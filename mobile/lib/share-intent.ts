// Platform seam for the share sheet. Real native builds use
// expo-share-intent (iOS Share Extension + Android intent filter); the
// .web variant stubs it so the app runs as a react-native-web preview.
// Expo Go is a third runtime: the native module does not exist there and
// even importing it throws, so Go gets the web preview's inert shape and
// the share sheet stays a real-build feature (see MOBILE.md boundaries).
import Constants from 'expo-constants';

type ShareIntentHook = (options?: { debug?: boolean; resetOnBackground?: boolean }) => {
  hasShareIntent: boolean;
  shareIntent: { webUrl?: string | null; text?: string | null };
  resetShareIntent: () => void;
};

const inExpoGo = Constants.appOwnership === 'expo';

export const useShareIntent: ShareIntentHook = inExpoGo
  ? () => ({ hasShareIntent: false, shareIntent: { webUrl: null, text: null }, resetShareIntent: () => {} })
  : // eslint-disable-next-line @typescript-eslint/no-require-imports -- must not evaluate in Expo Go
    require('expo-share-intent').useShareIntent;
