// What the reader has chosen, kept on the device. One record, one key,
// read once at boot and written whenever a choice changes.
//
// Everything here is validated on the way in: a stored blob is input like
// any other, and a corrupted or hand-edited one must degrade to the
// defaults rather than putting an unknown sort on a query string.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type ExploreSort = 'trending' | 'recent';
export type FollowingOrder = 'recent' | 'popular';

export type Preferences = {
  exploreSort: ExploreSort;
  hideDemo: boolean;
  mutedTopics: string[];
  followingOrder: FollowingOrder;
};

export const DEFAULT_PREFERENCES: Preferences = {
  exploreSort: 'trending',
  hideDemo: false,
  mutedTopics: [],
  followingOrder: 'recent',
};

const KEY = 'annotated:preferences:v1';
const MAX_MUTED = 40;

export const parsePreferences = (raw: unknown): Preferences => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    exploreSort: value.exploreSort === 'recent' ? 'recent' : 'trending',
    hideDemo: value.hideDemo === true,
    mutedTopics: Array.isArray(value.mutedTopics)
      ? [...new Set(value.mutedTopics.filter((topic): topic is string => typeof topic === 'string'))].slice(0, MAX_MUTED)
      : [],
    followingOrder: value.followingOrder === 'popular' ? 'popular' : 'recent',
  };
};

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
    // A device that cannot write preferences still reads fine; the
    // choice simply does not outlive the session.
  }
};
