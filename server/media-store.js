import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from './store.js';

const mediaDirectory = path.join(dataDirectory, 'media');
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
  await mkdir(mediaDirectory, { recursive: true });
  const id = randomUUID();
  const fileName = `${id}.${extensionForMime(mimeType)}`;
  const filePath = path.join(mediaDirectory, fileName);
  const output = createWriteStream(filePath, { flags: 'wx' });

  return new Promise((resolve, reject) => {
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
      resolve({ id, fileName, filePath, mimeType, bytes, createdAt: new Date().toISOString() });
    };

    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxMediaBytes) {
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
}

export { maxMediaBytes, mediaDirectory };
