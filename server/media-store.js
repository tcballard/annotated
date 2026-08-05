import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from './store.js';
import { getObjectStore, objectStorageMode } from './object-store.js';
import { assertAudioDurationPolicy } from './media-probe.js';

const mediaDirectory = path.join(dataDirectory, 'media');
const mediaWorkDirectory = path.join(dataDirectory, 'media-work');
const maxMediaBytes = 25 * 1024 * 1024;
const maxImageBytes = 8 * 1024 * 1024;

const imageMimeExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export const normalizeImageMimeType = (mimeType) => {
  const normalized = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (!imageMimeExtensions.has(normalized)) throw new Error('Unsupported screenshot content type.');
  return normalized;
};

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

const bufferRequestToFile = (request, filePath, maxBytes) => new Promise((resolve, reject) => {
  const output = createWriteStream(filePath, { flags: 'wx' });
  let bytes = 0;
  let settled = false;
  const finish = async (error) => {
    if (settled) return;
    settled = true;
    if (error) {
      output.destroy();
      await unlink(filePath).catch(() => {});
      reject(error);
      return;
    }
    resolve(bytes);
  };
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.pause();
      void finish(new Error('Media payload is too large.'));
      return;
    }
    if (!output.write(chunk)) request.pause();
  });
  output.on('drain', () => request.resume());
  request.on('end', () => output.end(() => { void finish(); }));
  request.on('aborted', () => { void finish(new Error('Media upload was aborted.')); });
  request.on('error', (error) => { void finish(error); });
  output.on('error', (error) => { void finish(error); });
});

// Audio uploads land in the work directory first so the 90-second policy can
// be verified with ffprobe before the object is stored and addressable.
export async function writeIncomingMedia(request, mimeType) {
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxMediaBytes) throw new Error('Media payload is too large.');
  const id = randomUUID();
  const extension = extensionForMime(normalizedMimeType);
  const key = `audio/${id}.${extension}`;
  const workPath = path.join(mediaWorkDirectory, `incoming-${id}.${extension}`);
  await mkdir(mediaWorkDirectory, { recursive: true });
  try {
    const bytes = await bufferRequestToFile(request, workPath, maxMediaBytes);
    const durationSeconds = await assertAudioDurationPolicy(workPath);
    const store = getObjectStore();
    const result = await store.putFile(workPath, { id, key, mimeType: normalizedMimeType });
    return { id, key, fileName: result.fileName || key, mimeType: normalizedMimeType, bytes, durationSeconds, createdAt: new Date().toISOString() };
  } finally {
    await unlink(workPath).catch(() => {});
  }
}

// Screenshots are plain images: bounded and typed, no duration policy.
export async function writeIncomingImage(request, mimeType) {
  const normalizedMimeType = normalizeImageMimeType(mimeType);
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxImageBytes) throw new Error('Media payload is too large.');
  const id = randomUUID();
  const key = `shots/${id}.${imageMimeExtensions.get(normalizedMimeType)}`;
  const workPath = path.join(mediaWorkDirectory, `incoming-${id}.${imageMimeExtensions.get(normalizedMimeType)}`);
  await mkdir(mediaWorkDirectory, { recursive: true });
  try {
    const bytes = await bufferRequestToFile(request, workPath, maxImageBytes);
    const store = getObjectStore();
    const result = await store.putFile(workPath, { id, key, mimeType: normalizedMimeType });
    return { id, key, fileName: result.fileName || key, mimeType: normalizedMimeType, bytes, createdAt: new Date().toISOString() };
  } finally {
    await unlink(workPath).catch(() => {});
  }
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
