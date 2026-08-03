import assert from 'node:assert/strict';
import test from 'node:test';
import { compactDraft, compactPending, extensionStorage, MAX_PENDING_CAPTURES, normalizeApiOrigin } from '../extension/storage.js';

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

test('pending captures stay bounded and preserve only retry metadata', () => {
  const pending = compactPending({ id: 'capture-1', payload: { commentary: 'keep this' }, attempts: 3, blob: new Blob(['audio']) });
  assert.equal(MAX_PENDING_CAPTURES, 5);
  assert.equal(pending.id, 'capture-1');
  assert.equal(pending.attempts, 3);
  assert.equal('blob' in pending, false);
  assert.equal('blob' in pending.payload, false);
});

test('deployed extension origins require HTTPS while local development remains usable', () => {
  assert.equal(normalizeApiOrigin('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(normalizeApiOrigin('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeApiOrigin('https://annotated.example.com/api/'), 'https://annotated.example.com');
  assert.throws(() => normalizeApiOrigin('http://annotated.example.com'), /https outside local/);
  assert.throws(() => normalizeApiOrigin('file:///tmp/api'), /http or https/);
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
