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
  media: [],
  mediaJobs: [],
  sessions: [],
  extensionTickets: [],
  users: [{ id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard' }],
};

let writeQueue = Promise.resolve();

const clone = (value) => JSON.parse(JSON.stringify(value));

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
`;

const createPostgresStore = ({ pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: process.env.PGSSL === 'disable' ? false : undefined }) } = {}) => {
  let schemaReady;
  const ensureSchema = async () => {
    schemaReady ||= pool.query(postgresSchema);
    await schemaReady;
  };
  const read = async () => {
    await ensureSchema();
    const result = await pool.query('SELECT state FROM annotated_state WHERE id = 1');
    return result.rows[0] ? { ...clone(emptyStore), ...result.rows[0].state } : clone(emptyStore);
  };
  const update = async (mutator) => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [746132]);
      const result = await client.query('SELECT state FROM annotated_state WHERE id = 1 FOR UPDATE');
      const current = result.rows[0] ? { ...clone(emptyStore), ...result.rows[0].state } : clone(emptyStore);
      const next = await mutator(current);
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
  return { read, update, close: () => pool.end(), mode: 'postgres' };
};

const fileStore = {
  mode: 'file',
  read: async () => {
    try {
      const value = JSON.parse(await readFile(storePath, 'utf8'));
      return { ...clone(emptyStore), ...value };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(dataDirectory, { recursive: true });
      await writeFile(storePath, JSON.stringify(emptyStore, null, 2));
      return clone(emptyStore);
    }
  },
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

export function updateStore(mutator) {
  const operation = writeQueue.then(() => selectedStore.update(mutator));
  writeQueue = operation.catch(() => {});
  return operation;
}

export const closeStore = () => selectedStore.close();
export const storageDescription = () => selectedStore.mode;
export { createPostgresStore, dataDirectory, emptyStore, fileStore, storePath };
