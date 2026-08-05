import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
const nativeAuth = await readFile(new URL('../mobile/lib/native-auth.ts', import.meta.url), 'utf8');
const nativeApi = await readFile(new URL('../mobile/lib/api.ts', import.meta.url), 'utf8');

test('the native timeline renders through the shared core, not a private model', () => {
  assert.match(timeline, /from '\.\.\/lib\/core\/feed-item'/);
  assert.match(timeline, /annotationToFeedItem/);
  assert.match(timeline, /from '\.\.\/lib\/core\/deep-link'/);
  assert.match(timeline, /publicAnnotationUrl/);
  assert.match(nativeApi, /createApiClient\(\{ origin: ORIGIN \}\)/, 'the native client is the shared one, aimed at the deployment');
});

test('the reading surface has native physics: list, pull-to-refresh, cursor paging', () => {
  assert.match(timeline, /<FlatList/);
  assert.match(timeline, /RefreshControl refreshing=\{refreshing\} onRefresh=\{refresh\}/);
  assert.match(timeline, /onEndReached=\{loadMore\}/);
  assert.match(timeline, /result\.nextCursor \|\| null/);
  assert.match(timeline, /params\.set\('cursor', cursor\)/);
  assert.match(timeline, /Haptics\.selectionAsync/, 'pane switches tick');
});

test('the pane and topic contract matches the web feed exactly', () => {
  assert.match(timeline, /params\.set\('sort', 'trending'\)/);
  assert.match(timeline, /params\.set\('topic', selection\.topic\)/);
  assert.match(timeline, /params\.set\('following', 'true'\)/);
  assert.match(timeline, /'No public annotations yet\.'/, 'empty copy matches the web');
  assert.match(timeline, /'Nothing is trending yet\.'/);
  assert.match(timeline, /'No annotations from people you follow yet\.'/);
});

test('the top menu scrolls, X-style: panes then a feed per topic', () => {
  assert.match(timeline, /ScrollView horizontal/);
  assert.match(timeline, /\.\.\.TOPICS\.map\(\(topic\) => \(\{ key: `topic:\$\{topic\.slug\}`/, 'every topic is a feed in the menu');
  assert.match(timeline, /pane: 'trending' as const, topic: topic\.slug/, 'a topic feed is trending scoped to the topic');
  assert.match(timeline, /export const FeedCard/, 'the card is shared with search');
  assert.match(timeline, /export const useFeedActions/, 'card actions are shared with search');
});

test('originals open OUT and opens are counted, same as every other surface', () => {
  assert.match(timeline, /WebBrowser\.openBrowserAsync\(openOriginalHref\(item\)\)/);
  assert.match(timeline, /api\.recordOpen\(item\.slug\)/);
  assert.match(timeline, /router\.push\(`\/web\/a\/\$\{encodeURIComponent\(item\.slug\)\}`\)/, 'annotation pages push as web surfaces');
});

test('avatars: OAuth profile photos when present, deterministic colored initials when not', async () => {
  const { readFile } = await import('node:fs/promises');
  assert.match(timeline, /item\.avatarUrl\s*\n?\s*\? <Image source=\{\{ uri: item\.avatarUrl \}\}/);
  assert.match(timeline, /avatarColor\(item\.handle/);
  const authServer = await readFile(new URL('../server/auth.js', import.meta.url), 'utf8');
  assert.match(authServer, /providerAvatarUrl/, 'the stored avatar URL is bounded and https-only');
  assert.match(authServer, /_400x400/, "X's 48px _normal variant upgrades for retina");
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /avatarColor\(person\.handle/, 'the web renders the same shared avatar identity');
  const panel = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');
  assert.match(panel, /from '\.\/avatar\.js'/, 'the panel renders the same shared avatar identity');
});

test('native sign-in is the same ticket exchange, driven without a WebView', () => {
  assert.match(nativeAuth, /openAuthSessionAsync\(withMobileReturn\(startUrl\), 'annotated:\/\/auth'\)/);
  assert.match(nativeAuth, /sessionExchangeUrl\(ORIGIN, ticket, '\/'\)/);
  assert.match(nativeAuth, /enabledProviders/);
  assert.match(timeline, /await signInNatively\(\)/, 'a 401 on follow offers sign-in');
  assert.match(timeline, /\[epoch\]/, 'the timeline refreshes when a sign-in lands elsewhere in the app');
});
