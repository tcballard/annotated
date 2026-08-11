import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// One env var per store opens every door at once: the /app page's buttons,
// the mobile banner's direct store route, and (for iOS) Safari's native
// Smart App Banner injected into the served shell. Until an operator
// configures a listing, every door honestly falls back to /app.

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('the banner routes to the right store for the device, else to /app', () => {
  assert.match(main, /\/iPad\|iPhone\|iPod\/\.test\(agent\) \? stores\.ios : \/Android\/i\.test\(agent\) \? stores\.android : null/, 'the CTA picks the store by platform');
  assert.match(main, /state\.capabilities\?\.distribution\?\.app/, 'store URLs come from the capabilities the server already serves');
  assert.match(main, /`<a class="btn" href="\/app" data-action="set-view" data-view="app">Use in app<\/a>`/, 'without a listing the door is /app, never a dead store link');
  assert.match(main, /target="_blank" rel="noreferrer">Get the app<\/a>/, 'a live listing gets a direct store route');
});

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

const startServer = async (port, dataDir, extraEnv = {}) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), ANNOTATED_STORAGE: 'file', ANNOTATED_DATA_DIR: dataDir, NODE_ENV: 'test', ...extraEnv },
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

test('a configured iOS listing injects the native Smart App Banner; absence injects nothing', async () => {
  const dataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-appdoor-'));
  const port = await freePort();
  const server = await startServer(port, dataDir, { APP_STORE_URL_IOS: 'https://apps.apple.com/gb/app/annotated/id123456789' });
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /<meta name="apple-itunes-app" content="app-id=123456789" \/>/, 'the shell carries the Smart App Banner meta');
    const capabilities = await (await fetch(`http://127.0.0.1:${port}/api/capabilities`)).json();
    assert.equal(capabilities.distribution.app.ios, 'https://apps.apple.com/gb/app/annotated/id123456789');
    assert.equal(capabilities.distribution.app.android, null);
  } finally {
    server.kill('SIGTERM');
    await rm(dataDir, { recursive: true, force: true });
  }
  const bareDataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-appdoor-bare-'));
  const barePort = await freePort();
  const bareServer = await startServer(barePort, bareDataDir, { APP_STORE_URL_IOS: '' });
  try {
    const html = await (await fetch(`http://127.0.0.1:${barePort}/`)).text();
    assert.doesNotMatch(html, /apple-itunes-app/, 'no listing, no banner meta');
  } finally {
    bareServer.kill('SIGTERM');
    await rm(bareDataDir, { recursive: true, force: true });
  }
});
