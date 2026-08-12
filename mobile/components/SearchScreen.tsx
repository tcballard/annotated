// Search doubles as explore, X-style: before you type a query, the screen
// shows what's gathering attention — trending sources summarized as story
// rows (bold title, annotator facepile, counts), scoped by the topic
// pills that used to crowd the home menu. Typing swaps to people and
// annotation results from the same endpoints the web uses, debounced.

import { use, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from './Icon';
import SystemIcon from './SystemIcon';
import { annotationToFeedItem } from '../lib/core/feed-item';
import type { FeedItem } from '../lib/core/feed-item';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { TOPICS, topicLabel } from '../lib/core/topics';
import { api } from '../lib/api';
import { AccountContext } from './AccountContext';
import { FeedCard, useFeedActions } from './Timeline';
import HeaderAvatar from './HeaderAvatar';
import { ExploreSettingsContext, ExploreSettingsSheet } from './ExploreSettings';
import { card, ink, meta, paper, tokens } from '../lib/tokens';

type Person = { id: string; handle: string; displayName?: string; avatarUrl?: string | null };

type StoryAuthor = { id: string; handle: string; displayName: string; avatarUrl: string };

type Story = { key: string; host: string; title: string; type: string; authors: StoryAuthor[]; opens: number; count: number };

// X's "1.7K posts" story row, from our data: trending annotations grouped
// by their source, ranked by opens of the original — the number we count.
export const groupStories = (items: FeedItem[]): Story[] => {
  const map = new Map<string, Story>();
  for (const item of items) {
    const key = `${item.host}|${item.sourceTitle}`;
    const entry = map.get(key) || { key, host: item.host, title: item.sourceTitle, type: item.type, authors: [], opens: 0, count: 0 };
    entry.count += 1;
    entry.opens += Number(item.opens) || 0;
    if (item.authorId && entry.authors.length < 3 && !entry.authors.some((author) => author.id === item.authorId)) {
      entry.authors.push({ id: item.authorId, handle: item.handle, displayName: item.displayName, avatarUrl: item.avatarUrl });
    }
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => (b.opens - a.opens) || (b.count - a.count)).slice(0, 10);
};

export default function SearchScreen() {
  const router = useRouter();
  const { me } = useContext(AccountContext);
  const actions = useFeedActions();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [exploring, setExploring] = useState(true);
  const requestSeq = useRef(0);
  // The gear's small menu, X's Explore-settings shape: how explore ranks,
  // and whether the seeded demo accounts are part of the picture.
  const settings = use(ExploreSettingsContext);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visible = (list: FeedItem[]) => (settings.hideDemo ? list.filter((item) => !item.isDemo) : list);

  // The explore state: trending for the selected topic, grouped by source.
  useEffect(() => {
    let cancelled = false;
    setExploring(true);
    // Explore ranks by trending unless the gear says otherwise.
    const params = new URLSearchParams({ limit: '30' });
    if (settings.sort === 'trending') params.set('sort', 'trending');
    if (topic) params.set('topic', topic);
    api.feed(params.toString())
      .then((feed) => {
        if (cancelled) return;
        setStories(groupStories(visible((feed.annotations || []).map(annotationToFeedItem))));
        setExploring(false);
      })
      .catch(() => { if (!cancelled) { setStories([]); setExploring(false); } });
    return () => { cancelled = true; };
  }, [topic, settings.sort, settings.hideDemo]);

  useEffect(() => {
    const text = query.trim();
    if (!text) { setPeople([]); setItems([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      const [found, feed] = await Promise.all([
        api.people(text).catch(() => ({ people: [] })),
        api.feed(`q=${encodeURIComponent(text)}&limit=20`).catch(() => ({ annotations: [] })),
      ]);
      if (seq !== requestSeq.current) return;
      setPeople((found.people || []).slice(0, 5));
      setItems(visible((feed.annotations || []).map(annotationToFeedItem)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const personRow = (person: Person) => (
    <Pressable
      key={person.id}
      style={({ pressed }) => [styles.person, pressed && styles.pressed]}
      onPress={() => router.push(`/web/u/${encodeURIComponent(person.handle)}`)}
    >
      {person.avatarUrl
        ? <Image source={{ uri: person.avatarUrl }} style={styles.personAvatarImage} />
        : (
          <View style={[styles.personAvatar, { backgroundColor: avatarColor(person.handle || person.displayName) }]}>
            <Text style={styles.personAvatarText}>{avatarInitial(person)}</Text>
          </View>
        )}
      <View style={styles.personMain}>
        <Text style={styles.personName} numberOfLines={1}>{person.displayName || `@${person.handle}`}</Text>
        <Text style={styles.personHandle} numberOfLines={1}>@{person.handle}</Text>
      </View>
      <SystemIcon name="forward" size={17} color={meta} />
    </Pressable>
  );

  const facepile = (authors: StoryAuthor[]) => (
    <View style={styles.facepile}>
      {authors.map((author, index) => author.avatarUrl ? (
        <Image key={author.id} source={{ uri: author.avatarUrl }} style={[styles.face, index > 0 && styles.faceOverlap]} />
      ) : (
        <View key={author.id} style={[styles.face, styles.faceFallback, index > 0 && styles.faceOverlap, { backgroundColor: avatarColor(author.handle || author.displayName) }]}>
          <Text style={styles.faceInitial}>{avatarInitial(author)}</Text>
        </View>
      ))}
    </View>
  );

  // Every story row is a source hub destination — shared attention is the
  // directory.
  const storyRow = (story: Story) => (
    <Pressable
      key={story.key}
      style={({ pressed }) => [styles.story, pressed && styles.pressed]}
      onPress={() => router.push(`/web/s/${encodeURIComponent(story.host)}`)}
    >
      <Text style={styles.storyTitle} numberOfLines={2}>{story.title}</Text>
      <View style={styles.storyMeta}>
        {facepile(story.authors)}
        <Text style={styles.storyMetaText} numberOfLines={1}>
          {story.count === 1 ? '1 annotation' : `${story.count} annotations`} · {story.opens} {story.opens === 1 ? 'open' : 'opens'} · {story.host}
        </Text>
      </View>
    </Pressable>
  );

  const showExplore = !query.trim();

  const explore = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow} keyboardShouldPersistTaps="handled" style={styles.rail}>
        {[{ slug: null as string | null, label: 'All' }, ...TOPICS.map((entry) => ({ slug: entry.slug as string | null, label: entry.label }))].map((entry) => {
          const active = topic === entry.slug;
          return (
            <Pressable key={entry.slug ?? 'all'} style={styles.railTab} onPress={() => setTopic(entry.slug)}>
              <Text style={active ? styles.tabTextActive : styles.tabText}>{entry.label}</Text>
              {active ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.sectionTitle}>{settings.sort === 'recent'
        ? (topic ? `Latest in ${topicLabel(topic)}` : 'Latest annotations')
        : (topic ? `Trending in ${topicLabel(topic)}` : 'Trending now')}</Text>
      {exploring && !stories.length ? <ActivityIndicator color={ink} style={styles.spinner} /> : null}
      {!exploring && !stories.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing trending here yet.</Text>
          <Text style={styles.emptyBody}>The first source-backed moment in this topic starts the chart.</Text>
        </View>
      ) : null}
      <View style={styles.stories}>{stories.map(storyRow)}</View>
    </View>
  );

  return (
    <View style={styles.frame}>
      <View style={styles.chrome}>
      <HeaderAvatar />
      <View style={styles.searchBox}>
        <Icon name="search" size={16} color={meta} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search annotations and people"
          placeholderTextColor={meta}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={80}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 }} accessibilityLabel="Clear search">
            <Icon name="close" size={16} color={meta} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => setSettingsOpen(true)}
        style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        accessibilityLabel="Explore settings"
        accessibilityRole="button"
      >
        <Icon name="settings" size={20} color={ink} />
      </Pressable>
      </View>
      {searching ? <ActivityIndicator color={ink} style={styles.spinner} /> : null}
      <FlatList
        data={showExplore ? [] : items}
        keyExtractor={(item, index) => item.slug || String(index)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, { paddingBottom: 24 }]}
        ListHeaderComponent={showExplore ? explore : (people.length ? (
          <View style={styles.peopleBlock}>
            <Text style={styles.sectionLabel}>People</Text>
            {people.map(personRow)}
          </View>
        ) : null)}
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            following={Boolean(actions.followingIds[item.authorId])}
            ownId={me?.id || ''}
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
        ListEmptyComponent={!searching && !showExplore ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing matches “{query.trim()}”.</Text>
            <Text style={styles.emptyBody}>Try a different source, author, or phrase.</Text>
          </View>
        ) : null}
      />
      <ExploreSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  // Explore's chrome, X's arrangement in our identity: your avatar opens
  // the menu, the field takes the middle, the gear holds the settings.
  chrome: { flexDirection: 'row', alignItems: 'center', paddingRight: 10, backgroundColor: card },
  gear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: card,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 99,
    paddingHorizontal: 14,
    marginVertical: 8,
    marginLeft: 4,
    flex: 1,
    height: 42,
  },
  input: { flex: 1, color: ink, fontSize: 14.5, paddingVertical: 0 },
  spinner: { marginTop: 14 },
  list: { padding: 14, paddingTop: 10 },
  // Explore's topics wear the product's one tab anatomy — the same rail
  // Home switches feeds with, scrolling because the topic list is long.
  rail: { backgroundColor: card, borderBottomWidth: 1, borderBottomColor: tokens.hair, flexGrow: 0 },
  railRow: { paddingHorizontal: 4 },
  railTab: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, color: meta },
  tabTextActive: { fontSize: 14, color: ink, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: 0, left: '18%', right: '18%', height: 2, backgroundColor: tokens.accent, borderRadius: 99 },
  sectionTitle: { color: ink, fontSize: 19, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  stories: { marginTop: 4 },
  story: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.border },
  storyTitle: { color: ink, fontSize: 16.5, fontWeight: '800', lineHeight: 22 },
  storyMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  storyMetaText: { color: meta, fontSize: 13, flex: 1 },
  facepile: { flexDirection: 'row' },
  face: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: card, backgroundColor: tokens.soft },
  faceOverlap: { marginLeft: -8 },
  faceFallback: { alignItems: 'center', justifyContent: 'center' },
  faceInitial: { color: '#fff', fontWeight: '700', fontSize: 10 },
  peopleBlock: { marginBottom: 10 },
  sectionLabel: { color: meta, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginLeft: 2 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: card,
    borderRadius: 14,
    padding: 10,
    marginBottom: 6,
  },
  pressed: { opacity: 0.92 },
  personAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  personAvatarImage: { width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.soft },
  personAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  personMain: { flex: 1, minWidth: 0 },
  personName: { color: ink, fontWeight: '700', fontSize: 14 },
  personHandle: { color: meta, fontSize: 12.5 },
  empty: { backgroundColor: card, borderRadius: 18, padding: 22, alignItems: 'center', marginTop: 8 },
  emptyTitle: { color: ink, fontWeight: '700', fontSize: 15.5, textAlign: 'center' },
  emptyBody: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
