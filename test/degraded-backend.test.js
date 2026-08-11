import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The degraded-backend rehearsal: launch-day failure modes arrive at the
// browser, not the terminal. A slow API must not block the shell from
// painting, and a dead API must produce an honest page — words on screen and
// zero uncaught errors — never a white screen. The panel holds these
// contracts at the unit level; this proves the web timeline holds them in a
// real browser.

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

// A shaping proxy in front of the real API: static files pass through
// untouched; /api/* is delayed or answered 503 without ever reaching the
// upstream. This is the launch-day spectrum in one dial.
const startShapingProxy = (upstreamPort, { apiDelayMs = 0, apiDown = false } = {}) => new Promise((resolve) => {
  const server = http.createServer(async (request, response) => {
    const isApi = String(request.url || '').startsWith('/api/');
    if (isApi && apiDown) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":"upstream unavailable"}');
      return;
    }
    if (isApi && apiDelayMs) await new Promise((wake) => setTimeout(wake, apiDelayMs));
    const forwarded = http.request({ host: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers: request.headers }, (upstream) => {
      response.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(response);
    });
    forwarded.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const loadAndObserve = async (browser, url) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  const shellMs = Date.now() - started;
  await page.waitForTimeout(2_000);
  const text = (await page.evaluate(() => document.body?.innerText || '')).trim();
  await context.close();
  return { shellMs, text, errors };
};

test('the shell paints without waiting for a slow API, and a dead API yields an honest page', async (t) => {
  let browser;
  try {
    browser = await launchChromium();
  } catch (error) {
    t.skip(`Chromium unavailable: ${String(error).slice(0, 120)}`);
    return;
  }
  const dataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-degraded-'));
  const apiPort = await freePort();
  const server = await startServer(apiPort, dataDir);
  const slowProxy = await startShapingProxy(apiPort, { apiDelayMs: 1_500 });
  const deadProxy = await startShapingProxy(apiPort, { apiDown: true });
  try {
    // Slow API: every /api call takes 1.5s, yet the shell must paint on its
    // own clock — rendering is not allowed to sit behind the feed fetch.
    const slow = await loadAndObserve(browser, `http://127.0.0.1:${slowProxy.address().port}/`);
    assert.equal(slow.errors.length, 0, `slow-API load raised page errors: ${slow.errors.join('; ')}`);
    assert.ok(slow.shellMs < 5_000, `shell took ${slow.shellMs}ms behind a 1.5s API — rendering is blocked on data`);
    assert.ok(slow.text.length > 40, 'the slow-API page shows real words, not a blank shell');

    // Dead API: every /api call answers 503. The page must still be a page —
    // words on screen, zero uncaught errors, no white screen.
    const dead = await loadAndObserve(browser, `http://127.0.0.1:${deadProxy.address().port}/`);
    assert.equal(dead.errors.length, 0, `dead-API load raised page errors: ${dead.errors.join('; ')}`);
    assert.ok(dead.text.length > 40, 'the dead-API page still says something honest instead of rendering nothing');
  } finally {
    slowProxy.close();
    deadProxy.close();
    server.kill('SIGTERM');
    await browser.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
