import { spawn } from 'node:child_process';

// Audio commentary shares the 90-second policy with clips. The capture UIs cap
// the recorder, and this probe enforces the same limit at the API boundary so
// an over-length upload cannot arrive through a raw request.
export const MAX_AUDIO_UPLOAD_SECONDS = 90;
export const AUDIO_DURATION_TOLERANCE_SECONDS = 0.5;

const production = () => process.env.NODE_ENV === 'production';

const policyError = (message) => {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
};

const runFfprobe = (filePath, timeoutMs = 15_000) => new Promise((resolve, reject) => {
  const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    reject(new Error('Audio inspection timed out.'));
  }, timeoutMs);
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-16_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    error.unavailable = error.code === 'ENOENT';
    reject(error);
  });
  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code === 0) resolve(stdout);
    else reject(new Error(stderr.trim() || `ffprobe exited with code ${code}.`));
  });
});

export const parseProbedDuration = (output) => {
  let parsed;
  try { parsed = JSON.parse(output); } catch { return null; }
  const duration = Number(parsed?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
};

export const audioDurationWithinPolicy = (duration) => duration === null
  || duration <= MAX_AUDIO_UPLOAD_SECONDS + AUDIO_DURATION_TOLERANCE_SECONDS;

// Returns the probed duration in seconds. In production every upload must be
// inspectable and inside the 90-second policy; in development a missing
// ffprobe binary or a synthetic test payload degrades to null instead of
// blocking local work.
export async function assertAudioDurationPolicy(filePath, { runCommand = runFfprobe, strict = production() } = {}) {
  let output;
  try {
    output = await runCommand(filePath);
  } catch (error) {
    if (strict) throw policyError('The uploaded audio could not be inspected. Upload a standard audio recording.');
    return null;
  }
  const duration = parseProbedDuration(output);
  if (duration === null) {
    if (strict) throw policyError('The uploaded audio has no measurable duration.');
    return null;
  }
  if (!audioDurationWithinPolicy(duration)) throw policyError('Audio commentary must be 90 seconds or shorter.');
  return duration;
}
