import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_STORE_EXTERNAL_GATE_IDS,
  STORE_RECEIPT_MAX_AGE_MS,
  describeStoreExternalGateInventory,
  inspectStoreExternalGateIds,
} from '../server/store-contract.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionIdPattern = /^[a-p]{32}$/;
const publishedStoreUrlPattern = /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?([a-p]{32})(?:[/?#]|$)/;
const allowedListingStates = new Set(['not-submitted', 'draft', 'submitted', 'in-review', 'staged', 'published', 'rejected', 'unpublished']);
export const requiredOnlineReceiptChecks = Object.freeze(['homepage', 'privacy', 'rights', 'support', 'capabilities', 'providers', 'extension-cors', 'public-store-url']);

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file) => stat(file).then((entry) => entry.isFile()).catch(() => false);
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const withinRoot = (root, relative) => {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
};

export const deriveExtensionId = (base64Key) => {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest().subarray(0, 16);
  return [...digest].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join('');
};

export const readPngDimensions = async (file) => {
  const bytes = await readFile(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG with an IHDR header');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

export const validateListingState = (state) => {
  const issues = [];
  if (!state || !allowedListingStates.has(state.status)) issues.push('listingState.status is invalid');
  if (state?.itemId !== null && !extensionIdPattern.test(String(state.itemId || ''))) issues.push('listingState.itemId must be null or a Chrome extension ID');
  if (state?.status === 'not-submitted' && (state.itemId || state.publicUrl || state.publicUrlVerifiedAt)) {
    issues.push('not-submitted listings cannot carry an item ID, public URL, or verification date');
  }
  if (state?.status !== 'published' && (state?.publicUrl || state?.publicUrlVerifiedAt)) {
    issues.push(`${state.status} listings cannot claim a public Store URL or verification date`);
  }
  if (state?.status === 'published') {
    const match = String(state.publicUrl || '').match(publishedStoreUrlPattern);
    if (!match) issues.push('published listings require a canonical Chrome Web Store URL');
    if (!state.itemId) issues.push('published listings require the assigned item ID');
    if (match && state.itemId && match[1] !== state.itemId) issues.push('the public Store URL item ID does not match listingState.itemId');
    if (!Number.isFinite(Date.parse(state.publicUrlVerifiedAt || ''))) issues.push('published listings require a valid publicUrlVerifiedAt timestamp');
  }
  return issues;
};

const walkRuntimeFiles = async (directory, relative = '') => {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkRuntimeFiles(directory, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
};

const findReleaseManifest = async (root) => {
  const candidates = [
    path.join(root, 'dist/release/release.json'),
    path.join(root, 'public/release/release.json'),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
};

const fetchChecked = async (fetchImpl, url, options = {}) => {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { response, body };
};

export const verifyPublishedStoreListing = async (state, fetchImpl = globalThis.fetch, expectedName = '') => {
  if (state?.status !== 'published') return { required: false, passed: true, detail: 'listing is not published' };
  if (validateListingState(state).length) return { required: true, passed: false, detail: validateListingState(state).join('; ') };
  if (typeof fetchImpl !== 'function') return { required: true, passed: false, detail: 'fetch is unavailable' };
  try {
    const { response, body } = await fetchChecked(fetchImpl, state.publicUrl);
    const finalMatch = String(response.url || '').match(publishedStoreUrlPattern);
    const marker = String(expectedName || '').split(/[—–-]/u)[0].trim().toLowerCase();
    const normalizedBody = String(body || '').toLowerCase();
    const unavailable = /(?:item|extension).{0,40}(?:unavailable|not found|does not exist|was removed)|404 not found/iu.test(normalizedBody);
    const identityMatches = finalMatch?.[1] === state.itemId;
    const contentMatches = Boolean(marker) && normalizedBody.includes(marker) && !unavailable;
    const passed = identityMatches && contentMatches;
    const detail = !identityMatches
      ? `response resolved to a different Store item: ${response.url || 'unknown URL'}`
      : !contentMatches
        ? 'Store response did not contain the expected listing identity or reported the item unavailable'
        : `resolved to ${response.url} with the expected listing identity`;
    return { required: true, passed, detail };
  } catch (error) {
    return { required: true, passed: false, detail: error.message };
  }
};

export const liveReleaseMatches = ({ live, canonicalOrigin, listingStatus, release, extensionVersion }) => Boolean(
  live?.canonicalOrigin === canonicalOrigin
  && live?.distribution?.store?.status === listingStatus
  && live?.release?.gitSha === release?.gitSha
  && live?.release?.version === extensionVersion
  && live?.distribution?.directArtifact?.sha256 === release?.sha256
);

export const storeReceiptStatus = ({ listingState, ready, online, endpointChecks = [] }) => {
  if (!ready) return 'blocked';
  if (listingState !== 'published') return 'ready-not-published';
  const verified = online && requiredOnlineReceiptChecks.every((id) => endpointChecks.some((check) => check.id === id && check.passed));
  return verified ? 'verified' : 'blocked';
};

export const validateStoreReadiness = async ({
  root = projectRoot,
  listingPath = path.join(root, 'store-assets/store-listing.json'),
  online = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = () => new Date(),
} = {}) => {
  const checks = [];
  const blockers = [];
  const checkedDate = now();
  if (!(checkedDate instanceof Date) || !Number.isFinite(checkedDate.getTime())) throw new Error('Store readiness clock returned an invalid date.');
  const checkedAt = checkedDate.toISOString();
  const expiresAt = new Date(checkedDate.getTime() + STORE_RECEIPT_MAX_AGE_MS).toISOString();
  let releaseEvidence = null;
  const record = (id, passed, detail) => {
    checks.push({ id, passed, detail });
    if (!passed) blockers.push({ id, detail });
  };

  const listingBytes = await readFile(listingPath);
  const listing = JSON.parse(listingBytes.toString('utf8'));
  const listingManifestSha256 = createHash('sha256').update(listingBytes).digest('hex');
  const extensionManifest = await readJson(path.join(root, 'extension/manifest.json'));
  const releaseConfig = await readJson(path.join(root, 'config/release.json'));
  const packageManifest = await readJson(path.join(root, 'package.json'));
  const lock = await readJson(path.join(root, 'package-lock.json'));
  const capabilities = await readJson(path.join(root, 'config/capabilities.json'));
  const privacyPolicy = await readFile(path.join(root, 'public/privacy.html'), 'utf8');
  const extensionStorage = await readFile(path.join(root, 'extension/storage.js'), 'utf8');
  const corsSource = await readFile(path.join(root, 'server/cors.js'), 'utf8');
  const authSource = await readFile(path.join(root, 'server/auth.js'), 'utf8');
  const mainSource = await readFile(path.join(root, 'src/main.js'), 'utf8');

  record('listing-schema', listing.schemaVersion === 1, `schemaVersion is ${listing.schemaVersion}`);
  const listingStateIssues = validateListingState(listing.listingState);
  record('listing-state', listingStateIssues.length === 0, listingStateIssues.join('; ') || `honest state: ${listing.listingState.status}`);
  const externalGateInventory = inspectStoreExternalGateIds((listing.externalGates || []).map((gate) => gate?.id));
  record('external-gate-inventory', externalGateInventory.valid, describeStoreExternalGateInventory(externalGateInventory));
  if (listing.listingState.status === 'published') record('published-online-gate', online, online ? 'full live verification requested' : 'published state requires --online');
  const configuredStore = capabilities.distribution?.store || {};
  const configuredStoreManifest = String(configuredStore.manifestPath || '').replace(/^\//, '');
  const distributionTruth = configuredStore.status
    ? configuredStore.status === listing.listingState.status
    : configuredStoreManifest === 'store-assets/store-listing.json';
  record('distribution-truth', distributionTruth, configuredStore.status ? `legacy capability status says ${configuredStore.status}` : `capability manifest delegates to ${configuredStoreManifest || 'nothing'}`);

  const versions = {
    package: packageManifest.version,
    lock: lock.version,
    lockRoot: lock.packages?.['']?.version,
    extension: extensionManifest.version,
  };
  const versionValues = Object.values(versions);
  record('source-version-alignment', versionValues.every((value) => value === versionValues[0]), JSON.stringify(versions));
  record('listing-release-version', listing.release?.version === extensionManifest.version, `listing ${listing.release?.version}; extension ${extensionManifest.version}`);
  record('reproducible-release-epoch', releaseConfig.schemaVersion === 1 && releaseConfig.version === extensionManifest.version && Number.isSafeInteger(releaseConfig.sourceDateEpoch) && releaseConfig.sourceDateEpoch >= 315_532_800, `release epoch ${releaseConfig.sourceDateEpoch}; version ${releaseConfig.version}`);

  const releaseManifestPath = await findReleaseManifest(root);
  if (!releaseManifestPath) {
    record('release-version-alignment', false, 'run npm run build to generate release/release.json and the checksummed ZIP');
  } else {
    const release = await readJson(releaseManifestPath);
    releaseEvidence = release;
    record('release-version-alignment', release.version === extensionManifest.version, `release ${release.version}; extension ${extensionManifest.version}`);
    const releaseDirectory = path.dirname(releaseManifestPath);
    const artifactFile = path.join(releaseDirectory, path.basename(String(release.artifactPath || '')));
    const checksumFile = path.join(releaseDirectory, path.basename(String(release.checksumPath || '')));
    const artifactPresent = await exists(artifactFile);
    const checksumPresent = await exists(checksumFile);
    let checksumMatches = false;
    if (artifactPresent && checksumPresent) {
      const expected = (await readFile(checksumFile, 'utf8')).trim().split(/\s+/)[0];
      const actual = createHash('sha256').update(await readFile(artifactFile)).digest('hex');
      checksumMatches = /^[a-f0-9]{64}$/.test(expected) && expected === actual && expected === release.sha256;
    }
    record('release-artifact', artifactPresent && checksumPresent && checksumMatches, `${path.relative(root, artifactFile)} and checksum ${checksumMatches ? 'match' : 'do not match'}`);
    const pinnedSha = listing.release?.artifactSha256;
    const validPin = pinnedSha === null || (/^[a-f0-9]{64}$/.test(String(pinnedSha)) && pinnedSha === release.sha256);
    const publicationHasPin = listing.listingState.status !== 'published' || pinnedSha === release.sha256;
    record('listing-artifact-sha', validPin && publicationHasPin, pinnedSha ? `listing pins ${pinnedSha}` : 'null until the Store release is fixed; publication requires a matching SHA');
  }

  record('listing-name', listing.listing?.name === extensionManifest.name && listing.listing.name.length <= 75, `${listing.listing?.name || 'missing'}`);
  record('listing-summary', listing.listing?.summary === extensionManifest.description && listing.listing.summary.length <= 132, `${listing.listing?.summary?.length || 0}/132 characters and ${listing.listing?.summary === extensionManifest.description ? 'aligned' : 'not aligned'} with manifest`);
  record('listing-description', nonEmptyString(listing.listing?.description) && !/(store listing (?:is )?(?:in|awaiting) review|editor['’]s choice|number one extension)/i.test(listing.listing.description), 'description is present and makes no Store-status claim');
  record('single-purpose', nonEmptyString(listing.listing?.singlePurpose), listing.listing?.singlePurpose || 'missing');
  record('listing-taxonomy', listing.listing?.category === 'productivity' && listing.listing?.primaryLanguage === 'en' && ['public', 'unlisted', 'private'].includes(listing.listing?.visibility), `${listing.listing?.category}/${listing.listing?.primaryLanguage}/${listing.listing?.visibility}`);

  const declaredPermissions = [...(extensionManifest.permissions || []), ...(extensionManifest.host_permissions || [])].sort();
  const justifiedPermissions = Object.keys(listing.permissionJustifications || {}).sort();
  record('permission-inventory', JSON.stringify(declaredPermissions) === JSON.stringify(justifiedPermissions) && justifiedPermissions.every((key) => nonEmptyString(listing.permissionJustifications[key])), `${justifiedPermissions.length}/${declaredPermissions.length} permissions justified`);
  record('remote-code-declaration', listing.privacy?.usesRemoteCode === false, `usesRemoteCode=${listing.privacy?.usesRemoteCode}`);
  const runtimeFiles = (await walkRuntimeFiles(path.join(root, 'extension'))).filter((file) => /\.(?:js|html)$/.test(file));
  const remoteCodeFindings = [];
  for (const relative of runtimeFiles) {
    const source = await readFile(path.join(root, 'extension', relative), 'utf8');
    if (/\beval\s*\(|\bnew\s+Function\s*\(|import\s*\(\s*['"]https?:|<script[^>]+src\s*=\s*['"]https?:/i.test(source)) remoteCodeFindings.push(relative);
  }
  record('remote-code-scan', remoteCodeFindings.length === 0, remoteCodeFindings.length ? `possible remote code in ${remoteCodeFindings.join(', ')}` : 'no remote executable code patterns found');
  record('privacy-disclosure', /Chrome Web Store limited use/i.test(privacyPolicy) && /personalized[^<]{0,40}advertis/i.test(privacyPolicy) && /human review/i.test(privacyPolicy), 'local policy states collection, use, transfer, advertising, and human-review boundaries');
  const disclosedDataTypes = listing.privacy?.dataTypes || [];
  const disclosureShape = Array.isArray(disclosedDataTypes)
    && disclosedDataTypes.length > 0
    && disclosedDataTypes.every((item) => nonEmptyString(item?.dashboardLabel) && nonEmptyString(item?.scope));
  record('privacy-dashboard-shape', disclosureShape && listing.privacy.limitedUseCertified === true && listing.privacy.sold === false && listing.privacy.usedForAdvertising === false && listing.privacy.usedForCreditworthiness === false, `${disclosedDataTypes.length || 0} disclosed data types`);
  record('reviewer-instructions', listing.reviewerInstructions?.requiresTestAccount === true && /dashboard/i.test(listing.reviewerInstructions?.credentialPlacement || '') && Array.isArray(listing.reviewerInstructions?.steps) && listing.reviewerInstructions.steps.length >= 4 && nonEmptyString(listing.reviewerInstructions?.broadHostPermissionNote), `${listing.reviewerInstructions?.steps?.length || 0} reviewer steps; credentials stay in the dashboard`);

  let canonicalOrigin;
  try { canonicalOrigin = new URL(capabilities.canonicalOrigin).origin; } catch { canonicalOrigin = null; }
  const urlIssues = [];
  const parsedUrls = {};
  for (const [name, value] of Object.entries(listing.urls || {})) {
    try {
      const parsed = new URL(value);
      parsedUrls[name] = parsed;
      if (parsed.protocol !== 'https:') urlIssues.push(`${name} must use HTTPS`);
    } catch { urlIssues.push(`${name} is invalid`); }
  }
  if (parsedUrls.homepage?.origin !== canonicalOrigin) urlIssues.push('homepage must use the capability manifest canonical origin');
  if (parsedUrls.privacy?.origin !== canonicalOrigin || parsedUrls.privacy?.pathname !== '/privacy.html') urlIssues.push('privacy must be canonical /privacy.html');
  if (parsedUrls.rights?.origin !== canonicalOrigin || parsedUrls.rights?.pathname !== '/rights') urlIssues.push('rights must be canonical /rights');
  const supportIsRepository = parsedUrls.support?.origin === 'https://github.com' && parsedUrls.support?.pathname === '/tcballard/annotated/issues';
  const supportIsCanonical = parsedUrls.support?.origin === canonicalOrigin && parsedUrls.support?.pathname === '/support';
  if (!supportIsRepository && !supportIsCanonical) urlIssues.push('support must use the repository issue tracker or canonical /support');
  if (listing.extensionIdentity?.apiOrigin !== canonicalOrigin) urlIssues.push('extension API origin must equal the canonical origin');
  const urlConfigurationReady = urlIssues.length === 0;
  record('url-configuration', urlConfigurationReady, urlIssues.join('; ') || `canonical origin ${canonicalOrigin}`);
  record('extension-default-origin', extensionStorage.includes(`DEFAULT_API_ORIGIN = '${canonicalOrigin}'`), `packaged default is ${canonicalOrigin}`);
  record('rights-surface', /rights:\s*['"]\/rights['"]/.test(mainSource), 'public /rights route exists in the web application');

  const derivedId = deriveExtensionId(extensionManifest.key || '');
  record('extension-identity', extensionIdPattern.test(derivedId) && derivedId === listing.extensionIdentity?.expectedId, `key-derived ID ${derivedId}`);
  const expectedReturn = `https://${derivedId}.chromiumapp.org${listing.extensionIdentity?.oauthReturnPath || ''}`;
  record('oauth-return-url', listing.extensionIdentity?.oauthReturnUrl === expectedReturn, expectedReturn);
  const callbacks = listing.extensionIdentity?.providerCallbacks || {};
  record('provider-callbacks', callbacks.google === `${canonicalOrigin}/api/auth/google/callback` && callbacks.x === `${canonicalOrigin}/api/auth/x/callback`, JSON.stringify(callbacks));
  record('cors-source-allowlist', /CHROME_EXTENSION_IDS/.test(corsSource) && /configuredExtensionIds/.test(corsSource), 'CORS reads the configured extension-ID allowlist');
  record('oauth-source-allowlist', /isChromeExtensionRedirectUrl/.test(authSource) && /from ['"]\.\/cors\.js['"]/.test(authSource), 'OAuth return URLs use the same extension-ID allowlist as CORS');
  const draftIdentityComplete = listing.externalGates?.some((gate) => gate.id === 'draft-item-id' && gate.complete === true);
  const deploymentAllowlistComplete = listing.externalGates?.some((gate) => gate.id === 'deployment-extension-allowlist' && gate.complete === true);
  if (env.CWS_ITEM_ID || listing.listingState.status !== 'not-submitted' || draftIdentityComplete) {
    record('assigned-item-id', env.CWS_ITEM_ID === derivedId && listing.listingState.itemId === env.CWS_ITEM_ID, env.CWS_ITEM_ID ? `CWS_ITEM_ID=${env.CWS_ITEM_ID}` : 'CWS_ITEM_ID is required after the first draft upload');
  }
  if (env.CHROME_EXTENSION_IDS || deploymentAllowlistComplete || listing.listingState.status === 'published') {
    record('runtime-extension-id', String(env.CHROME_EXTENSION_IDS || '').split(',').map((value) => value.trim()).includes(derivedId), env.CHROME_EXTENSION_IDS ? 'CHROME_EXTENSION_IDS contains the packaged identity' : 'CHROME_EXTENSION_IDS is required for deployed Store identity proof');
  }

  const assets = Array.isArray(listing.assets) ? listing.assets : [];
  const screenshotAssets = assets.filter((asset) => asset.kind === 'screenshot');
  record('screenshot-inventory', screenshotAssets.length >= 1 && screenshotAssets.length <= 5, `${screenshotAssets.length}/5 screenshots declared`);
  record('small-promo-inventory', assets.filter((asset) => asset.kind === 'small-promo' && asset.required).length === 1, 'one required small promo declared');
  for (const asset of assets) {
    const assetFile = withinRoot(root, asset.path || '');
    if (!assetFile) {
      record(`asset:${asset.id}`, false, 'asset path escapes the repository');
      continue;
    }
    if (!(await exists(assetFile))) {
      record(`asset:${asset.id}`, !asset.required, `${asset.path} is ${asset.required ? 'required but missing' : 'optional and missing'}`);
      continue;
    }
    let dimensions;
    try { dimensions = await readPngDimensions(assetFile); } catch (error) {
      record(`asset:${asset.id}`, false, `${asset.path}: ${error.message}`);
      continue;
    }
    const allowedScreenshotSize = asset.kind !== 'screenshot' || (dimensions.width === 1280 && dimensions.height === 800) || (dimensions.width === 640 && dimensions.height === 400);
    const declaredSize = dimensions.width === asset.width && dimensions.height === asset.height;
    const ready = asset.status === 'ready' && asset.submittable === true;
    record(`asset:${asset.id}`, declaredSize && allowedScreenshotSize && ready, `${asset.path}: ${dimensions.width}x${dimensions.height}; status=${asset.status}; submittable=${asset.submittable}`);
  }

  const emailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(listing.publisher?.contactEmail || ''));
  record('publisher-contact-email', emailReady, emailReady ? listing.publisher.contactEmail : 'set a monitored, verified publisher email (not a placeholder)');
  for (const gate of listing.externalGates || []) {
    record(`external:${gate.id}`, gate.complete === true && nonEmptyString(gate.evidence), gate.complete ? (gate.evidence || 'completed without evidence') : gate.label);
  }

  const mustVerifyPublishedUrl = listing.listingState.status === 'published';
  if ((online || mustVerifyPublishedUrl) && typeof fetchImpl !== 'function') {
    record('online-verification', false, 'fetch is unavailable');
  } else if (online || mustVerifyPublishedUrl) {
    if (online) {
      for (const [name, value] of Object.entries(listing.urls || {})) {
        if (!urlConfigurationReady) {
          record(`online:${name}`, false, 'skipped because the committed URL configuration is invalid');
          continue;
        }
        try {
          const { body } = await fetchChecked(fetchImpl, value);
          const contentMatches = name === 'privacy' ? /privacy policy/i.test(body) && /Chrome Web Store limited use/i.test(body)
            : name === 'rights' ? /rights/i.test(body)
              : name === 'homepage' ? /annotated/i.test(body)
                : true;
          record(`online:${name}`, contentMatches, contentMatches ? `${value} reachable` : `${value} returned the wrong content`);
        } catch (error) { record(`online:${name}`, false, `${value}: ${error.message}`); }
      }
      try {
        const { body } = await fetchChecked(fetchImpl, `${canonicalOrigin}/api/capabilities`);
        const live = JSON.parse(body);
        const matches = liveReleaseMatches({ live, canonicalOrigin, listingStatus: listing.listingState.status, release: releaseEvidence, extensionVersion: extensionManifest.version });
        record('online:capabilities', matches, `live canonical=${live.canonicalOrigin}; Store=${live.distribution?.store?.status}; version=${live.release?.version}; git=${live.release?.gitSha}; artifact=${live.distribution?.directArtifact?.sha256}`);
      } catch (error) { record('online:capabilities', false, error.message); }
      try {
        const { body } = await fetchChecked(fetchImpl, `${canonicalOrigin}/api/auth/providers`);
        const live = JSON.parse(body);
        record('online:providers', live.providers?.google === true && live.providers?.x === true, `Google=${live.providers?.google}; X=${live.providers?.x}`);
      } catch (error) { record('online:providers', false, error.message); }
      try {
        const { response } = await fetchChecked(fetchImpl, `${canonicalOrigin}/api/health`, { headers: { origin: `chrome-extension://${derivedId}` } });
        record('online:extension-cors', response.headers.get('access-control-allow-origin') === `chrome-extension://${derivedId}`, `Access-Control-Allow-Origin=${response.headers.get('access-control-allow-origin')}`);
      } catch (error) { record('online:extension-cors', false, error.message); }
    }
    if (mustVerifyPublishedUrl) {
      const storeVerification = await verifyPublishedStoreListing(listing.listingState, fetchImpl, listing.listing?.name);
      record('online:public-store-url', storeVerification.passed, storeVerification.detail);
    }
  }

  const ready = blockers.length === 0;
  const onlineChecks = checks.filter((check) => check.id.startsWith('online:'));
  const endpointChecks = onlineChecks.map((check) => ({ id: check.id.slice('online:'.length), passed: check.passed, detail: check.detail }));
  const completedExternalGateIds = new Set((listing.externalGates || []).filter((gate) => gate.complete === true && nonEmptyString(gate.evidence)).map((gate) => gate.id));
  const externalGateIds = REQUIRED_STORE_EXTERNAL_GATE_IDS.filter((id) => completedExternalGateIds.has(id));
  const receipt = {
    schemaVersion: 1,
    status: storeReceiptStatus({ listingState: listing.listingState.status, ready, online, endpointChecks }),
    checkedAt,
    expiresAt,
    listingState: listing.listingState.status,
    itemId: listing.listingState.itemId,
    publicUrl: listing.listingState.publicUrl,
    version: extensionManifest.version,
    gitSha: releaseEvidence?.gitSha || null,
    artifactSha256: releaseEvidence?.sha256 || listing.release?.artifactSha256 || null,
    listingManifestSha256,
    externalGateIds,
    endpoints: endpointChecks,
  };
  return { ready, listingState: listing.listingState.status, version: extensionManifest.version, checks, blockers, receipt };
};

export const writeStoreReadinessReceipt = async (result, outputPath) => {
  if (!result?.receipt) throw new Error('A store-readiness result with a receipt is required.');
  await writeFile(outputPath, `${JSON.stringify(result.receipt, null, 2)}\n`, { mode: 0o644 });
  return outputPath;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const inventory = process.argv.includes('--inventory');
  const online = process.argv.includes('--online');
  const receiptFlag = process.argv.find((argument) => argument === '--receipt' || argument.startsWith('--receipt='));
  const receiptIndex = process.argv.indexOf('--receipt');
  const receiptValue = receiptFlag?.startsWith('--receipt=') ? receiptFlag.slice('--receipt='.length)
    : receiptIndex >= 0 && process.argv[receiptIndex + 1] && !process.argv[receiptIndex + 1].startsWith('--') ? process.argv[receiptIndex + 1]
      : receiptFlag ? 'store-assets/store-readiness-receipt.json' : null;
  if (receiptValue && !online) throw new Error('--receipt requires --online so the receipt cannot imply an offline verification.');
  const result = await validateStoreReadiness({ online });
  if (receiptValue) await writeStoreReadinessReceipt(result, path.resolve(projectRoot, receiptValue));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready && !inventory) process.exitCode = 1;
}
