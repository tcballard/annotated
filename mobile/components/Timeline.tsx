// The native timeline: the app's reading surface, built with the shared
// core (domain model, API client, deep links) and the web's own design
// tokens. The switcher is the product's one tab anatomy — Recent ·
// Trending · Following on a flat rail with the terracotta underline —
// and the feeds swipe left/right underneath it (react-native-pager-view;
// taps work too, and are all the web preview gets). Each pane is its own
// lazy FlatList with pull-to-refresh and cursor paging. Clips and audio play inline via
// players mounted on demand; annotation pages, profiles, and hubs push
// as web surfaces; originals open OUT in the real browser.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import Icon from './Icon';
import SystemIcon from './SystemIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { annotationToFeedItem, chipFor, formatTime } from '../lib/core/feed-item';
import type { FeedItem } from '../lib/core/feed-item';
import { avatarColor } from '../lib/core/avatar';
import { topicLabel } from '../lib/core/topics';
import { openOriginalHref } from '../lib/core/deep-link';
import { publicAnnotationUrl } from '../lib/core/share-links';
import { api } from '../lib/api';
import { ORIGIN } from '../lib/origin';
import { AccountContext } from './AccountContext';
import { AuthProviderContext } from './AuthProviderContext';
import { SessionEpochContext } from './WebScreen';
import FeedPager from './FeedPager';
import HeaderAvatar from './HeaderAvatar';
import BrandMark from './BrandMark';
import { InlineAudio, InlineClip } from './InlineMedia';
import { card, ink, meta, paper, tokens } from '../lib/tokens';

const serif = Platform.select({ ios: 'Georgia', default: 'serif' });

// Hosted media paths come back server-relative; the native app is not
// same-origin, so absolutize against the deployment.
const absolute = (url: string): string => (/^https?:\/\//.test(url) ? url : `${ORIGIN}${url}`);

// The feed menu is the three panes — Recent · Trending · Following.
// Topic feeds moved to Search's explore pills, X-style: Home is who and
// when, Search is what about.
type Selection = { pane: 'recent' | 'trending' | 'following'; topic: string | null };
const MENU: { key: string; label: string; selection: Selection }[] = [
  { key: 'recent', label: 'Recent', selection: { pane: 'recent', topic: null } },
  { key: 'trending', label: 'Trending', selection: { pane: 'trending', topic: null } },
  { key: 'following', label: 'Following', selection: { pane: 'following', topic: null } },
];

const feedQuery = (selection: Selection, cursor: string | null): string => {
  const params = new URLSearchParams({ limit: '20' });
  if (selection.pane === 'trending') {
    params.set('sort', 'trending');
    if (selection.topic) params.set('topic', selection.topic);
  }
  if (selection.pane === 'following') params.set('following', 'true');
  if (cursor) params.set('cursor', cursor);
  return params.toString();
};

const SourceCard = ({ item }: { item: FeedItem }) => {
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  return (
    <View style={styles.srccard}>
      <View style={styles.srchead}>
        {item.type !== 'article' ? <Text style={styles.chip}>{chipFor(item)}</Text> : null}
        <Text style={styles.srcname} numberOfLines={1}>{item.sourceTitle}</Text>
      </View>
      {item.clipUrl && item.mediaStatus === 'ready' && item.type === 'video' ? (
        <InlineClip uri={absolute(item.clipUrl)} posterUri={item.posterUrl ? absolute(item.posterUrl) : ''} seconds={clipSeconds} />
      ) : null}
      {item.clipUrl && item.mediaStatus === 'ready' && item.type === 'podcast' ? (
        <InlineAudio uri={absolute(item.clipUrl)} peaks={item.clipPeaks} seconds={clipSeconds} />
      ) : null}
      {item.screenshotUrl ? (
        <View style={styles.media}>
          <Image source={{ uri: absolute(item.screenshotUrl) }} style={styles.mediaImage} resizeMode="cover" />
        </View>
      ) : null}
      {item.quote ? <Text style={styles.quote}>&ldquo;{item.quote}&rdquo;</Text> : null}
      {item.commentaryMode === 'audio' && item.audioUrl ? (
        <InlineAudio uri={absolute(item.audioUrl)} peaks={item.audioPeaks} seconds={item.audioDuration} icon="mic" />
      ) : null}
      <Text style={styles.srchost}>{item.host} · {item.type}</Text>
    </View>
  );
};

// The card's tap targets, shared by every native list that renders feed
// items (timeline panes, search results).
export const useFeedActions = () => {
  const router = useRouter();
  const { bump } = useContext(SessionEpochContext);
  const { signIn } = useContext(AuthProviderContext);
  const [followingIds, setFollowingIds] = useState<Record<string, boolean>>({});

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
      if (error?.status === 401 && await signIn()) bump();
    }
  };

  // Optimistic like state, keyed by slug; the server's likedByMe/likes are
  // the baseline until the reader toggles.
  const [likeOverrides, setLikeOverrides] = useState<Record<string, { likedByMe: boolean; likes: number }>>({});
  const likeStateOf = (item: FeedItem) => (item.slug && likeOverrides[item.slug]) || { likedByMe: item.likedByMe, likes: item.likes };
  const toggleLike = async (item: FeedItem) => {
    if (!item.slug) return;
    const slug = item.slug;
    const current = likeStateOf(item);
    const next = { likedByMe: !current.likedByMe, likes: Math.max(0, current.likes + (current.likedByMe ? -1 : 1)) };
    setLikeOverrides((overrides) => ({ ...overrides, [slug]: next }));
    try {
      await (current.likedByMe ? api.unlike(slug) : api.like(slug));
      void Haptics.selectionAsync();
    } catch (error: any) {
      setLikeOverrides((overrides) => ({ ...overrides, [slug]: current }));
      if (error?.status === 401 && await signIn()) bump();
    }
  };

  return { followingIds, openAnnotation, openProfile, openOriginal, share, toggleFollow, likeStateOf, toggleLike };
};

export type FeedActions = ReturnType<typeof useFeedActions>;

type CardProps = {
  item: FeedItem;
  following: boolean;
  ownId: string;
  liked: boolean;
  likeCount: number;
  onOpenAnnotation: (item: FeedItem) => void;
  onOpenProfile: (item: FeedItem) => void;
  onOpenOriginal: (item: FeedItem) => void;
  onToggleFollow: (item: FeedItem) => void;
  onToggleLike: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
};

export const FeedCard = ({ item, following, ownId, liked, likeCount, onOpenAnnotation, onOpenProfile, onOpenOriginal, onToggleFollow, onToggleLike, onShare }: CardProps) => (
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
          {(item.displayName || item.editedAt) ? (
            <Text style={styles.metaText} numberOfLines={1}>{`${item.displayName ? `@${item.handle}` : ''}${item.editedAt ? `${item.displayName ? ' · ' : ''}edited` : ''}`}</Text>
          ) : null}
        </Pressable>
        {item.topic ? <Text style={styles.topicTag}>{topicLabel(item.topic)}</Text> : null}
        <Text style={styles.postTime}>{item.time}</Text>
      </View>
      {item.commentary
        ? <Text style={styles.note}>{item.commentary}</Text>
        : <Text style={styles.note}>Audio note{item.audioDuration ? ` · ${formatTime(item.audioDuration)}` : ''} — listen below.</Text>}
      <SourceCard item={item} />
      <View style={styles.actions}>
        <Pressable style={styles.act} onPress={() => onOpenAnnotation(item)} accessibilityLabel="Respond">
          <Icon name="respond" size={18} color={meta} />
          {item.comments ? <Text style={styles.actMuted}>{item.comments}</Text> : null}
        </Pressable>
        <Pressable style={styles.act} onPress={() => onToggleLike(item)} accessibilityLabel={liked ? 'Unlike this annotation' : 'Like this annotation'}>
          <Icon name="heart" size={18} color={liked ? ink : meta} />
          {likeCount ? <Text style={liked ? styles.actText : styles.actMuted}>{likeCount}</Text> : null}
        </Pressable>
        {item.authorId && item.authorId !== ownId ? (
          <Pressable style={styles.act} onPress={() => onToggleFollow(item)} accessibilityLabel={following ? 'Following' : 'Follow'}>
            <Icon name="follow" size={18} color={following ? ink : meta} />
          </Pressable>
        ) : null}
        <Pressable style={[styles.act, styles.actRight]} onPress={() => onOpenOriginal(item)} accessibilityLabel={`Open the original source${item.opens ? ` — ${item.opens} ${item.opens === 1 ? 'open' : 'opens'} of the original` : ''}`}>
          <Icon name="open" size={18} color={ink} />
          {item.opens ? <Text style={styles.actText}>{item.opens}</Text> : null}
        </Pressable>
        <Pressable style={styles.act} onPress={() => onShare(item)} accessibilityLabel="Share annotation">
          <SystemIcon name="share" size={18} color={meta} />
        </Pressable>
      </View>
    </View>
  </Pressable>
);

// One feed. Loads lazily the first time it becomes active, reloads when a
// sign-in lands anywhere in the app, and owns its own refresh + paging.
// Scroll direction feeds the collapsing chrome: down hides it, up — or
// being near the top — brings it back.
type FeedPaneProps = {
  selection: Selection;
  active: boolean;
  actions: FeedActions;
  ownId: string;
  chromePad: number;
  onChromeIntent: (intent: 'show' | 'hide') => void;
};

const FeedPane = ({ selection, active, actions, ownId, chromePad, onChromeIntent }: FeedPaneProps) => {
  const { epoch } = useContext(SessionEpochContext);
  const insets = useSafeAreaInsets();
  const lastY = useRef(0);

  const onScroll = (event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - lastY.current;
    lastY.current = y;
    if (y < 48) return onChromeIntent('show');
    if (delta > 6) onChromeIntent('hide');
    else if (delta < -6) onChromeIntent('show');
  };
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const loadedRef = useRef(false);
  const requestSeq = useRef(0);

  const load = useCallback(async ({ append = false, cursorAt = null as string | null } = {}) => {
    const seq = ++requestSeq.current;
    try {
      const result = await api.feed(feedQuery(selection, append ? cursorAt : null));
      if (seq !== requestSeq.current) return;
      const mapped = (result.annotations || []).map(annotationToFeedItem);
      setItems((current) => append ? [...current, ...mapped] : mapped);
      setCursor(result.nextCursor || null);
      setOffline(false);
    } catch {
      if (seq !== requestSeq.current) return;
      setOffline(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    void load().then(() => setLoading(false));
  }, [active, load]);

  useEffect(() => {
    if (!loadedRef.current || epoch === 0) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore || loading) return;
    setLoadingMore(true);
    await load({ append: true, cursorAt: cursor });
    setLoadingMore(false);
  };

  const emptyTitle = selection.topic ? `Nothing in ${topicLabel(selection.topic)} yet.`
    : selection.pane === 'following' ? 'No annotations from people you follow yet.'
    : selection.pane === 'trending' ? 'Nothing is trending yet.'
    : 'No public annotations yet.';
  const emptyBody = selection.topic ? 'Tag an annotation with this topic and it will appear here.'
    : selection.pane === 'following' ? 'Follow someone whose context you want to keep up with.'
    : selection.pane === 'trending' ? 'Annotations trend as readers open their originals and respond.'
    : 'Capture the first source-backed moment and it will appear here.';

  if (loading) return <View style={styles.loading}><ActivityIndicator color={ink} /></View>;

  return (
    <View style={styles.pane}>
      {offline ? (
        <View style={[styles.offline, { marginTop: chromePad }]}><Text style={styles.offlineText}>The annotated backend is unreachable. Pull to retry.</Text></View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item, index) => item.slug || String(index)}
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            following={Boolean(actions.followingIds[item.authorId])}
            ownId={ownId}
            liked={actions.likeStateOf(item).likedByMe}
            likeCount={actions.likeStateOf(item).likes}
            onOpenAnnotation={actions.openAnnotation}
            onOpenProfile={actions.openProfile}
            onOpenOriginal={actions.openOriginal}
            onToggleFollow={actions.toggleFollow}
            onToggleLike={actions.toggleLike}
            onShare={actions.share}
          />
        )}
        contentContainerStyle={[styles.list, { paddingTop: offline ? 10 : chromePad + 10, paddingBottom: 24 }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={meta} progressViewOffset={chromePad} />}
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
    </View>
  );
};

export default function Timeline() {
  const { me } = useContext(AccountContext);
  const actions = useFeedActions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  // The chrome (avatar + wordmark + feed menu) hides when the feed scrolls
  // down and returns on any scroll up — it should never cost reading room.
  const chromeShown = useRef(true);
  const chromeHeightRef = useRef(140);
  const [chromeHeight, setChromeHeight] = useState(140);
  const chromeY = useRef(new Animated.Value(0)).current;
  const setChrome = useCallback((intent: 'show' | 'hide') => {
    const show = intent === 'show';
    if (chromeShown.current === show) return;
    chromeShown.current = show;
    Animated.timing(chromeY, { toValue: show ? 0 : -chromeHeightRef.current, duration: 190, useNativeDriver: true }).start();
  }, [chromeY]);

  // Swipes and taps land here alike: haptic tick, and switching feeds
  // always reveals the chrome.
  const select = (next: number) => {
    if (next === index) return;
    void Haptics.selectionAsync();
    setIndex(next);
    setChrome('show');
  };

  return (
    <View style={styles.frame}>
      <FeedPager index={index} onSelect={select}>
        {MENU.map((entry, position) => (
          <View key={entry.key} style={styles.page}>
            <FeedPane
              selection={entry.selection}
              active={Math.abs(position - index) <= 1}
              actions={actions}
              ownId={me?.id || ''}
              chromePad={chromeHeight}
              onChromeIntent={setChrome}
            />
          </View>
        ))}
      </FeedPager>
      <Animated.View
        style={[styles.chrome, { paddingTop: insets.top, transform: [{ translateY: chromeY }] }]}
        onLayout={(event) => {
          const height = Math.round(event.nativeEvent.layout.height);
          if (height > 0 && height !== chromeHeightRef.current) {
            chromeHeightRef.current = height;
            setChromeHeight(height);
          }
        }}
      >
        <View style={styles.chromeHeader}>
          <HeaderAvatar />
          <View style={[styles.chromeTitle, { pointerEvents: 'none' }]}><BrandMark /></View>
        </View>
        <View style={styles.switcher}>
          {MENU.map((entry, position) => {
            const active = index === position;
            return (
              <Pressable
                key={entry.key}
                style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
                onPress={() => select(position)}
              >
                <Text style={active ? styles.tabTextActive : styles.tabText}>{entry.label}</Text>
                {active ? <View style={styles.tabUnderline} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const radiusCard = parseInt(String(tokens['radius-card']), 10) || 18;
const radiusInner = parseInt(String(tokens['radius-inner']), 10) || 14;

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: paper },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: card },
  chromeHeader: { height: 48, flexDirection: 'row', alignItems: 'center' },
  chromeTitle: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // The feed switcher wears the product's one tab anatomy, value for
  // value with the panel and the web (§1.1's active-tab clause): resting
  // tabs are quiet meta at regular weight, the active tab is ink 700,
  // and the rounded terracotta underline sits at 34% insets. Pills are
  // dock anatomy; a top switcher is a tab rail, and each tab is a true
  // 44pt target (the touch floor — the pointer surfaces run shorter).
  switcher: { flexDirection: 'row', backgroundColor: card, borderBottomWidth: 1, borderBottomColor: tokens.hair },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabPressed: { backgroundColor: tokens.soft },
  tabText: { fontSize: 14, color: meta },
  tabTextActive: { fontSize: 14, color: ink, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: 0, left: '34%', right: '34%', height: 2, backgroundColor: tokens.accent, borderRadius: 99 },
  page: { flex: 1 },
  pane: { flex: 1 },
  offline: { margin: 14, marginBottom: 0, padding: 12, backgroundColor: card, borderRadius: radiusInner, borderWidth: 1, borderColor: tokens.border },
  offlineText: { color: tokens['ink-soft'], fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, paddingTop: 10 },
  footer: { paddingVertical: 16 },
  post: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: card,
    borderRadius: radiusCard,
    padding: 12,
    marginBottom: 10,
    // The web's --shadow token, spelled as the modern cross-platform
    // boxShadow (expo-native-ui bans the legacy shadow*/elevation props).
    boxShadow: '0 2px 10px rgba(38, 41, 47, 0.06)',
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
  postTime: { color: meta, fontSize: 12.5, marginLeft: 'auto', flexShrink: 0 },
  topicTag: { marginLeft: 8, flexShrink: 0, fontSize: 11, color: tokens['ink-soft'], backgroundColor: tokens.soft, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  note: { color: ink, fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  srccard: { marginTop: 8, backgroundColor: tokens.strip, borderWidth: 1, borderColor: tokens.hair, borderRadius: radiusInner, padding: 10 },
  srchead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The moment chip is terracotta on every surface — law 1's first entry.
  // It wore grey here while web and panel wore accent-ink on accent-soft;
  // same tokens now, and the 3px chip radius the identity specifies.
  chip: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, color: tokens['accent-ink'], backgroundColor: tokens['accent-soft'], borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  srcname: { fontFamily: serif, fontSize: 14, color: ink, flexShrink: 1 },
  srchost: { color: meta, fontSize: 12, marginTop: 6 },
  media: { marginTop: 8, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  mediaImage: { width: '100%', aspectRatio: 16 / 10, backgroundColor: tokens.soft },
  quote: { fontFamily: serif, fontSize: 14.5, lineHeight: 21, color: tokens['ink-soft'], marginTop: 8 },
  // Every action is a true 44pt target (HIG floor) — the row grows, the
  // card compensates, and hitSlop goes: padded neighbours must not overlap.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: -6, marginLeft: -12, paddingRight: 4 },
  act: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 44, minHeight: 44, paddingHorizontal: 6 },
  actText: { color: ink, fontSize: 13, fontWeight: '600' },
  actRight: { marginLeft: 'auto' },
  actMuted: { color: meta, fontSize: 13 },
  empty: { backgroundColor: card, borderRadius: radiusCard, padding: 22, alignItems: 'center' },
  emptyTitle: { color: ink, fontWeight: '700', fontSize: 15.5, textAlign: 'center' },
  emptyBody: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
