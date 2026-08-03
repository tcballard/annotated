import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');

const root = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.join(root, '..', 'server', 'migrations');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS annotated_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationDirectory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const applied = await pool.query('SELECT version FROM annotated_schema_migrations WHERE version = $1', [version]);
    if (applied.rows.length) continue;
    const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO annotated_schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied ${version}.`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  console.log('Annotated database migrations applied.');
} finally {
  await pool.end();
}
