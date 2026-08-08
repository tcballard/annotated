// The welcome surface's public contract. Actions are semantic — the
// screen names what happened, the host decides what that means — so the
// composition never has to know about routers, auth, or navigation.

export const WELCOME_SCREEN_IDS = ['speak-language'] as const;

export type WelcomeScreenId = (typeof WELCOME_SCREEN_IDS)[number];

export type WelcomeActionId =
  | 'speak-language.sign-in'
  | 'speak-language.tap-to-continue'
  | 'speak-language.start-speaking-today';

export type WelcomeActionPressHandler = (actionId: WelcomeActionId) => void;

export type WelcomeScreenProps = {
  /** Play the authored entrance. False composes the final frame instantly. */
  autoplay?: boolean;
  onActionPress?: WelcomeActionPressHandler;
  onPrimaryPress?: () => void;
  onSecondaryPress?: () => void;
  /** Change to replay the sequence from zero. */
  replayKey?: number | string;
};

export type WelcomeScreenMetadata = {
  id: WelcomeScreenId;
  displayName: string;
  motionDurationMs: number;
};
