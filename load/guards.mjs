// Shared safety rails for the load harness. Every entry point imports these
// and refuses to run outside an explicitly named load environment.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const loadDir = path.dirname(fileURLToPath(import.meta.url));

// The canonical staging host is the evidence environment (RELEASE.md); it is
// never load-tested. Matching is by hostname so query strings and schemes
// cannot smuggle it past the rail.
export const CANONICAL_STAGING_HOST = 'annotated-staging.up.railway.app';

export const readConfig = () => JSON.parse(readFileSync(path.join(loadDir, 'config.json'), 'utf8'));

export const requireBaseUrl = () => {
  const raw = process.env.BASE_URL || '';
  if (!raw) throw new Error('BASE_URL is required. Point it at a disposable load environment, never at canonical staging.');
  let url;
  try { url = new URL(raw); } catch { throw new Error(`BASE_URL is not a valid URL: ${raw}`); }
  if (url.hostname.toLowerCase() === CANONICAL_STAGING_HOST) {
    throw new Error(`Refusing to run: ${CANONICAL_STAGING_HOST} is the evidence environment and is never load-tested. Deploy a disposable environment instead (see load/RUNBOOK.md).`);
  }
  return url.origin;
};

export const requireLoadDatabaseUrl = () => {
  const raw = process.env.LOAD_DATABASE_URL || '';
  if (!raw) throw new Error('LOAD_DATABASE_URL is required. Use an isolated database whose name contains load, bench, or perf.');
  const database = (() => {
    try { return new URL(raw).pathname.replace(/^\//, ''); } catch { return ''; }
  })();
  if (!/(?:load|bench|perf)/i.test(database)) {
    throw new Error(`Refusing to run: database "${database}" is not named like an isolated load database (load, bench, or perf). This rail matches scripts/run-relational-load.mjs.`);
  }
  return raw;
};

export const pgSslOption = () => (process.env.PGSSL === 'disable' ? false : undefined);
