import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
const shellHelpers = await readFile(new URL('../mobile/lib/shell.ts', import.meta.url), 'utf8');
const appConfig = JSON.parse(await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../mobile/package.json', import.meta.url), 'utf8'));
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

test('shares land on the same capture contract the PWA share target uses', () => {
  assert.match(shellHelpers, /\/capture\?text=\$\{encodeURIComponent\(payload\)\}/);
  assert.match(app, /useShareIntent/);
  assert.match(app, /captureUrlFromShare\(ORIGIN/);
});

test('sign-in hops to the system browser and returns as a cookie session', () => {
  assert.match(shellHelpers, /return_to', 'annotated:\/\/auth'/);
  assert.match(shellHelpers, /\/auth\/mobile\/session\?ticket=/);
  assert.match(app, /openAuthSessionAsync\(withMobileReturn\(startUrl\), 'annotated:\/\/auth'\)/);
  assert.match(authServer, /url\.protocol === 'annotated:' && url\.hostname === 'auth'/);
  assert.match(authServer, /export const mobileTicketSession/);
  assert.match(server, /\/auth\/mobile\/session/);
});

test('external navigation opens out; annotated stays in the shell', () => {
  assert.match(app, /isInternalNavigation\(request\.url, ORIGIN\)/);
  assert.match(app, /openBrowserAsync\(request\.url\)/);
});
