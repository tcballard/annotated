import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { annotationCard } from '../server/og-template.js';
import { injectPermalinkMeta, permalinkCardData } from '../server/permalink.js';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const rendererReady = ['satori', '@resvg/resvg-js'].every((name) => {
  try { require.resolve(name); return true; } catch { return false; }
});

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const waitForServer = (child, port) => new Promise((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`Timed out waiting for server on port ${port}.\n${output}`));
  }, 10_000);
  const onData = (chunk) => {
    output += chunk.toString();
    if (!output.includes(`annotated server listening on http://localhost:${port}`)) return;
    clearTimeout(timeout);
    child.stdout.off('data', onData);
    child.stderr.off('data', onData);
    resolve();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    reject(new Error(`Server exited before becoming ready (code=${code}, signal=${signal}).\n${output}`));
  });
});

const annotation = {
  id: 'dc29996a-2ea4-495c-a056-041541302487',
  slug: 'unsafe-source-quote',
  status: 'published',
  authorId: 'author-1',
  sourceUrl: 'https://www.youtube.com/watch?v=unsafe',
  sourceHost: 'youtube.com',
  sourceType: 'video',
  sourceTitle: 'The source title fallback',
  sourceExcerpt: 'A <selected> & "quoted" moment.',
  commentary: 'Notes can contain <angle brackets>, ampersands &, and "quotes".',
  clipStart: 14,
  clipEnd: 62,
};
const author = { id: 'author-1', handle: 'alice' };

test('permalink metadata escapes content and replaces the generic shell metadata', () => {
  const shell = '<html><head><meta name="description" content="generic"><title>annotated — keep the moment</title></head><body></body></html>';
  const html = injectPermalinkMeta(shell, annotation, author, 'https://annotated.example');
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /property="og:site_name" content="annotated"/);
  assert.match(html, /property="og:image" content="https:\/\/annotated\.example\/og\/dc29996a-2ea4-495c-a056-041541302487\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="canonical" href="https:\/\/annotated\.example\/a\/unsafe-source-quote"/);
  assert.match(html, /&lt;selected&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /Notes can contain &lt;angle brackets&gt;, ampersands &amp;, and &quot;quotes&quot;/);
  assert.doesNotMatch(html, /<selected>|<angle brackets>/);
  assert.doesNotMatch(html, /keep the moment/);
});

test('OG card data takes the source excerpt and card content clips long values before rendering', () => {
  const data = permalinkCardData({ ...annotation, sourceExcerpt: '', sourceTitle: 'Fallback source title', commentary: '' }, author);
  assert.equal(data.quote, 'Fallback source title');
  assert.equal(data.note, 'An annotation attached to this moment.');
  const long = annotationCard({ ...permalinkCardData({ ...annotation, sourceExcerpt: 'q'.repeat(300), commentary: 'n'.repeat(200) }, author) });
  const serialized = JSON.stringify(long);
  assert.match(serialized, /q{239}…/);
  assert.match(serialized, /n{139}…/);
  assert.equal(serialized.includes('q'.repeat(241)), false);
  assert.equal(serialized.includes('n'.repeat(141)), false);
});

test('known permalinks inject metadata, unknown slugs fall through to the SPA, and font files are not public assets', async (t) => {
  try { await stat(path.join(repoRoot, 'dist/index.html')); } catch { t.skip('requires the normal Vite build'); return; }
  const port = await freePort();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-og-'));
  await writeFile(path.join(dataDirectory, 'store.json'), JSON.stringify({ users: [author], annotations: [annotation] }));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development', PORT: String(port), PUBLIC_ORIGIN: `http://localhost:${port}`,
      ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ANNOTATED_DATA_DIR: dataDirectory,
      MEDIA_WORKER_CONCURRENCY: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  });
  await waitForServer(child, port);

  const page = await fetch(`http://127.0.0.1:${port}/a/${annotation.slug}`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /property="og:title"/);
  assert.match(html, new RegExp(`/og/${annotation.id}\\.png`));
  assert.match(html, /&lt;selected&gt;/);

  const unknown = await fetch(`http://127.0.0.1:${port}/a/not-a-real-annotation`);
  const unknownHtml = await unknown.text();
  assert.equal(unknown.status, 200);
  assert.match(unknownHtml, /<title>annotated — keep the moment<\/title>/);
  assert.doesNotMatch(unknownHtml, /property="og:title"/);

  const font = await fetch(`http://127.0.0.1:${port}/server/fonts/DejaVuSans.ttf`);
  assert.equal(font.status, 404);

  if (rendererReady) {
    const image = await fetch(`http://127.0.0.1:${port}/og/${annotation.id}.png`);
    const png = Buffer.from(await image.arrayBuffer());
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cache-control'), 'public, max-age=86400, s-maxage=604800');
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
});

test('OG PNG has the required dimensions, cache policy, and long-content rendering', { skip: rendererReady ? false : 'install satori and @resvg/resvg-js to exercise the PNG renderer' }, async () => {
  const { clearCardCache, renderCard } = await import('../server/og-render.js');
  clearCardCache();
  const data = permalinkCardData({ ...annotation, sourceExcerpt: 'q'.repeat(500), commentary: 'n'.repeat(500) }, author);
  const first = await renderCard(data);
  const second = await renderCard(data);
  assert.equal(first, second, 'the memory LRU returns the first rendered PNG');
  assert.deepEqual(first.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(first.readUInt32BE(16), 1200);
  assert.equal(first.readUInt32BE(20), 630);
});
