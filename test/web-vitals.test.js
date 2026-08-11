import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Web-vitals budgets for the two pages a launch crowd lands on. Loopback
// numbers exclude the network, so these budgets bound the page's OWN work —
// parse, execute, render. Measured baseline is ~90ms LCP with 0.000 CLS at a
// 100k-row corpus; the budgets leave generous CI headroom while still
// catching a heavy dependency or a layout regression the way a slow query
// already fails the database budgets.
const LCP_BUDGET_MS = 1_500;
const CLS_BUDGET = 0.02;

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

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

const publishArticle = async (base, name) => {
  const response = await fetch(`${base}/api/annotations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl: `https://example.com/${name}`, sourceType: 'article', sourceTitle: `Vitals ${name}`, sourceExcerpt: 'A passage for the vitals corpus.', commentaryMode: 'text', commentary: 'Vitals budget test.', visibility: 'public' }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).annotation.slug;
};

const measure = async (browser, url) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'load' });
  const vitals = await page.evaluate(() => new Promise((resolve) => {
    let lcp = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    let cls = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => resolve({ lcp, cls }), 1_200);
  }));
  await context.close();
  return { ...vitals, errors };
};

test('home and permalink hold the web-vitals budgets', async (t) => {
  let browser;
  try {
    browser = await launchChromium();
  } catch (error) {
    t.skip(`Chromium unavailable: ${String(error).slice(0, 120)}`);
    return;
  }
  const dataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-vitals-'));
  const port = await freePort();
  const server = await startServer(port, dataDir);
  try {
    const base = `http://127.0.0.1:${port}`;
    const slug = await publishArticle(base, 'vitals-page');
    for (const [name, url] of [['home', `${base}/`], ['permalink', `${base}/a/${slug}`]]) {
      const { lcp, cls, errors } = await measure(browser, url);
      assert.equal(errors.length, 0, `${name} raised page errors: ${errors.join('; ')}`);
      assert.ok(lcp > 0 && lcp < LCP_BUDGET_MS, `${name} LCP ${lcp.toFixed(0)}ms exceeds the ${LCP_BUDGET_MS}ms budget`);
      assert.ok(cls < CLS_BUDGET, `${name} CLS ${cls.toFixed(3)} exceeds the ${CLS_BUDGET} budget — something is shifting layout`);
    }
  } finally {
    server.kill('SIGTERM');
    await browser.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
