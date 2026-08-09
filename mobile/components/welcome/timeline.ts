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
  seekTo: (ms: number) => void;
};

export function useWelcomeTimeline(
  durationMs: number,
  autoplay: boolean,
  replayKey: number | string,
): WelcomeTimeline {
  const time = useSharedValue(autoplay ? 0 : durationMs);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    cancelAnimation(time);
    if (!autoplay || reducedMotion) {
      time.value = durationMs;
      return;
    }
    time.value = 0;
    time.value = withTiming(durationMs, { duration: durationMs, easing: Easing.linear });
  }, [autoplay, durationMs, reducedMotion, replayKey, time]);

  // Tapping through is a seek, not a separate animation path: the clock
  // jumps to the next page's stop and keeps running from there, so the
  // rest of the sequence stays exactly as authored.
  const seekTo = useCallback((ms: number) => {
    cancelAnimation(time);
    const target = Math.min(Math.max(ms, 0), durationMs);
    time.value = target;
    if (autoplay && !reducedMotion && target < durationMs) {
      time.value = withTiming(durationMs, {
        duration: durationMs - target,
        easing: Easing.linear,
      });
    }
  }, [autoplay, durationMs, reducedMotion, time]);

  return { time, seekTo };
}
