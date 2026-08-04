import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const require = createRequire(import.meta.url);
const { version: releaseVersion } = require('../package.json');

const timestamp = (value = new Date()) => value.toISOString().replace(/[:.]/g, '-');

const required = (env, names) => names.filter((name) => !String(env[name] || '').trim());

export const normalizeBackupConfig = ({ env = process.env, now = new Date() } = {}) => {
  const storage = env.ANNOTATED_STORAGE || (env.NODE_ENV === 'production' ? 'postgres' : 'file');
  const assetStorage = env.ANNOTATED_ASSET_STORAGE || (env.NODE_ENV === 'production' ? 's3' : 'local');
  if (env.NODE_ENV !== 'production') throw new Error('Production backups require NODE_ENV=production.');
  if (storage !== 'postgres') throw new Error('Production backups require ANNOTATED_STORAGE=postgres.');
  if (assetStorage !== 's3') throw new Error('Production backups require ANNOTATED_ASSET_STORAGE=s3.');
  const missing = required(env, ['DATABASE_URL', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  if (missing.length) throw new Error(`Production backups require ${missing.join(', ')}.`);
  const outputDir = path.resolve(env.BACKUP_OUTPUT_DIR || path.resolve(process.cwd(), 'backups', timestamp(now)));
  const maxObjects = Number(env.BACKUP_MAX_OBJECTS || 100_000);
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new Error('BACKUP_MAX_OBJECTS must be a positive integer.');
  return {
    databaseUrl: env.DATABASE_URL,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    outputDir,
    pgDumpBin: env.PG_DUMP_BIN || 'pg_dump',
    maxObjects,
    createdAt: now.toISOString(),
  };
};

const writeJson = async (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
};

export const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
};

const connectionEnvironment = (databaseUrl, baseEnv = process.env) => {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL for the backup command.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use the postgres or postgresql scheme.');
  const result = { ...baseEnv };
  delete result.DATABASE_URL;
  delete result.S3_ACCESS_KEY_ID;
  delete result.S3_SECRET_ACCESS_KEY;
  if (url.hostname) result.PGHOST = url.hostname;
  if (url.port) result.PGPORT = url.port;
  if (url.username) result.PGUSER = decodeURIComponent(url.username);
  if (url.password) result.PGPASSWORD = decodeURIComponent(url.password);
  if (url.pathname.length > 1) result.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  for (const name of ['sslmode', 'channel_binding']) {
    if (url.searchParams.has(name)) result[name === 'sslmode' ? 'PGSSLMODE' : 'PGCHANNELBINDING'] = url.searchParams.get(name);
  }
  return result;
};

export const runPgDump = ({ databaseUrl, outputPath, command = 'pg_dump', spawnImpl = spawn, baseEnv = process.env } = {}) => new Promise((resolve, reject) => {
  let commandEnv;
  try {
    commandEnv = connectionEnvironment(databaseUrl, baseEnv);
  } catch (error) {
    reject(error);
    return;
  }
  const child = spawnImpl(command, [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    outputPath,
  ], { env: commandEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2000);
  });
  child.once('error', (error) => {
    if (error.code === 'ENOENT') return reject(new Error(`${command} is required on the backup runner.`));
    reject(new Error(`${command} could not start: ${error.message}`));
  });
  child.once('close', (code, signal) => {
    if (code === 0) return resolve();
    const withUrlRedacted = stderr.replaceAll(databaseUrl, '[DATABASE_URL]');
    const redacted = commandEnv.PGPASSWORD ? withUrlRedacted.replaceAll(commandEnv.PGPASSWORD, '[PASSWORD]') : withUrlRedacted;
    reject(new Error(`${command} failed${signal ? ` (${signal})` : ''}${redacted ? `: ${redacted.trim()}` : '.'}`));
  });
});

export const inspectDatabase = async ({ databaseUrl, pgModule = pg } = {}) => {
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  if (!Pool) throw new Error('The PostgreSQL client is unavailable.');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const migration = await pool.query('SELECT version FROM annotated_schema_migrations ORDER BY version DESC LIMIT 1');
    const collections = await pool.query('SELECT collection, count(*)::int AS count FROM annotated_records GROUP BY collection ORDER BY collection');
    return {
      latestMigration: migration.rows[0]?.version || null,
      collections: Object.fromEntries(collections.rows.map((row) => [row.collection, row.count])),
    };
  } finally {
    await pool.end();
  }
};

export const listObjectManifest = async ({ client, bucket, maxObjects = 100_000 } = {}) => {
  if (!client || !bucket) throw new Error('An S3 client and bucket are required.');
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new Error('maxObjects must be a positive integer.');
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const item of result.Contents || []) {
      objects.push({
        key: item.Key,
        size: Number(item.Size || 0),
        etag: item.ETag ? String(item.ETag).replace(/^"|"$/g, '') : null,
        lastModified: item.LastModified?.toISOString?.() || item.LastModified || null,
      });
      if (objects.length > maxObjects) throw new Error(`Object manifest exceeds BACKUP_MAX_OBJECTS (${maxObjects}).`);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  objects.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return {
    objectCount: objects.length,
    totalBytes: objects.reduce((total, item) => total + item.size, 0),
    objects,
  };
};

export const buildBackupManifest = ({ config, database, dump, objectManifest, gitSha = null } = {}) => ({
  formatVersion: 1,
  createdAt: config.createdAt,
  releaseVersion,
  gitSha: gitSha || null,
  database: {
    latestMigration: database.latestMigration,
    collections: database.collections,
    dump: { path: 'postgres.dump', ...dump },
  },
  objectStore: {
    bucket: config.bucket,
    manifestPath: 'objects.json',
    objectCount: objectManifest.objectCount,
    totalBytes: objectManifest.totalBytes,
  },
  recovery: {
    restoreDatabaseWith: 'pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RECOVERY_DATABASE_URL" postgres.dump',
    objectBytesRequireProviderVersioning: true,
  },
});

const createS3Client = (config) => new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
});

export const createProductionBackup = async ({ env = process.env, now = new Date(), gitSha = env.GIT_COMMIT || env.RAILWAY_GIT_COMMIT_SHA || null } = {}) => {
  const config = normalizeBackupConfig({ env, now });
  await mkdir(config.outputDir, { recursive: true });
  for (const name of ['manifest.json', 'objects.json', 'postgres.dump']) {
    try {
      await stat(path.join(config.outputDir, name));
      throw new Error(`Refusing to overwrite existing backup file: ${name}.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const dumpPath = path.join(config.outputDir, 'postgres.dump');
  await runPgDump({ databaseUrl: config.databaseUrl, outputPath: dumpPath, command: config.pgDumpBin });
  await chmod(dumpPath, 0o600);
  const dump = await sha256File(dumpPath);
  const database = await inspectDatabase({ databaseUrl: config.databaseUrl });
  const objectManifest = await listObjectManifest({ client: createS3Client(config), bucket: config.bucket, maxObjects: config.maxObjects });
  await writeJson(path.join(config.outputDir, 'objects.json'), { formatVersion: 1, createdAt: config.createdAt, bucket: config.bucket, ...objectManifest });
  const manifest = buildBackupManifest({ config, database, dump, objectManifest, gitSha });
  await writeJson(path.join(config.outputDir, 'manifest.json'), manifest);
  return { outputDir: config.outputDir, manifest };
};

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  createProductionBackup()
    .then(({ outputDir, manifest }) => console.log(JSON.stringify({ status: 'complete', outputDir, database: manifest.database, objectStore: manifest.objectStore }, null, 2)))
    .catch((error) => {
      console.error(`Production backup failed: ${error.message}`);
      process.exitCode = 1;
    });
}
