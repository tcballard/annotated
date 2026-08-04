import assert from 'node:assert/strict';
import test from 'node:test';
import { compactDraft, compactPending, DEFAULT_API_ORIGIN, extensionStorage, MAX_PENDING_ATTEMPTS, MAX_PENDING_CAPTURES, normalizeApiOrigin } from '../extension/storage.js';
import { signIn, signOut } from '../extension/config.js';

test('extension drafts remain bounded metadata and never retain media blobs', () => {
  const draft = compactDraft({
    sourceType: 'video',
    sourceUrl: 'https://youtube.com/watch?v=example',
    sourceTitle: 'x'.repeat(800),
    sourceExcerpt: 'y'.repeat(4000),
    commentary: 'z'.repeat(800),
    audioDraftId: 'draft-1',
    blob: new Blob(['secret audio']),
  });
  assert.equal(draft.sourceTitle.length, 500);
  assert.equal(draft.sourceExcerpt.length, 2000);
  assert.equal(draft.commentary.length, 280);
  assert.equal(draft.audioDraftId, 'draft-1');
  assert.equal('blob' in draft, false);
  assert.equal(JSON.stringify(draft).includes('secret audio'), false);
});

test('extension drafts preserve absolute source time while bounding clip and audio duration', () => {
  const draft = compactDraft({ clipStart: 3660, clipEnd: 3750, audioDuration: 120 });
  assert.equal(draft.clipStart, 3660);
  assert.equal(draft.clipEnd, 3750);
  assert.equal(draft.audioDuration, 90);
});

test('pending captures stay bounded and preserve only retry metadata', () => {
  const pending = compactPending({ id: 'capture-1', payload: { commentary: 'keep this' }, attempts: 3, blob: new Blob(['audio']) });
  assert.equal(MAX_PENDING_CAPTURES, 5);
  assert.equal(pending.id, 'capture-1');
  assert.equal(pending.attempts, 3);
  assert.equal('blob' in pending, false);
  assert.equal('blob' in pending.payload, false);
});

test('pending captures persist uploaded audio IDs and bounded blocked failure state', async () => {
  const previousChrome = globalThis.chrome;
  const localState = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: localState[key] }; },
        async set(value) { Object.assign(localState, value); },
        async remove(key) { delete localState[key]; },
      },
    },
  };
  try {
    const id = await extensionStorage.queueCapture({ sourceUrl: 'https://example.com/story', commentaryMode: 'audio', audioDraftId: 'draft-1' });
    const queued = (await extensionStorage.getPendingCaptures())[0];
    const uploaded = await extensionStorage.updatePendingCapture(id, { payload: { ...queued.payload, audioAssetId: 'asset-1', audioDraftId: '' } });
    assert.equal(uploaded.payload.audioAssetId, 'asset-1');
    assert.equal(uploaded.payload.audioDraftId, '');
    const blocked = await extensionStorage.markPendingAttempt({ ...uploaded, attempts: MAX_PENDING_ATTEMPTS - 1 }, { retryable: true, message: 'backend unavailable' });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.attempts, MAX_PENDING_ATTEMPTS);
    assert.equal(blocked.lastError, 'backend unavailable');
    const reset = await extensionStorage.retryPendingCapture(id);
    assert.equal(reset.status, 'queued');
    assert.equal(reset.attempts, 0);
    assert.equal(reset.payload.audioAssetId, 'asset-1');
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test('queued captures deduplicate client retries and preserve auth-required work', async () => {
  const previousChrome = globalThis.chrome;
  const localState = {};
  const sessionState = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: localState[key] }; },
        async set(value) { Object.assign(localState, value); },
      },
      session: {
        async get(key) { return { [key]: sessionState[key] }; },
        async set(value) { Object.assign(sessionState, value); },
        async remove(key) { delete sessionState[key]; },
      },
    },
  };
  try {
    const payload = { sourceUrl: 'https://example.com/story', commentary: 'retry me', clientRequestId: 'request-1' };
    const firstId = await extensionStorage.queueCapture(payload);
    const secondId = await extensionStorage.queueCapture(payload);
    assert.equal(secondId, firstId);
    assert.equal((await extensionStorage.getPendingCaptures()).length, 1);
    const authRequired = await extensionStorage.markPendingAttempt((await extensionStorage.getPendingCaptures())[0], { authRequired: true, message: 'sign in again' });
    assert.equal(authRequired.status, 'needs-auth');
    assert.equal(authRequired.lastError, 'sign in again');
    const reset = await extensionStorage.retryPendingCapture(firstId);
    assert.equal(reset.status, 'queued');
    assert.equal(reset.attempts, 0);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test('deployed extension origins require HTTPS while local development remains usable', () => {
  assert.equal(normalizeApiOrigin('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(normalizeApiOrigin('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeApiOrigin('https://annotated.example.com/api/'), 'https://annotated.example.com');
  assert.throws(() => normalizeApiOrigin('http://annotated.example.com'), /https outside local/);
  assert.throws(() => normalizeApiOrigin('file:///tmp/api'), /http or https/);
});

test('tampered stored API origins fall back to the deployed staging origin', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return { annotatedConfig: { apiOrigin: 'http://annotated.example.com/unsafe' } }; },
      },
    },
  };
  try {
    assert.equal(await extensionStorage.getApiOrigin(), DEFAULT_API_ORIGIN);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test('extension sign out invalidates the server session then clears browser session storage', async () => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  let removed = '';
  globalThis.chrome = {
    storage: {
      local: { async get() { return {}; } },
      session: {
        async get() { return { annotatedSession: { token: 'session-token' } }; },
        async remove(key) { removed = key; },
      },
    },
  };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer session-token');
    return { ok: true, async json() { return { ok: true }; } };
  };
  try {
    await signOut();
    assert.equal(removed, 'annotatedSession');
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});

test('expired extension sessions are removed before a bearer token is returned', async () => {
  const previousChrome = globalThis.chrome;
  let removed = '';
  globalThis.chrome = {
    storage: {
      session: {
        async get() { return { annotatedSession: { token: 'expired-token', expiresAt: '2000-01-01T00:00:00.000Z' } }; },
        async remove(key) { removed = key; },
      },
    },
  };
  try {
    assert.equal(await extensionStorage.getAuthToken(), null);
    assert.equal(removed, 'annotatedSession');
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test('extension auth handoff accepts only its own callback origin and path', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: { local: { async get() { return {}; } } },
    identity: {
      getRedirectURL() { return 'https://extension-id.chromiumapp.org/annotated-auth'; },
      async launchWebAuthFlow() { return 'https://attacker.example/annotated-auth?ticket=stolen'; },
    },
  };
  try {
    await assert.rejects(signIn('google'), /did not return to this extension/);
    await assert.rejects(signIn('password'), /provider is not supported/);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
