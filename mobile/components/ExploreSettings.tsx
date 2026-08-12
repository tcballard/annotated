// Explore settings: the small set of choices that change what the
// Search tab shows, reachable from the gear beside the search field —
// the shape X uses, in our vocabulary. Only honest levers live here:
// which order explore ranks in, and whether the seeded demo accounts are
// part of the picture. Both apply immediately and last for the session.

import { createContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { card, ink, meta, tokens } from '../lib/tokens';

export type ExploreSort = 'trending' | 'recent';

type ExploreSettings = {
  sort: ExploreSort;
  setSort(next: ExploreSort): void;
  hideDemo: boolean;
  setHideDemo(next: boolean): void;
};

export const ExploreSettingsContext = createContext<ExploreSettings>({
  sort: 'trending',
  setSort() {},
  hideDemo: false,
  setHideDemo() {},
});

export const ExploreSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [sort, setSort] = useState<ExploreSort>('trending');
  const [hideDemo, setHideDemo] = useState(false);
  const value = useMemo(() => ({ sort, setSort, hideDemo, setHideDemo }), [sort, hideDemo]);
  return <ExploreSettingsContext.Provider value={value}>{children}</ExploreSettingsContext.Provider>;
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
  settings: ExploreSettings;
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
          const active = settings.sort === entry.id;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => { tick(); settings.setSort(entry.id); }}
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
        <Text style={styles.foot}>Choices last for this session.</Text>
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
