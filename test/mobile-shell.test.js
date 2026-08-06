import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootLayout = await readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8');
const drawerLayout = await readFile(new URL('../mobile/app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const tabsLayout = await readFile(new URL('../mobile/app/(drawer)/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const timelineTab = await readFile(new URL('../mobile/app/(drawer)/(tabs)/index.tsx', import.meta.url), 'utf8');
const profileTab = await readFile(new URL('../mobile/app/(drawer)/(tabs)/profile.tsx', import.meta.url), 'utf8');
const captureScreen = await readFile(new URL('../mobile/app/(drawer)/(tabs)/capture.tsx', import.meta.url), 'utf8');
const webPage = await readFile(new URL('../mobile/app/web/[...path].tsx', import.meta.url), 'utf8');
const webScreen = await readFile(new URL('../mobile/components/WebScreen.tsx', import.meta.url), 'utf8');
const shellHelpers = await readFile(new URL('../mobile/lib/shell.ts', import.meta.url), 'utf8');
const tokensModule = await readFile(new URL('../mobile/lib/tokens.ts', import.meta.url), 'utf8');
const appConfig = JSON.parse(await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../mobile/package.json', import.meta.url), 'utf8'));
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const webCss = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const authServer = await readFile(new URL('../server/auth.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

test('the shell is configured for the share sheet on both platforms', () => {
  assert.equal(appConfig.expo.scheme, 'annotated');
  const shareIntent = appConfig.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-share-intent');
  assert.ok(shareIntent, 'expo-share-intent plugin must be configured');
  assert.equal(shareIntent[1].iosActivationRules.NSExtensionActivationSupportsWebURLWithMaxCount, 1);
  assert.deepEqual(shareIntent[1].androidIntentFilters, ['text/*']);
  assert.ok(packageJson.dependencies['expo-share-intent']);
  assert.ok(packageJson.dependencies['react-native-webview']);
});

test('navigation is native, X-anatomy: a stack over a drawer over tabs', () => {
  assert.equal(packageJson.main, 'expo-router/entry');
  assert.ok(appConfig.expo.plugins.includes('expo-router'), 'expo-router config plugin must be registered');
  assert.match(rootLayout, /<Stack/);
  assert.match(rootLayout, /name="\(drawer\)"/);
  assert.match(rootLayout, /name="web\/\[\.\.\.path\]"/, 'internal pages push over the tabs');
  assert.match(drawerLayout, /<Drawer/);
  assert.match(drawerLayout, /swipeEdgeWidth/, 'the drawer answers an edge swipe');
  for (const name of ['index', 'search', 'capture', 'notifications', 'profile']) {
    assert.match(tabsLayout, new RegExp(`name="${name}"`), `the ${name} tab must exist`);
  }
  assert.match(tabsLayout, /tabPress: \(\) => \{ void Haptics\.selectionAsync\(\); \}/, 'tab switches give haptic feedback');
  assert.match(webScreen, /SafeAreaView edges=\{padTop \? \['top'\] : \[\]\}/, 'pushed screens under a native header do not double-pad the inset');
});

test('the timeline is native; capture, profile, and pushed pages stay shell-mode web', () => {
  assert.match(timelineTab, /<Timeline \/>/);
  assert.doesNotMatch(timelineTab, /WebScreen/, 'the reading surface is not a WebView');
  assert.match(shellHelpers, /searchParams\.set\('shell', '1'\)/);
  assert.match(captureScreen, /shellUrl\(ORIGIN, '\/capture'\)/);
  assert.match(profileTab, /shellUrl\(ORIGIN, `\/u\/\$\{encodeURIComponent\(me\.handle\)\}`\)/, 'the profile tab is your public page');
  assert.match(webPage, /shellUrl\(ORIGIN, target\)/, 'pushed permalinks/profiles/hubs stay shell-mode web');
  assert.match(webPage, /padTop=\{false\}/);
});

test('shares land on the capture desk via the same contract the PWA share target uses', () => {
  assert.match(rootLayout, /useShareIntent/);
  assert.match(rootLayout, /pathname: '\/capture', params: \{ shared: payload/, 'a share routes to the capture screen');
  assert.match(captureScreen, /captureUrlFromShare\(ORIGIN, \{ text: shared \}\)/);
  assert.match(shellHelpers, /new URL\('\/capture', origin\)/);
  assert.match(shellHelpers, /searchParams\.set\('text', payload\)/);
});

test('sign-in hops to the system browser and returns to the surface it left', () => {
  assert.match(shellHelpers, /return_to', 'annotated:\/\/auth'/);
  assert.match(shellHelpers, /new URL\('\/auth\/mobile\/session', origin\)/);
  assert.match(shellHelpers, /searchParams\.set\('next', next\)/);
  assert.match(webScreen, /openAuthSessionAsync\(withMobileReturn\(startUrl\), 'annotated:\/\/auth'\)/);
  assert.match(webScreen, /sessionExchangeUrl\(ORIGIN, ticket, `\$\{home\.pathname\}\$\{home\.search\}`\)/);
  assert.match(authServer, /url\.protocol === 'annotated:' && url\.hostname === 'auth'/);
  assert.match(authServer, /export const mobileTicketSession/);
  assert.ok(server.includes("url.pathname === '/auth/mobile/session'"));
  assert.ok(server.includes("test(requestedNext) ? requestedNext : '/'"), 'next is honoured only as a local path');
});

test('one sign-in serves every surface: the session epoch fans it out', () => {
  assert.match(webScreen, /SessionEpochContext/);
  assert.match(webScreen, /if \(!focusedRef\.current\) webViewRef\.current\?\.reload\(\)/);
  assert.match(rootLayout, /SessionEpochContext\.Provider/);
  assert.match(rootLayout, /bump: \(\) => setEpoch/);
});

test('external navigation opens out; annotated stays in the shell', () => {
  assert.match(webScreen, /isInternalNavigation\(request\.url, ORIGIN\)/);
  assert.match(webScreen, /openBrowserAsync\(request\.url\)/);
});

test('native styling derives from the web stylesheet — one source of truth', () => {
  const rootBlock = webCss.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(rootBlock, 'the web stylesheet must declare :root tokens');
  const entries = [...rootBlock[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)];
  assert.ok(entries.length >= 10, 'expected a real token set');
  for (const [, name, value] of entries) {
    assert.ok(
      tokensModule.includes(`${JSON.stringify(name)}: ${JSON.stringify(value.trim())},`),
      `token --${name} is stale in mobile/lib/tokens.ts — run node scripts/generate-mobile-tokens.mjs`,
    );
  }
  assert.match(tabsLayout, /from '\.\.\/\.\.\/\.\.\/lib\/tokens'/);
  assert.match(webScreen, /from '\.\.\/lib\/tokens'/);
});

test('shell mode strips web chrome and returns the feed switcher to the top', () => {
  assert.match(main, /get\('shell'\) === '1'/);
  assert.match(main, /sessionStorage\.setItem\('annotated-shell', '1'\)/, 'shell mode survives in-page reloads');
  assert.match(main, /classList\.add\('shell-mode'\)/);
  assert.match(main, /\$\{SHELL_MODE \? '' : chromeBar\(\)\}/, 'no web nav inside the native app');
  assert.match(main, /\$\{SHELL_MODE \? '' : footerView\(\)\}/, 'no web footer inside the native app');
  assert.match(main, /SHELL_MODE \? `<button class="ghost" data-action="logout">Sign out<\/button>` : ''/, 'sign-out lives on the Library surface when the chrome bar is gone');
  assert.match(webCss, /html\.shell-mode \.feedhead \{\s*position: sticky;\s*top: 0;/, 'the switcher docks top — the bottom belongs to the native tab bar');
  assert.match(webCss, /html\.shell-mode \.feed:has\(\.feedhead\)/, 'the dock padding is released in shell mode');
});
