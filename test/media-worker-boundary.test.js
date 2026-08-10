import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const inspectExecution = (extraEnv = {}) => {
  const env = { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ...extraEnv };
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_CONCURRENCY')) delete env.MEDIA_WORKER_CONCURRENCY;
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_MAX_ATTEMPTS')) delete env.MEDIA_WORKER_MAX_ATTEMPTS;
  if (!extraEnv.ANNOTATED_PROCESS_ROLE) delete env.ANNOTATED_PROCESS_ROLE;
  return spawnSync(process.execPath, ['--input-type=module', '-e', "const { mediaWorkerExecution } = await import('./server/media-worker.js'); console.log(JSON.stringify(mediaWorkerExecution));"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
};

const inspectRetryPolicy = (extraEnv = {}) => {
  const env = { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ...extraEnv };
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_MAX_ATTEMPTS')) delete env.MEDIA_WORKER_MAX_ATTEMPTS;
  return spawnSync(process.execPath, ['--input-type=module', '-e', "const { mediaWorkerRetryPolicy } = await import('./server/media-worker.js'); console.log(JSON.stringify(mediaWorkerRetryPolicy));"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
};

test('the production API is queue-only by default', () => {
  const result = inspectExecution();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { processRole: 'api', concurrency: 0, inProcess: false });
});

test('the standalone process owns production media concurrency', () => {
  const result = inspectExecution({ ANNOTATED_PROCESS_ROLE: 'media-worker' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { processRole: 'media-worker', concurrency: 2, inProcess: true });
});

test('the standalone process fails fast instead of silently disabling an invalid worker pool', () => {
  for (const concurrency of ['0', 'not-a-number', '1.5', '-1']) {
    const result = inspectExecution({ ANNOTATED_PROCESS_ROLE: 'media-worker', MEDIA_WORKER_CONCURRENCY: concurrency });
    assert.notEqual(result.status, 0, `worker concurrency ${concurrency} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, /MEDIA_WORKER_CONCURRENCY/);
  }
});

test('the worker retry policy is explicit and rejects invalid attempt limits', () => {
  const defaultPolicy = inspectRetryPolicy();
  assert.equal(defaultPolicy.status, 0, `${defaultPolicy.stdout}\n${defaultPolicy.stderr}`);
  assert.deepEqual(JSON.parse(defaultPolicy.stdout), { maxAttempts: 3 });

  const authoritativePolicy = inspectRetryPolicy({ MEDIA_WORKER_MAX_ATTEMPTS: '1' });
  assert.equal(authoritativePolicy.status, 0, `${authoritativePolicy.stdout}\n${authoritativePolicy.stderr}`);
  assert.deepEqual(JSON.parse(authoritativePolicy.stdout), { maxAttempts: 1 });

  for (const maxAttempts of ['0', 'not-a-number', '1.5', '-1']) {
    const result = inspectRetryPolicy({ MEDIA_WORKER_MAX_ATTEMPTS: maxAttempts });
    assert.notEqual(result.status, 0, `worker max attempts ${maxAttempts} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, /MEDIA_WORKER_MAX_ATTEMPTS/u);
  }
});

test('the worker executable establishes its role before loading media orchestration', async () => {
  const source = await readFile(new URL('../server/media-worker-main.js', import.meta.url), 'utf8');
  const role = source.indexOf("process.env.ANNOTATED_PROCESS_ROLE = 'media-worker'");
  const imported = source.indexOf("await import('./media-worker.js')");
  assert.ok(role >= 0 && imported > role);
  assert.match(source, /media_worker_started/);
  assert.match(source, /mediaWorkerExecution\.concurrency/);
  assert.match(source, /mediaWorkerRetryPolicy\.maxAttempts/);
  assert.match(source, /resolveS3MaxAttempts\(\)/);
});
