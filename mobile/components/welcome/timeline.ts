// One clock drives the whole screen: a shared value counting real
// milliseconds, linearly, from 0 to the sequence length. Every animated
// style reads it, so the composition can never drift out of sync with
// itself — and the motion spec's stops are literally the numbers in the
// component.
//
// Reduced motion parks the clock at the end instead of animating: the
// screen appears fully composed, which is the correct degradation for an
// authored entrance (nothing is left invisible waiting for a tween).

import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type WelcomeTimeline = {
  time: ReturnType<typeof useSharedValue<number>>;
  playSegment: (fromMs: number, toMs: number) => void;
};

export function useWelcomeTimeline(
  durationMs: number,
  autoplay: boolean,
  replayKey: number | string,
): WelcomeTimeline {
  const time = useSharedValue(autoplay ? 0 : durationMs);
  const reducedMotion = useReducedMotion();

  // The clock no longer runs the whole sequence on its own: it is parked
  // at the start and the screen plays one authored segment per tap.
  useEffect(() => {
    cancelAnimation(time);
    time.value = autoplay && !reducedMotion ? 0 : durationMs;
  }, [autoplay, durationMs, reducedMotion, replayKey, time]);

  // Play exactly one stretch of the authored timeline. The still stretches
  // between transitions are skipped by setting the clock to the segment's
  // start — nothing is visibly moving there — so each tap costs only the
  // transition it asked for, at its authored duration.
  const playSegment = useCallback((fromMs: number, toMs: number) => {
    cancelAnimation(time);
    const start = Math.min(Math.max(fromMs, 0), durationMs);
    const end = Math.min(Math.max(toMs, 0), durationMs);
    if (!autoplay || reducedMotion) { time.value = end; return; }
    time.value = start;
    time.value = withTiming(end, { duration: Math.max(0, end - start), easing: Easing.linear });
  }, [autoplay, durationMs, reducedMotion, time]);

  return { time, playSegment };
}
