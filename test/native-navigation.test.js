import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tabsLayout = await readFile(new URL('../mobile/app/(drawer)/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const drawerPanel = await readFile(new URL('../mobile/components/DrawerPanel.tsx', import.meta.url), 'utf8');
const brandMark = await readFile(new URL('../mobile/components/BrandMark.tsx', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../mobile/components/NotificationsScreen.tsx', import.meta.url), 'utf8');
const search = await readFile(new URL('../mobile/components/SearchScreen.tsx', import.meta.url), 'utf8');
const rootLayout = await readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

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

test('capture is the pen at the center of a floating pill bar', () => {
  assert.match(tabsLayout, /name="capture"/);
  assert.match(tabsLayout, /name="edit-3"/, 'the pen, not a plus');
  assert.doesNotMatch(tabsLayout, /name="plus"/, 'the FAB is gone');
  assert.match(tabsLayout, /position: 'absolute',\s*\n\s*left: 14,\s*\n\s*right: 14,/, 'the bar is inset from the edges');
  assert.match(tabsLayout, /borderRadius: 29/, 'a full pill');
  assert.match(tabsLayout, /Math\.max\(insets\.bottom, 12\)/, 'padded above the home indicator');
});

test('the drawer carries account, library, and the public pages', () => {
  assert.match(drawerPanel, /navigation\.closeDrawer\(\)/);
  assert.match(drawerPanel, /'\/web\/library'/);
  assert.match(drawerPanel, /'\/web\/transparency'/);
  assert.match(drawerPanel, /'\/web\/about'/);
  assert.match(drawerPanel, /canModerate .*\['owner', 'admin', 'moderator'\]/, 'moderation shows only to moderators');
  assert.match(drawerPanel, /api\.logout\(\)/);
  assert.match(drawerPanel, /signInNatively\(\)/, 'signed out, the drawer offers sign-in');
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
