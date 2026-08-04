import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(projectRoot, 'assets', 'brand', 'annotated-brand-kit', 'chrome-extension', 'icons');
const outputDirectory = path.join(projectRoot, 'extension', 'icons');

// The approved brand kit is the immutable source. Every supplied icon is
// copied verbatim so Chrome receives the exact hand-authored small-size export.
const pngDimensions = async (file) => {
  const bytes = await readFile(file);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error(`${file} is not a PNG.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const source = path.join(sourceDirectory, `icon-${size}.png`);
  const output = path.join(outputDirectory, `icon-${size}.png`);
  await access(source);
  const dimensions = await pngDimensions(source);
  if (dimensions.width !== size || dimensions.height !== size) {
    throw new Error(`${source} must be ${size}x${size}, got ${dimensions.width}x${dimensions.height}.`);
  }
  await copyFile(source, output);
  console.log(`Copied approved icon-${size}.png to extension/icons/icon-${size}.png (${size}x${size})`);
}
