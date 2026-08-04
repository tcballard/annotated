export const MAX_CLIP_SECONDS = 90;
export const MIN_CLIP_SECONDS = 1;

const numericSeconds = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

const clampSeconds = (value, max) => Math.max(0, Math.min(max, numericSeconds(value)));

export const normalizeClipRange = (
  start,
  end,
  { max = MAX_CLIP_SECONDS, maxDuration = MAX_CLIP_SECONDS, min = MIN_CLIP_SECONDS, allowEmpty = false } = {},
) => {
  let from = clampSeconds(start, max);
  let to = clampSeconds(end, max);

  if (allowEmpty && from === 0 && to === 0) return { start: 0, end: 0 };
  if (to < from) [from, to] = [to, from];
  if (to - from > maxDuration) to = Math.min(max, from + maxDuration);
  if (to - from >= min) return { start: from, end: to };
  if (from + min <= max) return { start: from, end: from + min };
  return { start: Math.max(0, max - min), end: max };
};

export const moveClipBoundary = (
  start,
  end,
  boundary,
  value,
  { max = MAX_CLIP_SECONDS, maxDuration = MAX_CLIP_SECONDS, min = MIN_CLIP_SECONDS, allowEmpty = false } = {},
) => {
  const current = normalizeClipRange(start, end, { max, maxDuration, min, allowEmpty });
  const candidate = clampSeconds(value, max);

  if (allowEmpty && current.start === 0 && current.end === 0) {
    return boundary === 'start'
      ? { start: Math.min(candidate, max - min), end: Math.min(max, Math.max(candidate + min, min)) }
      : { start: Math.max(0, Math.min(candidate - min, max - min)), end: Math.max(candidate, min) };
  }

  if (boundary === 'start') return { start: Math.max(current.end - maxDuration, Math.min(candidate, current.end - min)), end: current.end };
  return { start: current.start, end: Math.min(current.start + maxDuration, Math.max(candidate, current.start + min)) };
};
