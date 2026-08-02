import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from './store.js';
import { getObjectStore, objectStorageMode } from './object-store.js';

const mediaDirectory = path.join(dataDirectory, 'media');
const mediaWorkDirectory = path.join(dataDirectory, 'media-work');
const maxMediaBytes = 25 * 1024 * 1024;

const audioMimeExtensions = new Map([
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['audio/wav', 'wav'],
  ['audio/webm', 'webm'],
  ['audio/x-wav', 'wav'],
]);

export const normalizeAudioMimeType = (mimeType) => {
  const normalized = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (!audioMimeExtensions.has(normalized)) throw new Error('Unsupported audio content type.');
  return normalized;
};

const extensionForMime = (mimeType) => {
  return audioMimeExtensions.get(mimeType) || 'webm';
};

export async function writeIncomingMedia(request, mimeType) {
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxMediaBytes) throw new Error('Media payload is too large.');
  const id = randomUUID();
  const extension = extensionForMime(normalizedMimeType);
  const key = `audio/${id}.${extension}`;
  const store = getObjectStore();
  const result = await store.putStream(request, { id, key, mimeType: normalizedMimeType, maxBytes: maxMediaBytes });
  return { id, key, fileName: result.fileName || key, mimeType: normalizedMimeType, bytes: result.bytes, createdAt: new Date().toISOString() };
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
