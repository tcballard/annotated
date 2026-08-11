import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import pg from 'pg';
import { normalizeSourceUrlKey } from '../server/feed.js';

// The URL identity lives twice: normalizeSourceUrlKey in JS (query side and
// the file store) and annotated_url_key in SQL (the stored pg columns). The
// two drifted once — SQL folded the whole URL, JS only the host — and the
// panel's This page feed silently emptied on every PostgreSQL deployment
// while every JS-only test stayed green. This suite pins the twins to the
// byte, against a real database, over the URL shapes that broke.

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL;
const gated = { skip: url ? false : 'DATABASE_URL not set' };

const PARITY_DB = 'annotated_url_key_parity_tests';

const scratchUrl = () => {
  const parsed = new URL(url);
  parsed.pathname = `/${PARITY_DB}`;
  return parsed.toString();
};

let databaseReady;
const ensureDatabase = async () => {
  databaseReady ||= (async () => {
    const admin = new pg.Pool({ connectionString: url, max: 1, ssl: process.env.PGSSL === 'disable' ? false : undefined });
    await admin.query(`CREATE DATABASE ${PARITY_DB}`).catch((error) => { if (error.code !== '42P04') throw error; });
    await admin.end();
    await execFileAsync(process.execPath, ['scripts/migrate.js'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: scratchUrl() },
    });
  })();
  await databaseReady;
};

const CORPUS = [
  // the staging reproduction: uppercase path
  'https://en.wikipedia.org/wiki/Web_annotation',
  'https://EN.Wikipedia.org/wiki/Web_annotation',
  // case-sensitive video identity + share junk + position marker
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com/watch?v=dQw4w9WgXcQ&t=304&si=AbCdEf',
  'https://youtu.be/dQw4w9WgXcQ?si=XyZ',
  // tracking params, alone and mixed with structural ones
  'https://example.com/story?utm_source=x&utm_campaign=launch',
  'https://example.com/story?fbclid=abc123',
  'https://example.com/story?page=2&utm_medium=social',
  'https://example.com/search?s=maker+schedule',
  // hash, www, trailing slashes, ports, bare hosts
  'https://www.example.com/post/#section-2',
  'https://example.com/post///',
  'https://example.com:8443/post',
  'https://example.com',
  'https://paulgraham.com/greatwork.html',
  // encoded characters stay raw on both sides
  'https://example.com/a%20b?q=c%2Fd',
  // rejects
  'not a url',
  'ftp://example.com/x',
  '',
];

test('annotated_url_key (SQL) equals normalizeSourceUrlKey (JS) over the corpus', gated, async () => {
  await ensureDatabase();
  const pool = new pg.Pool({ connectionString: scratchUrl(), max: 1, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  try {
    for (const candidate of CORPUS) {
      const { rows } = await pool.query('SELECT annotated_url_key($1) AS key', [candidate]);
      assert.equal(rows[0].key, normalizeSourceUrlKey(candidate), `SQL and JS must agree for: ${candidate}`);
    }
  } finally {
    await pool.end();
  }
});

test('the This page filter round-trips through the pg store for mixed-case and canonical URLs', gated, async () => {
  await ensureDatabase();
  // The store and repository bind to env at import time; point them at the
  // scratch database before they load. Each test file is its own process,
  // so this cannot leak into other suites.
  process.env.DATABASE_URL = scratchUrl();
  process.env.ANNOTATED_STORAGE = 'postgres';
  const { readStore, updateStore, closeStore } = await import('../server/store.js');
  const repository = await import('../server/product-repository.js');
  try {
    await readStore();
    await updateStore((state) => ({
      ...state,
      users: [{ id: 'parity-author', handle: 'parity', displayName: 'Parity Author' }],
      annotations: [{
      id: 'parity-a1',
      slug: 'parity-wiki',
      authorId: 'parity-author',
      sourceUrl: 'https://en.wikipedia.org/wiki/Web_annotation',
      canonicalUrl: 'https://en.wikipedia.org/wiki/Web_annotation',
      sourceHost: 'en.wikipedia.org',
      sourceType: 'article',
      sourceTitle: 'Web annotation',
      sourceExcerpt: 'Mixed-case path.',
      commentaryMode: 'text',
      commentary: 'Parity check.',
      visibility: 'public',
      status: 'published',
      clipStart: 0,
      clipEnd: 0,
      createdAt: new Date().toISOString(),
    }, {
      id: 'parity-a2',
      slug: 'parity-video',
      authorId: 'parity-author',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      canonicalUrl: 'https://youtu.be/dQw4w9WgXcQ',
      sourceHost: 'youtube.com',
      sourceType: 'video',
      sourceTitle: 'Case-sensitive video',
      commentaryMode: 'text',
      commentary: 'Canonical parity check.',
      visibility: 'public',
      status: 'published',
      clipStart: 1,
      clipEnd: 10,
      createdAt: new Date().toISOString(),
      }],
    }));
    const bySlug = async (tabUrl) => {
      const result = await repository.listFeed({ urlKey: normalizeSourceUrlKey(tabUrl) });
      return result.annotations.map((item) => item.slug).sort();
    };
    assert.deepEqual(await bySlug('https://en.wikipedia.org/wiki/Web_annotation'), ['parity-wiki'], 'the exact mixed-case tab URL must match');
    assert.deepEqual(await bySlug('https://en.wikipedia.org/wiki/Web_annotation?utm_source=share'), ['parity-wiki'], 'share-button junk must not defeat the match');
    assert.deepEqual(await bySlug('https://youtu.be/dQw4w9WgXcQ?si=share'), ['parity-video'], 'the canonical short link must find the capture');
    assert.deepEqual(await bySlug('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), ['parity-video'], 'the timestamped watch URL must find the capture');
    assert.deepEqual(await bySlug('https://en.wikipedia.org/wiki/Hypertext'), [], 'a different page matches nothing');
  } finally {
    const { closeStore } = await import('../server/store.js');
    await closeStore?.().catch(() => {});
  }
});
