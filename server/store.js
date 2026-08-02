import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const dataDirectory = process.env.ANNOTATED_DATA_DIR || path.resolve(process.cwd(), 'data');
const storePath = path.join(dataDirectory, 'store.json');
const emptyStore = {
  annotations: [],
  comments: [],
  claims: [],
  follows: [],
  likes: [],
  media: [],
  mediaJobs: [],
  sessions: [],
  extensionTickets: [],
  moderationAudit: [],
  users: [{ id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard', role: 'owner' }],
};

let writeQueue = Promise.resolve();

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeStore = (value) => {
  const merged = { ...clone(emptyStore), ...value };
  merged.users = (merged.users || []).map((user) => user.id === 'local-tom' ? { role: 'owner', ...user } : user);
  return merged;
};

const storageMode = process.env.ANNOTATED_STORAGE || (process.env.NODE_ENV === 'production' ? 'postgres' : 'file');

const assertPostgresConfiguration = () => {
  if (!process.env.DATABASE_URL) throw new Error('ANNOTATED_STORAGE=postgres requires DATABASE_URL.');
};

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS annotated_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS annotated_state_gin_idx ON annotated_state USING gin (state);
  CREATE TABLE IF NOT EXISTS annotated_records (
    collection text NOT NULL CHECK (collection IN (
      'annotations', 'comments', 'claims', 'follows', 'likes', 'media',
      'mediaJobs', 'sessions', 'extensionTickets', 'moderationAudit', 'users'
    )),
    record_id text NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, record_id)
  );
  CREATE INDEX IF NOT EXISTS annotated_records_collection_idx ON annotated_records (collection);
  CREATE INDEX IF NOT EXISTS annotated_records_payload_gin_idx ON annotated_records USING gin (payload);
  CREATE INDEX IF NOT EXISTS annotated_records_annotation_request_idx
    ON annotated_records ((payload->>'authorId'), (payload->>'clientRequestId'))
    WHERE collection = 'annotations';
`;
export const latestMigrationVersion = '003_idempotency_index';

const recordCollections = Object.keys(emptyStore);
const recordId = (collection, value, index) => String(value?.id || value?.tokenHash || `${collection}-${index}`);

const stateFromRecords = (rows) => {
  const state = Object.fromEntries(recordCollections.map((collection) => [collection, []]));
  for (const row of rows) {
    if (!recordCollections.includes(row.collection)) continue;
    state[row.collection].push(row.payload);
  }
  return normalizeStore(state);
};

const createPostgresStore = ({ pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: process.env.PGSSL === 'disable' ? false : undefined }) } = {}) => {
  let schemaReady;
  const ensureSchema = async () => {
    schemaReady ||= pool.query(postgresSchema);
    await schemaReady;
  };
  const readLegacy = async (query = pool) => {
    const result = await query.query('SELECT state FROM annotated_state WHERE id = 1');
    return result.rows[0] ? normalizeStore(result.rows[0].state) : clone(emptyStore);
  };
  const read = async () => {
    await ensureSchema();
    const result = await pool.query('SELECT collection, record_id, payload FROM annotated_records');
    return result.rows.length ? stateFromRecords(result.rows) : readLegacy();
  };
  const check = async () => {
    await ensureSchema();
    await pool.query('SELECT 1');
    const migrations = await pool.query('SELECT version FROM annotated_schema_migrations ORDER BY version DESC LIMIT 1');
    if (migrations.rows[0]?.version !== latestMigrationVersion) throw new Error(`PostgreSQL migrations are not current (expected ${latestMigrationVersion}).`);
  };
  const update = async (mutator) => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [746132]);
      const records = await client.query('SELECT collection, record_id, payload FROM annotated_records FOR UPDATE');
      const current = records.rows.length ? stateFromRecords(records.rows) : await readLegacy(client);
      const next = await mutator(current);
      await client.query('DELETE FROM annotated_records');
      for (const collection of recordCollections) {
        for (const [index, value] of (next[collection] || []).entries()) {
          await client.query(
            'INSERT INTO annotated_records (collection, record_id, payload, updated_at) VALUES ($1, $2, $3::jsonb, now())',
            [collection, recordId(collection, value, index), JSON.stringify(value)],
          );
        }
      }
      await client.query(`
        INSERT INTO annotated_state (id, state, updated_at) VALUES (1, $1::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
      `, [JSON.stringify(next)]);
      await client.query('COMMIT');
      return clone(next);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return { read, update, check, close: () => pool.end(), mode: 'postgres' };
};

const fileStore = {
  mode: 'file',
  read: async () => {
    try {
      const value = JSON.parse(await readFile(storePath, 'utf8'));
      return normalizeStore(value);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(dataDirectory, { recursive: true });
      await writeFile(storePath, JSON.stringify(emptyStore, null, 2));
      return clone(emptyStore);
    }
  },
  check: async () => { await fileStore.read(); },
  update: async (mutator) => {
    const current = await fileStore.read();
    const next = await mutator(current);
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(next, null, 2));
    await rename(temporaryPath, storePath);
    return clone(next);
  },
  close: async () => {},
};

if (storageMode === 'postgres') assertPostgresConfiguration();
const selectedStore = storageMode === 'postgres' ? createPostgresStore() : fileStore;

export async function readStore() {
  return selectedStore.read();
}

export async function checkStore() {
  return selectedStore.check ? selectedStore.check() : selectedStore.read();
}

export function updateStore(mutator) {
  const operation = writeQueue.then(() => selectedStore.update(mutator));
  writeQueue = operation.catch(() => {});
  return operation;
}

export const closeStore = () => selectedStore.close();
export const storageDescription = () => selectedStore.mode;
export { createPostgresStore, dataDirectory, emptyStore, fileStore, storePath };
