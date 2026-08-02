import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outputDirectory = path.join(root, 'extension', 'icons');
const supersample = 4;
const orange = [250, 99, 54, 255];
const ink = [17, 21, 21, 255];
const transparent = [0, 0, 0, 0];

const crcTable = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
};

const png = (width, pixels) => {
  const rows = Buffer.alloc((width * 4 + 1) * width);
  for (let y = 0; y < width; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) pixels[y * width + x].forEach((value, channel) => { rows[row + 1 + x * 4 + channel] = value; });
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};

const distanceToRoundedRect = (x, y, left, top, right, bottom, radius) => {
  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
  return Math.hypot(dx, dy) - radius;
};

const circleDistance = (x, y, cx, cy, radius) => Math.abs(Math.hypot(x - cx, y - cy) - radius);

const render = (size) => {
  const scale = size * supersample;
  const pixels = Array.from({ length: scale * scale }, () => transparent);
  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= scale || y >= scale) return;
    pixels[y * scale + x] = color;
  };
  for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
    const pointX = x + 0.5;
    const pointY = y + 0.5;
    const shadow = distanceToRoundedRect(pointX, pointY, 8, 8, scale - 4, scale - 4, scale * 0.22);
    const tile = distanceToRoundedRect(pointX, pointY, 4, 4, scale - 8, scale - 8, scale * 0.22);
    if (shadow <= 0) setPixel(x, y, ink);
    if (tile <= 0) setPixel(x, y, orange);
    const ring = circleDistance(pointX, pointY, scale * 0.49, scale * 0.56, scale * 0.18);
    const stem = pointX >= scale * 0.61 && pointX <= scale * 0.69 && pointY >= scale * 0.54 && pointY <= scale * 0.75;
    if (ring <= scale * 0.055 || stem) setPixel(x, y, ink);
    const counter = Math.hypot(pointX - scale * 0.49, pointY - scale * 0.56);
    if (counter < scale * 0.115 && !stem) setPixel(x, y, orange);
  }
  const output = Array.from({ length: size * size }, () => [0, 0, 0, 0]);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const channels = [0, 0, 0, 0];
    for (let offsetY = 0; offsetY < supersample; offsetY += 1) for (let offsetX = 0; offsetX < supersample; offsetX += 1) {
      const source = pixels[(y * supersample + offsetY) * scale + x * supersample + offsetX];
      source.forEach((value, channel) => { channels[channel] += value; });
    }
    output[y * size + x] = channels.map((value) => Math.round(value / (supersample * supersample)));
  }
  return png(size, output);
};

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 48, 128]) {
  await writeFile(path.join(outputDirectory, `icon-${size}.png`), render(size));
  console.log(`Created extension/icons/icon-${size}.png (${size}x${size})`);
}
