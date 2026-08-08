const DB_NAME = 'annotated-extension-media';
const DB_VERSION = 1;
const STORE_NAME = 'audio-drafts';

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open local audio storage.'));
});

const transaction = (database, mode, operation) => new Promise((resolve, reject) => {
  const current = database.transaction(STORE_NAME, mode);
  operation(current.objectStore(STORE_NAME));
  current.oncomplete = () => resolve();
  current.onerror = () => reject(current.error || new Error('Local audio storage failed.'));
  current.onabort = () => reject(current.error || new Error('Local audio storage was aborted.'));
});

const readValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result || null);
  request.onerror = () => reject(request.error || new Error('Local audio read failed.'));
});

const id = () => crypto.randomUUID();

export async function stageAudioDraft(blob, metadata = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('The recorded audio is empty.');
  const record = { id: id(), blob, mimeType: blob.type || 'audio/webm', createdAt: new Date().toISOString(), ...metadata };
  const database = await openDatabase();
  await transaction(database, 'readwrite', (store) => store.put(record));
  database.close();
  return record.id;
}

export async function readAudioDraft(audioDraftId) {
  if (!audioDraftId) return null;
  const database = await openDatabase();
  const record = await readValue(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(audioDraftId));
  database.close();
  return record;
}

export async function deleteAudioDraft(audioDraftId) {
  if (!audioDraftId) return;
  const database = await openDatabase();
  await transaction(database, 'readwrite', (store) => store.delete(audioDraftId));
  database.close();
}

// A staged take is referenced from exactly two places: the panel's saved
// draft and a queued capture's payload. Anything else in this store is an
// orphan — the extension reloaded mid-record, or a draft was replaced before
// its take reached the server — and an orphan is megabytes of audio that
// nothing else ever collects. The grace window protects a take that was
// staged seconds ago but whose id has not been written to storage yet; a
// record with no readable createdAt predates that field and is never in
// flight, so it is always sweepable.
export async function sweepOrphanedAudioDrafts(liveIds = [], graceMs = 86_400_000) {
  const live = new Set([...liveIds].filter(Boolean));
  const cutoff = Date.now() - Math.max(0, graceMs);
  const database = await openDatabase();
  const removed = [];
  try {
    await new Promise((resolve, reject) => {
      const current = database.transaction(STORE_NAME, 'readwrite');
      const request = current.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const staged = Date.parse(cursor.value?.createdAt || '');
        if (!live.has(cursor.key) && !(Number.isFinite(staged) && staged >= cutoff)) {
          cursor.delete();
          removed.push(cursor.key);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('Local audio sweep failed.'));
      current.oncomplete = () => resolve();
      current.onerror = () => reject(current.error || new Error('Local audio sweep failed.'));
      current.onabort = () => reject(current.error || new Error('Local audio sweep was aborted.'));
    });
  } finally {
    database.close();
  }
  return removed;
}
