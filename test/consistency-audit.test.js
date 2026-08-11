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

const [web, webCss, panelHtml, panelJs, panelCss, nativeAuth, nativeDoor, timeline, search, notifications, tokens] = await Promise.all([
  read('src/main.js'),
  read('src/styles.css'),
  read('extension/sidepanel.html'),
  read('extension/sidepanel.js'),
  read('extension/sidepanel.css'),
  read('mobile/lib/native-auth.ts'),
  read('mobile/components/AuthProviderContext.tsx'),
  read('mobile/components/Timeline.tsx'),
  read('mobile/components/SearchScreen.tsx'),
  read('mobile/components/NotificationsScreen.tsx'),
  read('mobile/lib/tokens.ts'),
]);

test('the sign-in door speaks the same words on every surface', () => {
  const pitch = 'One account across the extension, the web, and the app.';
  const title = 'Add your name to the margin';
  for (const [surface, source] of [['web', web], ['panel', panelHtml], ['native', nativeDoor]]) {
    assert.ok(source.includes(title), `${surface} must open with "${title}"`);
    assert.ok(source.includes(pitch), `${surface} must carry the pitch line`);
    assert.ok(source.includes('Not now'), `${surface} must offer the same way out`);
  }
  // Continue-with wording: web and native build it from providerLabel;
  // the extension ships both provider doors statically.
  assert.match(web, /Continue with \$\{providerLabel\(provider\)\}/);
  assert.match(panelHtml, /Continue with X/);
  assert.match(panelHtml, /Continue with Google/);
  assert.match(nativeDoor, /`Continue with \$\{providerLabel\(provider\)\}`/);
  assert.match(nativeAuth, /signInWithProvider/);
});

test('provider sign-in buttons use official marks and the same legal boundary', () => {
  for (const [surface, source] of [['web', web], ['panel', panelHtml], ['native', nativeDoor]]) {
    assert.ok(source.includes('Privacy Policy'), `${surface} links the privacy policy from the sign-in door`);
    assert.ok(source.includes('Terms'), `${surface} links the terms from the sign-in door`);
    assert.ok(/google\.png/.test(source), `${surface} uses the Google provider mark`);
  }
  assert.match(web, /providers\/.*x\.svg/);
  assert.match(panelHtml, /providers\/x\.svg/);
  assert.match(nativeDoor, /providers\/x\.png/);
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
    // The sentence is canon; the stop is surface-local. On web the .card
    // h2::after supplies it in terracotta, so the copy carries no period —
    // "All quiet." would render "All quiet..". Native text keeps its own.
    'notifications-empty title': ['All quiet', [web, notifications]],
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

test('the feed tabs speak one language on web, panel, and the native app', () => {
  // Every feed switcher wears the panel's tab anatomy: meta text at rest,
  // ink 700 when active, the short rounded terracotta underline at 34%
  // insets naming the pane. No exemptions any more — the phone dock and
  // the shell's segmented pills died when the native app started
  // switching feeds from this exact rail; both phone experiences must
  // read as one.
  for (const [surface, css] of [['web', webCss], ['panel', panelCss]]) {
    const active = css.match(/\.tab\.is-active::after \{[\s\S]*?\}/)?.[0] || '';
    for (const rule of ['left: 34%', 'right: 34%', 'height: 2px', 'background: var(--accent)', 'border-radius: 99px']) {
      assert.ok(active.includes(rule), `${surface} active-tab underline must carry ${rule}`);
    }
    assert.match(css, /\.tab\.is-active \{ color: var\(--ink\); font-weight: 700; \}/, `${surface} active tab is ink and bold`);
  }
  // The native rail carries the same values through the shared tokens.
  assert.match(timeline, /tabUnderline: \{ position: 'absolute', bottom: 0, left: '34%', right: '34%', height: 2, backgroundColor: tokens\.accent, borderRadius: 99 \}/, 'the native underline is the same rounded 34% rule');
  assert.match(timeline, /tabTextActive: \{ fontSize: 14, color: ink, fontWeight: '700' \}/, 'the native active tab is ink and bold');
  assert.match(timeline, /tabText: \{ fontSize: 14, color: meta \}/, 'the native resting tab is quiet meta at regular weight');
  // And no pill switcher survives anywhere on the web: the rail never
  // re-docks to the bottom, and no scope repaints the active tab as a
  // filled chrome pill.
  assert.doesNotMatch(webCss, /\.feedhead \{ position: fixed/, 'the feed rail must never dock to the bottom again');
  assert.doesNotMatch(webCss, /\.feedhead \.tabs \.tab\.is-active \{ color: #fff/, 'no scope repaints the active tab as a filled pill');
});

test('the moment chip is the same component on every surface', () => {
  // Law 1's first entry: the chip marks the moment — mono type, accent-ink
  // on accent-soft, 3px radius. The native timeline wore grey here while
  // web and panel wore terracotta; the same tokens bind all three now.
  const webChip = webCss.match(/\n\.chip \{[\s\S]*?\n\}/)?.[0] || '';
  const panelChip = panelCss.match(/\n\.chip \{[\s\S]*?\n\}/)?.[0] || '';
  for (const [surface, chip] of [['web', webChip], ['panel', panelChip]]) {
    assert.match(chip, /color: var\(--accent-ink\)/, `${surface} chip text must be accent-ink`);
    assert.match(chip, /background: var\(--accent-soft\)/, `${surface} chip wash must be accent-soft`);
    assert.match(chip, /border-radius: 3px/, `${surface} chip radius must be 3px`);
  }
  const nativeChip = timeline.match(/\n  chip: \{.*\n/)?.[0] || '';
  assert.match(nativeChip, /color: tokens\['accent-ink'\]/, 'the native chip text must be accent-ink');
  assert.match(nativeChip, /backgroundColor: tokens\['accent-soft'\]/, 'the native chip wash must be accent-soft');
  assert.match(nativeChip, /borderRadius: 3,/, 'the native chip radius must be 3');
});

test('one icon vocabulary: the same drawings, sourced from core, on every surface', async () => {
  const [coreIcons, nativeIcon, systemIcon, mobilePkg] = await Promise.all([
    read('packages/core/src/icons.ts'),
    read('mobile/components/Icon.tsx'),
    read('mobile/components/SystemIcon.tsx'),
    read('mobile/package.json'),
  ]);
  assert.match(web, /import \{ PRODUCT_ICONS as icons \} from '\.\/icons\.js';/, 'the web renders the core set');
  assert.match(nativeIcon, /from '\.\.\/lib\/core\/icons'/, 'native renders the same core set');
  for (const name of ['open', 'respond', 'share', 'claim', 'follow', 'mic', 'bell', 'heart']) {
    assert.ok(coreIcons.includes(`'${name}':`), `the core vocabulary carries ${name}`);
  }
  // System affordances are a deliberate allowlist, not a drift channel: the
  // platform's own glyph (SF Symbols on iOS) for exactly these, nothing else.
  const allowlist = systemIcon.match(/const SYSTEM_ICONS = \{[\s\S]*?\} satisfies/)?.[0] || '';
  assert.deepEqual([...allowlist.matchAll(/^  (\w+): \{ sf:/gm)].map((match) => match[1]).sort(), ['back', 'forward', 'share'], 'the platform-glyph allowlist is exactly share/back/forward');
  assert.ok(!mobilePkg.includes('@expo/vector-icons'), 'the icon-font dependency is retired');
});

test('one lockup: the wordmark is the same drawing everywhere', async () => {
  const [brandMark, welcome, ogCard] = await Promise.all([
    read('mobile/components/BrandMark.tsx'),
    read('mobile/components/welcome/speak-language.tsx'),
    read('server/og-card.js'),
  ]);
  // The web ships the lockup outlined from Inter ExtraBold at -2.1%
  // (locked in brand-identity.test.js). The app must name that face —
  // an unnamed fontFamily drew SF on iOS and Roboto on Android — and
  // every native rendering tracks at the same -2.1%.
  assert.match(brandMark, /fontFamily: 'Inter_800ExtraBold'/, 'BrandMark must name the face, not inherit the platform default');
  assert.match(brandMark, /letterSpacing: size \* -0\.021/);
  assert.match(welcome, /letterSpacing: size \* -0\.021/, 'the welcome lockup tracks like the brand');
  // The share card embeds the outlined drawing itself — retyping the
  // wordmark hands the brand to whatever font the container carries.
  assert.match(ogCard, /OG_WORDMARK/, 'the share card must embed the outlined lockup');
  assert.doesNotMatch(ogCard, /'annotated'\)/, 'the card must not retype the wordmark in container fonts');
});

test('the account menu has the same skeleton on web and panel', () => {
  // The avatar never signs you out directly on any surface — it opens a
  // menu: identity first, View profile next, Sign out always last. The
  // middle entry is surface-appropriate (panel: Settings; web: library).
  for (const [surface, source] of [['web', web], ['panel', panelHtml]]) {
    assert.match(source, /aria-haspopup="menu"/, `${surface} avatar declares the menu`);
    assert.match(source, /role="menu" aria-label="Account"/, `${surface} menu is named Account`);
    const menu = source.match(/role="menu" aria-label="Account"[\s\S]*?Sign out/)?.[0] || '';
    assert.match(menu, /me-name/, `${surface} menu opens with the identity line`);
    assert.ok(menu.indexOf('View profile') < menu.indexOf('Sign out'), `${surface} keeps sign out last`);
  }
});

test('focus is the same ink ring on web and panel', () => {
  const ring = ':focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 3px; }';
  for (const [surface, css] of [['web', webCss], ['panel', panelCss]]) {
    assert.ok(css.includes(ring), `${surface} draws the ink focus ring`);
    assert.match(css, /:focus-visible \{ outline-color: #F5F4F0; \}/, `${surface} flips to paper on the dark chrome`);
  }
});

test('one clock: web and panel share the same motion tokens', () => {
  // Affordance motion runs on the panel's proven tokens on both surfaces.
  // Authored sequences (the publish celebration's locked beat, ambient
  // loops, the welcome's timeline) deliberately keep their own clocks.
  const clock = [
    '--t-press: 60ms', '--t-hover: 120ms', '--t-fade: 180ms', '--t-move: 240ms',
    '--e-ink: cubic-bezier(.25, .1, .25, 1)',
    '--e-enter: cubic-bezier(.2, .7, .3, 1)',
    '--e-exit: cubic-bezier(.4, 0, .7, 1)',
    '--e-hold: ease-in-out',
  ];
  for (const token of clock) {
    assert.ok(webCss.includes(token), `web must carry ${token}`);
    assert.ok(panelCss.includes(token), `panel must carry ${token}`);
  }
  // and the web actually runs on them — no raw transition timings left
  assert.doesNotMatch(webCss, /transition: [^;]*\.\d+s/, 'web transitions must use the tokens');
});
