import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const safeZipEntry = (entry) => {
  const normalized = entry.replaceAll('\\', '/');
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.split('/').includes('..')
    && !/^[A-Za-z]:/.test(normalized);
};

export const unpackReleaseExtension = async ({ repoRoot, destination }) => {
  const releasePath = path.join(repoRoot, 'dist', 'release', 'release.json');
  let release;
  try {
    release = JSON.parse(await readFile(releasePath, 'utf8'));
  } catch (error) {
    throw new Error(`The built release manifest is missing or invalid at ${releasePath}. Run npm run build before the browser gate.`, { cause: error });
  }
  if (!release.artifactPath || !release.sha256) throw new Error('release.json must name a checksummed extension artifact.');
  const artifact = path.join(repoRoot, 'dist', release.artifactPath.replace(/^\/+/, ''));
  const bytes = await readFile(artifact).catch((error) => {
    throw new Error(`The release artifact is missing at ${artifact}.`, { cause: error });
  });
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== release.sha256) throw new Error(`Release artifact checksum mismatch: expected ${release.sha256}, received ${actual}.`);
  const checksumLine = await readFile(`${artifact}.sha256`, 'utf8');
  if (checksumLine.trim().split(/\s+/)[0] !== actual) throw new Error('The sidecar checksum does not match the release artifact.');
  const { stdout } = await execFileAsync('unzip', ['-Z1', artifact], { maxBuffer: 10 * 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.some((entry) => !safeZipEntry(entry))) throw new Error('The extension ZIP contains an unsafe or empty entry list.');
  await mkdir(destination, { recursive: true });
  await execFileAsync('unzip', ['-qq', artifact, '-d', destination]);
  const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
  if (manifest.version !== release.version) throw new Error(`Extension manifest ${manifest.version} does not match release ${release.version}.`);
  return { artifact, sha256: actual, release, manifest, extensionPath: destination };
};

export { safeZipEntry };
