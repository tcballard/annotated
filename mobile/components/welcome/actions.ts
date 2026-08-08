// Prefer the semantic action API, keep the plain primary/secondary
// callbacks working for hosts that only care about the two outcomes.
// Returning undefined (rather than a no-op) is deliberate: GatedPressable
// treats a handler-less control as inert, so an unwired action is
// untappable instead of silently swallowing presses.

import type { WelcomeActionId, WelcomeActionPressHandler } from './types';

export function resolveActionPress(
  actionId: WelcomeActionId,
  onActionPress: WelcomeActionPressHandler | undefined,
  fallback?: () => void,
) {
  if (!onActionPress) return fallback;
  return () => onActionPress(actionId);
}
