const databaseName = 'annotated-local';
const databaseVersion = 1;
const storeName = 'media-drafts';

const supported = () => typeof indexedDB !== 'undefined';

const openDatabase = () => new Promise((resolve, reject) => {
  if (!supported()) {
    reject(new Error('IndexedDB is unavailable.'));
    return;
  }
  const request = indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) {
      request.result.createObjectStore(storeName, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open local media storage.'));
});

const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Local media storage request failed.'));
});

const transaction = (database, mode, operation) => new Promise((resolve, reject) => {
  const current = database.transaction(storeName, mode);
  current.oncomplete = () => resolve();
  current.onerror = () => reject(current.error || new Error('Local media storage transaction failed.'));
  operation(current.objectStore(storeName));
});

const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function stageMediaDraft(blob, metadata = {}) {
  const database = await openDatabase();
  const record = { id: id(), blob, mimeType: blob.type || 'application/octet-stream', createdAt: new Date().toISOString(), ...metadata };
  await transaction(database, 'readwrite', (store) => store.put(record));
  database.close();
  return record.id;
}

export async function readMediaDraft(mediaId) {
  if (!mediaId || !supported()) return null;
  const database = await openDatabase();
  const record = await requestValue(database.transaction(storeName, 'readonly').objectStore(storeName).get(mediaId));
  database.close();
  return record || null;
}

export async function deleteMediaDraft(mediaId) {
  if (!mediaId || !supported()) return;
  const database = await openDatabase();
  await transaction(database, 'readwrite', (store) => store.delete(mediaId));
  database.close();
}
