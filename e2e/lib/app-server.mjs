import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForExit = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve();
  child.once('exit', resolve);
});

export const createAppServer = ({ repoRoot, dataDirectory, port, extensionId, oauthAuthorizeUrl }) => {
  const origin = `http://127.0.0.1:${port}`;
  let child = null;
  let output = '';
  let history = '';

  const start = async () => {
    if (child && child.exitCode === null && child.signalCode === null) return;
    output = '';
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(port),
        PUBLIC_ORIGIN: origin,
        APP_ORIGIN: origin,
        CORS_ORIGIN: origin,
        CHROME_EXTENSION_IDS: extensionId,
        ANNOTATED_STORAGE: 'file',
        ANNOTATED_ASSET_STORAGE: 'local',
        ANNOTATED_DATA_DIR: dataDirectory,
        MEDIA_WORKER_CONCURRENCY: '0',
        OAUTH_PROVIDERS: 'google,x',
        GOOGLE_CLIENT_ID: 'annotated-e2e-google-client',
        GOOGLE_CLIENT_SECRET: 'annotated-e2e-google-secret',
        X_CLIENT_ID: 'annotated-e2e-x-client',
        X_CLIENT_SECRET: 'annotated-e2e-x-secret',
        ANNOTATED_E2E_OAUTH_AUTHORIZE_URL: oauthAuthorizeUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = (chunk) => { history += chunk.toString(); };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    const ready = `annotated server listening on http://localhost:${port}`;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out starting Annotated at ${origin}.\n${output}`)), 15_000);
      const onData = (chunk) => {
        const text = chunk.toString();
        output += text;
        if (!output.includes(ready)) return;
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolve();
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Annotated exited before readiness (code=${code}, signal=${signal}).\n${output}`));
      });
    });
  };

  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const stopping = child;
    stopping.kill('SIGTERM');
    let timer;
    await Promise.race([
      waitForExit(stopping),
      new Promise((resolve) => {
        timer = setTimeout(async () => {
          if (stopping.exitCode === null && stopping.signalCode === null) stopping.kill('SIGKILL');
          await waitForExit(stopping);
          resolve();
        }, 5_000);
      }),
    ]);
    clearTimeout(timer);
  };

  return { origin, start, stop, logs: () => history, dataPath: path.join(dataDirectory, 'store.json') };
};
