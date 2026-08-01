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
