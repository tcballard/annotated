import assert from 'node:assert/strict';

const configuredOrigin = process.env.STAGING_ORIGIN || process.env.PUBLIC_ORIGIN || 'https://annotated-staging.up.railway.app';
const origin = new URL(configuredOrigin);
if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('STAGING_ORIGIN must use http or https.');
origin.pathname = '';
origin.search = '';
origin.hash = '';

const checks = [];

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

const health = await json('/api/health');
assert.equal(health.status, 'ok');
assert.equal(health.persistence, 'postgres');

const ready = await json('/api/ready');
assert.equal(ready.status, 'ready');
assert.equal(ready.persistence, 'postgres');
assert.equal(ready.mediaRuntime?.status, 'ready');
assert.deepEqual(ready.mediaRuntime?.checks, ['ffmpeg', 'ffprobe', 'provider extractor']);

const providers = await json('/api/auth/providers');
assert.equal(providers.required, true);
assert.deepEqual(Object.keys(providers.providers || {}).sort(), ['google', 'x']);
assert.ok(Object.values(providers.providers).some(Boolean), 'at least one OAuth provider must be enabled');

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

const feed = await json('/api/feed?limit=3');
assert.ok(Array.isArray(feed.annotations));
assert.equal(feed.annotations.length <= 3, true);

const { body: root } = await request('/');
assert.match(root, /annotated-mark-32\.png/);
assert.match(root, /keep the moment/i);

const { body: privacy } = await request('/privacy.html');
assert.match(privacy, /privacy policy/i);
assert.match(privacy, /browser extension/i);

await request('/api/me', 401);
await request('/api/claims', 401);

console.log(JSON.stringify({
  origin: origin.origin,
  version: health.version,
  persistence: health.persistence,
  providerState: providers.providers,
  oauthPreflight,
  feedAnnotations: feed.annotations.length,
  checks,
}, null, 2));
