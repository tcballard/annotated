// The slide-out panel: who you are, your library, and the product's public
// pages — the X drawer anatomy in annotated's identity. The panel has a
// top and a bottom: identity (or the wordmark) up top, navigation in the
// middle with room to breathe, and the session action — sign in or sign
// out — pinned to the bottom where X keeps settings.

import { use, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { AccountContext } from './AccountContext';
import { AuthProviderContext } from './AuthProviderContext';
import { SessionEpochContext } from './WebScreen';
import BrandMark from './BrandMark';
import { card, ink, meta, tokens } from '../lib/tokens';

type Counts = { followers: number; following: number; annotationCount: number };

// Typed to the slice we use of the drawer's navigation object.
export default function DrawerPanel({ navigation }: { navigation: { closeDrawer(): void } }) {
  const router = useRouter();
  const { me } = use(AccountContext);
  const { bump } = use(SessionEpochContext);
  const { signIn } = use(AuthProviderContext);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!me?.handle) { setCounts(null); return; }
    api.profile(me.handle)
      .then((result) => { if (!cancelled) setCounts(result.profile || result || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [me?.handle]);

  const close = () => navigation.closeDrawer();
  // A light tick on iOS turns each menu tap into a physical event; Android
  // keeps its own system feedback.
  const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };
  const go = (path: string) => { tick(); close(); router.push(path as never); };

  const item = (iconName: keyof typeof Feather.glyphMap, label: string, onPress: () => void) => (
    <Pressable key={label} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]} onPress={onPress}>
      <Feather name={iconName} size={21} color={ink} />
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );

  const canModerate = Boolean(me?.role && ['owner', 'admin', 'moderator'].includes(me.role));

  return (
    <SafeAreaView style={styles.frame} edges={['top', 'bottom']}>
      {me ? (
        <View style={styles.head}>
          {me.avatarUrl
            ? <Image source={{ uri: me.avatarUrl }} style={styles.avatarImage} />
            : (
              <View style={[styles.avatar, { backgroundColor: avatarColor(me.handle || me.displayName) }]}>
                <Text style={styles.avatarText}>{avatarInitial(me)}</Text>
              </View>
            )}
          <Text style={styles.name} numberOfLines={1}>{me.displayName || `@${me.handle}`}</Text>
          {me.displayName ? <Text style={styles.handle} numberOfLines={1}>@{me.handle}</Text> : null}
          <View style={styles.counts}>
            <Text style={styles.count}><Text style={styles.countN}>{counts?.following ?? '—'}</Text> Following</Text>
            <Text style={styles.count}><Text style={styles.countN}>{counts?.followers ?? '—'}</Text> Followers</Text>
          </View>
        </View>
      ) : (
        <View style={styles.head}>
          <BrandMark size={26} />
          <Text style={styles.blurb}>Keep the moment, keep the source.</Text>
        </View>
      )}

      <View style={styles.items}>
        {me ? item('bookmark', 'Library', () => go('/web/library')) : null}
        {me ? item('user', 'Profile', () => go(`/web/u/${encodeURIComponent(me.handle || '')}`)) : null}
        {canModerate ? item('shield', 'Moderation', () => go('/web/moderation')) : null}
        {me ? <View style={styles.divider} /> : null}
        {item('bar-chart-2', 'Transparency', () => go('/web/transparency'))}
        {item('info', 'About', () => go('/web/about'))}
        {item('flag', 'Rights & claims', () => go('/web/rights'))}
        {item('file-text', 'Terms', () => go('/web/terms'))}
      </View>

      <View style={styles.spacer} />

      {me ? (
        <Pressable
          style={({ pressed }) => [styles.item, styles.foot, pressed && styles.itemPressed]}
          onPress={async () => { tick(); await api.logout().catch(() => {}); bump(); close(); }}
        >
          <Feather name="log-out" size={20} color={meta} />
          <Text style={[styles.itemLabel, { color: meta }]}>Sign out</Text>
        </Pressable>
      ) : (
        <View style={styles.foot}>
          <Pressable
            style={styles.signIn}
            onPress={async () => { tick(); if (await signIn()) { bump(); close(); } }}
          >
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.footnote}>annotated · source-first notes</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // The frame carries the card's own radii and clips content to them — the
  // matching drawerStyle radii (and the shadow) live on the navigator's
  // container, which must keep overflow visible for the shadow to paint.
  frame: { flex: 1, backgroundColor: card, borderTopRightRadius: 24, borderBottomRightRadius: 24, borderCurve: 'continuous', overflow: 'hidden' },
  head: { padding: 20, paddingTop: 22, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: tokens.hair },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarImage: { width: 52, height: 52, borderRadius: 26, backgroundColor: tokens.soft, marginBottom: 10 },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 20 },
  name: { color: ink, fontWeight: '800', fontSize: 17 },
  handle: { color: meta, fontSize: 13.5, marginTop: 1 },
  counts: { flexDirection: 'row', gap: 14, marginTop: 10 },
  count: { color: meta, fontSize: 13 },
  countN: { color: ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  blurb: { color: meta, fontSize: 14, marginTop: 6 },
  items: { paddingVertical: 10, paddingHorizontal: 10 },
  // Rows are inset rounded pills, so a press highlights a shape instead of
  // smearing a full-bleed strip into the card's rounded edge.
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 12, borderCurve: 'continuous' },
  itemPressed: { backgroundColor: tokens.soft },
  itemLabel: { color: ink, fontSize: 16.5, fontWeight: '700' },
  divider: { height: 1, backgroundColor: tokens.hair, marginVertical: 8, marginHorizontal: 12 },
  spacer: { flex: 1 },
  foot: { borderTopWidth: 1, borderTopColor: tokens.hair, paddingHorizontal: 20, paddingVertical: 14 },
  signIn: { backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 12, alignItems: 'center' },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footnote: { color: meta, fontSize: 11.5, paddingHorizontal: 20, paddingBottom: 10 },
});
