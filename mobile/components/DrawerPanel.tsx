// The menu panel: who you are, then where you can go — the X drawer
// anatomy in annotated's identity. It stays mounted beneath the app's
// moving surface (SwipeMenuShell). Identity sits at the top with your
// counts, the places you act live in the primary group, and the quieter
// public and account pages sit in a smaller group beneath them; the
// session action — sign in or sign out — is pinned to the bottom.

import { use, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import Icon, { type ProductIconName } from './Icon';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { AccountContext } from './AccountContext';
import { AuthProviderContext } from './AuthProviderContext';
import { SessionEpochContext } from './WebScreen';
import { SwipeMenuContext } from './SwipeMenuShell';
import BrandMark from './BrandMark';
import { card, ink, meta, tokens } from '../lib/tokens';

type Counts = { followers: number; following: number; annotationCount: number };

const count = (value: number | undefined) => (typeof value === 'number' ? value.toLocaleString() : '—');

export default function DrawerPanel() {
  const router = useRouter();
  const { close } = use(SwipeMenuContext);
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

  // A light tick on iOS turns each menu tap into a physical event; Android
  // keeps its own system feedback.
  const tick = () => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); };
  const go = (path: string) => { tick(); close(); router.push(path as never); };

  // Two weights of destination, X-style: the places you act are set in
  // the reading size, the reference pages sit quieter beneath them.
  const item = (iconName: ProductIconName, label: string, onPress: () => void) => (
    <Pressable key={label} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]} onPress={onPress}>
      <Icon name={iconName} size={21} color={ink} />
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );

  const minorItem = (iconName: ProductIconName, label: string, onPress: () => void) => (
    <Pressable key={label} style={({ pressed }) => [styles.minor, pressed && styles.itemPressed]} onPress={onPress}>
      <Icon name={iconName} size={18} color={meta} />
      <Text style={styles.minorLabel}>{label}</Text>
    </Pressable>
  );

  const canModerate = Boolean(me?.role && ['owner', 'admin', 'moderator'].includes(me.role));

  return (
    <SafeAreaView style={styles.frame} edges={['top', 'bottom']}>
      {me ? (
        <Pressable
          style={styles.head}
          onPress={() => go(`/web/u/${encodeURIComponent(me.handle || '')}`)}
          accessibilityLabel="Open your profile"
        >
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
            <Text style={styles.count}><Text style={styles.countN}>{count(counts?.following)}</Text> Following</Text>
            <Text style={styles.count}><Text style={styles.countN}>{count(counts?.followers)}</Text> Followers</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.head}>
          <BrandMark size={26} />
          <Text style={styles.blurb}>Keep the moment, keep the source.</Text>
        </View>
      )}

      <View style={styles.items}>
        {me ? item('user', 'Profile', () => go(`/web/u/${encodeURIComponent(me.handle || '')}`)) : null}
        {me ? item('bookmark', 'Library', () => go('/web/library')) : null}
        {item('claim', 'Disputes', () => go('/web/rights'))}
        {canModerate ? item('shield', 'Moderation', () => go('/web/moderation')) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.minorItems}>
        {minorItem('bar-chart-2', 'Transparency', () => go('/web/transparency'))}
        {minorItem('info', 'About', () => go('/web/about'))}
        {minorItem('settings', 'Settings', () => go('/settings'))}
        {minorItem('help-circle', 'Help Centre', () => go('/web/help'))}
      </View>

      <View style={styles.spacer} />

      {me ? (
        <Pressable
          style={({ pressed }) => [styles.minor, styles.foot, pressed && styles.itemPressed]}
          onPress={async () => { tick(); await api.logout().catch(() => {}); bump(); close(); }}
        >
          <Icon name="log-out" size={18} color={meta} />
          <Text style={styles.minorLabel}>Sign out</Text>
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
  // The panel is the flat layer beneath the moving surface — the rounded
  // card in this anatomy is the surface above it (SwipeMenuShell), so the
  // frame itself stays square and full-bleed.
  frame: { flex: 1, backgroundColor: card },
  head: { padding: 20, paddingTop: 22, paddingBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarImage: { width: 48, height: 48, borderRadius: 24, backgroundColor: tokens.soft, marginBottom: 10 },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 19 },
  name: { color: ink, fontWeight: '800', fontSize: 17 },
  handle: { color: meta, fontSize: 13.5, marginTop: 1 },
  counts: { flexDirection: 'row', gap: 16, marginTop: 10 },
  count: { color: meta, fontSize: 13 },
  countN: { color: ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  blurb: { color: meta, fontSize: 14, marginTop: 6 },
  items: { paddingHorizontal: 10, paddingBottom: 4 },
  minorItems: { paddingHorizontal: 10, paddingTop: 4 },
  // Rows are inset rounded pills, so a press highlights a shape instead of
  // smearing a full-bleed strip into the card's rounded edge.
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 12, borderCurve: 'continuous' },
  itemPressed: { backgroundColor: tokens.soft },
  itemLabel: { color: ink, fontSize: 16.5, fontWeight: '700' },
  minor: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 11, minHeight: 44, borderRadius: 12, borderCurve: 'continuous' },
  minorLabel: { color: tokens['ink-soft'], fontSize: 14.5, fontWeight: '600' },
  divider: { height: 1, backgroundColor: tokens.hair, marginVertical: 4, marginHorizontal: 22 },
  spacer: { flex: 1 },
  foot: { marginHorizontal: 10, marginBottom: 2 },
  signIn: { backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 12, alignItems: 'center', marginHorizontal: 10 },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footnote: { color: meta, fontSize: 11.5, paddingHorizontal: 22, paddingBottom: 10 },
});
