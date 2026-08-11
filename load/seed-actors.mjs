// Mint N load actors (users + bearer sessions) directly in the load database,
// using the exact session semantics in server/auth.js: token = base64url of 32
// random bytes, stored token_hash = sha256 hex, one row in annotated_sessions.
// Idempotent: users upsert by deterministic id; prior load sessions for those
// users are replaced so every run hands the k6 script working tokens.
//
//   LOAD_DATABASE_URL=postgresql://.../annotated_load [ACTORS=50] \
//     npm run load:actors
//
// Writes load/actors.json (gitignored — it contains live bearer tokens).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadDir, pgSslOption, readConfig, requireLoadDatabaseUrl } from './guards.mjs';

const databaseUrl = requireLoadDatabaseUrl();
const config = readConfig();
const count = Math.max(1, Number(process.env.ACTORS || config.actorCount || 50));

const base64url = (value) => Buffer.from(value).toString('base64url');
const hashToken = (value) => createHash('sha256').update(value).digest('hex');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, ssl: pgSslOption() });
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

const run = async () => {
  const migrated = await pool.query("SELECT to_regclass('annotated_users') AS users, to_regclass('annotated_sessions') AS sessions");
  if (!migrated.rows[0].users || !migrated.rows[0].sessions) {
    throw new Error('The load database has no relational schema. Run: DATABASE_URL=$LOAD_DATABASE_URL node scripts/migrate.js');
  }
  const actors = [];
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  for (let index = 0; index < count; index += 1) {
    const id = `load-actor-${String(index).padStart(4, '0')}`;
    // annotated_users NOT NULL without defaults: id, handle, display_name.
    // is_demo marks these as demonstration accounts, matching the seeders'
    // discipline of never inflating real totals.
    await pool.query(
      `INSERT INTO annotated_users (id, handle, display_name, bio, is_demo)
       VALUES ($1, $2, $3, 'Load-test actor. Not a person.', true)
       ON CONFLICT (id) DO UPDATE SET is_demo = true`,
      [id, `load_actor_${index}`, `Load Actor ${index}`],
    );
    const token = base64url(randomBytes(32));
    await pool.query('DELETE FROM annotated_sessions WHERE user_id = $1', [id]);
    await pool.query(
      `INSERT INTO annotated_sessions (id, token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, now(), $4)`,
      [randomUUID(), hashToken(token), id, expiresAt],
    );
    actors.push({ id, handle: `load_actor_${index}`, token });
  }
  const outPath = path.join(loadDir, 'actors.json');
  writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), database: new URL(databaseUrl).pathname.replace(/^\//, ''), expiresAt, actors }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Minted ${actors.length} actors with bearer sessions -> ${outPath}`);
  console.log('Tokens are live credentials for the load environment. actors.json is gitignored; keep it that way.');
};

run().then(() => pool.end()).catch(async (error) => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
