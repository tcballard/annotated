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
export const latestMigrationVersion = '005_hot_path_indexes';

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
  // Mutators receive the whole state and return the whole state — but the
  // write is a DIFF, not a rewrite. The old engine deleted every row and
  // re-inserted the dataset on every write (measured: one like cost 1.6 s
  // at 500k rows, serialised product-wide). Now only rows the mutator
  // actually changed are upserted or deleted. The advisory lock stays
  // EXCLUSIVE here — whole-state mutators must serialise against each
  // other AND against the row-native ops below, which take it SHARED.
  const update = async (mutator) => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [746132]);
      const records = await client.query('SELECT collection, record_id, payload FROM annotated_records');
      const current = records.rows.length ? stateFromRecords(records.rows) : await readLegacy(client);
      const before = new Map(records.rows.map((row) => [`${row.collection}|${row.record_id}`, JSON.stringify(row.payload)]));
      const next = await mutator(current);
      const seen = new Set();
      for (const collection of recordCollections) {
        for (const [index, value] of (next[collection] || []).entries()) {
          const id = recordId(collection, value, index);
          const key = `${collection}|${id}`;
          seen.add(key);
          const payload = JSON.stringify(value);
          if (before.get(key) === payload) continue;
          await client.query(
            `INSERT INTO annotated_records (collection, record_id, payload, updated_at) VALUES ($1, $2, $3::jsonb, now())
             ON CONFLICT (collection, record_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
            [collection, id, payload],
          );
        }
      }
      for (const key of before.keys()) {
        if (seen.has(key)) continue;
        const separatorIndex = key.indexOf('|');
        const collection = key.slice(0, separatorIndex);
        const id = key.slice(separatorIndex + 1);
        await client.query('DELETE FROM annotated_records WHERE collection = $1 AND record_id = $2', [collection, id]);
      }
      await client.query('COMMIT');
      return clone(next);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  // Row-native hot ops: the three highest-frequency writes touch exactly
  // the rows they mean. They take the advisory lock SHARED, so they run
  // concurrently with each other while any whole-state mutator still
  // excludes everything. Race safety for the toggles comes from the
  // partial UNIQUE indexes in migration 005, not from locking.
  const withSharedLock = async (work) => {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock_shared($1)', [746132]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  const toggleLike = (annotationId, userId, on) => withSharedLock(async (client) => {
    if (on) {
      const record = { id: `like-${annotationId}-${userId}`, annotationId, userId, createdAt: new Date().toISOString() };
      await client.query(
        `INSERT INTO annotated_records (collection, record_id, payload) VALUES ('likes', $1, $2::jsonb)
         ON CONFLICT DO NOTHING`,
        [record.id, JSON.stringify(record)],
      );
    } else {
      await client.query(
        `DELETE FROM annotated_records WHERE collection = 'likes' AND payload->>'annotationId' = $1 AND payload->>'userId' = $2`,
        [annotationId, userId],
      );
    }
  });

  const toggleFollow = (followerId, followingId, on) => withSharedLock(async (client) => {
    if (on) {
      const record = { id: `follow-${followerId}-${followingId}`, followerId, followingId, createdAt: new Date().toISOString() };
      await client.query(
        `INSERT INTO annotated_records (collection, record_id, payload) VALUES ('follows', $1, $2::jsonb)
         ON CONFLICT DO NOTHING`,
        [record.id, JSON.stringify(record)],
      );
    } else {
      await client.query(
        `DELETE FROM annotated_records WHERE collection = 'follows' AND payload->>'followerId' = $1 AND payload->>'followingId' = $2`,
        [followerId, followingId],
      );
    }
  });

  const incrementOpenCount = (annotationId) => withSharedLock(async (client) => {
    const result = await client.query(
      `UPDATE annotated_records
         SET payload = jsonb_set(payload, '{openCount}', to_jsonb(COALESCE((payload->>'openCount')::int, 0) + 1)), updated_at = now()
       WHERE collection = 'annotations' AND record_id = $1`,
      [annotationId],
    );
    return result.rowCount > 0;
  });

  return { read, update, check, toggleLike, toggleFollow, incrementOpenCount, close: () => pool.end(), mode: 'postgres' };
};

// The read-through cache. Every request used to materialise the entire
// dataset from storage; now the first read after a write does, and the
// rest share it. Row ops PATCH the cache in place (they know their exact
// delta), whole-state mutators invalidate it (they don't). Correct for
// the current one-API-instance topology; multi-instance needs
// LISTEN/NOTIFY invalidation (Gate 1b). Consumers treat the returned
// state as immutable — all mutation goes through updateStore or the ops.
let cachedState = null;
function invalidateReadCache() { cachedState = null; }

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
  // File mode mirrors the row ops through the same whole-file write it has
  // always done — identical semantics, laptop-friendly, zero pg required.
  toggleLike: async (annotationId, userId, on) => {
    await fileStore.update((store) => {
      const key = (like) => like.annotationId === annotationId && like.userId === userId;
      const likes = on
        ? ((store.likes || []).some(key) ? store.likes : [...(store.likes || []), { id: `like-${annotationId}-${userId}`, annotationId, userId, createdAt: new Date().toISOString() }])
        : (store.likes || []).filter((like) => !key(like));
      return { ...store, likes };
    });
  },
  toggleFollow: async (followerId, followingId, on) => {
    await fileStore.update((store) => {
      const key = (follow) => follow.followerId === followerId && follow.followingId === followingId;
      const follows = on
        ? ((store.follows || []).some(key) ? store.follows : [...(store.follows || []), { id: `follow-${followerId}-${followingId}`, followerId, followingId, createdAt: new Date().toISOString() }])
        : (store.follows || []).filter((follow) => !key(follow));
      return { ...store, follows };
    });
  },
  incrementOpenCount: async (annotationId) => {
    let found = false;
    await fileStore.update((store) => ({
      ...store,
      annotations: store.annotations.map((item) => {
        if (item.id !== annotationId) return item;
        found = true;
        return { ...item, openCount: (Number(item.openCount) || 0) + 1 };
      }),
    }));
    return found;
  },
};

if (storageMode === 'postgres') assertPostgresConfiguration();
const selectedStore = storageMode === 'postgres' ? createPostgresStore() : fileStore;

const enqueue = (task) => {
  const operation = writeQueue.then(task);
  writeQueue = operation.catch(() => {});
  return operation;
};

export async function readStore() {
  cachedState ||= await selectedStore.read();
  return cachedState;
}

export async function checkStore() {
  return selectedStore.check ? selectedStore.check() : selectedStore.read();
}

export function updateStore(mutator) {
  return enqueue(async () => {
    const next = await selectedStore.update(mutator);
    cachedState = next;
    return next;
  });
}

// The three hot writes. Each runs its backend's row op, then patches the
// read cache with the same delta by structural sharing — no reload, no
// invalidation, so a like is one indexed row write plus an O(1) patch.
export function toggleLike(annotationId, userId, on) {
  return enqueue(async () => {
    await selectedStore.toggleLike(annotationId, userId, on);
    if (!cachedState) return;
    const exists = (cachedState.likes || []).some((like) => like.annotationId === annotationId && like.userId === userId);
    if (on && !exists) {
      cachedState = { ...cachedState, likes: [...(cachedState.likes || []), { id: `like-${annotationId}-${userId}`, annotationId, userId, createdAt: new Date().toISOString() }] };
    } else if (!on && exists) {
      cachedState = { ...cachedState, likes: cachedState.likes.filter((like) => !(like.annotationId === annotationId && like.userId === userId)) };
    }
  });
}

export function toggleFollow(followerId, followingId, on) {
  return enqueue(async () => {
    await selectedStore.toggleFollow(followerId, followingId, on);
    if (!cachedState) return;
    const exists = (cachedState.follows || []).some((follow) => follow.followerId === followerId && follow.followingId === followingId);
    if (on && !exists) {
      cachedState = { ...cachedState, follows: [...(cachedState.follows || []), { id: `follow-${followerId}-${followingId}`, followerId, followingId, createdAt: new Date().toISOString() }] };
    } else if (!on && exists) {
      cachedState = { ...cachedState, follows: cachedState.follows.filter((follow) => !(follow.followerId === followerId && follow.followingId === followingId)) };
    }
  });
}

export function incrementOpenCount(annotationId) {
  return enqueue(async () => {
    const found = await selectedStore.incrementOpenCount(annotationId);
    if (cachedState) {
      cachedState = { ...cachedState, annotations: cachedState.annotations.map((item) => item.id === annotationId ? { ...item, openCount: (Number(item.openCount) || 0) + 1 } : item) };
    }
    return found;
  });
}

export const closeStore = () => selectedStore.close();
export const storageDescription = () => selectedStore.mode;
export { createPostgresStore, dataDirectory, emptyStore, fileStore, storePath };
