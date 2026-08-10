#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertPublicUrl } from '../server/ssrf.js';

export const PRODUCTION_EVIDENCE_KIND = 'annotated.media-worker-integration';
export const PRODUCTION_EVIDENCE_SCHEMA_VERSION = 1;
export const DEFAULT_PRODUCTION_EVIDENCE_DIRECTORY = 'artifacts/production';
export const MEDIA_JOB_SLO_MS = 5_000;
export const PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS = 1;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobCompletionTimeoutMs = 120_000;
const pollIntervalMs = 15;
const requiredExactEnvironment = Object.freeze({
  NODE_ENV: 'production',
  ANNOTATED_STORAGE: 'postgres',
  ANNOTATED_ASSET_STORAGE: 's3',
});
const requiredEnvironmentNames = Object.freeze([
  'DATABASE_URL',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const round = (value) => Number(Number(value).toFixed(3));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const posixPath = (value) => String(value).split(path.sep).join('/');
const errorMessage = (error) => String(error?.message || error || 'Unknown failure.');

export const validateProductionEvidenceEnvironment = (environment = process.env) => {
  const problems = [];
  for (const [name, expected] of Object.entries(requiredExactEnvironment)) {
    if (environment[name] !== expected) problems.push(`${name} must equal ${expected}.`);
  }
  for (const name of requiredEnvironmentNames) {
    if (!String(environment[name] || '').trim()) problems.push(`${name} is required.`);
  }
  const releaseEnvironment = String(environment.RELEASE_ENVIRONMENT || environment.ANNOTATED_RELEASE_ENVIRONMENT || '').trim().toLowerCase();
  if (!['staging', 'production'].includes(releaseEnvironment)) {
    problems.push('RELEASE_ENVIRONMENT must equal staging or production.');
  }
  try {
    const endpoint = new URL(environment.S3_ENDPOINT || '');
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('unsupported protocol');
    if (endpoint.username || endpoint.password) throw new Error('embedded credentials');
  } catch {
    problems.push('S3_ENDPOINT must be an absolute HTTP(S) URL without embedded credentials.');
  }
  if (problems.length) throw new Error(`Production evidence is fail-closed:\n- ${problems.join('\n- ')}`);
  return { releaseEnvironment };
};

export const parseProductionEvidenceArguments = (argumentsList) => {
  const options = { outputDirectory: DEFAULT_PRODUCTION_EVIDENCE_DIRECTORY, help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--output-dir') options.outputDirectory = argumentsList[++index] || '';
    else if (argument.startsWith('--output-dir=')) options.outputDirectory = argument.slice('--output-dir='.length);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.outputDirectory.trim()) throw new Error('--output-dir must not be empty.');
  return options;
};

const xmlEscape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const buildProductionEvidenceJunit = (cases, { durationMs = 0 } = {}) => {
  const failed = cases.filter((item) => item.status === 'failed').length;
  const caseXml = cases.map((item) => {
    const seconds = Math.max(0, Number(item.durationMs) || 0) / 1_000;
    const failure = item.status === 'failed'
      ? `<failure message="${xmlEscape(item.error || 'Production evidence check failed.')}"/>`
      : '';
    return `    <testcase classname="production evidence" name="${xmlEscape(item.name)}" time="${seconds.toFixed(3)}">${failure}</testcase>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${cases.length}" failures="${failed}" errors="0" skipped="0" time="${(Math.max(0, Number(durationMs) || 0) / 1_000).toFixed(3)}">`,
    `  <testsuite name="production PostgreSQL, S3 object storage, and standalone media worker" tests="${cases.length}" failures="${failed}" errors="0" skipped="0" time="${(Math.max(0, Number(durationMs) || 0) / 1_000).toFixed(3)}">`,
    caseXml,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
};

export const summarizeMediaProbe = (sourceType, probe) => {
  const durationSeconds = Number(probe?.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 90.05) {
    throw new Error('Transcoded output must have a measurable duration no greater than 90 seconds.');
  }
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');
  if (!hasAudio) throw new Error('Transcoded output has no audio stream.');
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (sourceType === 'video') {
    const videoHeight = Number(video?.height);
    if (!Number.isFinite(videoHeight) || videoHeight <= 0 || videoHeight > 240) {
      throw new Error('Transcoded video must contain a video stream no taller than 240 pixels.');
    }
    return { durationSeconds: round(durationSeconds), hasAudio, videoHeight };
  }
  if (video) throw new Error('Transcoded podcast output unexpectedly contains a video stream.');
  return { durationSeconds: round(durationSeconds), hasAudio, videoHeight: null };
};

const redact = (value, environment = process.env) => {
  let output = String(value || '');
  for (const name of ['DATABASE_URL', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    const secret = String(environment[name] || '');
    if (secret) output = output.replaceAll(secret, `<redacted:${name}>`);
  }
  output = output.replace(/(https?:\/\/[^\s?'"<>]+)\?[^\s'"<>]*/gu, '$1?<redacted>');
  return output.slice(0, 8_000);
};

export const recordUnhandledProductionEvidenceFailure = ({
  cases,
  failures,
  error,
  durationMs = 0,
  environment = process.env,
}) => {
  const message = redact(errorMessage(error), environment);
  if (!cases.some((item) => item.status === 'failed')) {
    cases.push({
      name: 'production evidence runner',
      status: 'failed',
      durationMs: round(Math.max(0, Number(durationMs) || 0)),
      error: message,
    });
  }
  if (!failures.length) failures.push({ name: 'production evidence runner', error: message });
  return message;
};

const gitSha = () => {
  for (const value of [process.env.RELEASE_GIT_SHA, process.env.GITHUB_SHA]) {
    if (/^[0-9a-f]{40}$/iu.test(value || '')) return value.toLowerCase();
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
  const value = result.status === 0 ? result.stdout.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error('A full release Git SHA could not be resolved.');
  return value;
};

export const productionEvidenceS3ClientConfig = (environment = process.env) => ({
  region: environment.S3_REGION,
  endpoint: environment.S3_ENDPOINT,
  forcePathStyle: environment.S3_FORCE_PATH_STYLE === 'true',
  maxAttempts: PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS,
  credentials: {
    accessKeyId: environment.S3_ACCESS_KEY_ID,
    secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
  },
});

const createS3Client = () => new S3Client(productionEvidenceS3ClientConfig());

const objectUrl = async (client, key) => {
  const publicBaseUrl = String(process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/u, '');
  if (publicBaseUrl) return `${publicBaseUrl}/${encodeURIComponent(key).replaceAll('%2F', '/')}`;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: 900 });
};

const publicFixtureUrl = async (client, key) => {
  const url = await objectUrl(client, key);
  try {
    await assertPublicUrl(url);
  } catch (error) {
    const host = (() => { try { return new URL(url).hostname; } catch { return '(invalid URL)'; } })();
    throw new Error(
      `The generated S3 fixture URL at ${host} is not publicly routable: ${errorMessage(error)} `
      + 'This is expected for localhost/private MinIO, and the production SSRF guard must not be bypassed. '
      + 'Run authoritative evidence against an externally reachable staging S3/R2 endpoint, or provide a public CDN mapping through S3_PUBLIC_BASE_URL. '
      + 'The runner will not self-assert a successful standalone-worker transcode without a real public media fetch.',
    );
  }
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || !bytes.length) throw new Error(`Generated S3 fixture fetch returned HTTP ${response.status} with ${bytes.length} bytes.`);
  return { url, host: new URL(url).hostname, bytes: bytes.length, sha256: sha256(bytes) };
};

const createLogger = (logPath) => async (event, details = {}) => {
  const record = {
    at: new Date().toISOString(),
    event,
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, redact(value)])),
  };
  await appendFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
};

const runCommand = (command, argumentsList, { cwd = projectRoot, log, label = path.basename(command), timeoutMs = 60_000 } = {}) => new Promise((resolve, reject) => {
  const started = performance.now();
  const child = spawn(command, argumentsList, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2_000).unref();
  }, timeoutMs);
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-64_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-64_000); });
  child.on('error', (error) => {
    settled = true;
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code, signal) => {
    settled = true;
    clearTimeout(timer);
    const durationMs = round(performance.now() - started);
    void log?.('command_completed', { label, code, signal: signal || '', durationMs });
    if (code === 0) resolve({ stdout, stderr, durationMs });
    else reject(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${redact(stderr || stdout)}`));
  });
});

const ffprobe = async (filePath, log) => {
  const result = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,height,codec_name',
    '-of', 'json',
    filePath,
  ], { log, label: `ffprobe ${path.basename(filePath)}` });
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`FFprobe returned invalid JSON for ${path.basename(filePath)}.`); }
};

const generateFixtures = async (directory, log) => {
  const videoPath = path.join(directory, 'controlled-video-source.mp4');
  const podcastPath = path.join(directory, 'controlled-podcast-source.wav');
  await runCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-t', '8', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    videoPath,
  ], { log, label: 'generate controlled video fixture', timeoutMs: 90_000 });
  await runCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '8', '-c:a', 'pcm_s16le',
    podcastPath,
  ], { log, label: 'generate controlled podcast fixture', timeoutMs: 60_000 });
  const videoProbe = summarizeMediaProbe('video', await ffprobe(videoPath, log));
  const podcastProbe = summarizeMediaProbe('podcast', await ffprobe(podcastPath, log));
  return { video: { path: videoPath, ...videoProbe }, podcast: { path: podcastPath, ...podcastProbe } };
};

const uploadFile = async (client, filePath, key, contentType) => {
  const bytes = await readFile(filePath);
  await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: createReadStream(filePath), ContentType: contentType, ContentLength: bytes.length }));
  const head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  if (Number(head.ContentLength) !== bytes.length) throw new Error(`S3 HEAD size mismatch for ${key}.`);
  const fetched = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  const returned = Buffer.from(await fetched.Body.transformToByteArray());
  if (!returned.equals(bytes)) throw new Error(`S3 GET bytes did not match the uploaded fixture ${key}.`);
  return { key, bytes: bytes.length, sha256: sha256(bytes) };
};

const insertRecord = (pool, collection, id, payload) => pool.query(
  `INSERT INTO annotated_records (collection, record_id, payload, updated_at)
   VALUES ($1, $2, $3::jsonb, now())
   ON CONFLICT (collection, record_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
  [collection, id, JSON.stringify(payload)],
);

const readRecord = async (pool, collection, id) => {
  const result = await pool.query(
    'SELECT payload FROM annotated_records WHERE collection = $1 AND record_id = $2',
    [collection, id],
  );
  return result.rows[0]?.payload || null;
};

const readMediaJobByAnnotation = async (pool, annotationId) => {
  const result = await pool.query(
    `SELECT record_id, payload FROM annotated_records
     WHERE collection = 'mediaJobs' AND payload->>'annotationId' = $1
     ORDER BY updated_at DESC LIMIT 1`,
    [annotationId],
  );
  return result.rows[0] ? { id: result.rows[0].record_id, ...result.rows[0].payload } : null;
};

export const cleanupProductionEvidenceFixtures = async ({
  pool,
  s3,
  bucket,
  records = [],
  keys = [],
}) => {
  if (!pool) return { records: [], keys: [] };
  const recordMap = new Map(records.map(([collection, id]) => [`${collection}\u0000${id}`, [collection, id]]));
  const keySet = new Set(keys);
  const annotationIds = [...recordMap.values()].filter(([collection]) => collection === 'annotations').map(([, id]) => id);
  if (annotationIds.length) {
    const annotations = await pool.query(
      `SELECT payload FROM annotated_records
       WHERE collection = 'annotations' AND record_id = ANY($1::text[])`,
      [annotationIds],
    );
    const mediaIds = annotations.rows.flatMap(({ payload }) => [payload?.mediaAssetId, payload?.posterAssetId]).filter(Boolean);
    if (mediaIds.length) {
      const media = await pool.query(
        `SELECT record_id, payload FROM annotated_records
         WHERE collection = 'media' AND record_id = ANY($1::text[])`,
        [mediaIds],
      );
      for (const row of media.rows) {
        recordMap.set(`media\u0000${row.record_id}`, ['media', row.record_id]);
        if (row.payload?.key) keySet.add(row.payload.key);
      }
    }
  }

  const errors = [];
  if (s3) {
    for (const key of keySet) {
      try { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
      catch (error) { errors.push(new Error(`Could not remove S3 object ${key}: ${errorMessage(error)}`)); }
    }
  }
  // Remove annotations after their generated media rows so a later best-effort
  // pass can still discover the worker-created keys if an earlier deletion fails.
  const orderedRecords = [...recordMap.values()].sort(([left], [right]) => Number(left === 'annotations') - Number(right === 'annotations'));
  for (const [collection, id] of orderedRecords) {
    try { await pool.query('DELETE FROM annotated_records WHERE collection = $1 AND record_id = $2', [collection, id]); }
    catch (error) { errors.push(new Error(`Could not remove PostgreSQL record ${collection}/${id}: ${errorMessage(error)}`)); }
  }
  if (errors.length) throw new AggregateError(errors, `Production evidence cleanup had ${errors.length} failure(s).`);
  return { records: orderedRecords, keys: [...keySet] };
};

const waitForRecord = async (pool, collection, id, predicate, { timeoutMs = jobCompletionTimeoutMs, label } = {}) => {
  const started = performance.now();
  let last = null;
  while (performance.now() - started <= timeoutMs) {
    last = await readRecord(pool, collection, id);
    if (last && predicate(last)) return { record: last, elapsedMs: round(performance.now() - started) };
    if (last && ['failed', 'cancelled'].includes(last.status)) throw new Error(`${label || id} entered ${last.status}: ${last.error || 'no worker error was recorded'}`);
    await delay(pollIntervalMs);
  }
  throw new Error(`${label || id} did not reach the required state within ${timeoutMs}ms (last status: ${last?.status || 'missing'}).`);
};

export const productionEvidenceWorkerEnvironment = (environment, workerId) => ({
  ...environment,
  ANNOTATED_PROCESS_ROLE: 'media-worker',
  MEDIA_WORKER_ID: workerId,
  MEDIA_WORKER_CONCURRENCY: '2',
  MEDIA_WORKER_POLL_MS: '2000',
  MEDIA_WORKER_MAX_ATTEMPTS: '1',
  S3_MAX_ATTEMPTS: String(PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS),
});

export const productionEvidenceApiEnvironment = (environment, { port, extensionId }) => {
  const origin = `http://127.0.0.1:${port}`;
  return {
    ...environment,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_ORIGIN: origin,
    APP_ORIGIN: origin,
    CORS_ORIGINS: origin,
    CHROME_EXTENSION_IDS: extensionId,
    ANNOTATED_PROCESS_ROLE: 'api',
    MEDIA_WORKER_CONCURRENCY: '0',
    MEDIA_WORKER_MAX_ATTEMPTS: '1',
    S3_MAX_ATTEMPTS: String(PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS),
    OAUTH_PROVIDERS: 'google,x',
    GOOGLE_CLIENT_ID: 'annotated-production-evidence-google-client',
    GOOGLE_CLIENT_SECRET: 'annotated-production-evidence-google-secret',
    X_CLIENT_ID: 'annotated-production-evidence-x-client',
    X_CLIENT_SECRET: 'annotated-production-evidence-x-secret',
  };
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});

const spawnApi = ({ log, port, extensionId }) => {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: productionEvidenceApiEnvironment(process.env, { port, extensionId }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let readinessObserved = false;
  let startedResolve;
  let startedReject;
  const started = new Promise((resolve, reject) => { startedResolve = resolve; startedReject = reject; });
  const consume = (stream, chunk) => {
    const text = chunk.toString('utf8');
    output = `${output}${text}`.slice(-64_000);
    void log('api_output', { stream, line: text });
    if (!readinessObserved && output.includes(`annotated server listening on http://localhost:${port}`)) {
      readinessObserved = true;
      startedResolve({ event: 'api_started', origin, processRole: 'api', mediaWorkerConcurrency: 0 });
    }
  };
  child.stdout.on('data', (chunk) => consume('stdout', chunk));
  child.stderr.on('data', (chunk) => consume('stderr', chunk));
  child.on('error', (error) => { if (!readinessObserved) startedReject(error); });
  child.on('exit', (code, signal) => {
    if (!readinessObserved) startedReject(new Error(`Production API exited before readiness with ${signal ? `signal ${signal}` : `code ${code}`}: ${redact(output)}`));
  });
  return { child, started, origin };
};

const spawnWorker = ({ log, workerId }) => {
  const child = spawn(process.execPath, ['server/media-worker-main.js'], {
    cwd: projectRoot,
    env: productionEvidenceWorkerEnvironment(process.env, workerId),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let startedResolve;
  let startedReject;
  let readinessObserved = false;
  const started = new Promise((resolve, reject) => { startedResolve = resolve; startedReject = reject; });
  const consume = (streamName, chunk) => {
    const key = streamName === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    if (key === 'stdoutBuffer') stdoutBuffer += chunk;
    else stderrBuffer += chunk;
    const buffer = key === 'stdoutBuffer' ? stdoutBuffer : stderrBuffer;
    const lines = buffer.split(/\r?\n/u);
    if (key === 'stdoutBuffer') stdoutBuffer = lines.pop() || '';
    else stderrBuffer = lines.pop() || '';
    for (const line of lines.filter(Boolean)) {
      void log('worker_output', { stream: streamName, line });
      if (streamName !== 'stdout') continue;
      try {
        const record = JSON.parse(line);
        if (record.event === 'media_worker_started') {
          readinessObserved = true;
          startedResolve(record);
        }
      } catch { /* worker output is retained even when it is not JSON */ }
    }
  };
  child.stdout.on('data', (chunk) => consume('stdout', chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => consume('stderr', chunk.toString('utf8')));
  child.on('error', startedReject);
  child.on('exit', (code, signal) => {
    if (!readinessObserved) startedReject(new Error(`Standalone worker exited before readiness with ${signal ? `signal ${signal}` : `code ${code}`}.`));
  });
  return { child, started };
};

const stopChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5_000);
  await exited;
  clearTimeout(timeout);
};

const fixtureRecord = async ({ pool, s3, sourceType, annotationId, outputDirectory, log }) => {
  const annotation = await readRecord(pool, 'annotations', annotationId);
  if (!annotation || annotation.mediaStatus !== 'ready' || !annotation.mediaAssetId) {
    throw new Error(`${sourceType} annotation did not reference a ready media asset.`);
  }
  const media = await readRecord(pool, 'media', annotation.mediaAssetId);
  if (!media?.key || !media?.mimeType) throw new Error(`${sourceType} media record is incomplete.`);
  const playbackStarted = performance.now();
  const url = await objectUrl(s3, media.key);
  await assertPublicUrl(url);
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || !bytes.length) throw new Error(`${sourceType} delivery returned HTTP ${response.status} with ${bytes.length} bytes.`);
  const outputPath = path.join(outputDirectory, `verified-${sourceType}${sourceType === 'video' ? '.mp4' : '.webm'}`);
  await writeFile(outputPath, bytes, { mode: 0o600 });
  const probe = summarizeMediaProbe(sourceType, await ffprobe(outputPath, log));
  const playbackReadyMs = round(performance.now() - playbackStarted);
  return {
    sourceType,
    annotationId,
    mediaAssetId: annotation.mediaAssetId,
    outputKey: media.key,
    outputBytes: bytes.length,
    outputSha256: sha256(bytes),
    jobStatus: 'ready',
    mediaStatus: annotation.mediaStatus,
    deliveryStatus: response.status,
    transcoded: true,
    hasAudio: probe.hasAudio,
    videoHeight: probe.videoHeight,
    durationSeconds: probe.durationSeconds,
    playbackReadyMs,
  };
};

const usage = `Usage: node scripts/run-production-evidence.mjs [options]\n\nOptions:\n  --output-dir <path>  Evidence directory (default: ${DEFAULT_PRODUCTION_EVIDENCE_DIRECTORY})\n`;

export const runProductionEvidence = async ({ outputDirectory = DEFAULT_PRODUCTION_EVIDENCE_DIRECTORY } = {}) => {
  const absoluteOutputDirectory = path.resolve(projectRoot, outputDirectory);
  const proofPath = path.join(absoluteOutputDirectory, 'media-worker.json');
  const junitPath = path.join(absoluteOutputDirectory, 'integration-junit.xml');
  const logPath = path.join(absoluteOutputDirectory, 'production-evidence.log');
  await mkdir(absoluteOutputDirectory, { recursive: true });
  await writeFile(logPath, '', { mode: 0o600 });
  const log = createLogger(logPath);
  const startedAt = new Date();
  const startedClock = performance.now();
  const cases = [];
  const failures = [];
  const cleanupKeys = new Set();
  const cleanupRecords = [];
  const runId = `evidence-${randomUUID()}`;
  let releaseEnvironment = null;
  let resolvedGitSha = null;
  let pool = null;
  let s3 = null;
  let temporaryDirectory = null;
  let api = null;
  let worker = null;
  let proofDetails = {};

  const runCase = async (name, operation) => {
    const caseStarted = performance.now();
    try {
      const result = await operation();
      cases.push({ name, status: 'passed', durationMs: round(performance.now() - caseStarted) });
      await log('check_passed', { name });
      return result;
    } catch (error) {
      const message = redact(errorMessage(error));
      cases.push({ name, status: 'failed', durationMs: round(performance.now() - caseStarted), error: message });
      failures.push({ name, error: message });
      await log('check_failed', { name, error: message });
      throw error;
    }
  };

  try {
    const configuration = await runCase('production environment is explicit and fail-closed', async () => validateProductionEvidenceEnvironment());
    releaseEnvironment = configuration.releaseEnvironment;
    resolvedGitSha = gitSha();
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-production-evidence-'));

    await runCase('PostgreSQL migrations and persistent record round trip', async () => {
      await runCommand(process.execPath, ['scripts/migrate.js'], { log, label: 'PostgreSQL migrations' });
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'disable' ? false : undefined,
        max: 4,
        connectionTimeoutMillis: 5_000,
      });
      await pool.query('SELECT 1');
      const migration = await pool.query('SELECT version FROM annotated_schema_migrations ORDER BY version DESC LIMIT 1');
      if (migration.rows[0]?.version !== '005_hot_path_indexes') throw new Error('PostgreSQL schema is not at migration 005_hot_path_indexes.');
      const marker = { id: `${runId}-user`, handle: runId, provider: 'production-evidence' };
      await insertRecord(pool, 'users', marker.id, marker);
      cleanupRecords.push(['users', marker.id]);
      const persisted = await readRecord(pool, 'users', marker.id);
      if (persisted?.id !== marker.id || persisted?.provider !== marker.provider) throw new Error('PostgreSQL marker record did not round-trip.');
      proofDetails.postgres = { status: 'passed', migrationVersion: migration.rows[0].version, markerRoundTrip: true };
    });

    const sourceFixtures = await runCase('real FFmpeg and FFprobe controlled source generation', async () => {
      const fixtures = await generateFixtures(temporaryDirectory, log);
      proofDetails.sourceGeneration = {
        status: 'passed',
        generator: 'ffmpeg',
        inspector: 'ffprobe',
        video: { durationSeconds: fixtures.video.durationSeconds, videoHeight: fixtures.video.videoHeight, hasAudio: fixtures.video.hasAudio },
        podcast: { durationSeconds: fixtures.podcast.durationSeconds, hasAudio: fixtures.podcast.hasAudio },
      };
      return fixtures;
    });

    const publicFixtures = await runCase('S3 object-storage byte round trip and public controlled fixture delivery', async () => {
      s3 = createS3Client();
      await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
      const videoKey = `production-evidence/${runId}/controlled-video-source.mp4`;
      const podcastKey = `production-evidence/${runId}/controlled-podcast-source.wav`;
      cleanupKeys.add(videoKey);
      cleanupKeys.add(podcastKey);
      const uploadedVideo = await uploadFile(s3, sourceFixtures.video.path, videoKey, 'video/mp4');
      const uploadedPodcast = await uploadFile(s3, sourceFixtures.podcast.path, podcastKey, 'audio/wav');
      const video = await publicFixtureUrl(s3, videoKey);
      const podcast = await publicFixtureUrl(s3, podcastKey);
      if (video.sha256 !== uploadedVideo.sha256 || podcast.sha256 !== uploadedPodcast.sha256) {
        throw new Error('Public S3 fixture bytes did not match their controlled generated inputs.');
      }
      proofDetails.s3 = {
        status: 'passed',
        bucketHead: true,
        byteRoundTrip: true,
        publicFixtureDelivery: true,
        fixtureHost: video.host === podcast.host ? video.host : `${video.host},${podcast.host}`,
      };
      return { video: { ...video, key: videoKey }, podcast: { ...podcast, key: podcastKey } };
    });

    const now = new Date();
    const workerId = `${runId}-worker`;
    let pickupAnnotationId = null;
    let pickupJobId = null;
    const recoveryAnnotationId = `${runId}-podcast-annotation`;
    const recoveryJobId = `${runId}-podcast-job`;
    const evidenceUserId = `${runId}-user`;
    const evidenceSessionId = `${runId}-session`;
    const evidenceSessionToken = `${randomUUID()}${randomUUID()}`;
    const records = [
      ['sessions', evidenceSessionId, { id: evidenceSessionId, tokenHash: sha256(evidenceSessionToken), userId: evidenceUserId, createdAt: now.toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }],
      ['annotations', recoveryAnnotationId, { id: recoveryAnnotationId, slug: recoveryAnnotationId, authorId: evidenceUserId, sourceUrl: publicFixtures.podcast.url, sourceType: 'podcast', status: 'published', commentary: 'controlled production evidence recovery', commentaryMode: 'text', mediaStatus: 'processing', createdAt: now.toISOString() }],
      ['mediaJobs', recoveryJobId, { id: recoveryJobId, annotationId: recoveryAnnotationId, ownerId: evidenceUserId, sourceUrl: publicFixtures.podcast.url, mediaUrl: publicFixtures.podcast.url, provider: 'podcast', sourceType: 'podcast', clipStart: 1, clipEnd: 6, status: 'processing', attempts: 0, workerId: `${runId}-expired-worker`, leaseUntil: new Date(Date.now() - 60_000).toISOString(), createdAt: now.toISOString() }],
    ];
    for (const [collection, id, payload] of records) {
      await insertRecord(pool, collection, id, payload);
      cleanupRecords.push([collection, id]);
    }

    const storeListing = JSON.parse(await readFile(path.join(projectRoot, 'store-assets', 'store-listing.json'), 'utf8'));
    const extensionId = String(storeListing.extensionIdentity?.expectedId || '');
    if (!/^[a-p]{32}$/u.test(extensionId)) throw new Error('The Store manifest must contain a valid expected Chrome extension ID for production API proof.');
    const apiPort = await freePort();
    const spawnedApi = spawnApi({ log, port: apiPort, extensionId });
    api = spawnedApi.child;
    const apiStartup = await runCase('production API executable reaches queue-only readiness', async () => {
      let timeoutHandle;
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Production API did not start within 15 seconds.')), 15_000);
      });
      let event;
      try { event = await Promise.race([spawnedApi.started, timeout]); }
      finally { clearTimeout(timeoutHandle); }
      const response = await fetch(`${spawnedApi.origin}/api/ready`);
      const body = await response.json();
      if (response.status !== 200
        || body.status !== 'ready'
        || body.persistence !== 'postgres'
        || event.processRole !== 'api'
        || Number(event.mediaWorkerConcurrency) !== 0
        || !api.pid) {
        throw new Error(`Unexpected production API readiness: HTTP ${response.status} ${JSON.stringify(body)}`);
      }
      return { ...event, readyStatus: response.status, mediaRuntimeStatus: body.mediaRuntime?.status };
    });

    const apiQueue = await runCase('production API publishes controlled media and persists a queued worker job', async () => {
      const response = await fetch(`${spawnedApi.origin}/api/annotations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${evidenceSessionToken}`,
          'content-type': 'application/json',
          'x-request-id': `${runId}-api-publish`,
        },
        body: JSON.stringify({
          sourceUrl: publicFixtures.video.url,
          mediaUrl: publicFixtures.video.url,
          sourceType: 'video',
          sourceTitle: 'Controlled production evidence video',
          commentaryMode: 'text',
          commentary: 'Controlled production evidence through the production API queue.',
          clipStart: 1,
          clipEnd: 6,
          clientRequestId: `${runId}-api-publish`,
          visibility: 'unlisted',
        }),
      });
      const body = await response.json();
      if (response.status !== 201 || !body.annotation?.id) {
        throw new Error(`Production API publish returned HTTP ${response.status}: ${JSON.stringify(body)}`);
      }
      pickupAnnotationId = body.annotation.id;
      cleanupRecords.push(['annotations', pickupAnnotationId]);
      const queuedStarted = performance.now();
      let job = null;
      while (performance.now() - queuedStarted <= 10_000) {
        job = await readMediaJobByAnnotation(pool, pickupAnnotationId);
        if (job) break;
        await delay(pollIntervalMs);
      }
      if (!job) throw new Error('Production API did not persist a media job within 10 seconds.');
      if (job.status !== 'queued' || Number(job.attempts) !== 0 || job.workerId) {
        throw new Error(`API-created media job was not observed in the pristine queued state: ${JSON.stringify({ status: job.status, attempts: job.attempts, workerId: job.workerId || null })}`);
      }
      pickupJobId = job.id;
      cleanupRecords.push(['mediaJobs', pickupJobId]);
      return {
        status: 'passed',
        endpoint: 'POST /api/annotations',
        publishStatus: response.status,
        authenticatedBy: 'isolated PostgreSQL bearer session',
        annotationId: pickupAnnotationId,
        jobId: pickupJobId,
        initialStatus: job.status,
        attempts: Number(job.attempts),
        observedBeforeWorkerStart: worker === null,
      };
    });

    await stopChild(api);
    api = null;

    const workerStartClock = performance.now();
    const spawned = spawnWorker({ log, workerId });
    worker = spawned.child;
    const startup = await runCase('standalone media worker executable reaches runtime readiness', async () => {
      let timeoutHandle;
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Standalone worker did not emit media_worker_started within 10 seconds.')), 10_000);
      });
      let event;
      try { event = await Promise.race([spawned.started, timeout]); }
      finally { clearTimeout(timeoutHandle); }
      if (event.runtime !== 'ready'
        || Number(event.concurrency) !== 2
        || Number(event.mediaJobMaxAttempts) !== 1
        || Number(event.s3MaxAttempts) !== PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS
        || !worker.pid) {
        throw new Error(`Unexpected standalone worker readiness event: ${JSON.stringify(event)}`);
      }
      return event;
    });

    const pickupObservation = runCase('standalone worker claims the queued media job within SLO', async () => {
      const observed = await waitForRecord(
        pool,
        'mediaJobs',
        pickupJobId,
        (job) => job.status === 'processing' && job.workerId === workerId,
        { timeoutMs: MEDIA_JOB_SLO_MS, label: 'queued media job pickup' },
      );
      const elapsedMs = round(performance.now() - workerStartClock);
      if (elapsedMs > MEDIA_JOB_SLO_MS) throw new Error(`Media job pickup ${elapsedMs}ms exceeded the ${MEDIA_JOB_SLO_MS}ms budget.`);
      return { ...observed, elapsedMs };
    });
    const recoveryObservation = runCase('standalone worker recovers the expired media-job lease within SLO', async () => {
      const observed = await waitForRecord(
        pool,
        'mediaJobs',
        recoveryJobId,
        (job) => job.status === 'processing' && job.workerId === workerId,
        { timeoutMs: MEDIA_JOB_SLO_MS, label: 'expired media job recovery' },
      );
      const elapsedMs = round(performance.now() - workerStartClock);
      if (elapsedMs > MEDIA_JOB_SLO_MS) throw new Error(`Media job recovery ${elapsedMs}ms exceeded the ${MEDIA_JOB_SLO_MS}ms budget.`);
      return { ...observed, elapsedMs };
    });
    const [pickup, recovery] = await Promise.all([pickupObservation, recoveryObservation]);

    const readyJobs = await runCase('worker completes real video and podcast transcodes through PostgreSQL and S3', async () => {
      const [video, podcast] = await Promise.all([
        waitForRecord(pool, 'mediaJobs', pickupJobId, (job) => job.status === 'ready', { label: 'video transcode' }),
        waitForRecord(pool, 'mediaJobs', recoveryJobId, (job) => job.status === 'ready', { label: 'podcast transcode' }),
      ]);
      for (const [name, result] of [['video', video], ['podcast', podcast]]) {
        if (Number(result.record.attempts || 0) !== 0) {
          throw new Error(`${name} transcode reached ready only after ${result.record.attempts} retry attempt(s); retries cannot become silent release evidence.`);
        }
      }
      return { video: video.record, podcast: podcast.record };
    });

    const fixtures = await runCase('transcoded assets deliver HTTP 200 and pass FFprobe playback readiness', async () => {
      const video = await fixtureRecord({ pool, s3, sourceType: 'video', annotationId: pickupAnnotationId, outputDirectory: temporaryDirectory, log });
      const podcast = await fixtureRecord({ pool, s3, sourceType: 'podcast', annotationId: recoveryAnnotationId, outputDirectory: temporaryDirectory, log });
      for (const fixture of [video, podcast]) cleanupKeys.add(fixture.outputKey);
      const videoAnnotation = await readRecord(pool, 'annotations', pickupAnnotationId);
      if (videoAnnotation?.posterAssetId) {
        const poster = await readRecord(pool, 'media', videoAnnotation.posterAssetId);
        if (poster?.key) cleanupKeys.add(poster.key);
      }
      return [video, podcast];
    });

    const provedFixtures = fixtures.map((fixture) => ({
      ...fixture,
      jobAttempts: Number(readyJobs[fixture.sourceType].attempts || 0),
      sourceProvenance: 'generated by this runner and byte-verified through the configured S3 service',
    }));
    const observedRetries = provedFixtures.reduce((total, fixture) => total + Number(fixture.jobAttempts || 0), 0);
    proofDetails = {
      ...proofDetails,
      apiProcess: {
        executable: 'server/index.js',
        pid: apiStartup.pid || spawnedApi.child.pid,
        processRole: apiStartup.processRole,
        mediaWorkerConcurrency: Number(apiStartup.mediaWorkerConcurrency),
        readyStatus: apiStartup.readyStatus,
        mediaRuntimeStatus: apiStartup.mediaRuntimeStatus,
        oauthProviderVerification: false,
      },
      apiQueue,
      workerProcess: {
        executable: 'server/media-worker-main.js',
        pid: worker.pid,
        processRole: 'media-worker',
        concurrency: Number(startup.concurrency),
        mediaJobMaxAttempts: Number(startup.mediaJobMaxAttempts),
        s3MaxAttempts: Number(startup.s3MaxAttempts),
        readinessEvent: startup.event,
      },
      retryPolicy: {
        maxAttempts: Number(startup.mediaJobMaxAttempts),
        retriesAllowed: false,
        observedRetries,
        allJobsFirstAttempt: observedRetries === 0,
      },
      s3RetryPolicy: {
        maxAttempts: PRODUCTION_EVIDENCE_S3_MAX_ATTEMPTS,
        retriesAllowed: false,
        runnerClientMaxAttempts: productionEvidenceS3ClientConfig().maxAttempts,
        workerClientMaxAttempts: Number(startup.s3MaxAttempts),
      },
      pickup: {
        status: 'passed',
        samplesMs: [pickup.elapsedMs],
        observed: pickup.record.workerId === workerId,
        jobId: pickupJobId,
        initialStatus: 'queued',
        observedStatus: pickup.record.status,
        observedWorkerId: pickup.record.workerId,
      },
      recovery: {
        status: 'passed',
        samplesMs: [recovery.elapsedMs],
        recoveredLease: recovery.record.workerId === workerId,
        jobId: recoveryJobId,
        initialStatus: 'processing',
        expiredWorkerId: `${runId}-expired-worker`,
        observedStatus: recovery.record.status,
        observedWorkerId: recovery.record.workerId,
      },
      playback: {
        status: 'passed',
        samplesMs: fixtures.map((fixture) => fixture.playbackReadyMs),
        audioReady: fixtures.some((fixture) => fixture.sourceType === 'podcast' && fixture.hasAudio && fixture.deliveryStatus === 200),
        videoReady: fixtures.some((fixture) => fixture.sourceType === 'video' && fixture.hasAudio && fixture.videoHeight <= 240 && fixture.deliveryStatus === 200),
        definition: 'signed/public object GET returned HTTP 200 and the downloaded output passed FFprobe stream validation',
      },
      fixtures: provedFixtures,
      completedJobs: { video: readyJobs.video.status, podcast: readyJobs.podcast.status },
    };

    await stopChild(worker);
    worker = null;

    await runCase('production evidence fixtures are removed from PostgreSQL and S3', async () => {
      const cleaned = await cleanupProductionEvidenceFixtures({
        pool,
        s3,
        bucket: process.env.S3_BUCKET,
        records: cleanupRecords,
        keys: cleanupKeys,
      });
      for (const [collection, id] of cleaned.records) {
        if (await readRecord(pool, collection, id)) throw new Error(`PostgreSQL cleanup did not remove ${collection}/${id}.`);
      }
      for (const key of cleaned.keys) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
          throw new Error(`S3 cleanup did not remove ${key}.`);
        } catch (error) {
          const status = error?.$metadata?.httpStatusCode;
          if (status !== 404 && !['NotFound', 'NoSuchKey'].includes(error?.name)) throw error;
        }
      }
    });
  } catch (error) {
    recordUnhandledProductionEvidenceFailure({
      cases,
      failures,
      error,
      durationMs: performance.now() - startedClock,
    });
  } finally {
    await stopChild(api).catch(async (error) => log('cleanup_failed', { target: 'api', error: errorMessage(error) }));
    await stopChild(worker).catch(async (error) => log('cleanup_failed', { target: 'worker', error: errorMessage(error) }));
    if (pool) {
      try {
        await cleanupProductionEvidenceFixtures({
          pool,
          s3,
          bucket: process.env.S3_BUCKET,
          records: cleanupRecords,
          keys: cleanupKeys,
        });
      } catch (error) {
        const details = error instanceof AggregateError ? error.errors.map(errorMessage).join(' | ') : errorMessage(error);
        await log('cleanup_failed', { target: 'production-fixtures', error: details });
      }
    }
    await pool?.end().catch(async (error) => log('cleanup_failed', { target: 'postgres-pool', error: errorMessage(error) }));
    s3?.destroy?.();
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(async (error) => log('cleanup_failed', { target: 'temporary-directory', error: errorMessage(error) }));
  }

  const completedAt = new Date();
  const durationMs = round(performance.now() - startedClock);
  const failedCount = cases.filter((item) => item.status === 'failed').length;
  const status = failures.length || failedCount ? 'failed' : 'passed';
  const proof = {
    schemaVersion: PRODUCTION_EVIDENCE_SCHEMA_VERSION,
    kind: PRODUCTION_EVIDENCE_KIND,
    status,
    gitSha: resolvedGitSha,
    environment: releaseEnvironment,
    runtimeMode: process.env.NODE_ENV || null,
    persistence: process.env.ANNOTATED_STORAGE || null,
    objectStorage: process.env.ANNOTATED_ASSET_STORAGE || null,
    workerMode: status === 'passed' ? 'standalone' : null,
    transcoder: status === 'passed' ? 'ffmpeg' : null,
    realMediaTranscode: status === 'passed' && proofDetails.fixtures?.length === 2,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    ...proofDetails,
    tests: {
      tests: cases.length,
      passed: cases.filter((item) => item.status === 'passed').length,
      failed: failedCount,
      skipped: 0,
      cases,
    },
    evidence: {
      junit: posixPath(path.relative(projectRoot, junitPath)),
      log: posixPath(path.relative(projectRoot, logPath)),
    },
    limitations: [
      'Authoritative worker input must be fetched from a publicly routable controlled S3/CDN URL; localhost/private MinIO is intentionally rejected by the production SSRF policy.',
      'The production API proof uses an isolated bearer session and controlled placeholder OAuth configuration; it makes no Google or X provider-verification claim.',
      'Playback readiness here means HTTP 200 plus FFprobe-valid media; end-user browser playback is proved separately by the packaged-extension Playwright evidence.',
    ],
    failures,
  };
  const junit = buildProductionEvidenceJunit(cases, { durationMs });
  await writeFile(junitPath, junit, { mode: 0o600 });
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  await log('production_evidence_completed', { status, tests: cases.length, failures: failures.length, proof: posixPath(path.relative(projectRoot, proofPath)) });
  if (!(await readFile(junitPath)).length || !(await readFile(proofPath)).length || !(await readFile(logPath)).length) {
    throw new Error('Production evidence artifacts must be non-empty.');
  }
  return { proof, proofPath, junitPath, logPath };
};

const main = async () => {
  let options;
  try { options = parseProductionEvidenceArguments(process.argv.slice(2)); }
  catch (error) { console.error(errorMessage(error)); console.error(usage); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  try {
    const result = await runProductionEvidence({ outputDirectory: options.outputDirectory });
    console.log(JSON.stringify({
      status: result.proof.status,
      proof: posixPath(path.relative(projectRoot, result.proofPath)),
      junit: posixPath(path.relative(projectRoot, result.junitPath)),
      log: posixPath(path.relative(projectRoot, result.logPath)),
      tests: result.proof.tests,
      pickupMs: result.proof.pickup?.samplesMs || [],
      recoveryMs: result.proof.recovery?.samplesMs || [],
      failures: result.proof.failures,
    }, null, 2));
    if (result.proof.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(redact(errorMessage(error)));
    process.exitCode = 1;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
