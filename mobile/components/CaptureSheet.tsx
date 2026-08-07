// The pen summons a sheet, X-compose style: capture slides up over
// whatever you were reading instead of being a place you travel to.
// The sheet is native chrome — drag handle, close, and the copied-link
// chip — around the same shell-mode web capture the share sheet uses.
//
// Clipboard manners: hasUrlAsync only DETECTS a link (no iOS paste
// banner); the actual read happens on the chip tap — a user gesture,
// exactly the pattern X and Bluesky use.

import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebScreen from './WebScreen';
import { ORIGIN } from '../lib/origin';
import { captureUrlFromShare, shellUrl } from '../lib/shell';
import { card, ink, paper, tokens } from '../lib/tokens';

export default function CaptureSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [hasCopiedLink, setHasCopiedLink] = useState(false);
  const [uri, setUri] = useState(() => shellUrl(ORIGIN, '/capture'));

  // Each opening starts fresh and asks (bannerlessly) whether the
  // clipboard holds a link worth offering.
  useEffect(() => {
    if (!visible) return;
    setUri(`${shellUrl(ORIGIN, '/capture')}&nonce=${Date.now()}`);
    setHasCopiedLink(false);
    if (Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      const holdsUrl = await Clipboard.hasUrlAsync().catch(() => false);
      if (!cancelled) setHasCopiedLink(holdsUrl);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const pasteCopiedLink = useCallback(async () => {
    const copied = (await Clipboard.getUrlAsync().catch(() => null))
      || (await Clipboard.getStringAsync().catch(() => ''));
    const prefilled = copied ? captureUrlFromShare(ORIGIN, { text: copied }) : null;
    if (prefilled) setUri(`${prefilled}&nonce=${Date.now()}`);
    setHasCopiedLink(false);
  }, []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdropHost}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close capture" onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.grip}>
            <View style={styles.handle} />
            <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close capture" hitSlop={8}>
              <Feather name="x" color={ink} size={18} />
            </Pressable>
          </View>
          {hasCopiedLink ? (
            <Pressable style={styles.chip} onPress={() => { void pasteCopiedLink(); }} accessibilityLabel="Paste the copied link">
              <Feather name="link" color={ink} size={14} />
              <Text style={styles.chipText}>Paste copied link</Text>
            </Pressable>
          ) : null}
          <WebScreen uri={uri} padTop={false} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropHost: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(38, 41, 47, 0.45)' },
  sheet: {
    height: '90%',
    backgroundColor: card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: tokens.border,
    overflow: 'hidden',
  },
  grip: { alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingBottom: 6 },
  handle: { width: 36, height: 4, borderRadius: 99, backgroundColor: tokens.border },
  close: { position: 'absolute', right: 12, top: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: paper },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 6,
    backgroundColor: card,
  },
  chipText: { color: ink, fontSize: 13, fontWeight: '600' },
});
