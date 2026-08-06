import { spawn } from 'node:child_process';

// Waveform peaks for hosted audio — commentary notes and podcast clips. The
// file is decoded to mono 8 kHz PCM with ffmpeg and bucketed into PEAK_COUNT
// bars scaled 0..100 against the loudest bucket, so quiet recordings still
// show their shape. Peaks are cosmetic: any failure (no ffmpeg locally, an
// undecodable file) degrades to null and the UI falls back to a plain player.

export const PEAK_COUNT = 48;

// 90 seconds of 16-bit mono at 8 kHz is ~1.4 MB; the cap is safety margin,
// not head-room for longer inputs.
const MAX_PCM_BYTES = 8 * 1024 * 1024;

const runFfmpegPcm = (filePath, timeoutMs = 20_000) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let total = 0;
  let stderr = '';
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(value);
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    finish(new Error('Audio decode timed out.'));
  }, timeoutMs);
  child.stdout.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_PCM_BYTES) {
      child.kill('SIGKILL');
      finish(new Error('Decoded audio exceeded the expected size.'));
      return;
    }
    chunks.push(chunk);
  });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  child.on('error', (error) => finish(error));
  child.on('close', (code) => {
    if (code === 0) finish(null, Buffer.concat(chunks));
    else finish(new Error(stderr.trim() || `ffmpeg exited with code ${code}.`));
  });
});

export const peaksFromPcm = (pcm, count = PEAK_COUNT) => {
  if (!pcm || pcm.length < 2) return null;
  const samples = Math.floor(pcm.length / 2);
  const bucketSize = Math.max(1, Math.floor(samples / count));
  const buckets = new Array(Math.min(count, samples)).fill(0);
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    const start = bucket * bucketSize;
    const end = bucket === buckets.length - 1 ? samples : Math.min(samples, start + bucketSize);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(pcm.readInt16LE(index * 2));
      if (value > peak) peak = value;
    }
    buckets[bucket] = peak;
  }
  const loudest = Math.max(...buckets);
  if (!loudest) return null;
  return buckets.map((value) => Math.round((value / loudest) * 100));
};

export async function extractAudioPeaks(filePath, { runCommand = runFfmpegPcm, count = PEAK_COUNT } = {}) {
  try {
    return peaksFromPcm(await runCommand(filePath), count);
  } catch {
    return null;
  }
}
