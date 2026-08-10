import { parseFile } from 'music-metadata';

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

const inspectAudio = async (filePath) => Number((await parseFile(filePath, { duration: true, skipCovers: true })).format.duration) || null;

export const parseProbedDuration = (output) => {
  let parsed;
  try { parsed = JSON.parse(output); } catch { return null; }
  const duration = Number(parsed?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
};

export const audioDurationWithinPolicy = (duration) => duration === null
  || duration <= MAX_AUDIO_UPLOAD_SECONDS + AUDIO_DURATION_TOLERANCE_SECONDS;

// Returns the inspected duration in seconds. In production every upload must
// be parseable and inside the 90-second policy; in development a synthetic or
// unsupported test payload degrades to null instead of blocking local work.
export async function assertAudioDurationPolicy(filePath, { runCommand = inspectAudio, strict = production() } = {}) {
  let inspected;
  try {
    inspected = await runCommand(filePath);
  } catch (error) {
    if (strict) throw policyError('The uploaded audio could not be inspected. Upload a standard audio recording.');
    return null;
  }
  const duration = typeof inspected === 'number'
    ? (Number.isFinite(inspected) && inspected > 0 ? inspected : null)
    : typeof inspected === 'string'
      ? parseProbedDuration(inspected)
      : Number.isFinite(Number(inspected?.format?.duration)) && Number(inspected.format.duration) > 0 ? Number(inspected.format.duration) : null;
  if (duration === null) {
    if (strict) throw policyError('The uploaded audio has no measurable duration.');
    return null;
  }
  if (!audioDurationWithinPolicy(duration)) throw policyError('Audio commentary must be 90 seconds or shorter.');
  return duration;
}
