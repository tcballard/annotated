import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainSource = await readFile(path.join(projectRoot, 'src/main.js'), 'utf8');

test('following feed keeps anonymous users in the sign-in recovery path', () => {
  assert.match(mainSource, /following && requestSignIn\('see the people you follow'\)/);
  assert.match(mainSource, /state\.feedFollowing = false;[\s\S]*recoverAuthError\(error, 'Sign in to see the people you follow\.'/);
});
