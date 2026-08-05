// Web preview stub — a browser tab has no native share sheet to receive
// from. Matches the slice of expo-share-intent's hook the app consumes.
export type ShareIntentSlice = { webUrl?: string | null; text?: string | null };

export const useShareIntent = (_options?: { debug?: boolean; resetOnBackground?: boolean }) => ({
  hasShareIntent: false,
  shareIntent: { webUrl: null, text: null } as ShareIntentSlice,
  resetShareIntent: () => {},
});
