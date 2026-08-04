import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(projectRoot, 'assets', 'brand');
const outputDirectory = path.join(projectRoot, 'extension', 'icons');

// The supplied raster is the immutable source of the mark. These checked-in
// square derivatives are copied verbatim so icon generation is deterministic
// on macOS, CI, and any machine that does not have an image tool installed.
const pngDimensions = async (file) => {
  const bytes = await readFile(file);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error(`${file} is not a PNG.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 48, 128]) {
  const source = path.join(sourceDirectory, `annotated-mark-${size}.png`);
  const output = path.join(outputDirectory, `icon-${size}.png`);
  await access(source);
  const dimensions = await pngDimensions(source);
  if (dimensions.width !== size || dimensions.height !== size) {
    throw new Error(`${source} must be ${size}x${size}, got ${dimensions.width}x${dimensions.height}.`);
  }
  await copyFile(source, output);
  console.log(`Copied annotated-mark-${size}.png to extension/icons/icon-${size}.png (${size}x${size})`);
}
