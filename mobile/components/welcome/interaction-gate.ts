// Nothing is tappable before it has finished arriving. An authored
// entrance means a control can be on screen at opacity 0.04 with its hit
// box already live — the gate keeps it inert until its surface is
// actually there, so a stray tap during the animation can't fire an
// action the person never saw.
//
// Comparing the completed gate object during render (rather than a plain
// boolean) closes the one-frame window a replay would otherwise leave
// open before the effect resets it.

import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

type InteractionGateOptions = {
  autoplay: boolean;
  delayMs: number;
  replayKey: number | string;
};

export function useInteractionGate({ autoplay, delayMs, replayKey }: InteractionGateOptions) {
  const reducedMotion = useReducedMotion();
  // With reduced motion the screen is composed instantly, so every
  // control is legitimately available from the first frame.
  const shouldWait = autoplay && !reducedMotion;
  const motionKey = `${typeof replayKey}:${String(replayKey)}`;
  const gate = useMemo(() => ({ delayMs, motionKey, shouldWait }), [delayMs, motionKey, shouldWait]);
  const [completedGate, setCompletedGate] = useState<typeof gate | null>(null);

  useEffect(() => {
    if (!shouldWait) return;
    const timeout = setTimeout(() => setCompletedGate(gate), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs, gate, shouldWait]);

  return !shouldWait || completedGate === gate;
}
