import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { authIsRequired, parseCookies, providerStatus, startOAuth } from '../server/auth.js';

const envSnapshot = () => ({ ...process.env });
const restoreEnv = (snapshot) => {
  for (const name of Object.keys(process.env)) if (!(name in snapshot)) delete process.env[name];
  for (const [name, value] of Object.entries(snapshot)) process.env[name] = value;
};

test('development identity remains explicit and providers report configuration state', () => {
  assert.equal(authIsRequired(), false);
  assert.deepEqual(providerStatus(), { google: false, x: false });
});

test('OAuth start creates a PKCE challenge and short-lived state cookies', async () => {
  const saved = envSnapshot();
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  try {
    const result = await startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google');
    assert.match(result.location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.match(result.location, /client_id=google-client/);
    assert.match(result.location, /code_challenge_method=S256/);
    assert.equal(result.cookies.length, 2);
    const stateCookie = parseCookies(result.cookies[0]);
    assert.ok(stateCookie.annotated_oauth_state);
  } finally {
    restoreEnv(saved);
  }
});

test('production authentication fails fast when either required provider is absent', () => {
  const result = spawnSync(process.execPath, ['-e', "import('./server/auth.js').then((auth) => auth.assertAuthConfiguration())"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', X_CLIENT_ID: '', X_CLIENT_SECRET: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /Production authentication requires/);
});

test('unconfigured providers fail instead of emitting fake OAuth URLs', async () => {
  await assert.rejects(() => startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'x'), /OAuth is not configured/);
});

test('extension OAuth return URLs are constrained to Chromium app redirects', async () => {
  const saved = envSnapshot();
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  try {
    const result = await startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google', 'https://example.chromiumapp.org/annotated-auth');
    assert.equal(result.cookies.length, 3);
    await assert.rejects(() => startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google', 'https://evil.example/callback'), /return URL is not allowed/);
  } finally {
    restoreEnv(saved);
  }
});
