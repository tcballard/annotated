import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Transform } from 'node:stream';
import { dataDirectory } from './store.js';

const localDirectory = path.join(dataDirectory, 'media');
const objectStorageMode = process.env.ANNOTATED_ASSET_STORAGE || (process.env.NODE_ENV === 'production' ? 's3' : 'local');

export const resolveS3MaxAttempts = (environment = process.env) => {
  const maxAttempts = Number(environment.S3_MAX_ATTEMPTS || 3);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('S3_MAX_ATTEMPTS must be a positive integer.');
  return maxAttempts;
};

const extensionFromKey = (key) => path.extname(key).slice(1) || 'bin';
const safeLocalPath = (key) => {
  const candidate = path.resolve(localDirectory, key.replace(/^\/+/, ''));
  if (!candidate.startsWith(`${path.resolve(localDirectory)}${path.sep}`)) throw new Error('Invalid media object key.');
  return candidate;
};

const cloudflareR2Endpoint = (endpoint) => {
  if (!endpoint) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('S3_ENDPOINT must be an absolute URL.');
  }
  return /(^|\.)r2\.cloudflarestorage\.com$/i.test(url.hostname) ? url : null;
};

const assertS3Configuration = () => {
  const required = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`ANNOTATED_ASSET_STORAGE=s3 requires ${missing.join(', ')}.`);
  const r2 = cloudflareR2Endpoint(process.env.S3_ENDPOINT);
  if (r2 && r2.protocol !== 'https:') throw new Error('Cloudflare R2 requires an HTTPS S3_ENDPOINT.');
  if (r2 && process.env.S3_REGION !== 'auto') throw new Error('Cloudflare R2 requires S3_REGION=auto.');
};

class LocalObjectStore {
  async check() {
    await mkdir(localDirectory, { recursive: true });
  }

  async putStream(request, { key, mimeType, maxBytes }) {
    const filePath = safeLocalPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
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
        resolve({ bytes, fileName: key, mimeType });
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
  }

  async putFile(filePath, { key, mimeType }) {
    const info = await stat(filePath);
    const target = safeLocalPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    if (path.resolve(filePath) !== path.resolve(target)) {
      const input = createReadStream(filePath);
      const output = createWriteStream(target, { flags: 'wx' });
      await new Promise((resolve, reject) => {
        input.on('error', reject);
        output.on('error', reject);
        output.on('finish', resolve);
        input.pipe(output);
      });
    }
    return { bytes: info.size, fileName: key, mimeType };
  }

  async remove({ key, fileName }) {
    await unlink(safeLocalPath(key || fileName)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }

  async getBytes(media, maxBytes = 8 * 1024 * 1024) {
    const filePath = safeLocalPath(media.key || media.fileName);
    const info = await stat(filePath);
    if (info.size > maxBytes) throw new Error('Media object is too large to inline.');
    return readFile(filePath);
  }

  async serve(response, media) {
    const filePath = safeLocalPath(media.key || media.fileName);
    try {
      const info = await stat(filePath);
      response.writeHead(200, { 'content-type': media.mimeType, 'content-length': info.size, 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes' });
      return createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ error: 'Not found.' }));
    }
  }
}

class S3ObjectStore {
  constructor({ client } = {}) {
    assertS3Configuration();
    this.bucket = process.env.S3_BUCKET;
    this.publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
    this.maxAttempts = resolveS3MaxAttempts();
    this.client = client || new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      maxAttempts: this.maxAttempts,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
  }

  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async putStream(request, { key, mimeType, maxBytes }) {
    let bytes = 0;
    const body = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(new Error('Media payload is too large.'));
        callback(null, chunk);
      },
    });
    const upload = this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType, ...(Number(request.headers?.['content-length']) ? { ContentLength: Number(request.headers['content-length']) } : {}) }));
    request.pipe(body);
    await upload;
    return { bytes, fileName: key, mimeType };
  }

  async putFile(filePath, { key, mimeType }) {
    const info = await stat(filePath);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentType: mimeType, ContentLength: info.size }));
    return { bytes: info.size, fileName: key, mimeType };
  }

  async remove({ key, fileName }) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key || fileName }));
  }

  async getBytes(media, maxBytes = 8 * 1024 * 1024) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: media.key || media.fileName }));
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (bytes.length > maxBytes) throw new Error('Media object is too large to inline.');
    return bytes;
  }

  async url(media) {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${encodeURIComponent(media.key || media.fileName).replace(/%2F/g, '/')}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: media.key || media.fileName }), { expiresIn: Number(process.env.S3_URL_TTL_SECONDS || 900) });
  }

  async serve(response, media) {
    const url = await this.url(media);
    response.writeHead(302, { location: url, 'cache-control': 'private, max-age=60' });
    return response.end();
  }
}

let objectStore;
export const getObjectStore = () => {
  objectStore ||= objectStorageMode === 's3' ? new S3ObjectStore() : new LocalObjectStore();
  return objectStore;
};

export { LocalObjectStore, S3ObjectStore, objectStorageMode };
