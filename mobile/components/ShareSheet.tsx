// The share sheet, native: the same doors as the web and the panel — X,
// WhatsApp, Bluesky, Email from core's shareTargets — plus Copy link and
// the system sheet for everything else the OS knows about. One host sits
// above the tabs; any surface with a share glyph summons it through the
// context instead of jumping straight to the platform sheet.

import { createContext, useMemo, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import SystemIcon from './SystemIcon';
import { BRAND_ICONS, PRODUCT_ICONS } from '../lib/core/icons';
import { shareDescriptor, shareTargets } from '../lib/core/share-kit';
import { ORIGIN } from '../lib/origin';
import { card, ink, meta, tokens } from '../lib/tokens';

type ShareSheetControls = { openShare(annotation: Record<string, any>): void };

export const ShareSheetContext = createContext<ShareSheetControls>({ openShare() {} });

// react-native-svg's web renderer re-creates parsed attributes as React
// props (see Icon.tsx) — the brand xml sheds aria-hidden the same way.
const brandXml = (xml: string) => xml.replace(' aria-hidden="true"', '');

export const ShareSheetHost = ({ children }: { children: ReactNode }) => {
  const insets = useSafeAreaInsets();
  const [annotation, setAnnotation] = useState<Record<string, any> | null>(null);
  const controls = useMemo<ShareSheetControls>(() => ({ openShare: setAnnotation }), []);
  const close = () => setAnnotation(null);
  const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };
  const descriptor = annotation ? shareDescriptor(annotation, ORIGIN) : null;

  const openDoor = (href: string) => {
    tick();
    void Linking.openURL(href).catch(() => {});
    close();
  };
  const copyLink = async () => {
    if (!descriptor) return;
    tick();
    await Clipboard.setStringAsync(descriptor.url).catch(() => {});
    if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    close();
  };
  const systemSheet = () => {
    if (!descriptor) return;
    tick();
    close();
    void Share.share(
      process.env.EXPO_OS === 'ios'
        ? { url: descriptor.url, message: descriptor.text.replace(descriptor.url, '').trim() }
        : { message: descriptor.text },
    );
  };

  return (
    <ShareSheetContext.Provider value={controls}>
      {children}
      <Modal visible={Boolean(descriptor)} transparent animationType="slide" onRequestClose={close}>
        <Pressable accessibilityLabel="Close share sheet" style={styles.backdrop} onPress={close} />
        <View style={[styles.card, { paddingBottom: 14 + insets.bottom }]}>
          <View style={styles.doors}>
            {descriptor
              ? shareTargets(descriptor).map((door) => (
                  <Pressable
                    key={door.id}
                    accessibilityRole="button"
                    accessibilityLabel={door.label}
                    style={({ pressed }) => [styles.door, pressed && styles.pressed]}
                    onPress={() => openDoor(door.href)}
                  >
                    {BRAND_ICONS[door.id as keyof typeof BRAND_ICONS]
                      ? <SvgXml xml={brandXml(BRAND_ICONS[door.id as keyof typeof BRAND_ICONS])} width={20} height={20} color={ink} />
                      : <Icon name="mail" size={20} color={ink} />}
                    <Text style={styles.doorLabel}>{door.label}</Text>
                  </Pressable>
                ))
              : null}
          </View>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => { void copyLink(); }}
          >
            <Icon name="link" size={18} color={meta} />
            <Text style={styles.rowLabel}>Copy link</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={systemSheet}
          >
            <SystemIcon name="share" size={18} color={meta} />
            <Text style={styles.rowLabel}>More options…</Text>
          </Pressable>
        </View>
      </Modal>
    </ShareSheetContext.Provider>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(38, 41, 47, 0.45)' },
  card: {
    backgroundColor: card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderCurve: 'continuous',
    padding: 14,
    gap: 10,
  },
  doors: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  door: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: tokens.hair,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  doorLabel: { fontSize: 11, color: tokens['ink-soft'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: tokens.hair,
  },
  rowLabel: { fontSize: 15, color: ink, fontWeight: '600' },
  pressed: { backgroundColor: tokens.soft },
});
