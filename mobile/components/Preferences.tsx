// The reader's choices, in one place and kept on the device: how explore
// ranks, whether the seeded demo accounts are in the picture, which
// themes Recent puts aside, and how Following is ordered. Read once at
// boot, written whenever one changes — a preference that forgets itself
// is not a preference.
//
// The gear's sheet lives here too: it is the Explore half of this record,
// in the shape X gives it.

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  writePreferences,
  type ExploreSort,
  type FollowingOrder,
  type Preferences,
} from '../lib/prefs';
import { card, ink, meta, tokens } from '../lib/tokens';

export type { ExploreSort, FollowingOrder };

type PreferencesApi = Preferences & {
  setExploreSort(next: ExploreSort): void;
  setHideDemo(next: boolean): void;
  setMutedTopics(next: string[]): void;
  setFollowingOrder(next: FollowingOrder): void;
};

export const PreferencesContext = createContext<PreferencesApi>({
  ...DEFAULT_PREFERENCES,
  setExploreSort() {},
  setHideDemo() {},
  setMutedTopics() {},
  setFollowingOrder() {},
});

export const PreferencesProvider = ({ children }: { children: ReactNode }) => {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  // Nothing is written before the stored record has been read, or the
  // defaults would overwrite the reader's choices on every cold start.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void readPreferences().then((stored) => {
      if (cancelled) return;
      setPreferences(stored);
      hydrated.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      if (hydrated.current) void writePreferences(next);
      return next;
    });
  }, []);

  const value = useMemo<PreferencesApi>(() => ({
    ...preferences,
    setExploreSort: (exploreSort) => update({ exploreSort }),
    setHideDemo: (hideDemo) => update({ hideDemo }),
    setMutedTopics: (mutedTopics) => update({ mutedTopics }),
    setFollowingOrder: (followingOrder) => update({ followingOrder }),
  }), [preferences, update]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

const SORTS: { id: ExploreSort; label: string; blurb: string }[] = [
  { id: 'trending', label: 'Trending', blurb: 'Ranked by opens of the original.' },
  { id: 'recent', label: 'Recent', blurb: 'Newest annotations first.' },
];

export const ExploreSettingsSheet = ({
  visible,
  onClose,
  settings,
}: {
  visible: boolean;
  onClose(): void;
  settings: PreferencesApi;
}) => {
  const insets = useSafeAreaInsets();
  const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close explore settings" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.card, { paddingBottom: 14 + insets.bottom }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Explore settings</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close}>
            <Icon name="close" size={18} color={meta} />
          </Pressable>
        </View>

        <Text style={styles.section}>Rank explore by</Text>
        {SORTS.map((entry) => {
          const active = settings.exploreSort === entry.id;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => { tick(); settings.setExploreSort(entry.id); }}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{entry.label}</Text>
                <Text style={styles.rowBlurb}>{entry.blurb}</Text>
              </View>
              {active ? <Icon name="check" size={19} color={ink} /> : null}
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Hide demo accounts</Text>
            <Text style={styles.rowBlurb}>This build seeds demo annotations so the feed is never empty.</Text>
          </View>
          <Switch
            value={settings.hideDemo}
            onValueChange={(next) => { tick(); settings.setHideDemo(next); }}
            trackColor={{ true: tokens.chrome, false: tokens.border }}
          />
        </View>
        <Text style={styles.foot}>Kept on this device.</Text>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(38, 41, 47, 0.45)' },
  card: {
    backgroundColor: card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  title: { flex: 1, color: ink, fontSize: 17, fontWeight: '800' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  section: { color: meta, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 6, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 4 },
  rowText: { flex: 1 },
  rowLabel: { color: ink, fontSize: 15.5, fontWeight: '700' },
  rowBlurb: { color: meta, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  pressed: { backgroundColor: tokens.soft },
  divider: { height: 1, backgroundColor: tokens.hair, marginVertical: 6 },
  foot: { color: meta, fontSize: 12, paddingHorizontal: 4, paddingTop: 6 },
});
