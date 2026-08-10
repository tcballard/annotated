import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { packageExtension } from './package-extension.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseDirectory = path.join(projectRoot, 'public/release');
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });
let gitSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null;
if (!gitSha) {
  try { gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim(); } catch { /* Docker excludes .git. */ }
}
const manifest = JSON.parse(await readFile(path.join(projectRoot, 'extension/manifest.json'), 'utf8'));
const fileName = `annotated-extension-v${manifest.version}.zip`;
const artifact = await packageExtension(path.join('public/release', fileName));
const builtAt = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() : new Date().toISOString();
await writeFile(path.join(releaseDirectory, 'release.json'), `${JSON.stringify({ schemaVersion: 1, version: artifact.version, gitSha, builtAt, artifactPath: `/release/${fileName}`, checksumPath: `/release/${fileName}.sha256`, sha256: artifact.sha256, bytes: artifact.bytes }, null, 2)}\n`);
console.log(`Release artifact ready: ${fileName}`);
