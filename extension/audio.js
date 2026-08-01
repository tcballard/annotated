export const MAX_AUDIO_SECONDS = 90;

export const preferredAudioMimeType = (mediaRecorder = globalThis.MediaRecorder) => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((mimeType) => mediaRecorder?.isTypeSupported?.(mimeType)) || '';
};

export const clampAudioDuration = (value) => Math.max(1, Math.min(MAX_AUDIO_SECONDS, Math.round(Number(value) || 0)));
