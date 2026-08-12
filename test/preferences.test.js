import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_PREFERENCES, MAX_MUTED_TOPICS, parsePreferences, samePreferences } from '../src/preferences.js';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('a preferences record is validated, never trusted', () => {
  // the defaults are the answer to anything unexpected
  assert.deepEqual(parsePreferences(undefined), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('nonsense'), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences({ exploreSort: 'ranked-by-vibes' }).exploreSort, 'trending');
  assert.equal(parsePreferences({ followingOrder: 'chronological' }).followingOrder, 'recent');
  // truthiness is not enough for a boolean that hides content
  assert.equal(parsePreferences({ hideDemo: 'yes' }).hideDemo, false);
  assert.equal(parsePreferences({ hideDemo: true }).hideDemo, true);
  // muted topics are taxonomy slugs, deduplicated and bounded — a record
  // is a filter input, and an unbounded one is a denial of service on
  // every render that reads it
  const messy = parsePreferences({ mutedTopics: ['tech', 'tech', 'Not A Slug', 42, null, 'startups'] });
  assert.deepEqual(messy.mutedTopics, ['tech', 'startups']);
  const flood = parsePreferences({ mutedTopics: Array.from({ length: 200 }, (_, index) => `topic-${index}`) });
  assert.equal(flood.mutedTopics.length, MAX_MUTED_TOPICS);
  // and the round trip is stable
  const record = parsePreferences({ exploreSort: 'recent', hideDemo: true, mutedTopics: ['tech'], followingOrder: 'popular' });
  assert.deepEqual(parsePreferences(record), record);
  assert.ok(samePreferences(record, parsePreferences(record)));
  assert.ok(!samePreferences(record, DEFAULT_PREFERENCES));
});

test('every surface reads the one definition, and the account holds the record', async () => {
  const [core, server, repository, web, panel, appPrefs, appProvider, migration, version] = await Promise.all([
    read('packages/core/src/preferences.ts'),
    read('server/index.js'),
    read('server/product-repository.js'),
    read('src/main.js'),
    read('extension/sidepanel.js'),
    read('mobile/lib/prefs.ts'),
    read('mobile/components/Preferences.tsx'),
    read('server/migrations/009_user_preferences.sql'),
    read('server/migration-version.js'),
  ]);
  assert.match(core, /export const parsePreferences/);
  // the store: one JSON column on the account, validated on the way out
  assert.match(migration, /ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(version, /009_user_preferences/);
  assert.match(repository, /preferences: parsePreferences\(row\.preferences\)/, 'the user row parses its record');
  assert.match(repository, /export async function saveUserPreferences/);
  // the endpoint: signed in only, whole records, validated by the shared parser
  assert.match(server, /pathname === '\/api\/preferences'/);
  assert.match(server, /if \(!viewer\) return send\(response, 401/);
  assert.match(server, /saveUserPreferences\(viewer\.id, body\.preferences \?\? body\)/);
  // every reader consumes the same emitted module
  assert.match(web, /from '\.\/preferences\.js'/);
  assert.match(panel, /from '\.\/preferences\.js'/);
  assert.match(appPrefs, /from '\.\/core\/preferences'/);
  // and every surface applies it to what it shows
  assert.match(web, /state\.preferences\.hideDemo && annotation\.isDemo/, 'the web filters demo accounts');
  assert.match(web, /state\.preferences\.mutedTopics\.includes\(annotation\.topic\)/, 'the web filters muted themes');
  assert.match(web, /state\.preferences\.followingOrder === 'popular'/, 'the web honours the following order');
  assert.match(panel, /panelPreferences\.hideDemo && item\.isDemo/, 'the panel filters demo accounts');
  assert.match(panel, /panelPreferences\.mutedTopics\.includes\(item\.topic\)/, 'the panel filters muted themes');
  // the app treats the account as the authority over its device cache
  assert.match(appProvider, /if \(samePreferences\(current, record\)\) return current;/);
  assert.match(appProvider, /if \(signedIn\.current\) void api\.savePreferences\(next\)/);
});

test('the web can change them too, and says so when it cannot', async () => {
  const web = await read('src/main.js');
  assert.match(web, /settings: '\/settings'/, 'settings is a real address');
  assert.match(web, /const settingsView = /);
  assert.match(web, /data-action="pref-sort"/);
  assert.match(web, /data-action="pref-order"/);
  assert.match(web, /data-action="pref-topic"/);
  assert.match(web, /data-action="pref-demo"/);
  assert.match(web, /api\.savePreferences\(state\.preferences\)/);
  // signed out the controls are inert and the page says why, rather than
  // pretending a choice was kept
  assert.match(web, /Sign in to keep these/);
  assert.match(web, /\$\{state\.user \? '' : 'disabled'\}/);
  assert.match(web, /data-action="set-view" data-view="settings">Settings/, 'the account menu carries it');
});
