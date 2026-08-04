import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('cookie parsing tolerates malformed values without corrupting neighboring cookies', () => {
  assert.deepEqual(parseCookies('annotated_session=token%3Dvalue; broken=%E0%A4%A; other=ok'), { annotated_session: 'token=value', other: 'ok' });
});

test('OAuth start creates a PKCE challenge and short-lived state cookies', async () => {
  const saved = envSnapshot();
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.OAUTH_PROVIDERS = 'google';
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

test('X OAuth requests only the identity scope needed for sign-in', async () => {
  const saved = envSnapshot();
  process.env.X_CLIENT_ID = 'x-client';
  process.env.X_CLIENT_SECRET = 'x-secret';
  process.env.OAUTH_PROVIDERS = 'x';
  try {
    const result = await startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'x');
    assert.equal(new URL(result.location).searchParams.get('scope'), 'users.read');
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

test('X is the current production default and Google remains an opt-in sibling provider', () => {
  const saved = envSnapshot();
  delete process.env.OAUTH_PROVIDERS;
  process.env.X_CLIENT_ID = 'x-client';
  process.env.X_CLIENT_SECRET = 'x-secret';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.deepEqual(providerStatus(), { google: false, x: true });
    const result = spawnSync(process.execPath, ['-e', "import('./server/auth.js').then((auth) => auth.assertAuthConfiguration())"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', AUTH_REQUIRED: 'true', APP_ORIGIN: 'https://annotated.example.com' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    restoreEnv(saved);
  }
});

test('enabling X requires both X credentials without changing the Google adapter', () => {
  const saved = envSnapshot();
  process.env.OAUTH_PROVIDERS = 'google,x';
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.X_CLIENT_ID = 'x-client';
  delete process.env.X_CLIENT_SECRET;
  const result = spawnSync(process.execPath, ['-e', "import('./server/auth.js').then((auth) => auth.assertAuthConfiguration())"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', AUTH_REQUIRED: 'true', APP_ORIGIN: 'https://annotated.example.com' },
    encoding: 'utf8',
  });
  restoreEnv(saved);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /X_CLIENT_SECRET/);
});

test('unconfigured providers fail instead of emitting fake OAuth URLs', async () => {
  const saved = envSnapshot();
  process.env.OAUTH_PROVIDERS = 'google,x';
  try {
    await assert.rejects(() => startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'x'), /OAuth is not configured/);
  } finally {
    restoreEnv(saved);
  }
});

test('extension OAuth return URLs are constrained to Chromium app redirects', async () => {
  const saved = envSnapshot();
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.OAUTH_PROVIDERS = 'google';
  try {
    const result = await startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google', 'https://example.chromiumapp.org/annotated-auth');
    assert.equal(result.cookies.length, 3);
    await assert.rejects(() => startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google', 'https://evil.example/callback'), /return URL is not allowed/);
    await assert.rejects(() => startOAuth({ headers: {}, socket: { remoteAddress: 'test-client' } }, 'google', 'https://example.chromiumapp.org.evil.example/callback'), /return URL is not allowed/);
  } finally {
    restoreEnv(saved);
  }
});

test('OAuth callback exchanges provider identity and consumes an extension ticket', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-auth-'));
  const script = `
    const { exchangeExtensionTicket, finishOAuth, parseCookies, startOAuth } = await import('./server/auth.js');
    const request = { headers: {}, socket: { remoteAddress: 'oauth-test' } };
    const started = await startOAuth(request, 'google', 'https://example.chromiumapp.org/annotated-auth');
    const cookieHeader = started.cookies.join('; ');
    const cookies = parseCookies(cookieHeader);
    globalThis.fetch = async (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'provider-access-token' }) };
      return { ok: true, json: async () => ({ sub: 'google-user-1', email: 'reader@example.com', name: 'Reader' }) };
    };
    const callback = new URL('http://localhost:8787/api/auth/google/callback');
    callback.searchParams.set('code', 'oauth-code');
    callback.searchParams.set('state', cookies.annotated_oauth_state);
    const finished = await finishOAuth({ headers: { cookie: cookieHeader } }, 'google', callback);
    const ticket = new URL(finished.redirectTo).searchParams.get('ticket');
    const exchanged = await exchangeExtensionTicket(ticket);
    let replayError = '';
    try { await exchangeExtensionTicket(ticket); } catch (error) { replayError = error.message; }
    console.log(JSON.stringify({ provider: finished.user.provider, handle: finished.user.handle, sessionCookie: finished.cookie.includes('annotated_session='), clearedCookies: finished.clearCookies.length, exchangedUser: exchanged.user.id === finished.user.id, replayError }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANNOTATED_STORAGE: 'file',
      ANNOTATED_DATA_DIR: dataDirectory,
      PUBLIC_ORIGIN: 'http://localhost:8787',
      APP_ORIGIN: 'https://annotated.example.com',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_PROVIDERS: 'google',
    },
    encoding: 'utf8',
    maxBuffer: 1_000_000,
  });
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output, { provider: 'google', handle: 'reader', sessionCookie: true, clearedCookies: 3, exchangedUser: true, replayError: 'Extension auth ticket is invalid or expired.' });
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('web OAuth returns to the requesting app page without issuing an extension ticket', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-web-auth-'));
  const script = `
    const { finishOAuth, parseCookies, startOAuth } = await import('./server/auth.js');
    const request = { headers: {}, socket: { remoteAddress: 'web-oauth-test' } };
    const started = await startOAuth(request, 'google', 'https://annotated.example.com/u/reader?view=feed');
    const cookieHeader = started.cookies.join('; ');
    const cookies = parseCookies(cookieHeader);
    globalThis.fetch = async (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'provider-access-token' }) };
      return { ok: true, json: async () => ({ sub: 'google-user-2', email: 'reader@example.com', name: 'Reader' }) };
    };
    const callback = new URL('https://annotated.example.com/api/auth/google/callback');
    callback.searchParams.set('code', 'oauth-code');
    callback.searchParams.set('state', cookies.annotated_oauth_state);
    const finished = await finishOAuth({ headers: { cookie: cookieHeader } }, 'google', callback);
    console.log(JSON.stringify({ redirectTo: finished.redirectTo, hasTicket: finished.redirectTo.includes('ticket=') }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANNOTATED_STORAGE: 'file',
      ANNOTATED_DATA_DIR: dataDirectory,
      PUBLIC_ORIGIN: 'http://localhost:8787',
      APP_ORIGIN: 'https://annotated.example.com',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_PROVIDERS: 'google',
    },
    encoding: 'utf8',
    maxBuffer: 1_000_000,
  });
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output, { redirectTo: 'https://annotated.example.com/u/reader?view=feed&auth=success', hasTicket: false });
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
