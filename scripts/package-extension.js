import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(projectRoot, 'extension');
const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const requestedOutput = process.argv[2] || `annotated-extension-v${manifest.version}.zip`;
const outputPath = path.resolve(projectRoot, requestedOutput);

if (outputPath === extensionRoot || outputPath.startsWith(`${extensionRoot}${path.sep}`)) {
  throw new Error('The extension package must be written outside the extension source directory.');
}

await unlink(outputPath).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
await execFileAsync('zip', ['-qr', outputPath, '.', '-x', '*.DS_Store'], { cwd: extensionRoot });
console.log(`Packaged ${outputPath}`);
