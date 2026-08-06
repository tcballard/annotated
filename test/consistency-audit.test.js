import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// One product, three surfaces. These assertions make cross-surface
// consistency a build gate rather than a habit: the same door, the same
// moment, the same voice, the same palette — on web, extension, and the
// native app. A surface may phrase a state only where the platform's
// idiom genuinely differs (a system alert has no ::after full stop);
// everything else must match verbatim.

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [web, webCss, panelHtml, panelJs, panelCss, nativeAuth, timeline, search, notifications, tokens] = await Promise.all([
  read('src/main.js'),
  read('src/styles.css'),
  read('extension/sidepanel.html'),
  read('extension/sidepanel.js'),
  read('extension/sidepanel.css'),
  read('mobile/lib/native-auth.ts'),
  read('mobile/components/Timeline.tsx'),
  read('mobile/components/SearchScreen.tsx'),
  read('mobile/components/NotificationsScreen.tsx'),
  read('mobile/lib/tokens.ts'),
]);

test('the sign-in door speaks the same words on every surface', () => {
  const pitch = 'One account across the extension, the web, and the app.';
  const title = 'Add your name to the margin';
  for (const [surface, source] of [['web', web], ['panel', panelHtml], ['native', nativeAuth]]) {
    assert.ok(source.includes(title), `${surface} must open with "${title}"`);
    assert.ok(source.includes(pitch), `${surface} must carry the pitch line`);
    assert.ok(source.includes('Not now'), `${surface} must offer the same way out`);
  }
  // Continue-with wording: web builds it from providerLabel, panel ships it
  // statically, native templates it into the system sheet.
  assert.match(web, /Continue with \$\{providerLabel\(provider\)\}/);
  assert.match(panelHtml, /Continue with X/);
  assert.match(panelHtml, /Continue with Google/);
  assert.match(nativeAuth, /`Continue with \$\{providerLabel\(provider\)\}`/);
});

test('the publish moment is the same beat on web and panel', () => {
  for (const [surface, source] of [['web', web], ['panel', panelJs]]) {
    assert.ok(source.includes('Published<span class="dot">.</span>'), `${surface} says Published.`);
    assert.ok(source.includes('This moment now has a page — with the source attached.'), `${surface} explains the same way`);
    assert.match(source, /setTimeout\(dismissPublishMoment, 1600\)/, `${surface} steps aside on the same clock`);
    assert.match(source, /prefers-reduced-motion: reduce/, `${surface} respects reduced motion`);
  }
  for (const [surface, css] of [['web', webCss], ['panel', panelCss]]) {
    assert.match(css, /stroke-dasharray: 233/, `${surface} draws the same ring`);
    assert.match(css, /animation: pub-draw \.3s ease \.38s forwards/, `${surface} strikes the tick on the same beat`);
    assert.match(css, /color-mix\(in srgb, var\(--paper\) 96%, transparent\)/, `${surface} veils with its own paper`);
  }
});

test('empty states say the same thing for the same state everywhere', () => {
  const canon = {
    'following-empty title': ['No annotations from people you follow yet.', [web, panelJs, timeline]],
    'following-empty body': ['Follow someone whose context you want to keep up with.', [web, panelJs, timeline]],
    'public-empty title': ['No public annotations yet.', [web, panelJs, timeline]],
    'public-empty body': ['Capture the first source-backed moment and it will appear here.', [web, panelJs, timeline]],
    'trending-empty title': ['Nothing is trending yet.', [web, timeline]],
    'search-empty title': ['Nothing matches “', [web, search]],
    'search-empty body': ['Try a different source, author, or phrase.', [web, search]],
    'notifications-empty title': ['All quiet.', [web, notifications]],
    'notifications-empty body': ['When readers respond, like your annotations, or follow you, it lands here.', [web, notifications]],
    'notifications signed-out body': ['Sign in to see responses, likes, and new followers.', [web, notifications]],
  };
  for (const [state, [line, sources]] of Object.entries(canon)) {
    sources.forEach((source, index) => {
      assert.ok(source.includes(line), `${state}: surface #${index} must say "${line}"`);
    });
  }
});

test('one terracotta, one dark paper — the palette matches across surfaces', () => {
  // the accent is identical everywhere, including the generated native tokens
  for (const [surface, source] of [['web', webCss], ['panel', panelCss], ['native tokens', tokens]]) {
    assert.ok(/#B0674D/i.test(source), `${surface} carries the one true terracotta`);
  }
  // the dark scheme is the panel's proven mapping, now shared with the web
  const darkPairs = [
    ['--paper: #26292F', 'dark paper'],
    ['--card: #2C3037', 'dark card'],
    ['--border: #3E444E', 'dark border'],
    ['--ink: #E9EAEC', 'dark ink'],
    ['--meta: #9AA0A8', 'dark meta'],
    ['--link: #8FA4C9', 'dark link'],
    ['--hover-row: #31363E', 'dark hover'],
    ['--strip: #2A2E35', 'dark strip'],
    ['--accent-soft: rgba(224, 164, 142, .14)', 'dark accent-soft'],
  ];
  for (const [pair, name] of darkPairs) {
    assert.ok(webCss.includes(pair), `web dark scheme must keep the ${name}`);
    assert.ok(panelCss.includes(pair), `panel dark scheme must keep the ${name}`);
  }
  // both surfaces flip on the same signal
  for (const [surface, css] of [['web', webCss], ['panel', panelCss]]) {
    assert.match(css, /@media \(prefers-color-scheme: dark\)/, `${surface} answers the OS scheme`);
  }
});
