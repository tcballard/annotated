import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from './store.js';
import { getObjectStore, objectStorageMode } from './object-store.js';

const mediaDirectory = path.join(dataDirectory, 'media');
const mediaWorkDirectory = path.join(dataDirectory, 'media-work');
const maxMediaBytes = 25 * 1024 * 1024;

const extensionForMime = (mimeType) => {
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/ogg') return 'ogg';
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return 'wav';
  return 'webm';
};

export async function writeIncomingMedia(request, mimeType) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxMediaBytes) throw new Error('Media payload is too large.');
  const id = randomUUID();
  const extension = extensionForMime(mimeType);
  const key = `audio/${id}.${extension}`;
  const store = getObjectStore();
  const result = await store.putStream(request, { id, key, mimeType, maxBytes: maxMediaBytes });
  return { id, key, fileName: result.fileName || key, mimeType, bytes: result.bytes, createdAt: new Date().toISOString() };
}

export async function storeMediaFile(filePath, { id, key, mimeType }) {
  const store = getObjectStore();
  return store.putFile(filePath, { id, key, mimeType });
}

export async function removeMediaFile(filePath) {
  await unlink(filePath).catch(() => {});
}

export async function serveStoredMedia(response, media) {
  return getObjectStore().serve(response, media);
}

export async function removeStoredMedia(media) {
  if (!media?.key && !media?.fileName) return;
  return getObjectStore().remove(media);
}

export { maxMediaBytes, mediaDirectory, mediaWorkDirectory, objectStorageMode };
