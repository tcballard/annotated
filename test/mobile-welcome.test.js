import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

const [screen, timeline, gate, canvas, pressable, layout, route, types] = await Promise.all([
  read('mobile/components/welcome/speak-language.tsx'),
  read('mobile/components/welcome/timeline.ts'),
  read('mobile/components/welcome/interaction-gate.ts'),
  read('mobile/components/welcome/reference-canvas.tsx'),
  read('mobile/components/welcome/pressable.tsx'),
  read('mobile/app/_layout.tsx'),
  read('mobile/app/welcome.tsx'),
  read('mobile/components/welcome/types.ts'),
]);

// The sequence is authored to documented, measured stops. These numbers
// ARE the specification: if one drifts, the entrance no longer matches
// the reference behaviour it was calibrated against.
test('the welcome sequence keeps every documented motion stop', () => {
  assert.match(screen, /SPEAK_LANGUAGE_DURATION_MS = 5070/);
  // launch dissolve, then the loading field
  assert.match(screen, /1 - Easing\.out\(Easing\.cubic\)\(segment\(time\.value, 33, 200\)\)/);
  assert.match(screen, /Math\.min\(segment\(time\.value, 80, 180\), 1 - segment\(time\.value, 290, 333\)\)/);
  // page one is composed at 0.333
  assert.match(screen, /opacity: segment\(time\.value, 300, 333\)/);
  // page one → two, page two → three
  assert.match(screen, /segment\(time\.value, 2833, 3100\)/);
  assert.match(screen, /segment\(time\.value, 3267, 3533\)/);
  // the tap retires, the primary action arrives
  assert.match(screen, /1 - segment\(time\.value, 3200, 3400\)/);
  assert.match(screen, /Easing\.inOut\(Easing\.quad\)\(segment\(time\.value, 3800, 4400\)\)/);
  // slides travel a full canvas width, never a magic number
  assert.match(screen, /\[0, 1\], \[REFERENCE_WIDTH, 0\]/);
});

test('the canvas is the 640×1385 reference, scaled as one piece', async () => {
  const geometry = await read('mobile/components/welcome/geometry.ts');
  assert.match(geometry, /REFERENCE_WIDTH = 640/);
  assert.match(geometry, /REFERENCE_HEIGHT = 1385/);
  // cover when the aspect is within 2%, contain when it is not
  assert.match(canvas, /scaleDelta <= 0\.02 \? Math\.max\(widthScale, heightScale\) : Math\.min\(widthScale, heightScale\)/);
  assert.match(canvas, /transformOrigin: 'top left'/);
});

test('autoplay, replay, and reduced motion each have defined behaviour', () => {
  // autoplay=false composes the final frame; autoplay runs the clock
  assert.match(timeline, /useSharedValue\(autoplay \? 0 : durationMs\)/);
  assert.match(timeline, /easing: Easing\.linear/);
  // reduced motion parks at the end — nothing is left waiting invisibly
  assert.match(timeline, /if \(!autoplay \|\| reducedMotion\) \{\s*\n\s*time\.value = durationMs;/);
  // replayKey re-runs the effect from zero
  assert.match(timeline, /\[autoplay, durationMs, reducedMotion, replayKey, time\]/);
  assert.match(screen, /replayKey = 0/);
});

test('controls stay inert — to touch and to screen readers — until they arrive', () => {
  // the three gates match the moments their surfaces land
  assert.match(screen, /useInteractionGate\(\{ autoplay, delayMs: 333, replayKey \}\)/);
  assert.match(screen, /useInteractionGate\(\{ autoplay, delayMs: 4400, replayKey \}\)/);
  assert.match(screen, /useInteractionGate\(\{ autoplay, delayMs: 3400, replayKey \}\)/);
  // reduced motion opens every gate immediately, because nothing animates
  assert.match(gate, /const shouldWait = autoplay && !reducedMotion;/);
  // a gated control leaves the accessibility tree entirely
  assert.match(pressable, /accessibilityElementsHidden=\{inert \|\| accessibilityElementsHidden\}/);
  assert.match(pressable, /importantForAccessibility=\{inert \? 'no-hide-descendants'/);
  assert.match(pressable, /accessibilityState=\{inert \? \{ \.\.\.accessibilityState, disabled: true \}/);
  // every control names itself
  for (const label of ['Sign in', 'Tap to continue', 'Start keeping moments']) {
    assert.ok(screen.includes(`accessibilityLabel="${label}"`), `missing accessibility label: ${label}`);
  }
});

test('every semantic action is declared and wired to a real destination', () => {
  for (const action of ['speak-language.sign-in', 'speak-language.tap-to-continue', 'speak-language.start-speaking-today']) {
    assert.ok(types.includes(`'${action}'`), `undeclared action: ${action}`);
    assert.ok(screen.includes(action), `unwired action in the screen: ${action}`);
  }
  // sign-in and the primary CTA reach the app's own native sign-in
  assert.match(route, /signInNatively/);
  assert.match(route, /speak-language\.sign-in/);
  assert.match(route, /speak-language\.start-speaking-today/);
  // tap-to-continue advances the authored sequence rather than skipping it
  assert.match(screen, /const next = PAGE_STOPS\.find\(\(stop\) => stop > now \+ 1\)/);
  assert.match(timeline, /const seekTo = useCallback/);
});

test('the first frame waits for its fonts, its artwork, and the account', () => {
  assert.match(layout, /SplashScreen\.preventAutoHideAsync\(\)/);
  for (const font of ['Inter_400Regular', 'Inter_600SemiBold', 'Inter_700Bold', 'Inter_800ExtraBold']) {
    assert.ok(layout.includes(font), `font alias not loaded: ${font}`);
  }
  assert.match(layout, /Asset\.loadAsync\(WELCOME_ASSETS\)/);
  assert.match(layout, /const ready = fontsLoaded && artworkLoaded && accountResolved;/);
  assert.match(layout, /if \(!ready\) return null;/);
  // the hand-off happens once, and only someone without an account meets it
  assert.match(layout, /if \(!me\) router\.replace\('\/welcome'\)/);
  assert.match(layout, /handedOff\.current = true;/);
  // the route owns its canvas: no header, no safe-area padding
  assert.match(layout, /name="welcome"[\s\S]{0,160}headerShown: false/);
  assert.match(route, /surface: \{ flex: 1 \}/);
  assert.doesNotMatch(route, /SafeAreaView/);
});

// The reference project is GPL-3.0 and this repository is Apache-2.0:
// its implementation was studied, never copied. Keep it that way.
test('the welcome surface carries its own implementation and provenance', async () => {
  const provenance = await read('mobile/components/welcome/PROVENANCE.md');
  assert.match(provenance, /GPL-3\.0/);
  assert.match(provenance, /Apache-2\.0/);
  assert.match(provenance, /No source, asset, or copy from that repository is used here/);
  // the reference's own identifiers must never appear in our tree
  for (const source of [screen, timeline, gate, canvas, pressable]) {
    assert.doesNotMatch(source, /ReplicaPressable|welcome-gallery|Appllama/);
  }
  // our artwork is generated from our palette, in the repo, as source
  const generator = await read('scripts/generate-welcome-assets.mjs');
  assert.match(generator, /lower-wash\.png/);
  assert.match(generator, /#B0674D/);
});
