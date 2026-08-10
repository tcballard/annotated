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
  assert.equal(manifest.minimum_chrome_version, '116');
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
  // global mark keys: read at keypress time in the background, while the
  // PAGE has focus — the panel-document keys were a promise the panel
  // could not keep on its own
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.commands['mark-in'].suggested_key.default, 'Alt+I');
  assert.equal(manifest.commands['mark-out'].suggested_key.default, 'Alt+O');
  assert.equal(manifest.commands['clip-last-30'].suggested_key.default, 'Alt+L');
  const background = await read('background.js');
  assert.match(background, /chrome\.commands\?\.onCommand\.addListener/);
  // the gesture window: open the panel before any await in the listener
  const onCommand = background.slice(background.indexOf('onCommand.addListener'));
  assert.ok(onCommand.indexOf('chrome.sidePanel.open') < onCommand.indexOf('await '), 'sidePanel.open fires before the first await, inside the gesture');
  assert.match(background, /annotatedPendingMark/);
  assert.match(runtime, /const applyGlobalMark = /);
  assert.match(runtime, /const consumePendingMark = /);
  assert.match(runtime, /ANNOTATED_MARK/);
});

test('nothing survives a navigation it does not belong to', async () => {
  const runtime = await read('sidepanel.js');
  // a new URL in the same tab is a new source: the rebind guard includes it
  assert.match(runtime, /const changed = tab\.id !== currentTabId \|\| url !== currentTab\.url;/);
  // the draft debounce snapshots its tab and payload at schedule time
  const save = runtime.slice(runtime.indexOf('const saveDraft'), runtime.indexOf('const restoreDraft'));
  assert.match(save, /const tabId = currentTabId;\s*\n\s*const payload = draftPayload\(\);/);
  assert.match(save, /saveTabDraft\(tabId, payload\)/);
  // background tabs never drive the panel
  assert.match(runtime, /if \(Number\.isInteger\(currentTabId\) && tabId !== currentTabId\) return;/);
  // a hand on the type dial outranks every probe until the page changes
  assert.match(runtime, /typeOverridden = true;/);
  assert.match(runtime, /if \(!typeOverridden\) currentTab\.sourceType = await detectSourceType/);
  assert.match(runtime, /resolvedSource\.sourceType && !typeOverridden/);
  // a mark probe that returns after a tab switch is discarded
  assert.match(runtime, /if \(tabId !== currentTabId\) return; \/\/ a tab switch mid-probe wins/);
});

test('the probe finds the player you are watching, and refuses poisoned clocks', async () => {
  const runtime = await read('sidepanel.js');
  const background = await read('background.js');
  // every frame is searched — an embedded player is a first-class citizen
  assert.match(runtime, /target: \{ tabId: currentTabId, allFrames: true \}/);
  assert.match(background, /target: \{ tabId, allFrames: true \}/);
  // the scoring cascade: PiP > playing > unmuted > has-progress > on-screen
  assert.match(runtime, /function readPlayersInPage\(\)/);
  assert.match(runtime, /pictureInPictureElement \? 1e9/);
  assert.match(runtime, /el\.shadowRoot\) collect\(el\.shadowRoot, out\)/);
  // live/DVR timelines don't start at zero
  assert.match(runtime, /seekable\.start\(0\)/);
  // an ad's clock is refused, not silently trusted — in the panel AND
  // for global marks read in the background
  assert.match(runtime, /An ad is playing — mark once the video resumes\./);
  assert.match(runtime, /adShowing\) \{ showToast\('An ad is playing/);
  assert.match(background, /adShowing: Boolean\(yt/);
  // blocked injection is a different truth than "no player here"
  assert.match(runtime, /return \{ blocked: true \};/);
  assert.match(runtime, /doesn’t allow reading its player/);
  // the winning frame is remembered; seek, preview, and the lease target it
  assert.match(runtime, /let playerFrameId = 0;/);
  assert.match(runtime, /frameIds: \[playerFrameId\]/);
  // the mark lands where the person meant: half the round trip walked back
  assert.match(runtime, /\(rtt \/ 2\) \* \(player\.rate \|\| 1\)/);
});

test('the panel keeps its hands clean: gestures, stashes, listeners, takes', async () => {
  const runtime = await read('sidepanel.js');
  const background = await read('background.js');
  // the context-menu gesture is spent by the first await, so open first
  const menu = background.slice(background.indexOf("info.menuItemId !== 'annotated-capture-selection'"));
  assert.ok(menu.indexOf('chrome.sidePanel.open') < menu.indexOf('await '), 'sidePanel.open runs inside the gesture, before any await');
  // the warm path clears the stash the cold path would have consumed
  assert.match(runtime, /remove\('annotatedPendingGrab'\)[\s\S]{0,80}captureSelection\(\)/);
  // the injected selection watcher outlives the panel — its send must not
  // reject onto the page's console
  assert.match(runtime, /ANNOTATED_SELECTION', preview: text\.slice\(0, 80\) \}\)\.catch\(\(\) => \{\}\)/);
  // a self-ending recorder clears its own ticker, and a stale take never
  // stamps its length onto the tab the panel moved to
  const stop = runtime.slice(runtime.indexOf("recorder.addEventListener('stop'"));
  assert.ok(stop.indexOf('clearInterval(recordingTimer)') < stop.indexOf('recordingStream?.getTracks'), 'the stop handler clears the ticker first');
  assert.ok(stop.indexOf('token !== recordingToken') < stop.indexOf('audioDurationSeconds = clampAudioDuration'), 'the staleness guard precedes the duration write');
  // the mic is requested before the previous take is destroyed
  const start = runtime.slice(runtime.indexOf('const startAudioRecording'));
  assert.ok(start.indexOf('getUserMedia({ audio: true })') < start.indexOf('deleteAudioDraft'), 'permission first, deletion second');
  // the queue backs off instead of burning eight attempts in eight minutes
  assert.match(background, /Math\.min\(2 \*\* \(capture\.attempts \|\| 0\), 128\) \* 60_000/);
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
  // the preview is a button wrapping the image, so the veil's focus returns
  // to something focusable and the keyboard can open it at all
  assert.match(runtime, /shotPreviewOpen\.addEventListener\('click', \(\) => openShotVeil\(shotPreview\.src, shotPreviewOpen\)\)/);
  assert.match(runtime, /closest\('\.srcmedia img'\)/);
  assert.match(runtime, /shotVeilImg\.removeAttribute\('src'\)/, 'the veil forgets the image when closed');
  assert.match(styles, /\.shot-preview-open, \.srcmedia img \{ cursor: zoom-in; \}/);
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
  const listing = await readFile(path.join(projectRoot, 'docs', 'CHROMEWEBSTORE.md'), 'utf8');
  const release = await readFile(path.join(projectRoot, 'docs', 'RELEASE.md'), 'utf8');
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

// ── H: the panel's word is worth what its code does ──────────────────────

test('nothing is injected and no URL is resolved while you are reading a feed', async () => {
  const panel = await read('sidepanel.js');
  // The listing promises the current tab's address leaves the browser only
  // while the Capture surface is open. That was a claim about intent, not a
  // property of the code — loadCurrentTab ran on every tab change regardless
  // of which tab you were on. Each of these three is the gate.
  const loader = panel.slice(panel.indexOf('const loadCurrentTab'), panel.indexOf('const setPanelMode'));
  const gated = [...loader.matchAll(/panelMode === 'capture'/g)];
  assert.ok(gated.length >= 4, `expected the type probe, the media read, the selection watcher and the resolver to be gated; found ${gated.length}`);
  assert.match(loader, /if \(panelMode === 'capture'\) void installSelectionWatcher/, 'the selection watcher is an injection');
  assert.match(loader, /panelMode === 'capture' && isMediaType\(\)/, 'the media read is an injection');
  assert.match(loader, /backendOnline && panelMode === 'capture' && \/\^https\?:\/\.test\(url\)/, 'the resolver is the network call the listing describes');
  // the fourth one is easy to miss: classifying an unknown host falls back to
  // reading its og:type, which is an injection like any other
  assert.match(loader, /detectSourceType\(tab\.id, url, \{ probe: panelMode === 'capture' \}\)/);
  assert.match(panel, /const detectSourceType = async \(tabId, url, \{ probe = true \} = \{\}\) => classifyByUrl\(url\) \|\| \(probe \? await probeTabForType\(tabId\) : 'article'\)/);

  // …and the gate must not simply lose the source: arriving at the desk is
  // when the work happens instead.
  assert.match(panel, /const enteringCapture = mode === 'capture' && panelMode !== 'capture'/);
  assert.match(panel, /if \(enteringCapture && !resolvedSource\) void loadCurrentTab\(\)/);
});

test('the store listing and the options page describe that gate, not a softer one', async () => {
  const [listing, options] = await Promise.all([
    readFile(new URL('../docs/CHROMEWEBSTORE.md', import.meta.url), 'utf8'),
    read('options.html'),
  ]);
  for (const [name, text] of [['CHROMEWEBSTORE.md', listing], ['options.html', options]]) {
    assert.match(text, /while the Capture surface is open/i, `${name} must scope the resolve call to the capture surface`);
  }
  // the honest version names the two automatic injections rather than
  // implying every injection follows a click
  assert.match(listing, /Two injections are automatic there/);
  assert.match(listing, /Nothing is injected while you are reading a feed/);
});

test('the panel exposes tabs, panels and status to a screen reader', async () => {
  const html = await read('sidepanel.html');
  const panel = await read('sidepanel.js');

  // every tab points at the panel it actually controls
  for (const [id, controls] of [['capture', 'captureSection'], ['recent', 'timeline'], ['following', 'timeline'], ['page', 'timeline']]) {
    assert.match(html, new RegExp(`id="tab-${id}"[^>]*role="tab"[^>]*aria-controls="${controls}"`), `tab-${id} must control ${controls}`);
  }
  assert.match(html, /id="captureSection" role="tabpanel" aria-labelledby="tab-capture" tabindex="0"/);
  assert.match(html, /id="timeline" role="tabpanel" tabindex="0"/);
  // one panel, three tabs — so its label has to follow the active one
  assert.match(panel, /timeline\.setAttribute\('aria-labelledby', `tab-\$\{panelMode\}`\)/);

  // A live region around the whole feed re-announced every row on every
  // render. The feed is now silent and a status node says what changed.
  assert.doesNotMatch(html, /id="timeline"[^>]*aria-live/, 'the feed itself must not be a live region');
  assert.match(html, /id="timelineState"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(panel, /const announceTimeline = \(\)/);
  assert.match(panel, /announceTimeline\(\)/);

  // controls that only responded to a mouse are real buttons now
  assert.match(html, /<button class="backend" id="backendStatus" type="button"/);
  assert.match(html, /id="backendState" role="status"/);
  assert.match(html, /id="shotPreviewOpen"[^>]*type="button"/);
});

test('the identity chip is legible on both schemes, on both surfaces', async () => {
  // #B0674D is the moment's colour, not a text colour: as chip type it
  // measured 3.81:1 on paper and 2.37:1 on the dark card. --accent-ink is
  // the same hue moved until it passes AA — 5.52:1 and 4.77:1.
  for (const file of ['../src/styles.css', '../extension/sidepanel.css']) {
    const css = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(css, /--accent-ink: #8F5039/);
    assert.match(css, /--accent-ink: #E0A48E/);
  }
  // and the connection dot is a state, not a moment, so it left the ramp
  const sidepanelCss = await read('sidepanel.css');
  assert.match(sidepanelCss, /\.backend\.is-live i \{ background: #B9BEC6; \}/);
});

test('the panel opens with one round-trip, not two', async () => {
  const panel = await read('sidepanel.js');
  // checkBackend's recovery branch fires when the backend comes back from an
  // outage. Booting is not that: with backendOnline starting at false, the
  // first successful check looked like a recovery and fired a second
  // concurrent resolve of the same tab alongside the boot sequence's own.
  assert.match(panel, /let backendOnline = null;/, 'null means "not asked yet", distinct from "asked and down"');
  assert.match(panel, /const wasOnline = backendOnline;/);
  assert.match(panel, /if \(wasOnline === false\) \{/, 'recovery keys on a known-offline state, not a falsy one');
  // and every other read of it stays a plain boolean test
  assert.doesNotMatch(panel, /backendOnline === true|backendOnline == /);
});

test('the timeline status node describes every state the feed lands in', async () => {
  const panel = await read('sidepanel.js');
  // announceTimeline used to be called from the one branch that had items,
  // so an empty or failed feed left the node holding a stale count — or, on
  // first load, nothing at all.
  const render = panel.slice(panel.indexOf('const renderTimeline'), panel.indexOf('const patchLikeButton'));
  assert.match(render, /paintTimeline\(\);/);
  assert.match(render, /announceTimeline\(\);/);
  const paint = panel.slice(panel.indexOf('const paintTimeline'), panel.indexOf('const renderTimeline'));
  assert.doesNotMatch(paint, /announceTimeline\(/, 'the paint must not announce from inside a branch');
  // every state the paint can render has a sentence
  const announce = panel.slice(panel.indexOf('const announceTimeline'), panel.indexOf('const paintTimeline'));
  for (const phrase of ['Loading the timeline', 'Sign in to see', 'You’re offline', 'could not be loaded', 'Nothing here yet']) {
    assert.ok(announce.includes(phrase), `announceTimeline is missing the "${phrase}" state`);
  }
});
