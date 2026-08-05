// Search: people and annotations from the same endpoints the web uses,
// debounced as you type. Results reuse the timeline's card so an
// annotation looks identical wherever it appears.

import { useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { annotationToFeedItem } from '../lib/core/feed-item';
import type { FeedItem } from '../lib/core/feed-item';
import { avatarColor, avatarInitial } from '../lib/core/avatar';
import { api } from '../lib/api';
import { AccountContext } from './AccountContext';
import { FeedCard, useFeedActions } from './Timeline';
import { card, ink, meta, tokens } from '../lib/tokens';

type Person = { id: string; handle: string; displayName?: string; avatarUrl?: string | null };

export default function SearchScreen() {
  const router = useRouter();
  const { me } = useContext(AccountContext);
  const actions = useFeedActions();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);

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
      setItems((feed.annotations || []).map(annotationToFeedItem));
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
      <Feather name="chevron-right" size={17} color={meta} />
    </Pressable>
  );

  return (
    <View style={styles.frame}>
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={meta} />
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
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Feather name="x" size={16} color={meta} />
          </Pressable>
        ) : null}
      </View>
      {searching ? <ActivityIndicator color={ink} style={styles.spinner} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item, index) => item.slug || String(index)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={people.length ? (
          <View style={styles.peopleBlock}>
            <Text style={styles.sectionLabel}>People</Text>
            {people.map(personRow)}
          </View>
        ) : null}
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            following={Boolean(actions.followingIds[item.authorId])}
            ownId={me?.id || ''}
            onOpenAnnotation={actions.openAnnotation}
            onOpenProfile={actions.openProfile}
            onOpenOriginal={actions.openOriginal}
            onToggleFollow={actions.toggleFollow}
            onShare={actions.share}
          />
        )}
        ListEmptyComponent={!searching ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{query.trim() ? `Nothing matches “${query.trim()}”.` : 'Search annotated.'}</Text>
            <Text style={styles.emptyBody}>{query.trim() ? 'Try a different source, author, or phrase.' : 'Find annotations by source, phrase, or author — and people worth following.'}</Text>
          </View>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: card,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 99,
    paddingHorizontal: 14,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    height: 42,
  },
  input: { flex: 1, color: ink, fontSize: 14.5, paddingVertical: 0 },
  spinner: { marginTop: 14 },
  list: { padding: 14, paddingTop: 10 },
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
  empty: { backgroundColor: card, borderRadius: 18, padding: 22, alignItems: 'center' },
  emptyTitle: { color: ink, fontWeight: '700', fontSize: 15.5, textAlign: 'center' },
  emptyBody: { color: meta, fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
