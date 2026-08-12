// Where a reader's choices live on this device.
//
// The record itself is defined once for the whole product
// (lib/core/preferences) and follows the account when there is one — the
// server holds it, and every surface reads the same copy. This module is
// the device's half of that: the cache that makes the first frame
// correct before the network answers, and the whole record for a reader
// who has not signed in.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFERENCES, parsePreferences, type Preferences } from './core/preferences';

export { DEFAULT_PREFERENCES, parsePreferences };
export type { Preferences };
export type { ExploreSort, FollowingOrder } from './core/preferences';

const KEY = 'annotated:preferences:v1';

export const readPreferences = async (): Promise<Preferences> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? parsePreferences(JSON.parse(raw)) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const writePreferences = async (preferences: Preferences): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // A device that cannot write its cache still reads fine, and a
    // signed-in reader still has the account's copy.
  }
};
