import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tabsLayout = await readFile(new URL('../mobile/app/(drawer)/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const drawerPanel = await readFile(new URL('../mobile/components/DrawerPanel.tsx', import.meta.url), 'utf8');
const brandMark = await readFile(new URL('../mobile/components/BrandMark.tsx', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../mobile/components/NotificationsScreen.tsx', import.meta.url), 'utf8');
const search = await readFile(new URL('../mobile/components/SearchScreen.tsx', import.meta.url), 'utf8');
const drawerLayout = await readFile(new URL('../mobile/app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const rootLayout = await readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

test('the drawer is a card over the timeline, not a full-bleed sheet', () => {
  // Rounded on its open edge on both the navigator container (which owns
  // the shadow, so it must not clip) and the panel frame (which clips its
  // own content to the same radii), over the ink scrim the web's modals use.
  assert.match(drawerLayout, /borderTopRightRadius: 24/, 'the container rounds its open edge');
  assert.match(drawerLayout, /borderBottomRightRadius: 24/);
  assert.match(drawerLayout, /elevation: 16/, 'the card lifts off the timeline on Android');
  assert.match(drawerLayout, /shadowColor: '#26292F'/, 'the card lifts off the timeline on iOS');
  assert.match(drawerLayout, /overlayColor: 'rgba\(38, 41, 47, 0\.45\)'/, 'the scrim is the same ink tint as the web modal backdrop');
  assert.match(drawerPanel, /borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden'/, 'the panel clips its content to the card');
  assert.match(drawerPanel, /borderRadius: 12/, 'rows highlight as inset pills, not full-bleed strips');
});

test('the header is X-anatomy in our identity: avatar opens the drawer, the wordmark sits center', async () => {
  const { readFile } = await import('node:fs/promises');
  const headerAvatar = await readFile(new URL('../mobile/components/HeaderAvatar.tsx', import.meta.url), 'utf8');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  assert.match(tabsLayout, /headerLeft: \(\) => <HeaderAvatar \/>/);
  assert.match(headerAvatar, /drawer\.openDrawer\(\)/);
  assert.match(timeline, /<HeaderAvatar \/>/, 'the timeline draws its own chrome');
  assert.match(timeline, /<BrandMark \/>/, 'Home leads with the wordmark');
  assert.match(brandMark, /annotated<Text style=\{\{ color: accent \}\}>\.<\/Text>/, 'the terracotta dot is the one accent in chrome');
});

test('the home chrome hides on scroll down and returns on scroll up', async () => {
  const { readFile } = await import('node:fs/promises');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  assert.match(tabsLayout, /headerShown: false,\s*\n\s*tabBarIcon: \(\{ color, size \}\) => <Feather name="home"/, 'the navigator header yields to the collapsing chrome');
  assert.match(timeline, /Animated\.timing\(chromeY, \{ toValue: show \? 0 : -chromeHeightRef\.current/, 'the chrome translates away');
  assert.match(timeline, /if \(y < 48\) return onChromeIntent\('show'\)/, 'near the top the chrome always shows');
  assert.match(timeline, /if \(delta > 6\) onChromeIntent\('hide'\)/, 'scrolling down hides');
  assert.match(timeline, /else if \(delta < -6\) onChromeIntent\('show'\)/, 'scrolling up reveals');
  assert.match(timeline, /setChrome\('show'\)/, 'switching feeds reveals the chrome');
});

test('capture is the pen that summons a sheet from a flat X-style bar', () => {
  assert.match(tabsLayout, /name="capture"/);
  assert.match(tabsLayout, /name="edit-3"/, 'the pen, not a plus');
  assert.doesNotMatch(tabsLayout, /name="plus"/, 'the FAB is gone');
  // the bar is flat and full-width: one hairline, real layout space —
  // no pill, no float, no shadow
  assert.match(tabsLayout, /borderTopWidth: StyleSheet\.hairlineWidth/);
  assert.doesNotMatch(tabsLayout, /borderRadius: 29/, 'the floating pill is gone');
  assert.doesNotMatch(tabsLayout, /position: 'absolute'/, 'the bar reserves real space');
  assert.match(tabsLayout, /height: 52 \+ insets\.bottom/, 'the bar owns the home-indicator inset');
  // the pen presents the capture sheet instead of traveling to a tab
  assert.match(tabsLayout, /event\.preventDefault\(\);\s*\n\s*setCaptureOpen\(true\);/);
  assert.match(tabsLayout, /<CaptureSheet visible=\{captureOpen\}/);
});

test('the capture sheet has clipboard manners', async () => {
  const sheet = await readFile(new URL('../mobile/components/CaptureSheet.tsx', import.meta.url), 'utf8');
  // detection is bannerless; the read happens only on the chip tap
  assert.match(sheet, /Clipboard\.hasUrlAsync\(\)/);
  assert.match(sheet, /Paste copied link/);
  assert.match(sheet, /captureUrlFromShare\(ORIGIN, \{ text: copied \}\)/, 'the pasted link rides the share contract');
  assert.match(sheet, /animationType="slide"/);
  assert.match(sheet, /onPress=\{onClose\}/, 'the backdrop dismisses');
});

test('the native shell follows the system light/dark setting', async () => {
  const appConfig = await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8');
  const tokens = await readFile(new URL('../mobile/lib/tokens.ts', import.meta.url), 'utf8');
  assert.match(appConfig, /"userInterfaceStyle": "automatic"/);
  assert.match(rootLayout, /<StatusBar style="auto" \/>/);
  // every color the web's dark scheme overrides becomes a DynamicColorIOS
  // pair — the same dark palette, flipping on the same OS signal
  assert.match(tokens, /DynamicColorIOS\(\{ light: light\[name\], dark: dark\[name/);
  assert.match(tokens, /"paper": "#26292F",/, 'the dark paper matches the web dark scheme');
});

test('the drawer carries account, library, and the public pages — session action at the bottom', () => {
  assert.match(drawerPanel, /navigation\.closeDrawer\(\)/);
  assert.match(drawerPanel, /'\/web\/library'/);
  assert.match(drawerPanel, /'\/web\/transparency'/);
  assert.match(drawerPanel, /'\/web\/about'/);
  assert.match(drawerPanel, /canModerate .*\['owner', 'admin', 'moderator'\]/, 'moderation shows only to moderators');
  assert.match(drawerPanel, /api\.logout\(\)/);
  assert.match(drawerPanel, /await signIn\(\)/, 'signed out, the drawer offers the branded sign-in door');
  // signed out the head is the wordmark, not plain text, and the session
  // action is pinned past the spacer at the bottom
  assert.match(drawerPanel, /<BrandMark size=\{26\} \/>/);
  assert.match(drawerPanel, /spacer: \{ flex: 1 \}/);
  assert.ok(drawerPanel.indexOf('styles.spacer') < drawerPanel.indexOf('styles.signIn'), 'sign in renders below the spacer');
});

test('notifications aggregate X-style and the personas can aim at a real account', async () => {
  // same event on the same annotation collapses into one row with a
  // facepile; the people and the source are the bold parts
  assert.match(notifications, /export const groupNotifications = /);
  assert.match(notifications, /and \{group\.count - 1\} others/);
  assert.match(notifications, /styles\.facepile/);
  assert.match(notifications, /borderBottomWidth: StyleSheet\.hairlineWidth/, 'flat rows, not cards');
  // the seeder can turn the personas toward a target account so the
  // screen is recordable: follows always, likes and responses once the
  // target has published
  const seeder = await readFile(new URL('../scripts/seed-personas.mjs', import.meta.url), 'utf8');
  assert.match(seeder, /ANNOTATED_SEED_TARGET/);
  assert.match(seeder, /followingId: target\.id/);
  assert.match(seeder, /targetAnnotations\[0\]/);
});

test('notifications: derived server-side, badge cleared by the seen watermark', () => {
  assert.ok(server.includes("pathname === '/api/notifications'"));
  assert.ok(server.includes("pathname === '/api/notifications/seen'"));
  assert.match(server, /lastNotificationsSeenAt/);
  assert.match(server, /unseenCount/);
  assert.match(notifications, /api\.notifications\(\)/);
  assert.match(notifications, /api\.notificationsSeen\(\)/);
  assert.match(notifications, /clearUnseen\(\)/);
  assert.match(notifications, /responded to your annotation of/);
  assert.match(notifications, /followed you/);
  assert.match(tabsLayout, /tabBarBadge/, 'the bell wears the unseen count');
});

test('search doubles as explore: topic pills scope summarized trending stories', () => {
  // before a query: trending annotations grouped by source into X-style
  // story rows — title, annotator facepile, counts — behind topic pills
  assert.match(search, /export const groupStories = /);
  assert.match(search, /sort: 'trending'/);
  assert.match(search, /params\.set\('topic', topic\)/);
  assert.match(search, /TOPICS\.map\(\(entry\)/, 'the topic pills live here now');
  assert.match(search, /Trending in \$\{topicLabel\(topic\)\}/);
  assert.match(search, /\/web\/s\/\$\{encodeURIComponent\(story\.host\)\}/, 'every story row lands on its source hub');
  assert.match(search, /styles\.facepile/);
});

test('search reuses the shared card and the same endpoints as the web', () => {
  assert.match(search, /api\.people\(text\)/);
  assert.match(search, /api\.feed\(`q=\$\{encodeURIComponent\(text\)\}/);
  assert.match(search, /<FeedCard/);
  assert.match(search, /useFeedActions/);
  assert.match(search, /setTimeout/, 'typing is debounced');
});

test('the account context feeds the header avatar and the badge', () => {
  assert.match(rootLayout, /AccountContext\.Provider/);
  assert.match(rootLayout, /api\.notifications\(\)\.catch/, 'the badge count loads with the session');
  assert.match(tabsLayout, /useContext\(AccountContext\)/);
});
