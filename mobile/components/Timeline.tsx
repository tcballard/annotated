// The native timeline: the app's reading surface, built with the shared
// core (domain model, API client, deep links) and the web's own design
// tokens — FlatList physics, pull-to-refresh, cursor paging, haptic pane
// switches. Annotation pages, profiles, and hubs push as web surfaces;
// originals open OUT in the real browser. Media plays on the permalink —
// the list shows posters, screenshots, waveforms, and quotes.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import Feather from '@expo/vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { annotationToFeedItem, chipFor, formatTime } from '../lib/core/feed-item';
import type { FeedItem } from '../lib/core/feed-item';
import { avatarColor } from '../lib/core/avatar';
import { topicLabel } from '../lib/core/topics';
import { openOriginalHref } from '../lib/core/deep-link';
import { publicAnnotationUrl } from '../lib/core/share-links';
import { api } from '../lib/api';
import { ORIGIN } from '../lib/origin';
import { signInNatively } from '../lib/native-auth';
import { card, ink, meta, paper, tokens } from '../lib/tokens';
import { SessionEpochContext } from './WebScreen';

const serif = Platform.select({ ios: 'Georgia', default: 'serif' });

// Hosted media paths come back server-relative; the native app is not
// same-origin, so absolutize against the deployment.
const absolute = (url: string): string => (/^https?:\/\//.test(url) ? url : `${ORIGIN}${url}`);

type PaneKey = 'recent' | 'trending' | 'following';
const PANES: { key: PaneKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'trending', label: 'Trending' },
  { key: 'following', label: 'Following' },
];

type TopicEntry = { slug: string; label: string; count: number };

const feedQuery = (pane: PaneKey, topic: string | null, cursor: string | null): string => {
  const params = new URLSearchParams({ limit: '20' });
  if (pane === 'trending') {
    params.set('sort', 'trending');
    if (topic) params.set('topic', topic);
  }
  if (pane === 'following') params.set('following', 'true');
  if (cursor) params.set('cursor', cursor);
  return params.toString();
};

// Bars from the server-extracted peaks (0..100) — the same visual the web
// draws, sized for the card. Playback lives on the permalink.
const Waveform = ({ peaks }: { peaks: number[] | null }) => {
  if (!Array.isArray(peaks) || !peaks.length) return null;
  return (
    <View style={styles.wave} accessibilityElementsHidden>
      {peaks.map((peak, index) => (
        <View key={index} style={[styles.waveBar, { height: `${Math.max(8, Math.min(100, Number(peak) || 0))}%` }]} />
      ))}
    </View>
  );
};

const SourceCard = ({ item }: { item: FeedItem }) => {
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  return (
    <View style={styles.srccard}>
      <View style={styles.srchead}>
        <Text style={styles.chip}>{chipFor(item)}</Text>
        <Text style={styles.srcname} numberOfLines={1}>{item.sourceTitle}</Text>
      </View>
      {item.posterUrl && item.mediaStatus === 'ready' && item.type === 'video' ? (
        <View style={styles.media}>
          <Image source={{ uri: absolute(item.posterUrl) }} style={styles.mediaImage} resizeMode="cover" />
          <Text style={styles.cliptag}>CLIP</Text>
          <Text style={styles.badge}>{formatTime(clipSeconds)} · 240p</Text>
        </View>
      ) : null}
      {item.clipUrl && item.mediaStatus === 'ready' && item.type === 'podcast' ? (
        <View style={styles.audioRow}>
          <Waveform peaks={item.clipPeaks} />
          <Text style={styles.audioTime}>{formatTime(clipSeconds)}</Text>
        </View>
      ) : null}
      {item.screenshotUrl ? (
        <View style={styles.media}>
          <Image source={{ uri: absolute(item.screenshotUrl) }} style={styles.mediaImage} resizeMode="cover" />
        </View>
      ) : null}
      {item.quote ? <Text style={styles.quote}>&ldquo;{item.quote}&rdquo;</Text> : null}
      {item.commentaryMode === 'audio' && item.audioUrl ? (
        <View style={styles.audioRow}>
          <Feather name="mic" size={14} color={meta} />
          <Waveform peaks={item.audioPeaks} />
          {item.audioDuration ? <Text style={styles.audioTime}>{formatTime(item.audioDuration)}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.srchost}>{item.host} · {item.type}</Text>
    </View>
  );
};

type CardProps = {
  item: FeedItem;
  following: boolean;
  ownId: string;
  onOpenAnnotation: (item: FeedItem) => void;
  onOpenProfile: (item: FeedItem) => void;
  onOpenOriginal: (item: FeedItem) => void;
  onToggleFollow: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
};

const FeedCard = ({ item, following, ownId, onOpenAnnotation, onOpenProfile, onOpenOriginal, onToggleFollow, onShare }: CardProps) => (
  <Pressable style={({ pressed }) => [styles.post, pressed && styles.postPressed]} onPress={() => onOpenAnnotation(item)}>
    <Pressable onPress={() => onOpenProfile(item)} hitSlop={6}>
      {item.avatarUrl
        ? <Image source={{ uri: item.avatarUrl }} style={styles.avatarImage} />
        : (
          <View style={[styles.avatar, { backgroundColor: avatarColor(item.handle || item.displayName) }]}>
            <Text style={styles.avatarText}>{item.initials}</Text>
          </View>
        )}
    </Pressable>
    <View style={styles.content}>
      <View style={styles.byline}>
        <Pressable onPress={() => onOpenProfile(item)} hitSlop={6} style={styles.who}>
          <Text style={styles.name} numberOfLines={1}>{item.displayName || `@${item.handle}`}</Text>
          <Text style={styles.metaText} numberOfLines={1}>{`${item.displayName ? `@${item.handle} · ` : ''}${item.time}${item.editedAt ? ' · edited' : ''}`}</Text>
        </Pressable>
        {item.topic ? <Text style={styles.topicTag}>{topicLabel(item.topic)}</Text> : null}
      </View>
      {item.commentary
        ? <Text style={styles.note}>{item.commentary}</Text>
        : <Text style={styles.note}>Audio note{item.audioDuration ? ` · ${formatTime(item.audioDuration)}` : ''} — listen on the page.</Text>}
      <SourceCard item={item} />
      <View style={styles.actions}>
        <Pressable style={styles.act} onPress={() => onOpenOriginal(item)} hitSlop={8}>
          <Feather name="external-link" size={15} color={ink} />
          <Text style={styles.actText}>Open original{item.opens ? ` · ${item.opens}` : ''}</Text>
        </Pressable>
        <Pressable style={styles.act} onPress={() => onOpenAnnotation(item)} hitSlop={8} accessibilityLabel="Respond">
          <Feather name="message-circle" size={15} color={meta} />
          {item.comments ? <Text style={styles.actMuted}>{item.comments}</Text> : null}
        </Pressable>
        {item.authorId && item.authorId !== ownId ? (
          <Pressable style={styles.act} onPress={() => onToggleFollow(item)} hitSlop={8} accessibilityLabel={following ? 'Following' : 'Follow'}>
            <Feather name={following ? 'user-check' : 'user-plus'} size={15} color={following ? ink : meta} />
          </Pressable>
        ) : null}
        <Pressable style={styles.act} onPress={() => onShare(item)} hitSlop={8} accessibilityLabel="Share annotation">
          <Feather name="share" size={15} color={meta} />
        </Pressable>
      </View>
    </View>
  </Pressable>
);

export default function Timeline() {
  const router = useRouter();
  const { epoch, bump } = useContext(SessionEpochContext);
  const [pane, setPane] = useState<PaneKey>('recent');
  const [topic, setTopic] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const [ownId, setOwnId] = useState('');
  const [followingIds, setFollowingIds] = useState<Record<string, boolean>>({});
  const requestSeq = useRef(0);

  const load = useCallback(async (target: PaneKey, targetTopic: string | null, { append = false, cursorAt = null as string | null } = {}) => {
    const seq = ++requestSeq.current;
    try {
      const result = await api.feed(feedQuery(target, targetTopic, append ? cursorAt : null));
      if (seq !== requestSeq.current) return;
      const mapped = (result.annotations || []).map(annotationToFeedItem);
      setItems((current) => append ? [...current, ...mapped] : mapped);
      setCursor(result.nextCursor || null);
      setTopics(Array.isArray(result.topics) ? result.topics : []);
      setOffline(false);
    } catch {
      if (seq !== requestSeq.current) return;
      setOffline(true);
    }
  }, []);

  // First load, and again whenever a sign-in lands anywhere in the app.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await api.me().catch(() => ({ user: null }));
      if (!cancelled) setOwnId(result.user?.id || '');
      await load(pane, topic);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  const switchPane = (next: PaneKey) => {
    if (next === pane) return;
    void Haptics.selectionAsync();
    setPane(next);
    setTopic(null);
    setLoading(true);
    void load(next, null).then(() => setLoading(false));
  };

  const switchTopic = (next: string | null) => {
    setTopic(next);
    void load(pane, next);
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(pane, topic);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadingMore(true);
    await load(pane, topic, { append: true, cursorAt: cursor });
    setLoadingMore(false);
  };

  const openAnnotation = (item: FeedItem) => {
    if (!item.slug) return;
    api.recordOpen(item.slug).catch(() => {});
    router.push(`/web/a/${encodeURIComponent(item.slug)}`);
  };
  const openProfile = (item: FeedItem) => router.push(`/web/u/${encodeURIComponent(item.handle)}`);
  const openOriginal = (item: FeedItem) => {
    if (item.slug) api.recordOpen(item.slug).catch(() => {});
    void WebBrowser.openBrowserAsync(openOriginalHref(item));
  };
  const share = (item: FeedItem) => {
    const url = publicAnnotationUrl(item, ORIGIN);
    if (url) void Share.share(Platform.OS === 'ios' ? { url } : { message: url });
  };
  const toggleFollow = async (item: FeedItem) => {
    const next = !followingIds[item.authorId];
    setFollowingIds((current) => ({ ...current, [item.authorId]: next }));
    try {
      await (next ? api.follow(item.authorId) : api.unfollow(item.authorId));
      void Haptics.selectionAsync();
    } catch (error: any) {
      setFollowingIds((current) => ({ ...current, [item.authorId]: !next }));
      if (error?.status === 401 && await signInNatively()) bump();
    }
  };

  const emptyTitle = pane === 'following' ? 'No annotations from people you follow yet.'
    : pane === 'trending' ? 'Nothing is trending yet.'
    : 'No public annotations yet.';
  const emptyBody = pane === 'following' ? 'Follow someone whose context you want to keep up with.'
    : pane === 'trending' ? 'Annotations trend as readers open their originals and respond.'
    : 'Capture the first source-backed moment and it will appear here.';

  return (
    <SafeAreaView edges={['top']} style={styles.frame}>
      <View style={styles.switcher}>
        <View style={styles.tabs}>
          {PANES.map(({ key, label }) => (
            <Pressable key={key} style={[styles.tab, pane === key && styles.tabActive]} onPress={() => switchPane(key)}>
              <Text style={pane === key ? styles.tabActiveText : styles.tabText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {pane === 'trending' && topics.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
            <Pressable style={[styles.topicChip, !topic && styles.topicChipActive]} onPress={() => switchTopic(null)}>
              <Text style={!topic ? styles.topicChipActiveText : styles.topicChipText}>All</Text>
            </Pressable>
            {topics.map((entry) => (
              <Pressable key={entry.slug} style={[styles.topicChip, topic === entry.slug && styles.topicChipActive]} onPress={() => switchTopic(entry.slug)}>
                <Text style={topic === entry.slug ? styles.topicChipActiveText : styles.topicChipText}>{entry.label} {entry.count}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      {offline ? (
        <View style={styles.offline}><Text style={styles.offlineText}>The annotated backend is unreachable. Pull to retry.</Text></View>
      ) : null}
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={ink} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, index) => item.slug || String(index)}
          renderItem={({ item }) => (
            <FeedCard
              item={item}
              following={Boolean(followingIds[item.authorId])}
              ownId={ownId}
              onOpenAnnotation={openAnnotation}
              onOpenProfile={openProfile}
              onOpenOriginal={openOriginal}
              onToggleFollow={toggleFollow}
              onShare={share}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={meta} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={meta} style={styles.footer} /> : null}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptyBody}>{emptyBody}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const radiusCard = parseInt(tokens['radius-card'], 10) || 18;
const radiusInner = parseInt(tokens['radius-inner'], 10) || 14;

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: paper },
  switcher: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, backgroundColor: paper },
  tabs: { flexDirection: 'row', backgroundColor: card, borderWidth: 1, borderColor: tokens.border, borderRadius: 99, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 99 },
  tabActive: { backgroundColor: tokens.chrome },
  tabText: { fontSize: 13.5, color: meta },
  tabActiveText: { fontSize: 13.5, color: '#fff', fontWeight: '700' },
  chips: { marginTop: 8 },
  chipsRow: { gap: 6, paddingRight: 14 },
  topicChip: { borderWidth: 1, borderColor: tokens.border, backgroundColor: card, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  topicChipActive: { backgroundColor: tokens['ink-soft'], borderColor: tokens['ink-soft'] },
  topicChipText: { fontSize: 12.5, color: tokens['ink-soft'] },
  topicChipActiveText: { fontSize: 12.5, color: '#fff', fontWeight: '600' },
  offline: { margin: 14, padding: 12, backgroundColor: card, borderRadius: radiusInner, borderWidth: 1, borderColor: tokens.border },
  offlineText: { color: tokens['ink-soft'], fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, paddingTop: 8 },
  footer: { paddingVertical: 16 },
  post: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: card,
    borderRadius: radiusCard,
    padding: 12,
    marginBottom: 10,
    shadowColor: tokens['chrome-dark'],
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  postPressed: { opacity: 0.92 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.soft },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  content: { flex: 1, minWidth: 0 },
  byline: { flexDirection: 'row', alignItems: 'center' },
  who: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, minWidth: 0 },
  name: { color: ink, fontWeight: '700', fontSize: 14.5, flexShrink: 1 },
  metaText: { color: meta, fontSize: 12.5, flexShrink: 1, marginLeft: 5 },
  topicTag: { marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: tokens['ink-soft'], backgroundColor: tokens.soft, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  note: { color: ink, fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  srccard: { marginTop: 8, backgroundColor: tokens.strip, borderWidth: 1, borderColor: tokens.hair, borderRadius: radiusInner, padding: 10 },
  srchead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, color: tokens['ink-soft'], backgroundColor: tokens.soft, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  srcname: { fontFamily: serif, fontSize: 14, color: ink, flexShrink: 1 },
  srchost: { color: meta, fontSize: 12, marginTop: 6 },
  media: { marginTop: 8, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  mediaImage: { width: '100%', aspectRatio: 16 / 10, backgroundColor: tokens.soft },
  cliptag: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(38,41,47,.82)', color: '#fff', fontSize: 10, fontWeight: '700', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  badge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(38,41,47,.82)', color: '#fff', fontSize: 11, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  quote: { fontFamily: serif, fontSize: 14.5, lineHeight: 21, color: tokens['ink-soft'], marginTop: 8 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  wave: { flex: 1, height: 34, flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, overflow: 'hidden' },
  waveBar: { flex: 1, minWidth: 1.5, backgroundColor: tokens.border, borderRadius: 1 },
  audioTime: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, color: meta },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingRight: 4 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actText: { color: ink, fontSize: 12.5, fontWeight: '600' },
  actMuted: { color: meta, fontSize: 12.5 },
  empty: { backgroundColor: card, borderRadius: radiusCard, padding: 22, alignItems: 'center' },
  emptyTitle: { color: ink, fontWeight: '700', fontSize: 15.5, textAlign: 'center' },
  emptyBody: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
