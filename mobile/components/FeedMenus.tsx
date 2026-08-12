// The two small menus the Home rail carries, in X's shape and our
// vocabulary: Recent can put topics aside, and Following can be ordered
// by time or by attention. Both hang off the active tab's chevron, both
// apply immediately, and both are kept on the device (lib/prefs).

import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { TOPICS } from '../lib/core/topics';
import type { FollowingOrder } from '../lib/prefs';
import { card, ink, meta, tokens } from '../lib/tokens';

export type { FollowingOrder };

const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };

const SheetFrame = ({
  visible,
  onClose,
  title,
  action,
  children,
}: {
  visible: boolean;
  onClose(): void;
  title: string;
  action?: { label: string; onPress(): void };
  children: React.ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={`Close ${title}`} style={styles.backdrop} onPress={onClose} />
      <View style={[styles.card, { paddingBottom: 12 + insets.bottom }]}>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close}>
            <Icon name="close" size={18} color={meta} />
          </Pressable>
        </View>
        {children}
        {action ? (
          <Pressable style={({ pressed }) => [styles.reset, pressed && styles.pressed]} onPress={action.onPress}>
            <Text style={styles.resetText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
};

// Recent's themes: the topics you would rather not see right now.
export const TopicMuteSheet = ({
  visible,
  onClose,
  muted,
  setMuted,
}: {
  visible: boolean;
  onClose(): void;
  muted: string[];
  setMuted(next: string[]): void;
}) => (
  <SheetFrame
    visible={visible}
    onClose={onClose}
    title="Themes"
    action={muted.length ? { label: 'Show every theme', onPress: () => { tick(); setMuted([]); } } : undefined}
  >
    <Text style={styles.blurb}>Turn a theme off to keep it out of Recent. Kept on this device.</Text>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
      {TOPICS.map((entry) => {
        const on = !muted.includes(entry.slug);
        return (
          <View key={entry.slug} style={styles.row}>
            <Text style={styles.rowLabel}>{entry.label}</Text>
            <Switch
              value={on}
              onValueChange={(next) => {
                tick();
                setMuted(next ? muted.filter((slug) => slug !== entry.slug) : [...muted, entry.slug]);
              }}
              trackColor={{ true: tokens.chrome, false: tokens.border }}
            />
          </View>
        );
      })}
    </ScrollView>
  </SheetFrame>
);

// Following's ordering: newest first, or the ones people are opening.
export const FollowingOrderSheet = ({
  visible,
  onClose,
  order,
  setOrder,
}: {
  visible: boolean;
  onClose(): void;
  order: FollowingOrder;
  setOrder(next: FollowingOrder): void;
}) => (
  <SheetFrame visible={visible} onClose={onClose} title="Order Following by">
    {([
      { id: 'recent' as const, label: 'Most recent', blurb: 'Newest annotations from people you follow.', icon: 'bell' as const },
      { id: 'popular' as const, label: 'Popular', blurb: 'Ranked by opens of the original.', icon: 'heart' as const },
    ]).map((entry) => {
      const active = order === entry.id;
      return (
        <Pressable
          key={entry.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: active }}
          style={({ pressed }) => [styles.row, styles.orderRow, pressed && styles.pressed]}
          onPress={() => { tick(); setOrder(entry.id); onClose(); }}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{entry.label}</Text>
            <Text style={styles.rowBlurb}>{entry.blurb}</Text>
          </View>
          {active ? <Icon name="check" size={19} color={ink} /> : null}
        </Pressable>
      );
    })}
  </SheetFrame>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(38, 41, 47, 0.45)' },
  card: {
    backgroundColor: card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingTop: 10,
    maxHeight: '76%',
  },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  title: { flex: 1, color: ink, fontSize: 17, fontWeight: '800' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  blurb: { color: meta, fontSize: 12.5, lineHeight: 17, paddingBottom: 6 },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 4 },
  orderRow: { minHeight: 60 },
  rowText: { flex: 1 },
  rowLabel: { flex: 1, color: ink, fontSize: 15.5, fontWeight: '600' },
  rowBlurb: { color: meta, fontSize: 12.5, marginTop: 2 },
  pressed: { backgroundColor: tokens.soft },
  reset: { minHeight: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.soft, borderRadius: 12, borderCurve: 'continuous', marginTop: 8 },
  resetText: { color: ink, fontSize: 14.5, fontWeight: '700' },
});
