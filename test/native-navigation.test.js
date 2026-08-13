import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tabsLayout = await readFile(new URL('../mobile/app/(drawer)/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const drawerPanel = await readFile(new URL('../mobile/components/DrawerPanel.tsx', import.meta.url), 'utf8');
const brandMark = await readFile(new URL('../mobile/components/BrandMark.tsx', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../mobile/components/NotificationsScreen.tsx', import.meta.url), 'utf8');
const search = await readFile(new URL('../mobile/components/SearchScreen.tsx', import.meta.url), 'utf8');
const drawerLayout = await readFile(new URL('../mobile/app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const swipeShell = await readFile(new URL('../mobile/components/SwipeMenuShell.tsx', import.meta.url), 'utf8');
const rootLayout = await readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

test('touch targets meet the 44pt floor', async () => {
  const { readFile } = await import('node:fs/promises');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  const headerAvatar = await readFile(new URL('../mobile/components/HeaderAvatar.tsx', import.meta.url), 'utf8');
  const capture = await readFile(new URL('../mobile/components/CaptureSheet.tsx', import.meta.url), 'utf8');
  const search = await readFile(new URL('../mobile/components/SearchScreen.tsx', import.meta.url), 'utf8');
  assert.match(timeline, /act: \{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 44, minHeight: 44/, 'feed actions are true 44pt targets');
  assert.doesNotMatch(timeline, /onShare\(item\)\} hitSlop/, 'padded action targets do not stack overlapping hitSlop');
  assert.match(headerAvatar, /minWidth: 44, minHeight: 44/, 'the menu button meets the floor');
  assert.match(capture, /width: 44, height: 44, borderRadius: 22/, 'the capture-sheet close meets the floor');
  assert.match(search, /minWidth: 44, minHeight: 44/, 'the search clear meets the floor');
});

test('the menu sits beneath one moving surface, ChatGPT-style', () => {
  // The panel stays mounted underneath; the whole app face is a single
  // rounded surface that slides right on the UI thread. The layout is
  // just the shell composed around the panel and the tab routes.
  assert.match(drawerLayout, /<SwipeMenuShell menu=\{<DrawerPanel \/>\}>/, 'the layout composes the shell around the panel');
  assert.match(drawerLayout, /<Slot \/>/, 'the tab routes ride inside the moving surface');
  assert.doesNotMatch(drawerLayout, /expo-router\/drawer/, 'the Drawer navigator is gone');
  // The gesture: Reanimated shared value driven by a pan on the UI
  // thread, sprung home without overshoot; vertical travel hands the
  // touch back to scrolling.
  assert.match(swipeShell, /withSpring\(shouldOpen \? menuWidth : 0, SWIPE_SPRING\)/, 'release springs the surface to a seat');
  assert.match(swipeShell, /overshootClamping: true/, 'the spring never overshoots — that would flash the root behind the menu');
  assert.match(swipeShell, /failOffsetY/, 'vertical intent belongs to the scroll views');
  // Closed, the timeline's feed pager owns mid-screen horizontal swipes —
  // the surface drag arms only at the left edge, and only rightward.
  assert.match(swipeShell, /hitSlop\(\{ left: 0, width: SWIPE_GESTURE\.edgeWidth \}\)/, 'closed, the drag starts at the left edge');
  assert.match(swipeShell, /pan\.activeOffsetX\(SWIPE_GESTURE\.activationDistance\)/, 'closed, only a rightward drag arms it');
  // The surface wears the example's fallback screen-corner radii (Expo Go
  // cannot load the native corner module) with the continuous curve and
  // the modern shadow, ink-tinted like every shadow in the identity.
  assert.match(swipeShell, /process\.env\.EXPO_OS === 'ios' \? 55 : process\.env\.EXPO_OS === 'android' \? 32 : 28/, 'the corner radius approximates the device screen corner');
  assert.match(swipeShell, /borderCurve: 'continuous'/, 'rounded corners use the Apple continuous curve (expo-native-ui)');
  assert.match(swipeShell, /boxShadow: SWIPE_MENU_SURFACE_SHADOW/, 'the surface lifts on the modern cross-platform shadow');
  assert.match(swipeShell, /rgba\(38, 41, 47, 0\.2\)/, 'the shadow is ink, not black');
  assert.doesNotMatch(swipeShell, /shadowColor|elevation:/, 'legacy shadow*/elevation props are banned (expo-native-ui)');
  // The hidden menu leaves the accessibility tree, and Android back
  // closes the menu before it leaves the screen.
  assert.match(swipeShell, /aria-hidden=\{!isMenuOpen\}/, 'the closed menu is hidden from assistive tech (one modern cross-platform prop)');
  assert.match(swipeShell, /hardwareBackPress/, 'Android back closes the menu first');
  // The panel itself is now the flat underneath layer; its rows keep the
  // inset continuous-curve pills and the iOS tick.
  assert.doesNotMatch(drawerPanel, /borderTopRightRadius/, 'the panel is flat — the rounded card is the surface above it');
  assert.match(drawerPanel, /borderRadius: 12, borderCurve: 'continuous'/, 'rows highlight as inset continuous-curve pills');
  assert.match(drawerPanel, /process\.env\.EXPO_OS === 'ios'.*Haptics\.selectionAsync/, 'menu taps tick on iOS');
});

test('the header is X-anatomy in our identity: avatar opens the drawer, the wordmark sits center', async () => {
  const { readFile } = await import('node:fs/promises');
  const headerAvatar = await readFile(new URL('../mobile/components/HeaderAvatar.tsx', import.meta.url), 'utf8');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  assert.match(tabsLayout, /headerLeft: \(\) => <HeaderAvatar \/>/);
  assert.match(headerAvatar, /use\(SwipeMenuContext\)/, 'the avatar opens the swipe menu through its context');
  assert.match(headerAvatar, /onPress=\{open\}/);
  assert.match(timeline, /<HeaderAvatar \/>/, 'the timeline draws its own chrome');
  assert.match(timeline, /<BrandMark \/>/, 'Home leads with the wordmark');
  assert.match(brandMark, /annotated<Text style=\{\{ color: accent \}\}>\.<\/Text>/, 'the terracotta dot is the one accent in chrome');
  // The feed switcher wears the product's one tab anatomy — the flat
  // rail with the web's own underline geometry (§1.1's active-tab
  // clause) — not the old pill language, and every tab is a real 44pt
  // target. Pills remain dock anatomy (the web's bottom switcher), never
  // a top switcher's.
  assert.match(timeline, /tabUnderline: \{ position: 'absolute', bottom: 0, left: '34%', right: '34%', height: 2, backgroundColor: tokens\.accent, borderRadius: 99 \}/, 'the native underline mirrors the web tab anatomy, rounded caps included');
  assert.match(timeline, /tab: \{ flex: 1, minHeight: 44/, 'switcher tabs meet the touch floor');
  assert.doesNotMatch(timeline, /menuPill/, 'the pill switcher is gone');
  assert.doesNotMatch(timeline, /shadowColor|elevation:/, 'legacy shadow*/elevation props are banned (expo-native-ui)');
  assert.match(timeline, /\.\.\.cardChrome/, 'the feed card sits on the shared card surface');
});

test('the home chrome hides on scroll down and returns on scroll up', async () => {
  const { readFile } = await import('node:fs/promises');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  assert.match(tabsLayout, /headerShown: false,\s*\n\s*tabBarIcon: \(\{ color, size \}\) => <Icon name="home"/, 'the navigator header yields to the collapsing chrome');
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
  assert.match(drawerPanel, /use\(SwipeMenuContext\)/, 'the panel closes the menu through its context');
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

test('the menu is X-anatomy: identity, the places you act, then the quiet pages', () => {
  // Identity block first, with the counts X puts there — and tapping it
  // opens your profile.
  assert.match(drawerPanel, /Following<\/Text>/);
  assert.match(drawerPanel, /Followers<\/Text>/);
  assert.match(drawerPanel, /value\.toLocaleString\(\)/, 'counts are grouped, not raw');
  assert.match(drawerPanel, /accessibilityLabel="Open your profile"/);
  // Primary group: the places you act. Secondary group: reference pages,
  // set smaller and quieter, exactly like X's lower list.
  const primary = drawerPanel.match(/<View style=\{styles\.items\}>[\s\S]*?<\/View>/)?.[0] || '';
  for (const label of ['Profile', 'Library', 'Disputes']) {
    assert.ok(primary.includes(`'${label}'`), `the primary group carries ${label}`);
  }
  const secondary = drawerPanel.match(/<View style=\{styles\.minorItems\}>[\s\S]*?<\/View>/)?.[0] || '';
  for (const label of ['Transparency', 'About', 'Settings', 'Help Centre']) {
    assert.ok(secondary.includes(`'${label}'`), `the secondary group carries ${label}`);
  }
  assert.match(drawerPanel, /minorLabel: \{ color: tokens\['ink-soft'\], fontSize: 14\.5/, 'the secondary group is set smaller');
  assert.match(drawerPanel, /itemLabel: \{ color: ink, fontSize: 16\.5, fontWeight: '700' \}/);
});

test('explore wears the chrome X gives it, and the gear holds its settings', async () => {
  const { readFile } = await import('node:fs/promises');
  const exploreSettings = await readFile(new URL('../mobile/components/Preferences.tsx', import.meta.url), 'utf8');
  // avatar, field, gear — one row, and the navigator header steps aside
  assert.match(search, /<HeaderAvatar \/>/, 'the avatar is the same top-left affordance here');
  assert.match(search, /accessibilityLabel="Explore settings"/);
  assert.match(search, /<Icon name="settings"/);
  assert.match(tabsLayout, /\/\/ Explore draws its own chrome[\s\S]*?headerShown: false/, 'the navigator header yields to explore chrome');
  assert.match(search, /const insets = useSafeAreaInsets\(\);/, 'explore reads the device safe area when it owns the header');
  assert.match(search, /style=\{\[styles\.chrome, \{ paddingTop: insets\.top \}\]\}/, 'explore chrome clears the status bar and return-to-app indicator');
  // topics wear the same rail as Home, not the old pills
  assert.doesNotMatch(search, /styles\.pill\b/, 'the pill topics are gone');
  assert.match(search, /tabUnderline: \{ position: 'absolute', bottom: 0/, 'topics use the product tab rail');
  // the sheet's levers are real ones
  assert.match(exploreSettings, /Rank explore by/);
  assert.match(exploreSettings, /Hide demo accounts/);
});

test('reader choices are cached on the device and validated on the way back in', async () => {
  const { readFile } = await import('node:fs/promises');
  const prefs = await readFile(new URL('../mobile/lib/prefs.ts', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../mobile/components/Preferences.tsx', import.meta.url), 'utf8');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  const settingsScreen = await readFile(new URL('../mobile/app/settings.tsx', import.meta.url), 'utf8');
  const rootLayout = await readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8');
  // one record, one key, in on-device storage
  assert.match(prefs, /from '@react-native-async-storage\/async-storage'/);
  assert.match(prefs, /const KEY = 'annotated:preferences:v1'/, 'the record is versioned');
  // a stored blob is input like any other: unknown values fall back to
  // the defaults rather than reaching a query string
  assert.match(prefs, /from '\.\/core\/preferences'/, 'the shape is the product-wide definition, not a second copy');
  assert.match(prefs, /return DEFAULT_PREFERENCES;/, 'an unreadable cache degrades to the defaults');
  // nothing is written before the stored record has been read, or a cold
  // start would overwrite the reader's choices with the defaults
  assert.match(provider, /const hydrated = useRef\(false\);/);
  assert.match(provider, /if \(hydrated\.current\) void writePreferences\(next\);/);
  // and every choice reads from that one record
  assert.match(rootLayout, /<PreferencesProvider>/);
  assert.match(timeline, /const \{ mutedTopics, setMutedTopics, followingOrder, setFollowingOrder \} = useContext\(PreferencesContext\);/);
  assert.match(settingsScreen, /use\(PreferencesContext\)/);
  assert.doesNotMatch(provider, /last for this session/i, 'the sheets no longer promise to forget');
});

test('the home rail carries its own menus: themes on Recent, ordering on Following', async () => {
  const { readFile } = await import('node:fs/promises');
  const timeline = await readFile(new URL('../mobile/components/Timeline.tsx', import.meta.url), 'utf8');
  const menus = await readFile(new URL('../mobile/components/FeedMenus.tsx', import.meta.url), 'utf8');
  assert.match(timeline, /MENUS: Record<string, 'themes' \| 'order'> = \{ recent: 'themes', following: 'order' \}/);
  assert.match(timeline, /if \(active && MENUS\[entry\.key\]\)/, 'a second tap on the active tab opens its menu');
  assert.match(timeline, /<TopicMuteSheet/);
  assert.match(timeline, /<FollowingOrderSheet/);
  // muting is a real filter, and Popular is the ranking the product means
  assert.match(timeline, /mutedTopics\.includes\(item\.topic\)/);
  assert.match(timeline, /if \(order === 'popular'\) params\.set\('sort', 'trending'\)/);
  assert.match(menus, /Most recent/);
  assert.match(menus, /Popular/);
});

test('notifications aggregate X-style and the personas can aim at a real account', async () => {
  // same event on the same annotation collapses into one row with a
  // facepile; the people and the source are the bold parts
  assert.match(notifications, /export const groupNotifications = /);
  assert.match(notifications, /and \{group\.count - 1\} others/);
  assert.match(notifications, /styles\.facepile/);
  // One card component under every list: the notification row and the
  // feed card are the same surface, so moving between tabs never changes
  // the shape of what you are reading.
  assert.match(notifications, /<CardSurface/, 'notifications sit on the shared card surface');
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
  assert.match(search, /params\.set\('sort', 'trending'\)/, 'explore ranks by trending unless the gear says otherwise');
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
