// The welcome screens are authored on one calibrated canvas — 640×1385,
// the reference viewport — and scaled to whatever device is holding them.
// Every position is absolute inside that canvas, so a layout reads as the
// same composition on an iPhone SE and a Pixel 9 Pro XL.

export const REFERENCE_WIDTH = 640;
export const REFERENCE_HEIGHT = 1385;

export type Box = readonly [x: number, y: number, width: number, height: number];

export const box = ([left, top, width, height]: Box) => ({
  position: 'absolute' as const,
  left,
  top,
  width,
  height,
});

export const centered = (width: number, top: number, height: number) =>
  box([(REFERENCE_WIDTH - width) / 2, top, width, height]);

export function clamp01(value: number) {
  'worklet';
  return Math.min(1, Math.max(0, value));
}

// The whole motion system in one function: a 0→1 ramp between two
// millisecond stops on the timeline. Every fade, slide, and gate below is
// this composed with an easing curve, which is why the sequence can be
// read straight off the motion spec.
export function segment(timeMs: number, startMs: number, endMs: number) {
  'worklet';
  if (endMs <= startMs) return timeMs >= endMs ? 1 : 0;
  return clamp01((timeMs - startMs) / (endMs - startMs));
}
