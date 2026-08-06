import Constants from 'expo-constants';

// The deployed web origin every surface of the app talks to — WebView
// shells and native fetches alike (they share one cookie jar).
// EXPO_PUBLIC_ORIGIN (inlined at bundle time) lets a dev build or the
// react-native-web preview point at a local server.
export const ORIGIN = process.env.EXPO_PUBLIC_ORIGIN
  ?? (Constants.expoConfig?.extra?.origin as string | undefined)
  ?? 'https://annotated-staging.up.railway.app';
