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
  feedAnnotations: feed.annotations.length,
  checks,
}, null, 2));
