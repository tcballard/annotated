import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionRoot = path.join(projectRoot, 'extension');
const read = (file) => readFile(path.join(extensionRoot, file), 'utf8');
const pngDimensions = async (file) => {
  const bytes = await readFile(path.join(extensionRoot, file));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test('Manifest V3 extension has a reachable side-panel trigger and local files', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '114');
  const keyBytes = Buffer.from(manifest.key, 'base64');
  const extensionId = [...createHash('sha256').update(keyBytes).digest().subarray(0, 16)].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join('');
  assert.equal(extensionId, 'omlikcdpcdhfmdojdalfdeihgjmgikkg');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('identity'));
  assert.ok(manifest.permissions.includes('alarms'));
  // captureVisibleTab accepts only the literal <all_urls> pattern (or a
  // per-invocation activeTab grant, which dies on tab switch) — plain
  // http/https host patterns satisfy scripting but NOT screenshots.
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.equal(manifest.action.default_popup, undefined);
  await access(path.join(extensionRoot, manifest.background.service_worker));
  await access(path.join(extensionRoot, manifest.side_panel.default_path));
  await access(path.join(extensionRoot, manifest.options_ui.page));
  for (const [size, file] of Object.entries(manifest.icons)) {
    assert.deepEqual(await pngDimensions(file), { width: Number(size), height: Number(size) });
    assert.deepEqual(await pngDimensions(manifest.action.default_icon[size]), { width: Number(size), height: Number(size) });
  }

  const background = await read('background.js');
  assert.match(background, /openPanelOnActionClick/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /chrome\.alarms\.onAlarm/);
  assert.match(background, /chrome\.runtime\.onMessage/);
  assert.match(background, /annotatedRetryLock/);
  assert.match(background, /runBackgroundTask/);
});

test('extension runtime source avoids remote-code and service-worker timer patterns', async () => {
  const files = ['background.js', 'config.js', 'options.js', 'sidepanel.js', 'storage.js', 'audio.js', 'media-draft-store.js', 'topics.js'];
  const source = await Promise.all(files.map(read));
  const combined = source.join('\n');
  assert.doesNotMatch(combined, /\beval\s*\(/);
  assert.doesNotMatch(combined, /new\s+Function\s*\(/);
  assert.doesNotMatch(combined, /\.then\s*\(/);
  assert.doesNotMatch(await read('background.js'), /set(?:Timeout|Interval)\s*\(/);
  assert.match(await read('sidepanel.html'), /<script type="module" src="sidepanel\.js"><\/script>/);
  assert.match(await read('options.html'), /<script type="module" src="options\.js"><\/script>/);
  assert.match(await read('options.html'), /<link rel="stylesheet" href="options\.css">/);
});

test('side panel implements the v5 surface: live source strip, marks, note, timeline', async () => {
  const html = await read('sidepanel.html');
  const styles = await read('sidepanel.css');
  const runtime = await read('sidepanel.js');
  // hidden means hidden; states are shipped, not implied
  assert.match(styles, /\*\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  // capture widget: live source strip with terracotta dot + type override
  assert.match(html, /class="livedot"/);
  assert.match(html, /id="typeSelect"/);
  // Mark in/out buttons replace native range scrubbers entirely
  assert.match(html, /id="markIn"/);
  assert.match(html, /id="markOut"/);
  assert.match(html, /id="durationChip"/);
  assert.doesNotMatch(html, /type="range"/);
  assert.match(runtime, /captureMark\('in'\)/);
  assert.match(runtime, /readPlayerTime/);
  // article flow: highlight capture with text-quote anchors and the ¶ chip
  assert.match(html, /id="grabSelection"/);
  assert.match(html, /id="passageChip"/);
  assert.match(runtime, /anchorParagraph/);
  assert.match(runtime, /anchorPrefix/);
  // visibility control and screenshot capture with provenance
  assert.match(html, /id="visibilitySelect"/);
  assert.match(html, /id="shotButton"/);
  assert.match(runtime, /captureVisibleTab/);
  assert.match(runtime, /screenshotAssetId/);
  assert.match(runtime, /\/api\/media\/screenshot/);
  // note + audio recorder with 90-second cap
  assert.match(html, /maxlength="280"/);
  assert.match(html, /class="record-icon"/);
  assert.match(html, /class="stop-icon"/);
  assert.match(html, /id="audioStatus"[^>]*role="status"/);
  assert.match(runtime, /MAX_AUDIO_SECONDS/);
  assert.match(runtime, /recordIcon\.hidden\s*=\s*isRecording/);
  assert.match(runtime, /stopIcon\.hidden\s*=\s*!isRecording/);
  // Text · Audio toggle keeps pressed state accessible
  assert.match(html, /data-mode="text"[^>]*aria-pressed="true"/);
  assert.match(html, /data-mode="audio"[^>]*aria-pressed="false"/);
  assert.match(runtime, /button\.setAttribute\('aria-pressed', String\(active\)\)/);
  // publish is disabled-with-reason, and the 90s block is inline
  assert.match(runtime, /publishBlocker/);
  assert.match(runtime, /Clips are capped at/);
  assert.match(runtime, /Mark an in and an out point, or screenshot the page\./);
  // four full-height modes: Capture · Recent · Following · This page.
  // Capture is the default so the sidebar stays the primary capture surface.
  assert.match(html, /data-feed-tab="capture"/);
  assert.match(html, /data-feed-tab="recent"/);
  assert.match(html, /data-feed-tab="following"/);
  assert.match(html, /data-feed-tab="page"/);
  assert.match(runtime, /let panelMode = 'capture'/);
  assert.match(runtime, /const setPanelMode = /);
  // publishing lands on This page; the empty state hands back to Capture
  assert.match(runtime, /setPanelMode\('page'\)/);
  assert.match(runtime, /setPanelMode\('capture'\); note\.focus\(\)/);
  assert.match(runtime, /No annotations on this page yet\./);
  assert.match(runtime, /Yours would be the first\./);
  // ready media renders inline in the panel timeline too
  assert.match(runtime, /const timelineMedia = /);
  assert.match(runtime, /mediaStatus === 'ready'/);
  assert.match(styles, /\.srcmedia video/);
  // per-tab drafts in session storage, re-bound on tab change
  assert.match(runtime, /saveTabDraft/);
  assert.match(runtime, /getTabDraft/);
  assert.match(runtime, /chrome\.tabs\?\.onActivated/);
  // keyboard path: I/O marks, Ctrl/Cmd+Enter publish, Escape clears
  assert.match(runtime, /event\.key === 'i' \|\| event\.key === 'I'/);
  assert.match(runtime, /event\.key === 'o' \|\| event\.key === 'O'/);
  assert.match(runtime, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(runtime, /event\.key === 'Escape'/);
  // resilience plumbing stays wired
  assert.match(html, /id="queueStatus"[^>]*role="status"/);
  assert.match(runtime, /RETRY_PENDING/);
  assert.match(runtime, /authRequired/);
  assert.match(runtime, /\/api\/sources\/resolve/);
  assert.match(runtime, /signOut/);
  // no raw glyph characters as icons; svg only
  assert.doesNotMatch(html, />\s*[▶◉●■✓⇤⇥]\s*</);
  // preferences + target sizes
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /prefers-color-scheme:\s*dark/);
  assert.match(styles, /\.markbtn[^}]*min-height:\s*40px/);
  assert.match(styles, /\.rec-button[^}]*width:\s*44px[^}]*height:\s*44px/);
  // identity: mono tabular chips, serif source voice, terracotta accent
  assert.match(styles, /--accent:\s*#B0674D/);
  assert.match(styles, /font-variant-numeric:\s*tabular-nums/);
  assert.match(styles, /--serif:\s*Georgia/);
});

test('sign-in is one door: a single trigger, both providers behind a modal', async () => {
  const html = await read('sidepanel.html');
  const runtime = await read('sidepanel.js');
  assert.match(html, /id="signInOpen"[^>]*hidden>Sign in</, 'the header holds a single Sign in button');
  assert.doesNotMatch(html, /Sign in with X<\/button>/, 'no per-provider buttons in the header');
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="signinTitle"/);
  assert.match(html, /data-auth="x"[^>]*hidden>.*Continue with X</);
  assert.match(html, /data-auth="google"[^>]*hidden>.*Continue with Google</);
  assert.match(runtime, /const openSignin = /);
  assert.match(runtime, /signinVeil\.querySelector\('\[data-auth\]:not\(\[hidden\]\)'\)\?\.focus\(\)/, 'focus lands on the first provider');
  assert.match(runtime, /if \(event\.target === signinVeil\) closeSignin\(\)/, 'the veil dismisses');
  assert.match(runtime, /if \(!signinVeil\.hidden\) \{ closeSignin\(\); return; \}/, 'Escape closes the modal first');
  assert.match(runtime, /data-open-signin/, 'the Following empty state opens the same door');
  assert.match(runtime, /if \(signedIn\) closeSignin\(\)/, 'success closes it everywhere');
});

test('the screenshot is a snip: draw the region on the page, crop in the panel', async () => {
  const html = await read('sidepanel.html');
  const runtime = await read('sidepanel.js');
  assert.match(html, /Snip part of the page/);
  assert.match(runtime, /function snipRegionInPage\(\)/);
  assert.match(runtime, /annotated-snip-veil/);
  assert.match(runtime, /requestAnimationFrame\(\(\) => requestAnimationFrame\(/, 'the page repaints before the capture — the tool never photographs itself');
  assert.match(runtime, /finish\(null\)/, 'Escape cancels');
  assert.match(runtime, /vw: window\.innerWidth, vh: window\.innerHeight/, 'the region carries its viewport for zoom/DPR-proof scaling');
  assert.match(runtime, /image\.naturalWidth \/ region\.vw/, 'crop scales bitmap-to-viewport');
  assert.match(runtime, /if \(snipOffered && !region\) return;/, 'a cancelled snip uploads nothing');
  assert.match(runtime, /catch \{ \/\* injection refused — full-tab fallback below \*\/ \}/, 'chrome:\/\/ and PDF pages still get the full-tab path');
});

test('extension settings surface explains the API boundary and recovery states', async () => {
  const html = await read('options.html');
  const runtime = await read('options.js');
  const styles = await read('options.css');
  assert.match(html, /<form id="settingsForm"[^>]*novalidate>/);
  assert.match(html, /<label for="apiOrigin">API origin<\/label>/);
  assert.match(html, /id="apiOriginHint"/);
  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="reset"[^>]*>Use Annotated staging<\/button>/);
  assert.match(runtime, /form\.addEventListener\('submit'/);
  assert.match(runtime, /DEFAULT_API_ORIGIN/);
  assert.match(runtime, /setStatus\(error\.message/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /prefers-color-scheme:\s*dark/);
});

test('Chrome Web Store record covers every manifest permission and the privacy gate', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const packageVersion = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version;
  const listing = await readFile(path.join(projectRoot, 'CHROMEWEBSTORE.md'), 'utf8');
  const release = await readFile(path.join(projectRoot, 'RELEASE.md'), 'utf8');
  assert.equal(manifest.version, packageVersion);
  assert.match(listing, /Chrome Web Store Listing/);
  assert.match(listing, new RegExp(`\`?${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?`));
  assert.ok(listing.includes(`Version ${manifest.version} —`));
  assert.match(release, new RegExp(`v${manifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(release, /draft release baseline/i);
  for (const permission of [...manifest.permissions, ...manifest.host_permissions]) assert.ok(listing.includes(permission), `Missing permission justification for ${permission}`);
  assert.match(listing, /Privacy Policy URL/);
  assert.match(listing, /not ready|TBD|external gate/i);
});

test('extension icon derivatives preserve the approved brand kit exports', async () => {
  const source = await readFile(new URL('../assets/brand/annotated-brand-kit/chrome-extension/icons/icon-128.png', import.meta.url));
  const generator = await readFile(new URL('../scripts/generate-extension-icons.mjs', import.meta.url), 'utf8');
  assert.ok(source.length > 1000);
  assert.match(generator, /annotated-brand-kit/u);
  assert.match(generator, /copyFile/);
  assert.doesNotMatch(generator, /supersample/);
  assert.match(generator, /icon-\$\{size\}\.png/);
});

test('the panel can put an annotation back on the page it came from', async () => {
  const panel = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');
  assert.match(panel, /function highlightPassageInPage/);
  assert.match(panel, /CSS\.highlights\.set\('annotated-passage', new Highlight\(range\)\)/, 'CSS Custom Highlight API — the page DOM is never touched');
  assert.match(panel, /rgba\(176, 103, 77, 0\.28\)/, 'the wash is the accent: this IS the moment');
  assert.match(panel, /\[normalize\(anchor\.prefix\), wanted, normalize\(anchor\.suffix\)\]\.join/, 'the toggle keys on the full anchor identity');
  assert.match(panel, /data-highlight-slug/);
  assert.match(panel, /panelMode === 'page' \|\| matchesCurrentTab\(item\)/, 'only rows about the current page offer it');
  assert.match(panel, /That passage is not on this page right now\./);
  assert.match(panel, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
});
