import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildFfmpegArgs } from '../server/media-worker.js';

const duration = Math.max(1, Math.min(90, Number(process.env.MEDIA_BENCHMARK_SECONDS || 15)));
const repeats = Math.max(1, Math.min(10, Number(process.env.MEDIA_BENCHMARK_REPEATS || 2)));
const presets = String(process.env.MEDIA_BENCHMARK_PRESETS || 'ultrafast,superfast,veryfast').split(',').map((value) => value.trim()).filter(Boolean);

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}.`)));
});

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const directory = await mkdtemp(path.join(tmpdir(), 'annotated-media-benchmark-'));
try {
  const sourcePath = path.join(directory, 'source.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${duration}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', sourcePath,
  ]);

  const results = [];
  for (const preset of presets) {
    const samples = [];
    let bytes = 0;
    for (let index = 0; index < repeats; index += 1) {
      const outputPath = path.join(directory, `${preset}-${index}.mp4`);
      const startedAt = performance.now();
      await run('ffmpeg', buildFfmpegArgs({ sourceType: 'video', clipStart: 0, clipEnd: duration }, sourcePath, outputPath, { preset, crf: 30 }));
      samples.push(Math.round(performance.now() - startedAt));
      bytes = (await stat(outputPath)).size;
    }
    results.push({ preset, durationSeconds: duration, repeats, samplesMs: samples, medianMs: Math.round(median(samples)), outputBytes: bytes });
  }
  console.log(JSON.stringify({ kind: 'annotated.media-transcode-benchmark', generatedAt: new Date().toISOString(), results }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
