import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAudioPeaks, PEAK_COUNT, peaksFromPcm } from '../server/audio-peaks.js';

const pcmOf = (samples) => {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
};

test('peaks bucket the loudest sample and normalise against it', () => {
  // 96 samples over 48 buckets: silence, then a ramp — the shape must survive.
  const samples = [...new Array(48).fill(0), ...Array.from({ length: 48 }, (_, i) => (i + 1) * 100)];
  const peaks = peaksFromPcm(pcmOf(samples));
  assert.equal(peaks.length, PEAK_COUNT);
  assert.equal(peaks[0], 0);
  assert.equal(peaks[23], 0);
  assert.equal(peaks[47], 100, 'the loudest bucket is full scale');
  assert.ok(peaks[24] < peaks[47], 'the ramp keeps its shape');
});

test('quiet recordings still show shape and negatives count as loudness', () => {
  const peaks = peaksFromPcm(pcmOf([0, -50, 0, 50]), 4);
  assert.deepEqual(peaks, [0, 100, 0, 100]);
});

test('silence and empty input degrade to null', () => {
  assert.equal(peaksFromPcm(pcmOf(new Array(96).fill(0))), null);
  assert.equal(peaksFromPcm(Buffer.alloc(0)), null);
  assert.equal(peaksFromPcm(null), null);
});

test('extraction degrades to null when the decoder is unavailable', async () => {
  const failing = async () => { const error = new Error('spawn ffmpeg ENOENT'); throw error; };
  assert.equal(await extractAudioPeaks('/nope.webm', { runCommand: failing }), null);
  const fake = async () => pcmOf([0, 100, 0, 200]);
  assert.deepEqual(await extractAudioPeaks('/fake.webm', { runCommand: fake, count: 4 }), [0, 50, 0, 100]);
});
