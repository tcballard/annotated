// Notifications: responses, likes, and follows aimed at you, derived on
// read by the server. Opening the tab marks everything seen and clears
// the bell badge.

import { useCallback, useContext, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { relTime } from '../lib/core/feed-item';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { signInNatively } from '../lib/native-auth';
import { AccountContext } from './AccountContext';
import { SessionEpochContext } from './WebScreen';
import { card, ink, meta, tokens } from '../lib/tokens';

type Notification = {
  type: 'response' | 'like' | 'follow';
  actor: { handle?: string; displayName?: string; avatarUrl?: string | null };
  body?: string;
  annotation?: { slug: string; sourceTitle: string };
  createdAt: string;
};

const ICONS = { response: 'message-circle', like: 'heart', follow: 'user-plus' } as const;

const sentence = (item: Notification): string => {
  const name = item.actor.displayName || `@${item.actor.handle}`;
  if (item.type === 'response') return `${name} responded to your annotation of ${item.annotation?.sourceTitle}`;
  if (item.type === 'like') return `${name} liked your annotation of ${item.annotation?.sourceTitle}`;
  return `${name} followed you`;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { me, clearUnseen } = useContext(AccountContext);
  const { bump } = useContext(SessionEpochContext);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.notifications();
      setItems(result.notifications || []);
      // Everything on screen is seen; the badge clears now, the watermark
      // moves server-side so it stays cleared on the next launch.
      clearUnseen();
      api.notificationsSeen().catch(() => {});
    } catch {
      setItems([]);
    }
  }, [clearUnseen]);

  useFocusEffect(useCallback(() => {
    if (me) void load();
    return () => {};
  }, [me, load]));

  if (!me) {
    return (
      <View style={styles.frame}>
        <View style={styles.cardBox}>
          <Text style={styles.title}>Nothing to ring about yet.</Text>
          <Text style={styles.body}>Sign in to see responses, likes, and new followers.</Text>
          <Pressable style={styles.signIn} onPress={async () => { if (await signInNatively()) bump(); }}>
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (items === null) return <View style={styles.loading}><ActivityIndicator color={ink} /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(item, index) => `${item.type}-${item.createdAt}-${index}`}
      style={styles.frame}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={meta} />}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => {
            if (item.annotation?.slug) router.push(`/web/a/${encodeURIComponent(item.annotation.slug)}`);
            else if (item.actor.handle) router.push(`/web/u/${encodeURIComponent(item.actor.handle)}`);
          }}
        >
          <Feather name={ICONS[item.type] || 'bell'} size={17} color={tokens['ink-soft']} style={styles.typeIcon} />
          {item.actor.avatarUrl
            ? <Image source={{ uri: item.actor.avatarUrl }} style={styles.avatarImage} />
            : (
              <View style={[styles.avatar, { backgroundColor: avatarColor(item.actor.handle || item.actor.displayName) }]}>
                <Text style={styles.avatarText}>{avatarInitial(item.actor)}</Text>
              </View>
            )}
          <View style={styles.main}>
            <Text style={styles.text}>{sentence(item)} <Text style={styles.time}>· {relTime(item.createdAt)}</Text></Text>
            {item.body ? <Text style={styles.quoteText} numberOfLines={2}>&ldquo;{item.body}&rdquo;</Text> : null}
          </View>
        </Pressable>
      )}
      ListEmptyComponent={(
        <View style={styles.cardBox}>
          <Text style={styles.title}>All quiet.</Text>
          <Text style={styles.body}>When readers respond, like your annotations, or follow you, it lands here.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  rowPressed: { opacity: 0.92 },
  typeIcon: { marginTop: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 34, height: 34, borderRadius: 17, backgroundColor: tokens.soft },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  main: { flex: 1, minWidth: 0 },
  text: { color: ink, fontSize: 14, lineHeight: 19 },
  time: { color: meta, fontSize: 12.5 },
  quoteText: { color: tokens['ink-soft'], fontSize: 13, lineHeight: 18, marginTop: 3, fontStyle: 'italic' },
  cardBox: { backgroundColor: card, borderRadius: 18, padding: 22, alignItems: 'center' },
  title: { color: ink, fontWeight: '700', fontSize: 16 },
  body: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  signIn: { marginTop: 14, backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 10, paddingHorizontal: 26 },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
