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

test('the first seconds are honest: no false errors while the panel boots', async () => {
  const runtime = await read('sidepanel.js');
  // unknown tab ≠ unsupported tab: the error strip waits for the tab to be known
  assert.match(runtime, /const known = Boolean\(currentTab\.url\);/);
  assert.match(runtime, /capUnsupported\.hidden = !known \|\| supported;/);
  // the backend check and the tab read race in parallel, then resolution catches up
  assert.match(runtime, /await Promise\.all\(\[checkBackend\(\), loadCurrentTab\(\)\]\)/);
  assert.match(runtime, /if \(backendOnline && !resolvedSource\) await loadCurrentTab\(\);/);
  // a hanging origin fails into the styled offline state, never a stuck boot
  assert.match(runtime, /setTimeout\(\(\) => timeoutController\.abort\(\), 8000\)/);
  assert.match(runtime, /signal: timeoutController\.signal/);
  // a never-signed-in publisher gets the door with context, capture intact
  assert.match(runtime, /openSignin\('Sign in to publish — your capture stays right here\.'\)/);
  const html = await read('sidepanel.html');
  assert.match(html, /id="signinContext" hidden/);
  // closing the OAuth window is a decision, not an error
  assert.match(runtime, /clos\|cancel\|did not approve/);
  // first run frames the loop once, dismissed forever via storage — and
  // closes on the round-trip claim that separates this from a vault
  assert.match(html, /id="introCard" hidden/);
  assert.match(html, /on the public feed by default/);
  assert.match(html, /class="intro-foot">The original stays the point/);
  assert.match(runtime, /annotatedIntroSeen/);
  // the Following empty state teaches instead of dead-ending
  assert.match(runtime, /data-feed-tab-jump="recent">Browse Recent</);
  // the grabber arms itself from a live selection instead of waiting to fail
  assert.match(runtime, /function watchSelectionInPage\(\)/);
  assert.match(runtime, /window\.__annotatedSelectionWatch/, 'the injected watcher self-guards against double injection');
  assert.match(runtime, /type: 'ANNOTATED_SELECTION'/);
  assert.match(runtime, /sender\?\.tab\?\.id !== currentTabId/, 'messages from other tabs never arm the grabber');
  assert.match(html, /id="grabLabel"/);
  // capturing hands focus to the note — the next step of the loop
  assert.match(runtime, /saveDraft\(\);\s*\n\s*note\.focus\(\);/);
  // a keyboard and a right-click both reach the panel
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.commands._execute_action.suggested_key.default, 'Alt+A');
  assert.ok(manifest.permissions.includes('contextMenus'));
  const background = await read('background.js');
  assert.match(background, /contextMenus\.create\(\{ id: 'annotated-capture-selection', title: 'Annotate “%s”', contexts: \['selection'\] \}\)/);
  assert.match(background, /chrome\.sidePanel\.open\(\{ tabId: tab\.id \}\)/, 'the context-menu click is the user gesture that opens the panel');
  assert.match(runtime, /ANNOTATED_GRAB_SELECTION/);
  assert.match(runtime, /const consumePendingGrab = /, 'a cold panel finds the stashed request at boot');
});

test('the panel moves on one clock: motion tokens and gated one-shot beats', async () => {
  const styles = await read('sidepanel.css');
  const runtime = await read('sidepanel.js');
  // one set of timing/easing tokens governs every animation
  for (const token of ['--t-press: 60ms', '--t-hover: 120ms', '--t-fade: 180ms', '--t-move: 240ms', '--e-enter: cubic-bezier(.2, .7, .3, 1)']) {
    assert.ok(styles.includes(token), `motion token missing: ${token}`);
  }
  // entrances are from-only keyframes on resting base states, so the global
  // reduced-motion kill makes elements simply appear — nothing parks invisible
  for (const keyframe of ['pane-in', 'underline-in', 'post-in', 'mark-flash', 'chip-tick', 'dot-retune', 'card-in', 'shot-develop']) {
    assert.ok(styles.includes(`@keyframes ${keyframe}`), `keyframe missing: ${keyframe}`);
  }
  // one-shot beats re-fire through the shared retrigger idiom
  assert.match(runtime, /const retrigger = \(element, className\)/);
  assert.match(runtime, /void element\.offsetWidth;/);
  assert.match(runtime, /retrigger\(boundary === 'in' \? markIn : markOut, 'just-set'\)/);
  assert.match(runtime, /retrigger\(durationChip, 'just-ticked'\)/);
  assert.match(runtime, /'is-retuned'/);
  // the stagger plays only on a feed's first paint, never on like re-renders
  assert.match(runtime, /let freshFeedTab = null;/);
  assert.match(runtime, /freshFeedTab = tab;/);
  assert.match(runtime, /timeline\.classList\.add\('is-fresh'\)/);
  // an optimistic like patches one button in place; only a failed round-trip rebuilds
  assert.match(runtime, /patchLikeButton\(like, !liked, entries\[0\]\.likes\);/);
  assert.match(runtime, /retrigger\(like, 'just-liked'\);/);
  assert.match(runtime, /renderTimeline\(\); \/\/ a failed round-trip earns the rebuild/);
  assert.match(styles, /@keyframes heart-press/);
  // the finishing beats: toast rises, doors close faster than they open,
  // the publish moment leaves with a breath and stands still under reduced motion
  assert.match(styles, /@keyframes toast-up/);
  assert.match(styles, /\.signin-veil\.is-closing \{ animation: veil-out var\(--t-hover\) var\(--e-exit\) forwards; \}/);
  assert.match(styles, /@keyframes modal-rise/);
  assert.match(styles, /\.pub-moment\.is-static \.ring, \.pub-moment\.is-static \.tick \{ stroke-dashoffset: 0; animation: none; \}/);
  assert.match(runtime, /moment\.className = reduced \? 'pub-moment is-static' : 'pub-moment';/);
  assert.match(runtime, /retrigger\(timeline\.querySelector\('\.post'\), 'just-published'\)/);
  assert.match(runtime, /timeline\.classList\.add\('is-inserting'\)/);
  assert.match(runtime, /publishButton\.classList\.add\('is-working'\)/);
  assert.match(styles, /\.publish:not\(\[disabled\]\):hover/);
});

test('the badge keeps its promise: the digest shows before the watermark moves', async () => {
  const runtime = await read('sidepanel.js');
  const html = await read('sidepanel.html');
  assert.match(html, /id="notifDigest" type="button" hidden/);
  assert.match(runtime, /const digest = await apiRequest\('\/api\/notifications'\);/);
  assert.match(runtime, /notifDigest\.hidden = false;/);
  // the digest renders BEFORE the seen POST in the same function
  const fn = runtime.match(/const markNotificationsSeen = [\s\S]*?\n\};/)[0];
  assert.ok(fn.indexOf('notifDigest.hidden = false') < fn.indexOf('/api/notifications/seen'), 'digest first, watermark second');
  assert.match(runtime, /responded to your annotation/);
  // offline recovers: backoff retries, online listener, chip retry, human copy
  assert.match(runtime, /const scheduleBackendRetry = /);
  assert.match(runtime, /Math\.min\(backendRetryDelay \* 2, 30000\)/);
  assert.match(runtime, /window\.addEventListener\('online'/);
  assert.match(runtime, /Can’t reach annotated right now — retrying quietly\. Captures queue locally\./);
  assert.doesNotMatch(runtime, /Check the extension API origin in settings\./, 'no developer-voiced dead ends');
  // feeds: warm caches revalidate in the background, appends never clobber
  assert.match(runtime, /background: Boolean\(feedCache\[mode\]\)/);
  assert.match(runtime, /if \(!background && !append\) \{/);
  assert.match(runtime, /params\.set\('cursor', feedCache\[tab\]\.nextCursor\)/);
  assert.match(runtime, /data-load-more>Load more</);
  // a clip mid-transcode explains itself
  assert.match(runtime, /\['queued', 'processing'\]\.includes\(item\.mediaStatus\)/);
  assert.match(runtime, /it appears here when ready/);
  // a background queue publish closes the loop instead of inviting a duplicate
  const background = await read('background.js');
  assert.match(background, /annotatedQueuePublished/);
  assert.match(runtime, /const consumeQueuePublished = /);
  assert.match(runtime, /Queued capture published/);
  // tab races: neutral reset, stale probes dropped, SPA url rebinds
  assert.match(runtime, /currentTab = \{ url: '', title: '', host: '', sourceType: 'article', duration: 0 \};/);
  assert.match(runtime, /if \(currentTabId !== tab\.id\) return; \/\/ a faster tab switch won the race/);
  assert.match(runtime, /if \(currentTab\.url !== url\) return;/);
  assert.match(runtime, /changeInfo\.status === 'complete' \|\| changeInfo\.url/);
  // voice notes are reviewable before publishing, and the cap warns first
  assert.match(html, /id="audioReview" type="button" hidden>Review take</);
  assert.match(runtime, /setReviewTake\(blob\); \/\/ hear it before you publish it/);
  assert.match(runtime, /URL\.revokeObjectURL\(reviewUrl\)/, 'takes are revoked, never leaked');
  assert.match(runtime, /s left — it stops itself at/);
  // honest edges: an uncapturable page hides the writing tools instead of
  // arming a composer that can only fail
  const styles = await read('sidepanel.css');
  assert.match(runtime, /captureSection\.classList\.toggle\('is-unsupported', known && !supported\)/);
  assert.match(styles, /\.capture\.is-unsupported \.livedot \{ background: var\(--meta\); \}/);
  assert.match(styles, /\.capture\.is-unsupported \.cap-foot/);
  assert.match(runtime, /This page can’t be annotated\./);
  // Esc clears but never destroys; Ctrl/Cmd+Z brings the capture back
  assert.match(runtime, /lastCleared = \{ kind: 'selection', value: selection \}/);
  assert.match(runtime, /lastCleared = \{ kind: 'marks', value: marks \}/);
  assert.match(runtime, /Selection cleared — Ctrl\/Cmd\+Z restores it/);
  assert.match(runtime, /Marks cleared — Ctrl\/Cmd\+Z restores them/);
  // the tablist speaks ARIA: roving tabindex, arrows walk and activate
  assert.match(runtime, /tabButton\.tabIndex = active \? 0 : -1;/);
  assert.match(runtime, /event\.key !== 'ArrowRight' && event\.key !== 'ArrowLeft'/);
  assert.match(runtime, /setPanelMode\(next\.dataset\.feedTab\);/);
  // the sign-in door holds focus while it is open
  assert.match(runtime, /signinVeil\.querySelectorAll\('button, a\[href\]'\)/);
});

test('the clip bay: the moment is drawn on the media’s own timeline', async () => {
  const runtime = await read('sidepanel.js');
  const html = await read('sidepanel.html');
  const styles = await read('sidepanel.css');
  // the band replaces the two-peer-button row: rail, selection, tail,
  // playhead, ceiling tick, and two slider handles that keep the old ids
  assert.match(html, /class="band" id="band"/);
  assert.match(html, /id="markIn"[^>]*role="slider"/);
  assert.match(html, /id="markOut"[^>]*role="slider"/);
  assert.doesNotMatch(html, /type="range"/, 'a custom control, never a native range');
  // the drag model is the shared core: boundary-aware, cap-clamping
  assert.match(runtime, /moveClipBoundary, normalizeClipRange \} from '\.\/clip-range\.js'/);
  assert.match(runtime, /moveClipBoundary\(marks\.start, marks\.end, boundary/);
  // the ceiling is geometry, not an alarm: no role="alert" block, the
  // clamp toast names the cap, the tick marks the wall
  assert.doesNotMatch(html, /overReason/);
  assert.match(runtime, /Capped at \$\{format\(MAX_CLIP_SECONDS\)\}/);
  assert.match(html, /id="bandCeiling"/);
  // law 4: the chip speaks range grammar, identical to the feed's
  assert.match(runtime, /`\$\{format\(marks\.start\)\}–\$\{format\(marks\.end\)\}`/);
  // retroactive capture: Last 30s button, L key, and out-first windows back
  assert.match(html, /id="bayLast30"/);
  assert.match(runtime, /const captureLastN = /);
  assert.match(runtime, /captureLastN\(30\)/);
  assert.match(runtime, /Start set 30s back — drag it to adjust/);
  // the page player is the preview monitor: live lease feed, seek on
  // handle release, and play-the-selection before publish
  assert.match(runtime, /function watchPlayerInPage\(untilMs\)/);
  assert.match(runtime, /window\.__annotatedFeedUntil/, 'the feed lease self-expires');
  assert.match(runtime, /ANNOTATED_PLAYER_TICK/);
  assert.match(runtime, /function seekPlayerInPage\(seconds\)/);
  assert.match(runtime, /async function previewRangeInPage\(startSeconds, endSeconds\)/);
  assert.match(runtime, /window\.__annotatedPreviewToken/, 'a newer preview supersedes a running one');
  assert.match(runtime, /Click the video once, then try again\./);
  // ticks from other tabs never move this band
  const tickBlock = runtime.slice(runtime.lastIndexOf("'ANNOTATED_PLAYER_TICK'"), runtime.lastIndexOf("'ANNOTATED_PLAYER_TICK'") + 200);
  assert.ok(tickBlock.includes('sender?.tab?.id !== currentTabId'), 'player ticks are tab-guarded');
  // typed times are a chosen path with a way back, not a failure state
  assert.match(html, /id="typeToggle"[^>]*>Type the times instead</);
  assert.match(html, /id="playerToggle"[^>]*>Read the player instead</);
  // format can say hours back — podcasts run long — and floors seconds
  assert.match(runtime, /\$\{hours\}:\$\{String\(mins\)\.padStart\(2, '0'\)\}/);
  // the moment wears the resolver's poster, and a dead image hides itself
  assert.match(runtime, /poster: source\.thumbnailUrl \|\| source\.imageUrl \|\| ''/);
  assert.match(runtime, /classList\?\.contains\('bay-poster'\)/);
  // the selection fill is law-1 accent; the playhead is ink
  assert.match(styles, /\.band-sel \{[^}]*background: var\(--accent\)/);
  assert.match(styles, /\.band-head \{[^}]*background: var\(--ink\)/);
});

test('details that read expensive: sources wear their faces', async () => {
  const runtime = await read('sidepanel.js');
  const html = await read('sidepanel.html');
  const manifest = JSON.parse(await read('manifest.json'));
  // favicons come from Chrome's local cache — a permission, not a network call
  assert.ok(manifest.permissions.includes('favicon'));
  assert.match(runtime, /chrome\.runtime\.getURL\('\/_favicon\/'\)/);
  assert.match(runtime, /url\.searchParams\.set\('pageUrl', pageUrl\)/);
  // every source line carries one: timeline cards and the live capture strip
  assert.match(runtime, /const favicon = faviconUrl\(item\.canonicalUrl \|\| item\.sourceUrl\)/);
  assert.match(html, /id="sourceFavicon"/);
  // a missing icon disappears instead of showing the broken-image glyph
  assert.match(runtime, /document\.addEventListener\('error'/);
  assert.match(runtime, /classList\?\.contains\('favicon'\)/);
  // the radius law the header comment promises — 3/6/8/99 (plus circles),
  // no stray 2/4/10/12px survivors
  const styles = await read('sidepanel.css');
  assert.doesNotMatch(styles, /border-radius: (?:2|4|10|12)px/);
  assert.doesNotMatch(styles, /border-radius: 0 10px/);
  // focus is ink everywhere, paper on the dark header — never the accent
  assert.match(styles, /:focus-visible \{ outline: 2px solid var\(--ink\)/);
  assert.match(styles, /\.phead :focus-visible \{ outline-color: #F5F4F0; \}/);
  // the scrollbar belongs to the design, and disabled controls all say so
  assert.match(styles, /::-webkit-scrollbar-thumb \{ background: var\(--border\); border-radius: 99px; \}/);
  assert.match(styles, /\.rec-button\[disabled\] \{ opacity: \.55; cursor: progress; \}/);
  // micro-copy: no transcode jargon in the panel, the chip says connected,
  // the hint speaks to the capture type and names the keyboard path
  assert.doesNotMatch(runtime, /240p/);
  assert.match(runtime, /textContent = 'connected'/);
  assert.match(runtime, /const defaultPublishHint = /);
  assert.match(runtime, /Highlights and snips stay right here\./);
  assert.match(runtime, /<kbd>Ctrl<\/kbd>\/<kbd>⌘<\/kbd> <kbd>Enter<\/kbd>/);
  // a panel left open keeps telling the truth: times re-derive from stamps
  assert.match(runtime, /data-created=/);
  assert.match(runtime, /\.posttime\[data-created\]/);
  // the avatar is a menu, not a sign-out landmine: profile, settings, then
  // sign out — with real menu semantics (aria-haspopup, arrows, Esc)
  assert.match(html, /id="meButton"[^>]*aria-haspopup="menu"/);
  assert.match(html, /id="meMenu" role="menu"/);
  assert.ok(html.indexOf('id="menuProfile"') < html.indexOf('id="menuSignOut"'), 'sign out comes last');
  assert.match(runtime, /chrome\.runtime\.openOptionsPage\?\.\(\)/);
  assert.match(runtime, /\/u\/\$\{encodeURIComponent\(handle\)\}/);
  assert.match(runtime, /const setMenuOpen = /);
  assert.match(runtime, /setMenuOpen\(false\); meButton\.focus\(\);/);
  // the settings page is the same product: shared palette, no second
  // terracotta, and Save actually checks the origin answers as annotated
  const optionsStyles = await read('options.css');
  assert.match(optionsStyles, /--accent: #B0674D/);
  assert.match(optionsStyles, /--paper: #F5F4F0/);
  assert.doesNotMatch(optionsStyles, /#c15a45|#174f68/i, 'the old second-product palette is gone');
  assert.match(optionsStyles, /:focus-visible \{ outline: 2px solid var\(--ink\)/);
  const options = await read('options.js');
  assert.match(options, /const verifyConnection = /);
  assert.match(options, /Connected ✓ — this origin answers as annotated\./);
  assert.match(options, /chrome\.runtime\.getManifest\(\)\.version/);
  // the snip you took can be verified at full size — preview and timeline
  // screenshots open a veil with the standard exits (click, button, Esc)
  assert.match(html, /id="shotVeil" role="dialog" aria-modal="true"/);
  assert.match(runtime, /openShotVeil\(shotPreview\.src, shotPreview\)/);
  assert.match(runtime, /closest\('\.srcmedia img'\)/);
  assert.match(runtime, /shotVeilImg\.removeAttribute\('src'\)/, 'the veil forgets the image when closed');
  assert.match(styles, /\.shot-preview, \.srcmedia img \{ cursor: zoom-in; \}/);
  assert.match(styles, /\.shot-veil\.is-closing \{ animation: veil-out var\(--t-hover\) var\(--e-exit\) forwards; \}/);
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
