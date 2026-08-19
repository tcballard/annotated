import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const configuredOrigin = process.env.STAGING_ORIGIN || process.env.PUBLIC_ORIGIN || 'https://annotated-staging.up.railway.app';
const origin = new URL(configuredOrigin);
if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('STAGING_ORIGIN must use http or https.');
origin.pathname = '';
origin.search = '';
origin.hash = '';

const checks = [];
const extensionOrigin = 'chrome-extension://omlikcdpcdhfmdojdalfdeihgjmgikkg';
const sourceFixtures = [
  {
    name: 'youtube',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    sourceType: 'video',
    provider: 'youtube',
    processing: 'ready-for-range',
  },
  {
    name: 'article',
    url: 'https://example.com/',
    sourceType: 'article',
    processing: 'text-ready',
    canonicalUrl: 'https://example.com/',
  },
  {
    name: 'podcast',
    url: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
    sourceType: 'podcast',
    processing: 'ready-for-range',
    mediaUrl: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
  },
];

const request = async (path, expectedStatus = 200) => {
  const response = await fetch(new URL(path, origin), { redirect: 'error' });
  const body = await response.text();
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}: ${body.slice(0, 240)}`);
  checks.push({ path, status: response.status });
  return { response, body };
};

const json = async (path, expectedStatus = 200) => {
  const { body } = await request(path, expectedStatus);
  try { return JSON.parse(body); } catch (error) { throw new Error(`${path} did not return JSON: ${error.message}`); }
};

const resolveSource = async (fixture) => {
  const response = await fetch(new URL('/api/sources/resolve', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: fixture.url }),
    redirect: 'error',
  });
  const body = await response.text();
  assert.equal(response.status, 200, `/api/sources/resolve (${fixture.name}) returned ${response.status}: ${body.slice(0, 240)}`);
  let payload;
  try { payload = JSON.parse(body); } catch (error) { throw new Error(`/api/sources/resolve (${fixture.name}) did not return JSON: ${error.message}`); }
  const source = payload.source || {};
  assert.equal(source.sourceType, fixture.sourceType, `${fixture.name} source type changed.`);
  assert.equal(source.processing, fixture.processing, `${fixture.name} processing state changed.`);
  if (fixture.provider) assert.equal(source.provider, fixture.provider, `${fixture.name} provider changed.`);
  if (fixture.canonicalUrl) assert.equal(source.canonicalUrl, fixture.canonicalUrl, `${fixture.name} canonical URL changed.`);
  if (fixture.mediaUrl) assert.equal(source.mediaUrl, fixture.mediaUrl, `${fixture.name} media URL changed.`);
  return { name: fixture.name, sourceType: source.sourceType, provider: source.provider || null, processing: source.processing, canonicalUrl: source.canonicalUrl, mediaUrl: source.mediaUrl || null };
};

const health = await json('/api/health');
assert.equal(health.status, 'ok');
assert.equal(health.persistence, 'postgres');

const extensionHealth = await fetch(new URL('/api/health', origin), { headers: { origin: extensionOrigin }, redirect: 'error' });
assert.equal(extensionHealth.status, 200, 'the packaged extension origin must reach the deployed API');
assert.equal(extensionHealth.headers.get('access-control-allow-origin'), extensionOrigin, 'the deployed API must reflect the approved extension origin');
checks.push({ path: '/api/health', origin: extensionOrigin, status: extensionHealth.status });
const extensionPreflight = await fetch(new URL('/api/auth/extension/exchange', origin), {
  method: 'OPTIONS',
  headers: { origin: extensionOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  redirect: 'error',
});
assert.equal(extensionPreflight.status, 204, 'the extension auth exchange preflight must be accepted');
assert.equal(extensionPreflight.headers.get('access-control-allow-origin'), extensionOrigin);
checks.push({ path: '/api/auth/extension/exchange', origin: extensionOrigin, status: extensionPreflight.status });

const ready = await json('/api/ready');
assert.equal(ready.status, 'ready');
assert.equal(ready.persistence, 'postgres');
assert.equal(ready.mediaRuntime?.status, 'external');
assert.equal(ready.mediaRuntime?.role, 'api');
assert.equal(ready.mediaRuntime?.concurrency, 0);

const providers = await json('/api/auth/providers');
assert.equal(providers.required, true);
assert.deepEqual(Object.keys(providers.providers || {}).sort(), ['google', 'x']);
assert.ok(Object.values(providers.providers).some(Boolean), 'at least one OAuth provider must be enabled');

let capabilities = await json('/api/capabilities');
for (let attempt = 0; !capabilities.proofWorld?.ready && attempt < 24; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  capabilities = await json('/api/capabilities');
}
assert.equal(capabilities.isCanonicalDeployment, true, 'acceptance must target the canonical staging deployment');
assert.equal(capabilities.distribution?.store?.status, 'not-submitted', 'Store status must match the release record');
assert.deepEqual(capabilities.providers, providers.providers, 'provider state must have one runtime source');
assert.equal(capabilities.distribution?.directArtifact?.available, true, 'the exact extension build must be downloadable');
assert.equal(capabilities.proofWorld?.ready, true, `proof world is incomplete: ${(capabilities.proofWorld?.missing || []).join(', ')}`);
const artifactResponse = await fetch(new URL(capabilities.distribution.directArtifact.path, origin));
assert.equal(artifactResponse.status, 200, 'direct extension artifact must download');
assert.equal(artifactResponse.headers.get('content-type'), 'application/zip');
const artifactBytes = Buffer.from(await artifactResponse.arrayBuffer());
assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), capabilities.distribution.directArtifact.sha256, 'downloaded artifact must match its published checksum');
checks.push({ path: capabilities.distribution.directArtifact.path, status: artifactResponse.status, bytes: artifactBytes.length });

const oauthPreflight = [];
for (const [provider, enabled] of Object.entries(providers.providers)) {
  if (!enabled) continue;
  const startResponse = await fetch(new URL(`/api/auth/${provider}/start?returnTo=%2F`, origin), { redirect: 'manual' });
  assert.equal(startResponse.status, 302, `${provider} OAuth start must redirect`);
  const authorizeUrl = startResponse.headers.get('location') || '';
  assert.match(authorizeUrl, provider === 'x' ? /twitter\.com\/i\/oauth2\/authorize/ : /accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  const cookies = startResponse.headers.getSetCookie?.() || [];
  const state = cookies.find((cookie) => cookie.startsWith('annotated_oauth_state='))?.split(';', 1)[0]?.split('=', 2)[1];
  const verifier = cookies.find((cookie) => cookie.startsWith('annotated_oauth_verifier='))?.split(';', 1)[0]?.split('=', 2)[1];
  assert.ok(state && verifier, `${provider} OAuth start must issue PKCE state cookies`);

  const callbackUrl = new URL(`/api/auth/${provider}/callback?error=access_denied&state=${encodeURIComponent(state)}`, origin);
  const callbackResponse = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: { cookie: `annotated_oauth_state=${state}; annotated_oauth_verifier=${verifier}` },
  });
  assert.equal(callbackResponse.status, 302, `${provider} OAuth cancellation must redirect`);
  const returnUrl = callbackResponse.headers.get('location') || '';
  assert.equal(new URL(returnUrl).origin, origin.origin);
  assert.match(returnUrl, /[?&]auth=/);
  oauthPreflight.push({ provider, startStatus: startResponse.status, cancellationStatus: callbackResponse.status });
}

const sourcePreflight = [];
for (const fixture of sourceFixtures) sourcePreflight.push(await resolveSource(fixture));

const feed = await json('/api/feed?limit=3');
assert.ok(Array.isArray(feed.annotations));
assert.equal(feed.annotations.length <= 3, true);

const { body: root } = await request('/');
assert.match(root, /\/brand\/favicon\.svg/);
assert.match(root, /keep the moment/i);

const { body: privacy } = await request('/privacy.html');
assert.match(privacy, /privacy policy/i);
assert.match(privacy, /browser extension/i);

const me = await json('/api/me');
assert.equal(me.authenticated, false, 'anonymous /api/me must report authenticated:false without a 401');
assert.equal(me.user, null);
await request('/api/claims', 401);

console.log(JSON.stringify({
  origin: origin.origin,
  version: health.version,
  persistence: health.persistence,
  providerState: providers.providers,
  release: capabilities.release,
  proofWorld: capabilities.proofWorld,
  directArtifact: { version: capabilities.distribution.directArtifact.version, sha256: capabilities.distribution.directArtifact.sha256, bytes: artifactBytes.length },
  oauthPreflight,
  sourcePreflight,
  feedAnnotations: feed.annotations.length,
  checks,
}, null, 2));
