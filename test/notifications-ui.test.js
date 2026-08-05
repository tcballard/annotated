import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const panel = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');

test('the web chrome wears the bell, and the view rides the shared endpoint', () => {
  assert.match(main, /data-action="open-notifications"/);
  assert.match(main, /api\.notifications\(\)/);
  assert.match(main, /api\.notificationsSeen\(\)/, 'opening the view moves the seen watermark');
  assert.match(main, /state\.unseenNotifications = 0/, 'the badge clears when the view opens');
  assert.match(main, /'\/notifications'/, 'the view has a real route');
  assert.match(main, /responded to your annotation of/);
  assert.match(main, /followed you/);
  assert.match(css, /\.chrome \.bell \.n \{/, 'the unseen dot is styled');
  assert.match(css, /\.notif-row \{/);
});

test('the toolbar icon wears the unseen count; opening the panel clears it', () => {
  assert.match(background, /annotated-notifications/, 'a periodic alarm refreshes the badge');
  assert.match(background, /setBadgeText/);
  assert.match(background, /setBadgeBackgroundColor\(\{ color: '#B0674D' \}\)/, 'the badge is the accent — new activity is a moment');
  assert.match(background, /NOTIFICATIONS_SEEN/);
  assert.match(panel, /\/api\/notifications\/seen/, 'panel open marks everything seen');
  assert.match(panel, /NOTIFICATIONS_SEEN/);
});

test('signed out, neither surface rings', () => {
  assert.match(main, /if \(state\.serverStatus !== 'online' \|\| !state\.user\) return;/);
  assert.match(background, /if \(!headers\.authorization\) return await chrome\.action\.setBadgeText\(\{ text: '' \}\)/);
});
