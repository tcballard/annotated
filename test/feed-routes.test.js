import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The feed's three panes are places, not ephemeral widget state. A pane you
// cannot address is a pane that "does nothing": refresh silently resets it
// to Recent, a shared link loses the filter, and a click whose only effect
// is below the fold looks like a dead control. These tests hold the contract
// that /trending and /following are real URLs, that a topic chip writes the
// address bar, and that switching panes visibly answers.

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the feed panes are routable addresses in the client', () => {
  assert.match(main, /window\.location\.pathname === '\/trending'/, 'deep-loading /trending must select the trending pane');
  assert.match(main, /window\.location\.pathname === '\/following'/, 'deep-loading /following must select the following pane');
  assert.match(main, /feedFollowing \? '\/following'/, 'routeFor must name the following pane');
  assert.match(main, /\/trending\$\{state\.feedTopic \? `\?topic=/, 'routeFor must carry the active topic in the address');
  assert.match(main, /window\.history\.pushState\(\{\}, '', routeFor\('feed'\)\)/, 'switching panes must write the address bar');
  assert.match(main, /state\.activeView === 'feed'\) \{ state\.feedCursor = null; loadFeed\(\)/, 'back/forward between panes must reload the feed');
});

test('switching panes dims the outgoing list so the click visibly answers', () => {
  assert.match(main, /is-refreshing/, 'the feed must mark itself while a pane loads');
  assert.match(css, /\.feed\.is-refreshing \.post[\s\S]*opacity: \.45/, 'the outgoing posts must dim during the swap');
});

/* ── the same contract, live in a browser ──────────────────────────── */

const launchChromium = async () => {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  } catch {
    return chromium.launch();
  }
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

const startServer = async (port, dataDir) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), ANNOTATED_STORAGE: 'file', ANNOTATED_DATA_DIR: dataDir, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server did not start\n${output}`)), 10_000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(`listening on http://localhost:${port}`)) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`server exited early\n${output}`)); });
  });
  return child;
};

const publish = async (base, name, topic) => {
  const response = await fetch(`${base}/api/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl: `https://example.com/${name}`, sourceType: 'article', sourceTitle: `Route ${name}`, sourceExcerpt: 'A passage for the routing corpus.', commentaryMode: 'text', commentary: `Routing test: ${name}.`, visibility: 'public', topic }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).annotation.slug;
};

test('trending and topic chips are clickable and hold their address', async (t) => {
  let browser;
  try {
    browser = await launchChromium();
  } catch (error) {
    t.skip(`Chromium unavailable: ${String(error).slice(0, 120)}`);
    return;
  }
  const dataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-routes-'));
  const port = await freePort();
  const server = await startServer(port, dataDir);
  try {
    const base = `http://127.0.0.1:${port}`;
    const techA = await publish(base, 'tech-a', 'tech');
    const techB = await publish(base, 'tech-b', 'tech');
    const culture = await publish(base, 'culture-a', 'culture');
    // opens give trending a signal distinct from recency
    await fetch(`${base}/api/annotations/${techA}/open`, { method: 'POST' });
    await fetch(`${base}/api/annotations/${techA}/open`, { method: 'POST' });

    const page = await browser.newPage();
    // Deep-loading /trending selects the pane — no click required.
    await page.goto(`${base}/trending`, { waitUntil: 'networkidle' });
    assert.equal(await page.getAttribute('.tab:has-text("Trending")', 'aria-selected'), 'true', '/trending must land on the Trending pane');
    await page.waitForSelector('.topic-chip');

    // A topic chip filters the list AND writes the address bar.
    await page.click('.topic-chip:has-text("Tech")');
    await page.waitForURL('**/trending?topic=tech');
    await page.waitForFunction(() => [...document.querySelectorAll('.post[data-slug]')].length > 0);
    const slugs = await page.$$eval('.post[data-slug]', (nodes) => nodes.map((n) => n.dataset.slug));
    assert.ok(slugs.includes(techA) && slugs.includes(techB), 'the tech pane lists the tech annotations');
    assert.ok(!slugs.includes(culture), 'the tech pane excludes other topics');

    // The address holds the state: a fresh load of the same URL restores it.
    await page.goto(`${base}/trending?topic=tech`, { waitUntil: 'networkidle' });
    const activeChip = await page.textContent('.topic-chip.is-active');
    assert.match(activeChip || '', /Tech/, 'a deep-loaded topic address re-selects its chip');

    // Clearing the topic returns to the unfiltered pane and its address.
    await page.click('.topic-chip:has-text("All")');
    await page.waitForURL('**/trending');
    await page.waitForFunction((slug) => [...document.querySelectorAll('.post[data-slug]')].some((n) => n.dataset.slug === slug), culture);
    await page.close();
  } finally {
    server.kill('SIGTERM');
    await browser.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
