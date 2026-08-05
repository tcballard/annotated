// The slide-out panel: who you are, your library, and the product's public
// pages — the X drawer anatomy in annotated's identity. Signed out it
// offers exactly one thing: sign in.

import { useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { signInNatively } from '../lib/native-auth';
import { AccountContext } from './AccountContext';
import { SessionEpochContext } from './WebScreen';
import { card, ink, meta, tokens } from '../lib/tokens';

type Counts = { followers: number; following: number; annotationCount: number };

// Typed to the slice we use of the drawer's navigation object.
export default function DrawerPanel({ navigation }: { navigation: { closeDrawer(): void } }) {
  const router = useRouter();
  const { me } = useContext(AccountContext);
  const { bump } = useContext(SessionEpochContext);
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
  const go = (path: string) => { close(); router.push(path as never); };

  const item = (iconName: keyof typeof Feather.glyphMap, label: string, onPress: () => void) => (
    <Pressable key={label} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]} onPress={onPress}>
      <Feather name={iconName} size={19} color={ink} />
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
          <Text style={styles.name}>annotated</Text>
          <Text style={styles.blurb}>Keep the moment, keep the source.</Text>
          <Pressable
            style={styles.signIn}
            onPress={async () => { if (await signInNatively()) { bump(); close(); } }}
          >
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.items}>
        {me ? item('bookmark', 'Library', () => go('/web/library')) : null}
        {me ? item('user', 'Profile', () => go(`/web/u/${encodeURIComponent(me.handle || '')}`)) : null}
        {canModerate ? item('shield', 'Moderation', () => go('/web/moderation')) : null}
        {item('bar-chart-2', 'Transparency', () => go('/web/transparency'))}
        {item('info', 'About', () => go('/web/about'))}
        {item('flag', 'Rights & claims', () => go('/web/rights'))}
        {item('file-text', 'Terms', () => go('/web/terms'))}
      </View>

      {me ? (
        <Pressable
          style={({ pressed }) => [styles.item, styles.signOut, pressed && styles.itemPressed]}
          onPress={async () => { await api.logout().catch(() => {}); bump(); close(); }}
        >
          <Feather name="log-out" size={19} color={meta} />
          <Text style={[styles.itemLabel, { color: meta }]}>Sign out</Text>
        </Pressable>
      ) : null}
      <Text style={styles.footnote}>annotated · source-first notes</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: card },
  head: { padding: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: tokens.hair },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarImage: { width: 52, height: 52, borderRadius: 26, backgroundColor: tokens.soft, marginBottom: 10 },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 20 },
  name: { color: ink, fontWeight: '800', fontSize: 17 },
  handle: { color: meta, fontSize: 13.5, marginTop: 1 },
  counts: { flexDirection: 'row', gap: 14, marginTop: 10 },
  count: { color: meta, fontSize: 13 },
  countN: { color: ink, fontWeight: '700' },
  blurb: { color: meta, fontSize: 13.5, marginTop: 4 },
  signIn: { marginTop: 14, backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 10, alignItems: 'center' },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  items: { paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 13 },
  itemPressed: { backgroundColor: tokens.soft },
  itemLabel: { color: ink, fontSize: 15.5, fontWeight: '600' },
  signOut: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: tokens.hair },
  footnote: { color: meta, fontSize: 11.5, paddingHorizontal: 18, paddingVertical: 10 },
});
