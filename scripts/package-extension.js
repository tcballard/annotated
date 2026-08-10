import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(projectRoot, 'extension');

const filesBelow = async (root, relative = '') => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
};

const sourceEpoch = async () => {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH);
  try { return Number((await execFileAsync('git', ['log', '-1', '--format=%ct'], { cwd: projectRoot })).stdout.trim()); }
  catch { return 1_700_000_000; }
};

export const packageExtension = async (requestedOutput) => {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const outputPath = path.resolve(projectRoot, requestedOutput || `annotated-extension-v${manifest.version}.zip`);
  if (outputPath === extensionRoot || outputPath.startsWith(`${extensionRoot}${path.sep}`)) throw new Error('The extension package must be written outside the extension source directory.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await unlink(outputPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotated-extension-'));
  try {
    const staged = path.join(temporary, 'extension');
    await cp(extensionRoot, staged, { recursive: true });
    const files = await filesBelow(staged);
    const timestamp = new Date((await sourceEpoch()) * 1000);
    for (const relative of files) {
      const filePath = path.join(staged, relative);
      await chmod(filePath, 0o644);
      await utimes(filePath, timestamp, timestamp);
    }
    await execFileAsync('zip', ['-X', '-q', outputPath, ...files], { cwd: staged, maxBuffer: 10 * 1024 * 1024 });
    const payload = await readFile(outputPath);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    await writeFile(`${outputPath}.sha256`, `${sha256}  ${path.basename(outputPath)}\n`);
    return { outputPath, version: manifest.version, sha256, bytes: (await stat(outputPath)).size };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await packageExtension(process.argv[2]);
  console.log(`Packaged ${result.outputPath} (${result.bytes} bytes, sha256 ${result.sha256})`);
}
