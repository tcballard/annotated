import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Staged audio is the only thing the extension keeps that is measured in
// megabytes. Every other draft field is bounded by compactDraft; a take is
// not. These tests exercise the sweep's selection rule directly against a
// minimal IndexedDB stand-in, because the risk is not "does it delete" — it
// is "does it delete the wrong one", and a take is unrecoverable.

const DB_NAME = 'annotated-extension-media';
const STORE_NAME = 'audio-drafts';

// Just enough IndexedDB for media-draft-store.js: open, a readwrite
// transaction, a forward cursor with delete/continue, and close. Callbacks
// fire on the microtask queue so ordering matches the real thing closely
// enough for the cursor walk under test.
const installFakeIndexedDB = (seed) => {
  const rows = new Map(seed.map((record) => [record.id, { ...record }]));
  const fire = (target, handler, value) => queueMicrotask(() => { if (target[handler]) target[handler](value); });

  const objectStore = (tx) => ({
    openCursor() {
      const request = { result: null, error: null };
      const keys = [...rows.keys()];
      let index = 0;
      const step = () => {
        if (index >= keys.length) {
          request.result = null;
          fire(request, 'onsuccess');
          queueMicrotask(() => fire(tx, 'oncomplete'));
          return;
        }
        const key = keys[index++];
        request.result = {
          key,
          value: rows.get(key),
          delete: () => rows.delete(key),
          continue: () => queueMicrotask(step),
        };
        fire(request, 'onsuccess');
      };
      queueMicrotask(step);
      return request;
    },
  });

  globalThis.indexedDB = {
    open(name) {
      assert.equal(name, DB_NAME, 'the sweep must open the extension media database');
      const request = { result: null, error: null };
      queueMicrotask(() => {
        request.result = {
          transaction(store, mode) {
            assert.equal(store, STORE_NAME);
            assert.equal(mode, 'readwrite', 'the sweep needs a readwrite transaction to delete');
            const tx = {};
            tx.objectStore = () => objectStore(tx);
            return tx;
          },
          close() { request.result.closed = true; },
        };
        fire(request, 'onsuccess');
      });
      return request;
    },
  };

  return rows;
};

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

const loadSweep = async () => {
  const { sweepOrphanedAudioDrafts } = await import('../extension/media-draft-store.js');
  return sweepOrphanedAudioDrafts;
};

test('the sweep reclaims orphaned takes and never touches a referenced one', async () => {
  const rows = installFakeIndexedDB([
    { id: 'in-draft', createdAt: iso(30 * DAY) },       // ancient, but the panel still holds it
    { id: 'in-queue', createdAt: iso(30 * DAY) },       // ancient, but a queued capture holds it
    { id: 'orphan-old', createdAt: iso(30 * DAY) },     // nothing references it
    { id: 'orphan-fresh', createdAt: iso(60_000) },     // staged a minute ago — id may not be saved yet
    { id: 'orphan-undated' },                           // predates createdAt: never in flight
  ]);

  const sweepOrphanedAudioDrafts = await loadSweep();
  const removed = await sweepOrphanedAudioDrafts(['in-draft', 'in-queue']);

  assert.deepEqual(removed.sort(), ['orphan-old', 'orphan-undated']);
  assert.deepEqual([...rows.keys()].sort(), ['in-draft', 'in-queue', 'orphan-fresh']);
});

test('the grace window protects a take staged seconds ago, then releases it', async () => {
  const sweepOrphanedAudioDrafts = await loadSweep();

  const held = installFakeIndexedDB([{ id: 'just-recorded', createdAt: iso(5_000) }]);
  assert.deepEqual(await sweepOrphanedAudioDrafts([]), [], 'a take from five seconds ago is still in flight');
  assert.equal(held.size, 1);

  const aged = installFakeIndexedDB([{ id: 'yesterday', createdAt: iso(2 * DAY) }]);
  assert.deepEqual(await sweepOrphanedAudioDrafts([]), ['yesterday'], 'past the window it is an orphan');
  assert.equal(aged.size, 0);
});

test('an empty live set is not treated as "sweep everything recent"', async () => {
  const sweepOrphanedAudioDrafts = await loadSweep();
  // A storage read that failed hands the sweep [undefined] — the falsy entries
  // must drop out without becoming a key that accidentally matches nothing.
  const rows = installFakeIndexedDB([{ id: 'orphan', createdAt: iso(10 * DAY) }, { id: 'fresh', createdAt: iso(1_000) }]);
  assert.deepEqual(await sweepOrphanedAudioDrafts([undefined, '', null]), ['orphan']);
  assert.deepEqual([...rows.keys()], ['fresh']);
});

test('the background worker sweeps at startup and after an update, from a complete live set', async () => {
  const runtime = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

  assert.match(runtime, /sweepOrphanedAudioDrafts/, 'background must import the sweep');
  // the live set is the saved draft plus every queued capture — miss either
  // and the sweep deletes a take the user is still waiting to publish
  const sweeper = runtime.slice(runtime.indexOf('const sweepStagedAudio'), runtime.indexOf('chrome.runtime.onInstalled'));
  assert.match(sweeper, /getDraft\(\)/);
  assert.match(sweeper, /getPendingCaptures\(\)/);
  assert.match(sweeper, /payload\?\.audioDraftId/);

  for (const hook of ['onInstalled', 'onStartup']) {
    const listener = runtime.slice(runtime.indexOf(`chrome.runtime.${hook}.addListener`));
    const body = listener.slice(0, listener.indexOf('\n});'));
    assert.match(body, /sweepStagedAudio/, `${hook} must run the staged-audio sweep`);
  }
});
