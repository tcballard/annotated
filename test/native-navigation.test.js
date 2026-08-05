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

test('the header is X-anatomy in our identity: avatar opens the drawer, the wordmark sits center', () => {
  assert.match(tabsLayout, /headerLeft: \(\) => <HeaderAvatar \/>/);
  assert.match(tabsLayout, /drawer\.openDrawer\(\)/);
  assert.match(tabsLayout, /headerTitle: \(\) => <BrandMark \/>/, 'Home leads with the wordmark');
  assert.match(brandMark, /annotated<Text style=\{\{ color: accent \}\}>\.<\/Text>/, 'the terracotta dot is the one accent in chrome');
});

test('capture floats as the FAB and pushes the desk', () => {
  assert.match(tabsLayout, /router\.push\('\/capture'\)/);
  assert.match(tabsLayout, /accessibilityLabel="Capture a moment"/);
  assert.match(tabsLayout, /name="plus"/);
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
