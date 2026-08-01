import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');

const root = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(root, '..', 'server', 'migrations', '001_initial.sql'), 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
try {
  await pool.query(sql);
  console.log('Annotated database migrations applied.');
} finally {
  await pool.end();
}
