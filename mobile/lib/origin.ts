import Constants from 'expo-constants';

// The deployed web origin every surface of the app talks to — WebView
// shells and native fetches alike (they share one cookie jar).
export const ORIGIN = (Constants.expoConfig?.extra?.origin as string | undefined)
  ?? 'https://annotated-staging.up.railway.app';
