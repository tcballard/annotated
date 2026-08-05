import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(repoRoot, 'scripts/seed-personas.mjs');

const run = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, cwd: repoRoot });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

test('persona seeding is idempotent and production-guarded', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-personas-'));
  try {
    const first = await run({ ANNOTATED_DATA_DIR: dataDirectory });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /\+4 users, \+9 annotations, \+8 follows, \+7 responses, \+14 likes/);

    const second = await run({ ANNOTATED_DATA_DIR: dataDirectory });
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /\+0 users, \+0 annotations, \+0 follows, \+0 responses, \+0 likes/);

    const store = JSON.parse(await readFile(path.join(dataDirectory, 'store.json'), 'utf8'));
    assert.equal(store.users.filter((user) => user.provider === 'demo').length, 4);
    const persona = store.annotations.find((item) => item.clientRequestId === 'persona-priya-textfragments');
    assert.ok(persona, 'persona annotations must carry deterministic clientRequestIds');
    assert.equal(persona.status, 'published');
    assert.equal(persona.visibility, 'public');
    assert.ok(persona.sourceExcerpt.startsWith('Text fragments link directly'));

    const guarded = await run({ ANNOTATED_DATA_DIR: dataDirectory, NODE_ENV: 'production' });
    assert.equal(guarded.code, 1);
    assert.match(guarded.stderr, /Refusing to seed personas in production/);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
