import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredExtensionIds } from './cors.js';
import { assertExactStoreExternalGateIds, assertFreshStoreReceipt } from './store-contract.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'config/capabilities.json');
const releasePath = path.join(projectRoot, 'dist/release/release.json');
const distRoot = path.join(projectRoot, 'dist');

export const proofWorldStatus = (store = {}) => {
  const users = (store.users || []).filter((item) => item.isDemo || item.provider === 'demo');
  const annotations = (store.annotations || []).filter((item) => item.isDemo && item.status === 'published');
  const required = {
    labelledDemoUsers: users.length >= 4,
    article: annotations.some((item) => item.sourceType === 'article'),
    video: annotations.some((item) => item.sourceType === 'video' && item.mediaStatus === 'ready' && item.mediaAssetId),
    podcast: annotations.some((item) => item.sourceType === 'podcast' && item.mediaStatus === 'ready' && item.mediaAssetId),
    screenshot: annotations.some((item) => item.screenshotAssetId),
    audioCommentary: annotations.some((item) => item.audioAssetId || item.commentaryMode === 'audio'),
    responses: (store.comments || []).some((item) => annotations.some((annotation) => annotation.id === item.annotationId)),
    socialGraph: (store.follows || []).length > 0 && (store.likes || []).length > 0,
    demonstrationClaim: (store.claims || []).some((item) => item.isDemo),
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  return { ready: missing.length === 0, label: 'Demonstration data — not real user activity', counts: { users: users.length, annotations: annotations.length }, required, missing };
};

const readOptionalJson = async (filePath) => {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const releaseEvidenceStatus = async (artifact, gitSha) => {
  const metadata = artifact?.evidence?.browser;
  if (!metadata?.receiptPath) return { valid: false, reason: 'No authoritative browser release receipt is embedded.' };
  try {
    const relativePath = String(metadata.receiptPath).replace(/^\/+/, '');
    const receiptPath = path.resolve(distRoot, relativePath);
    if (!receiptPath.startsWith(`${distRoot}${path.sep}`)) throw new Error('Receipt path escapes the release build.');
    const bytes = await readFile(receiptPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== metadata.sha256 || bytes.length !== metadata.bytes) throw new Error('Receipt integrity does not match release metadata.');
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (receipt.schemaVersion !== 1 || receipt.kind !== 'annotated.release-receipt' || !receipt.authoritative || receipt.status !== 'passed') throw new Error('Receipt is not an authoritative pass.');
    if (receipt.artifact?.version !== artifact.version || receipt.artifact?.sha256 !== artifact.sha256) throw new Error('Receipt artifact does not match this extension package.');
    if ((gitSha || artifact.gitSha) && receipt.gitSha !== (gitSha || artifact.gitSha)) throw new Error('Receipt git SHA does not match this deployment.');
    return {
      valid: true,
      receipt,
      publicPath: metadata.receiptPath,
      sha256,
      verifiedAt: receipt.capabilityEvidence?.verifiedAt || receipt.generatedAt,
    };
  } catch (error) {
    return { valid: false, reason: error.message || 'Release receipt could not be verified.' };
  }
};

const storeEvidenceStatus = async (artifact, storeManifest, storeManifestSha256, gitSha, browserEvidenceValid, now) => {
  const metadata = artifact?.evidence?.store;
  if (!metadata?.receiptPath) return { valid: false, reason: 'No live Store verification receipt is embedded.' };
  if (!browserEvidenceValid) return { valid: false, reason: 'Store promotion requires an authoritative browser release receipt.' };
  try {
    const relativePath = String(metadata.receiptPath).replace(/^\/+/, '');
    const receiptPath = path.resolve(distRoot, relativePath);
    if (!receiptPath.startsWith(`${distRoot}${path.sep}`)) throw new Error('Store receipt path escapes the release build.');
    const bytes = await readFile(receiptPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== metadata.sha256 || bytes.length !== metadata.bytes) throw new Error('Store receipt integrity does not match release metadata.');
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (receipt.schemaVersion !== 1 || receipt.status !== 'verified' || receipt.listingState !== 'published') throw new Error('Store receipt is not a verified publication.');
    assertFreshStoreReceipt(receipt, { now });
    if (receipt.listingManifestSha256 !== storeManifestSha256) throw new Error('Store receipt does not bind the deployed Store manifest.');
    assertExactStoreExternalGateIds(receipt.externalGateIds, 'Store receipt external gate IDs');
    if (receipt.itemId !== storeManifest.listingState.itemId || receipt.publicUrl !== storeManifest.listingState.publicUrl) throw new Error('Store receipt identity does not match the listing manifest.');
    if (receipt.version !== artifact.version || receipt.artifactSha256 !== artifact.sha256) throw new Error('Store receipt artifact does not match this extension package.');
    if ((gitSha || artifact.gitSha) && receipt.gitSha !== (gitSha || artifact.gitSha)) throw new Error('Store receipt git SHA does not match this deployment.');
    return { valid: true, receipt, publicPath: metadata.receiptPath, sha256 };
  } catch (error) {
    return { valid: false, reason: error.message || 'Store receipt could not be verified.' };
  }
};

export const requiredProvidersAvailable = (providers = {}) => providers.google === true && providers.x === true;
export const storeInstallReady = ({ canonical, listingStatus, storeEvidenceValid, extensionIdentityConfigured, providers }) => (
  canonical
  && listingStatus === 'published'
  && storeEvidenceValid
  && extensionIdentityConfigured
  && requiredProvidersAvailable(providers)
);

export const getCapabilities = async ({ publicOrigin, releaseVersion, providers, store, now = Date.now() }) => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.capabilities)) throw new Error('Unsupported capability manifest.');
  const storeManifestPath = path.resolve(projectRoot, manifest.distribution?.store?.manifestPath || '');
  if (!storeManifestPath.startsWith(`${projectRoot}${path.sep}`)) throw new Error('Store manifest must remain inside the project.');
  const storeManifestBytes = await readFile(storeManifestPath);
  const storeManifest = JSON.parse(storeManifestBytes.toString('utf8'));
  const storeManifestSha256 = createHash('sha256').update(storeManifestBytes).digest('hex');
  if (storeManifest.schemaVersion !== 1 || !storeManifest.listingState || !storeManifest.release) throw new Error('Unsupported Store manifest.');
  assertExactStoreExternalGateIds((storeManifest.externalGates || []).map((gate) => gate?.id), 'Store manifest external gate IDs');
  if (storeManifest.release.version !== releaseVersion) throw new Error('Store manifest version does not match the running release.');
  const artifact = await readOptionalJson(releasePath);
  const canonical = new URL(publicOrigin).origin === new URL(manifest.canonicalOrigin).origin;
  const gitSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.GITHUB_SHA || artifact?.gitSha || null;
  const environment = process.env.ANNOTATED_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
  const releaseEvidence = await releaseEvidenceStatus(artifact, gitSha);
  const storeEvidence = await storeEvidenceStatus(artifact, storeManifest, storeManifestSha256, gitSha, releaseEvidence.valid, now);
  const verifiedBrowserCapabilities = new Set(releaseEvidence.receipt?.capabilityEvidence?.capabilityIds || []);
  const expectedExtensionId = storeManifest.extensionIdentity?.expectedId || null;
  const extensionIdentityConfigured = Boolean(expectedExtensionId && configuredExtensionIds().includes(expectedExtensionId));
  const providersAvailable = requiredProvidersAvailable(providers);
  const oauthProviderVerified = providersAvailable && storeEvidence.valid && storeEvidence.receipt?.externalGateIds?.includes('oauth-round-trip');
  return {
    schemaVersion: manifest.schemaVersion,
    canonicalOrigin: manifest.canonicalOrigin,
    isCanonicalDeployment: canonical,
    release: {
      version: releaseVersion,
      gitSha,
      environment,
      deployedAt: process.env.ANNOTATED_DEPLOYED_AT || artifact?.builtAt || null,
      evidence: releaseEvidence.valid
        ? { status: 'passed', authoritative: true, path: releaseEvidence.publicPath, sha256: releaseEvidence.sha256, verifiedAt: releaseEvidence.verifiedAt }
        : { status: 'unverified', authoritative: false, blocker: releaseEvidence.reason },
    },
    providers,
    distribution: {
      store: {
        label: manifest.distribution.store.label,
        evidenceUrl: manifest.distribution.store.evidenceUrl,
        status: storeManifest.listingState.status,
        itemId: storeManifest.listingState.itemId,
        publicUrl: storeManifest.listingState.publicUrl,
        publicUrlVerifiedAt: storeManifest.listingState.publicUrlVerifiedAt,
        version: storeManifest.release.version,
        expectedExtensionId,
        extensionIdentityConfigured,
        requiredProvidersAvailable: providersAvailable,
        installReady: storeInstallReady({ canonical, listingStatus: storeManifest.listingState.status, storeEvidenceValid: storeEvidence.valid, extensionIdentityConfigured, providers }),
        verification: storeEvidence.valid
          ? { status: 'verified', path: storeEvidence.publicPath, sha256: storeEvidence.sha256, checkedAt: storeEvidence.receipt.checkedAt, expiresAt: storeEvidence.receipt.expiresAt }
          : { status: 'unverified', blocker: storeEvidence.reason },
      },
      directArtifact: artifact ? { ...manifest.distribution.directArtifact, available: true, version: artifact.version, sha256: artifact.sha256, bytes: artifact.bytes } : { ...manifest.distribution.directArtifact, available: false },
      // Native app store listings light up the /app page and its banner the
      // moment an operator configures the URLs; absent, the page says so.
      app: {
        ios: process.env.APP_STORE_URL_IOS || null,
        android: process.env.APP_STORE_URL_ANDROID || null,
      },
    },
    proofWorld: proofWorldStatus(store),
    capabilities: manifest.capabilities.map((item) => {
      const browserVerified = verifiedBrowserCapabilities.has(item.id) && releaseEvidence.valid;
      const providerAvailable = item.id === 'oauth'
        ? Object.keys(providers || {}).length > 0 && Object.values(providers).every(Boolean) && extensionIdentityConfigured
        : undefined;
      return {
        ...item,
        browserVerified,
        providerVerified: item.id === 'oauth' ? oauthProviderVerified : Boolean(item.providerVerified),
        ...(item.id === 'oauth' ? { providerAvailable } : {}),
        verifiedAt: browserVerified ? releaseEvidence.verifiedAt : item.verifiedAt || manifest.reviewedAt,
        deployed: canonical && item.stagingDeployed,
        ...((browserVerified && item.browserVerified === false) || (item.id === 'oauth' && oauthProviderVerified) ? { blocker: undefined } : {}),
      };
    }),
  };
};
