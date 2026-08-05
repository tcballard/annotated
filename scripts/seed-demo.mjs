// Seeds a deployment with demo annotations so a reviewer never lands on an
// empty timeline. Non-destructive and idempotent: every seed carries a fixed
// clientRequestId, so re-running updates nothing and creates no duplicates.
//
//   ANNOTATED_ORIGIN=https://annotated-staging.up.railway.app \
//   ANNOTATED_TOKEN=<bearer token from the extension session> \
//   npm run seed:demo
//
// Locally (dev auth): ANNOTATED_ORIGIN=http://localhost:8787 npm run seed:demo
// Entries whose sourceUrl contains SET_ME are skipped until an operator fills
// them in (scripts/seed-demo.json).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const origin = (process.env.ANNOTATED_ORIGIN || 'http://localhost:8787').replace(/\/$/, '');
const token = process.env.ANNOTATED_TOKEN || '';
const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };

const seeds = JSON.parse(await readFile(new URL('./seed-demo.json', import.meta.url), 'utf8'));

const post = async (path, body) => {
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200, `No annotated backend at ${origin}`);
console.log(`Seeding ${origin} (${seeds.length} entries)…`);

for (const seed of seeds) {
  if (seed.sourceUrl.includes('SET_ME')) {
    console.log(`- skipped (operator slot): ${seed.title}`);
    continue;
  }
  const resolved = await post('/api/sources/resolve', { url: seed.sourceUrl });
  const source = resolved.payload.source || {};
  const { response, payload } = await post('/api/annotations', {
    sourceUrl: seed.sourceUrl,
    sourceType: seed.sourceType || source.sourceType || 'article',
    sourceTitle: source.title || seed.title,
    sourceHost: source.host || new URL(seed.sourceUrl).hostname.replace(/^www\./, ''),
    sourceExcerpt: seed.excerpt || source.excerpt || '',
    canonicalUrl: source.canonicalUrl || seed.sourceUrl,
    mediaUrl: source.mediaUrl || undefined,
    provider: source.provider || undefined,
    clipStart: seed.clipStart || 0,
    clipEnd: seed.clipEnd || 0,
    commentary: seed.note,
    commentaryMode: 'text',
    visibility: 'public',
    clientRequestId: seed.clientRequestId,
  });
  if (response.status === 201) console.log(`- published: ${payload.annotation.url}`);
  else if (response.status === 200) console.log(`- already seeded: ${payload.annotation.url}`);
  else console.log(`- FAILED (${response.status}): ${seed.title} — ${JSON.stringify(payload).slice(0, 160)}`);
}
console.log('Done. Media jobs for video/podcast seeds transcode in the background; check the permalinks in ~a minute.');
