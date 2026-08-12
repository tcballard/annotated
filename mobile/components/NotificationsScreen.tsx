// Notifications: responses, likes, and follows aimed at you, derived on
// read by the server. Opening the tab marks everything seen and clears
// the bell badge. Rendered X-style: a kind glyph in the gutter, events
// aggregated per annotation ("Mara and Sam liked your annotation of …")
// with a facepile of the actors, the sentence in bold where the people
// and sources are, and the response text quoted underneath.

import { useCallback, useContext, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Icon from './Icon';
import { CardSurface } from './CardSurface';
import { relTime } from '../lib/core/feed-item';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { AccountContext } from './AccountContext';
import { AuthProviderContext } from './AuthProviderContext';
import { SessionEpochContext } from './WebScreen';
import { card, ink, meta, tokens } from '../lib/tokens';

type Actor = { handle?: string; displayName?: string; avatarUrl?: string | null };

type Notification = {
  type: 'response' | 'like' | 'follow';
  actor: Actor;
  body?: string;
  annotation?: { slug: string; sourceTitle: string };
  createdAt: string;
};

type Group = {
  key: string;
  type: Notification['type'];
  annotation?: { slug: string; sourceTitle: string };
  actors: Actor[];
  count: number;
  latest: string;
  body?: string;
};

const ICONS = { response: 'respond', like: 'heart', follow: 'follow' } as const;

// X's aggregation, ours: the same event on the same annotation collapses
// into one row — actors pile up, the newest body and time win.
export const groupNotifications = (items: Notification[]): Group[] => {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key = `${item.type}|${item.annotation?.slug || ''}`;
    const entry = map.get(key) || { key, type: item.type, annotation: item.annotation, actors: [], count: 0, latest: item.createdAt, body: item.body };
    entry.count += 1;
    if (entry.actors.length < 3 && !entry.actors.some((actor) => actor.handle === item.actor.handle)) entry.actors.push(item.actor);
    if (String(item.createdAt) > String(entry.latest)) { entry.latest = item.createdAt; entry.body = item.body || entry.body; }
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
};

const nameOf = (actor: Actor) => actor.displayName || `@${actor.handle}`;

export default function NotificationsScreen() {
  const router = useRouter();
  const { me, clearUnseen } = useContext(AccountContext);
  const { bump } = useContext(SessionEpochContext);
  const { signIn } = useContext(AuthProviderContext);
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

  // The people are the bold part of the sentence, X-style.
  const actorNames = (group: Group) => {
    const [first, second] = group.actors;
    if (group.count === 1 || !second) return <Text style={styles.bold}>{nameOf(first)}</Text>;
    if (group.count === 2) return <Text><Text style={styles.bold}>{nameOf(first)}</Text> and <Text style={styles.bold}>{nameOf(second)}</Text></Text>;
    return <Text><Text style={styles.bold}>{nameOf(first)}</Text> and {group.count - 1} others</Text>;
  };

  const sentence = (group: Group) => {
    if (group.type === 'follow') return <Text style={styles.text}>{actorNames(group)} followed you <Text style={styles.time}>· {relTime(group.latest)}</Text></Text>;
    const verb = group.type === 'response' ? 'responded to your annotation of' : 'liked your annotation of';
    return (
      <Text style={styles.text}>
        {actorNames(group)} {verb} <Text style={styles.bold}>{group.annotation?.sourceTitle}</Text> <Text style={styles.time}>· {relTime(group.latest)}</Text>
      </Text>
    );
  };

  const facepile = (actors: Actor[]) => (
    <View style={styles.facepile}>
      {actors.map((actor, index) => actor.avatarUrl ? (
        <Image key={actor.handle || String(index)} source={{ uri: actor.avatarUrl }} style={[styles.face, index > 0 && styles.faceOverlap]} />
      ) : (
        <View key={actor.handle || String(index)} style={[styles.face, styles.faceFallback, index > 0 && styles.faceOverlap, { backgroundColor: avatarColor(actor.handle || actor.displayName) }]}>
          <Text style={styles.faceInitial}>{avatarInitial(actor)}</Text>
        </View>
      ))}
    </View>
  );

  if (!me) {
    return (
      <View style={styles.frame}>
        <View style={styles.cardBox}>
          <Text style={styles.title}>Nothing to ring about yet.</Text>
          <Text style={styles.body}>Sign in to see responses, likes, and new followers.</Text>
          <Pressable style={styles.signIn} onPress={async () => { if (await signIn()) bump(); }}>
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (items === null) return <View style={styles.loading}><ActivityIndicator color={ink} /></View>;

  return (
    <FlatList
      data={groupNotifications(items)}
      keyExtractor={(group) => group.key}
      style={styles.frame}
      contentContainerStyle={[styles.list, { paddingBottom: 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={meta} />}
      renderItem={({ item: group }) => (
        <CardSurface
          style={styles.row}
          onPress={() => {
            if (group.annotation?.slug) router.push(`/web/a/${encodeURIComponent(group.annotation.slug)}`);
            else if (group.actors[0]?.handle) router.push(`/web/u/${encodeURIComponent(group.actors[0].handle)}`);
          }}
        >
          <View style={styles.typeIcon}><Icon name={ICONS[group.type] || 'bell'} size={19} color={tokens['ink-soft']} /></View>
          <View style={styles.main}>
            {facepile(group.actors)}
            {sentence(group)}
            {group.type === 'response' && group.body ? <Text style={styles.quoteText} numberOfLines={2}>&ldquo;{group.body}&rdquo;</Text> : null}
          </View>
        </CardSurface>
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
  list: { padding: 14, paddingTop: 6 },
  // The card chrome itself comes from CardSurface — this only says how
  // the row lays out inside it, so notifications and the feed cannot
  // drift apart again.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  typeIcon: { marginTop: 2, width: 22 },
  main: { flex: 1, minWidth: 0 },
  facepile: { flexDirection: 'row', marginBottom: 7 },
  face: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: card, backgroundColor: tokens.soft },
  faceOverlap: { marginLeft: -9 },
  faceFallback: { alignItems: 'center', justifyContent: 'center' },
  faceInitial: { color: '#fff', fontWeight: '700', fontSize: 12 },
  text: { color: ink, fontSize: 14.5, lineHeight: 20 },
  bold: { fontWeight: '800', color: ink },
  time: { color: meta, fontSize: 13, fontWeight: '400' },
  quoteText: { color: tokens['ink-soft'], fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  cardBox: { backgroundColor: card, borderRadius: 18, padding: 22, alignItems: 'center', marginTop: 8 },
  title: { color: ink, fontWeight: '700', fontSize: 16 },
  body: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  signIn: { marginTop: 14, backgroundColor: tokens.chrome, borderRadius: 99, paddingVertical: 10, paddingHorizontal: 26 },
  signInText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
