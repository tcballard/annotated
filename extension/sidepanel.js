import { extensionStorage, PENDING_KEY } from './storage.js';
import { apiOrigin, authHeaders, signIn, signOut } from './config.js';
import { clampAudioDuration, MAX_AUDIO_SECONDS, preferredAudioMimeType } from './audio.js';
import { deleteAudioDraft, readAudioDraft, stageAudioDraft } from './media-draft-store.js';
import { MAX_CLIP_SECONDS, moveClipBoundary, normalizeClipRange } from './clip-range.js';
import { isTopic, TOPICS } from './topics.js';
import { openOriginalHref, openOriginalLabel } from './deep-link.js';
import { avatarColor, avatarInitial } from './avatar.js';

const $ = (selector) => document.querySelector(selector);

const sourceTitle = $('#sourceTitle');
const sourceFavicon = $('#sourceFavicon');
const typeSelect = $('#typeSelect');
const capUnsupported = $('#capUnsupported');
const mediaSelection = $('#mediaSelection');
const textSelection = $('#textSelection');
const markIn = $('#markIn');
const markOut = $('#markOut');
const durationChip = $('#durationChip');
const bayNote = $('#bayNote');
const bayTotal = $('#bayTotal');
const band = $('#band');
const bandSel = $('#bandSel');
const bandTail = $('#bandTail');
const bandHead = $('#bandHead');
const bandCeiling = $('#bandCeiling');
const bayMoment = $('#bayMoment');
const bayPoster = $('#bayPoster');
const bayMeta = $('#bayMeta');
const bayPrimary = $('#bayPrimary');
const bayPrimaryLabel = $('#bayPrimaryLabel');
const bayPrimaryKey = $('#bayPrimaryKey');
const bayLast30 = $('#bayLast30');
const bayClear = $('#bayClear');
const typeToggle = $('#typeToggle');
const playerToggle = $('#playerToggle');
const bayFoot = document.querySelector('.bay-foot');
const manualMarks = $('#manualMarks');
const manualIn = $('#manualIn');
const manualOut = $('#manualOut');
const grabSelection = $('#grabSelection');
const passageCard = $('#passageCard');
const passageChip = $('#passageChip');
const passageText = $('#passageText');
const passageClear = $('#passageClear');
const note = $('#note');
const noteCount = $('#noteCount');
const audioComposer = $('#audioComposer');
const audioRecord = $('#audioRecord');
const audioStatus = $('#audioStatus');
const audioHint = $('#audioHint');
const audioDurationEl = $('#audioDuration');
const audioRetry = $('#audioRetry');
const recordIcon = document.querySelector('.record-icon');
const stopIcon = document.querySelector('.stop-icon');
const publishButton = $('#publish');
const publishHint = $('#publishHint');
const error = $('#error');
const backendStatus = $('#backendStatus');
const authActions = $('#authActions');
const signInOpen = $('#signInOpen');
const signinVeil = $('#signinVeil');
const signinCancel = $('#signinCancel');
const meButton = $('#meButton');
const meMenu = $('#meMenu');
const meName = $('#meName');
const queueStatus = $('#queueStatus');
const queueStatusTitle = $('#queueStatusTitle');
const queueStatusDetail = $('#queueStatusDetail');
const queueRetry = $('#queueRetry');
const timeline = $('#timeline');
const captureSection = $('#captureSection');
const visibilitySelect = $('#visibilitySelect');
const topicSelect = $('#topicSelect');
const shotButton = $('#shotButton');
const shotCard = $('#shotCard');
const shotPreview = $('#shotPreview');
const shotClear = $('#shotClear');
const shotVeil = $('#shotVeil');
const shotVeilImg = $('#shotVeilImg');
const shotVeilClose = $('#shotVeilClose');
const toast = $('#toast');
const toastText = $('#toastText');
const toastLink = $('#toastLink');

let backendOnline = false;
let availableProviders = {};
let panelUser = null;
let currentTabId = null;
let currentTab = { url: '', title: 'Reading this tab…', host: '', sourceType: 'article', duration: 0 };
let resolvedSource = null;
let selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
let marks = { start: 0, end: 0, inSet: false, outSet: false };
let manualMode = false;
let playhead = { time: 0, duration: 0, paused: true, adShowing: false, at: 0 };
let commentaryMode = 'text';
let visibility = 'public';
let topic = '';
let screenshotAssetId = '';
let screenshotPreviewUrl = '';
let apiOriginCache = '';
let audioAssetId = '';
let audioDurationSeconds = 0;
let audioDraftId = '';
let mediaRecorder;
let recordingStream;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingTimer;
let recordingToken = 0;
let audioUploadInFlight = false;
let clientRequestId = crypto.randomUUID();
let draftReady = false;
let draftSaveTimer;
let toastTimer;
// The panel is modal: you are either writing the margin (capture) or reading
// it (a timeline). Capture is the default so the sidebar stays the primary
// capture surface; each mode gets the full panel height.
let panelMode = 'capture';
let freshFeedTab = null;
let lastCleared = null;
const feedCache = { recent: null, following: null, page: null };

// Hours matter: podcasts run long, and parseTimeInput already accepts
// 1:02:05 — format must be able to say it back. Seconds floor, never
// round, so 59.6 can't become ":60".
const format = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
};

const escapeHTML = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const relTime = (iso) => {
  const stamp = Date.parse(iso || '');
  if (!Number.isFinite(stamp)) return 'just now';
  const seconds = Math.max(0, (Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Chrome keeps a favicon cache for every page you visit; the _favicon
// endpoint reads it locally — no network, no tracking — so every source
// in the margin can wear its site's face.
const faviconUrl = (pageUrl) => {
  try {
    if (!chrome.runtime?.getURL || !/^https?:/.test(pageUrl || '')) return '';
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '16');
    return url.href;
  } catch {
    return '';
  }
};

// A site without a cached icon fails the img load; it disappears instead
// of showing the broken-image glyph. Capture phase — error does not bubble.
document.addEventListener('error', (event) => {
  if (event.target?.classList?.contains('favicon') || event.target?.classList?.contains('bay-poster')) event.target.hidden = true;
}, true);

// A panel left open keeps telling the truth: relative times re-derive
// from their stamps every half-minute, so "just now" grows up.
setInterval(() => {
  document.querySelectorAll('.posttime[data-created]').forEach((el) => {
    const fresh = relTime(el.dataset.created);
    if (el.textContent !== fresh) el.textContent = fresh;
  });
}, 30_000);

// Accepts "62" or "1:02" and returns whole seconds.
const parseTimeInput = (value) => {
  const text = String(value ?? '').trim();
  if (!text || !/^\d+(?::[0-5]?\d){0,2}$/.test(text)) return null;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

const showError = (message) => {
  error.textContent = message;
  error.hidden = false;
};

const clearError = () => {
  error.hidden = true;
  error.textContent = '';
};

const showToast = (message, link = null) => {
  toastText.textContent = message;
  if (link) {
    toastLink.href = link.href;
    toastLink.textContent = link.label;
    toastLink.hidden = false;
  } else {
    toastLink.hidden = true;
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, link ? 6000 : 2800);
};

// The panel is where desktop publishing happens — it gets the full moment,
// same anatomy as the web: the ring draws closed over the panel while the
// fresh note is already waiting on This page underneath. The toast (with its
// View page link) is revealed when the moment steps aside.
let publishMomentTimer;
const dismissPublishMoment = () => {
  clearTimeout(publishMomentTimer);
  const moment = document.querySelector('.pub-moment');
  if (!moment || moment.classList.contains('is-leaving')) return;
  const finish = () => {
    moment.remove();
    // the fresh note underneath wears the celebration's tail — a soft wash
    if (panelMode === 'page') retrigger(timeline.querySelector('.post'), 'just-published');
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  moment.classList.add('is-leaving');
  setTimeout(finish, 160);
};

const showPublishMoment = (title) => {
  // Reduced motion gets the same confirmation, standing still: ring and tick
  // pre-drawn, no choreography — not the silence it used to get.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  dismissPublishMoment();
  const moment = document.createElement('div');
  moment.className = reduced ? 'pub-moment is-static' : 'pub-moment';
  moment.setAttribute('role', 'status');
  moment.title = 'Continue';
  moment.innerHTML = `
    <svg class="pub-check" viewBox="0 0 80 80" aria-hidden="true"><circle class="ring" cx="40" cy="40" r="37"/><path class="tick" d="m25 42 10 11 21-25"/></svg>
    <h2>Published<span class="dot">.</span></h2>
    <div class="pub-title"></div>
    <div class="pub-hint">This moment now has a page — with the source attached.</div>`;
  moment.querySelector('.pub-title').textContent = title || 'This moment';
  moment.addEventListener('click', dismissPublishMoment);
  document.body.append(moment);
  publishMomentTimer = setTimeout(dismissPublishMoment, 1600);
};

/* ── source detection ──────────────────────────────────────────────── */

const classifyByUrl = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('youtube') || host === 'youtu.be' || host.includes('vimeo') || host.includes('twitch')) return 'video';
    if (host.includes('podcast') || host.includes('spotify') || host.includes('overcast') || host.includes('soundcloud') || host.includes('pocketcasts')) return 'podcast';
    if (/\.(mp4|webm|mov)(?:$|\?)/i.test(url)) return 'video';
    if (/\.(mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i.test(url)) return 'podcast';
  } catch { /* restricted or empty tab */ }
  return '';
};

const probeTabForType = async (tabId) => {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        hasVideo: Boolean(document.querySelector('video')),
        hasAudio: Boolean(document.querySelector('audio')),
        ogType: document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '',
        hasArticle: Boolean(document.querySelector('article')),
      }),
    });
    const probe = result?.[0]?.result;
    if (!probe) return 'article';
    if (probe.hasVideo || /video/i.test(probe.ogType)) return 'video';
    if (probe.hasAudio) return 'podcast';
    return 'article';
  } catch {
    return 'article';
  }
};

// Detection cascade: URL/host pattern → in-page media probe → article.
const detectSourceType = async (tabId, url) => classifyByUrl(url) || await probeTabForType(tabId);

const readPlayerTime = async () => {
  if (!Number.isInteger(currentTabId)) return null;
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => {
        const players = [...document.querySelectorAll('video, audio')];
        if (!players.length) return null;
        const active = players.find((el) => !el.paused && !el.ended)
          || players.find((el) => el.currentTime > 0)
          || players[0];
        return {
          time: Math.max(0, Math.floor(active.currentTime || 0)),
          duration: Number.isFinite(active.duration) ? Math.floor(active.duration) : 0,
        };
      },
    });
    return result?.[0]?.result || null;
  } catch {
    return null;
  }
};

// Injected: a lease-based playhead feed. The panel extends the lease
// every ~2s; a closed panel simply lets it lapse, so there is nothing
// to tear down. Self-guarded and self-contained (no closures).
function watchPlayerInPage(untilMs) {
  window.__annotatedFeedUntil = untilMs;
  if (window.__annotatedFeedTimer) return true;
  const read = () => {
    const players = [...document.querySelectorAll('video, audio')];
    if (!players.length) return null;
    const active = players.find((el) => !el.paused && !el.ended)
      || players.find((el) => el.currentTime > 0)
      || players[0];
    const yt = document.querySelector('#movie_player');
    return {
      time: Math.max(0, active.currentTime || 0),
      duration: Number.isFinite(active.duration) ? Math.floor(active.duration) : 0,
      paused: Boolean(active.paused),
      adShowing: Boolean(yt && (yt.classList.contains('ad-showing') || yt.classList.contains('ad-interrupting'))),
    };
  };
  window.__annotatedFeedTimer = setInterval(() => {
    if (Date.now() > window.__annotatedFeedUntil) {
      clearInterval(window.__annotatedFeedTimer);
      window.__annotatedFeedTimer = 0;
      return;
    }
    const player = read();
    if (!player) return;
    try { chrome.runtime.sendMessage({ type: 'ANNOTATED_PLAYER_TICK', player }).catch(() => {}); }
    catch { /* extension reloaded — the lease will lapse */ }
  }, 250);
  return true;
}

// Injected: seek the page's player. Setting currentTime is enough — the
// page's own timeupdate handlers resync its scrubber.
function seekPlayerInPage(seconds) {
  const players = [...document.querySelectorAll('video, audio')];
  if (!players.length) return false;
  const active = players.find((el) => !el.paused && !el.ended)
    || players.find((el) => el.currentTime > 0)
    || players[0];
  active.currentTime = seconds;
  return true;
}

// Injected: play exactly the selection — seek to in, play, pause at out.
// Token-guarded so a newer preview supersedes a running one.
async function previewRangeInPage(startSeconds, endSeconds) {
  const players = [...document.querySelectorAll('video, audio')];
  if (!players.length) return { ok: false, reason: 'no-player' };
  const el = players.find((p) => !p.paused && !p.ended)
    || players.find((p) => p.currentTime > 0)
    || players[0];
  const token = (window.__annotatedPreviewToken = (window.__annotatedPreviewToken || 0) + 1);
  const tick = () => {
    if (token !== window.__annotatedPreviewToken) { el.removeEventListener('timeupdate', tick); return; }
    if (el.currentTime >= endSeconds) {
      el.removeEventListener('timeupdate', tick);
      el.pause();
    }
  };
  el.currentTime = startSeconds;
  el.addEventListener('timeupdate', tick);
  const outcome = await el.play().catch(() => 'blocked');
  if (outcome === 'blocked' && el.paused) {
    el.removeEventListener('timeupdate', tick);
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
}

const seekPlayer = async (seconds) => {
  if (!Number.isInteger(currentTabId)) return;
  await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: seekPlayerInPage, args: [seconds] }).catch(() => {});
};

const playSelection = async () => {
  if (!(marks.inSet && marks.outSet) || !Number.isInteger(currentTabId)) return;
  const results = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: previewRangeInPage, args: [marks.start, marks.end] }).catch(() => null);
  const outcome = results?.[0]?.result;
  if (!outcome?.ok) showToast(outcome?.reason === 'blocked' ? 'Click the video once, then try again.' : 'No player found on this tab.');
};

const readPageSelection = async () => {
  if (!Number.isInteger(currentTabId)) return { text: '' };
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => {
        const sel = window.getSelection();
        const text = String(sel?.toString() || '').trim();
        if (!text) return { text: '' };
        let node = sel.anchorNode;
        while (node && node.nodeType !== 1) node = node.parentNode;
        const element = node && node.closest ? node : document.body;
        const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6') || element;
        const paragraphs = [...document.querySelectorAll('p')];
        const index = paragraphs.indexOf(block.closest ? (block.closest('p') || block) : block);
        const context = String(block.textContent || '').replace(/\s+/g, ' ');
        const compact = text.replace(/\s+/g, ' ');
        const at = context.indexOf(compact);
        return {
          text: text.slice(0, 2000),
          paragraph: index >= 0 ? index + 1 : 0,
          prefix: at > 0 ? context.slice(Math.max(0, at - 40), at).trim() : '',
          suffix: at >= 0 ? context.slice(at + compact.length, at + compact.length + 40).trim() : '',
        };
      },
    });
    return result?.[0]?.result || { text: '' };
  } catch {
    return { text: '' };
  }
};

/* ── API plumbing ──────────────────────────────────────────────────── */

const apiRequest = async (path, options = {}) => {
  let response;
  // A hanging origin must fail into the styled offline state, not park the
  // panel on "connecting" at the browser's mercy.
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 8000);
  try {
    response = await fetch(`${await apiOrigin()}${path}`, { credentials: 'omit', signal: timeoutController.signal, headers: { 'content-type': 'application/json', ...(await authHeaders()), ...(options.headers || {}) }, ...options });
  } catch (requestError) {
    requestError.retryable = true;
    throw requestError;
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(body.errors?.join(' ') || body.error || `Request failed (${response.status}).`);
    requestError.status = response.status;
    requestError.retryable = response.status >= 500 || response.status === 429;
    if (response.status === 401) {
      requestError.authRequired = true;
      await extensionStorage.clearAuthSession().catch(() => {});
    }
    throw requestError;
  }
  return body;
};

const uploadAudioRequest = async (blob) => {
  let response;
  try {
    response = await fetch(`${await apiOrigin()}/api/media/audio`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': blob.type || 'audio/webm', ...(await authHeaders()) },
      body: blob,
    });
  } catch (requestError) {
    requestError.retryable = true;
    throw requestError;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(body.errors?.join(' ') || body.error || `Audio upload failed (${response.status}).`);
    requestError.status = response.status;
    requestError.retryable = response.status >= 500 || response.status === 429;
    if (response.status === 401) {
      requestError.authRequired = true;
      await extensionStorage.clearAuthSession().catch(() => {});
    }
    throw requestError;
  }
  return body;
};

const resolveSourceUrl = async (url, fallbackTitle = '') => {
  const { source } = await apiRequest('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) });
  return {
    url: source.canonicalUrl || source.sourceUrl || url,
    title: source.title || fallbackTitle || source.host || 'Untitled source',
    host: source.host || '',
    sourceType: source.sourceType || '',
    duration: Math.max(0, Number(source.duration) || 0),
    excerpt: source.excerpt || '',
    mediaUrl: source.mediaUrl || '',
    provider: source.provider || '',
    poster: source.thumbnailUrl || source.imageUrl || '',
  };
};

const recordOpen = async (slug) => {
  if (!slug || !backendOnline) return;
  try {
    await fetch(`${await apiOrigin()}/api/annotations/${encodeURIComponent(slug)}/open`, { method: 'POST', credentials: 'omit', keepalive: true });
  } catch { /* the open still happens; the count is best-effort */ }
};

/* ── capture state ─────────────────────────────────────────────────── */

const isMediaType = () => currentTab.sourceType !== 'article';

const publishBlocker = () => {
  let protocol = '';
  try { protocol = new URL(currentTab.url).protocol; } catch { /* invalid source */ }
  if (!['http:', 'https:'].includes(protocol)) return 'This tab has no publishable http(s) source.';
  // The selection can be a passage, a marked range, or a screenshot.
  if (currentTab.sourceType === 'article' && !selection.text.trim() && !screenshotAssetId) return 'Highlight a passage or screenshot the page.';
  if (isMediaType() && !screenshotAssetId && (!marks.inSet || !marks.outSet)) return 'Mark an in and an out point, or screenshot the page.';
  if (isMediaType() && marks.inSet && marks.outSet && marks.end - marks.start < 1) return 'The out mark must come after the in mark.';
  if (isMediaType() && marks.end - marks.start > MAX_CLIP_SECONDS) return `Clips are capped at ${format(MAX_CLIP_SECONDS)}. Shorten the selection.`;
  if (commentaryMode === 'text' && !note.value.trim()) return 'Add a note before publishing.';
  if (commentaryMode === 'audio' && mediaRecorder?.state === 'recording') return 'Stop the recording before publishing.';
  if (commentaryMode === 'audio' && audioUploadInFlight) return 'The audio note is still uploading.';
  if (commentaryMode === 'audio' && !audioAssetId && !audioDraftId) return 'Record your audio note first.';
  return '';
};

// The resting hint speaks to the capture you are actually making, and
// names the keyboard path once the mouse path is obvious.
const defaultPublishHint = () => `${isMediaType() ? 'Marks follow the player.' : 'Highlights and snips stay right here.'} Nothing is published until you publish — <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>Enter</kbd> when ready.`;

const syncPublishGate = () => {
  const blocker = publishBlocker();
  publishButton.disabled = Boolean(blocker);
  if (blocker) publishHint.textContent = blocker;
  else publishHint.innerHTML = defaultPublishHint();
};

// Re-fires a one-shot animation class even when it is already present.
// Under reduced motion the class is inert, so no guard is needed.
const retrigger = (element, className) => {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
};

// The band's scale: the full runtime when known, else enough to hold
// everything visible — never less than one cap-width, so early marks
// don't smear across the whole rail.
const bandScale = () => Math.max(
  currentTab.duration || 0,
  playhead.duration || 0,
  marks.end,
  marks.inSet ? marks.start + MAX_CLIP_SECONDS : 0,
  playhead.time,
  MAX_CLIP_SECONDS,
);

const bandPct = (seconds) => `${Math.min(100, Math.max(0, (seconds / bandScale()) * 100))}%`;

// The ceiling is enforced by geometry: a range can exist, but never a
// range longer than the cap. normalizeClipRange clamps the end down.
const clampMarks = () => {
  if (!(marks.inSet && marks.outSet)) return;
  const wasOver = marks.end - marks.start > MAX_CLIP_SECONDS;
  const safe = normalizeClipRange(marks.start, marks.end, { max: bandScale(), maxDuration: MAX_CLIP_SECONDS });
  marks.start = safe.start;
  marks.end = safe.end;
  if (wasOver) showToast(`Capped at ${format(MAX_CLIP_SECONDS)} — drag the start to shift the window`);
};

const baySentence = () => {
  if (manualMode) return 'Times accept 1:02 or plain seconds.';
  if (!marks.inSet && !marks.outSet) return 'Marks read the player — keys <kbd>I</kbd> · <kbd>O</kbd> · <kbd>L</kbd>';
  if (marks.inSet && !marks.outSet) return `In at ${format(marks.start)} — mark the end`;
  return 'Drag the ends — arrows nudge';
};

const syncMarks = () => {
  const length = Math.max(0, marks.end - marks.start);
  const both = marks.inSet && marks.outSet;
  const scale = bandScale();
  band.hidden = manualMode;
  manualMarks.hidden = !manualMode;
  bayFoot.hidden = manualMode;
  // the handles ride the band at their marks
  markIn.hidden = manualMode || !marks.inSet;
  markOut.hidden = manualMode || !marks.outSet;
  markIn.style.left = bandPct(marks.start);
  markOut.style.left = bandPct(marks.end);
  markIn.classList.toggle('is-set', marks.inSet);
  markOut.classList.toggle('is-set', marks.outSet);
  for (const [handle, value] of [[markIn, marks.start], [markOut, marks.end]]) {
    handle.setAttribute('aria-valuemax', String(Math.floor(scale)));
    handle.setAttribute('aria-valuenow', String(Math.floor(value)));
    handle.setAttribute('aria-valuetext', format(value));
  }
  // the selection is the accent; the ceiling is geometry, not an alarm
  bandSel.hidden = manualMode || !both || length <= 0;
  bandSel.style.left = bandPct(marks.start);
  bandSel.style.width = `${Math.max(0, (length / scale) * 100)}%`;
  const ceilingAt = marks.start + MAX_CLIP_SECONDS;
  bandCeiling.hidden = manualMode || !marks.inSet || both || ceilingAt >= scale;
  bandCeiling.style.left = bandPct(ceilingAt);
  // law 4: the chip names the moment in range grammar, or not at all
  const chipText = both ? `${format(marks.start)}–${format(marks.end)}` : marks.inSet ? `${format(marks.start)}–…` : '';
  bayMoment.hidden = !chipText;
  if (chipText && durationChip.textContent !== chipText) {
    durationChip.textContent = chipText;
    retrigger(durationChip, 'just-ticked');
  }
  const total = currentTab.duration || playhead.duration || 0;
  bayMeta.textContent = both
    ? `${format(length)}${length >= MAX_CLIP_SECONDS ? ' — the cap' : ''}${total ? ` · ${Math.max(1, Math.round((length / total) * 100))}% of ${format(total)}` : ''}`
    : '';
  bayPoster.hidden = !(both && bayPoster.getAttribute('src'));
  bayNote.innerHTML = baySentence();
  bayTotal.hidden = manualMode;
  if (Date.now() - playhead.at > 1200) bayTotal.textContent = total ? `${format(total)} total` : `${format(MAX_CLIP_SECONDS)} max`;
  // the primary action morphs with the stage: in → out → play
  bayPrimaryLabel.textContent = both ? 'Play selection' : marks.inSet ? 'Mark out' : 'Mark in';
  bayPrimaryKey.textContent = marks.inSet ? 'O' : 'I';
  bayPrimaryKey.hidden = both;
  bayPrimary.querySelector('svg path').setAttribute('d', both ? 'M8 6v12l10-6z' : marks.inSet ? 'M19 5v14M5 12h10m-4-4 4 4-4 4' : 'M5 5v14M19 12H9m4-4-4 4 4 4');
  bayClear.hidden = !marks.inSet && !marks.outSet;
  if (manualIn !== document.activeElement) manualIn.value = format(marks.start);
  if (manualOut !== document.activeElement) manualOut.value = format(marks.end);
  syncPublishGate();
};

const syncSelectionCard = () => {
  const has = Boolean(selection.text.trim());
  passageCard.hidden = !has;
  grabSelection.hidden = has;
  if (has) {
    passageChip.textContent = selection.paragraph ? `¶ ${selection.paragraph}` : '¶';
    passageText.textContent = `“${selection.text}”`;
  }
  syncPublishGate();
};

const syncScreenshot = () => {
  const has = Boolean(screenshotAssetId);
  shotCard.hidden = !has;
  shotButton.hidden = has;
  const src = screenshotPreviewUrl || (has && apiOriginCache ? `${apiOriginCache}/media/${screenshotAssetId}` : '');
  shotPreview.hidden = !src;
  if (src) shotPreview.src = src;
  syncPublishGate();
};

// Injected into the page: the snip overlay. Drag a marquee over the part
// that matters; mouseup confirms, Escape cancels. Resolves the chosen rect
// in viewport CSS pixels (with the viewport size, so the panel can scale to
// the captured bitmap under any zoom/DPR) — and only AFTER the overlay is
// gone and the page has repainted, so the capture never photographs the
// tool itself. Self-contained: it runs in the page, not the panel.
function snipRegionInPage() {
  return new Promise((resolve) => {
    document.getElementById('annotated-snip-veil')?.remove();
    const veil = document.createElement('div');
    veil.id = 'annotated-snip-veil';
    veil.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;-webkit-user-select:none;background:rgba(38,41,47,.28);';
    const marquee = document.createElement('div');
    marquee.style.cssText = 'position:fixed;display:none;border:2px solid #B0674D;box-shadow:0 0 0 200000px rgba(38,41,47,.28);pointer-events:none;';
    // corner brackets, echoing the snip button's icon — readable over busy pages
    for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']]) {
      const corner = document.createElement('div');
      corner.style.cssText = `position:absolute;width:16px;height:16px;${v}:-3px;${h}:-3px;border:0 solid #B0674D;border-${v}-width:4px;border-${h}-width:4px;`;
      marquee.append(corner);
    }
    const hint = document.createElement('div');
    hint.textContent = 'Drag over the part that matters — Esc cancels';
    hint.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:rgba(38,41,47,.92);color:#F5F4F0;font:12px/1.4 system-ui,sans-serif;padding:6px 12px;border-radius:99px;pointer-events:none;';
    veil.append(marquee, hint);
    document.documentElement.append(veil);
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const rectFrom = (event) => ({
      x: Math.min(startX, event.clientX),
      y: Math.min(startY, event.clientY),
      w: Math.abs(event.clientX - startX),
      h: Math.abs(event.clientY - startY),
    });
    const finish = (result) => {
      document.removeEventListener('keydown', onKey, true);
      veil.remove();
      // two frames so the page repaints clean before the panel captures
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    };
    veil.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      veil.style.background = 'transparent'; // the marquee's shadow takes over the dimming
      hint.style.display = 'none';
    });
    veil.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const r = rectFrom(event);
      marquee.style.display = 'block';
      marquee.style.left = `${r.x}px`;
      marquee.style.top = `${r.y}px`;
      marquee.style.width = `${r.w}px`;
      marquee.style.height = `${r.h}px`;
    });
    veil.addEventListener('mouseup', (event) => {
      if (!dragging) return;
      const r = rectFrom(event);
      finish(r.w >= 4 && r.h >= 4 ? { ...r, vw: window.innerWidth, vh: window.innerHeight } : null);
    });
    document.addEventListener('keydown', onKey, true);
  });
}

// The captured bitmap is device pixels for the whole viewport; the region
// arrived in CSS pixels with the viewport it was measured in. Scaling by
// bitmap/viewport handles DPR and page zoom in one step.
const cropCapture = async (dataUrl, region) => {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Screenshot decode failed.'));
    image.src = dataUrl;
  });
  const scaleX = image.naturalWidth / region.vw;
  const scaleY = image.naturalHeight / region.vh;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.w * scaleX));
  canvas.height = Math.max(1, Math.round(region.h * scaleY));
  canvas.getContext('2d').drawImage(
    image,
    region.x * scaleX, region.y * scaleY, region.w * scaleX, region.h * scaleY,
    0, 0, canvas.width, canvas.height,
  );
  return canvas.toDataURL('image/png');
};

const captureScreenshot = async () => {
  if (!chrome.tabs?.captureVisibleTab) { showError('Screenshot capture is unavailable in this browser.'); return; }
  if (!backendOnline) { showError('Screenshots upload immediately — reconnect the backend first.'); return; }
  shotButton.disabled = true;
  try {
    // Snip, not grab: draw the region on the page itself. Pages that refuse
    // injection (chrome://, the Web Store, PDF viewers) fall back to the
    // full visible tab.
    let region = null;
    let snipOffered = false;
    if (Number.isInteger(currentTabId)) {
      try {
        const injected = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func: snipRegionInPage });
        snipOffered = true;
        region = injected?.[0]?.result || null;
      } catch { /* injection refused — full-tab fallback below */ }
    }
    if (snipOffered && !region) return; // Escape or a stray click: cancelled on purpose
    const captured = await chrome.tabs.captureVisibleTab({ format: 'png' });
    const dataUrl = region ? await cropCapture(captured, region) : captured;
    const blob = await (await fetch(dataUrl)).blob();
    const response = await fetch(`${await apiOrigin()}/api/media/screenshot`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'image/png', ...(await authHeaders()) }, body: blob });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Screenshot upload failed (${response.status}).`);
    screenshotAssetId = body.media.id;
    screenshotPreviewUrl = dataUrl;
    clearError();
    syncScreenshot();
    saveDraft();
  } catch (shotError) {
    showError(shotError.message || 'Screenshot capture failed.');
  } finally {
    shotButton.disabled = false;
  }
};

shotButton.addEventListener('click', () => { void captureScreenshot(); });

shotClear.addEventListener('click', () => {
  screenshotAssetId = '';
  screenshotPreviewUrl = '';
  syncScreenshot();
  saveDraft();
  shotButton.focus();
});

// You can verify what you snipped: the small preview — and any screenshot
// in the timeline — opens at full size. Same door out as every veil:
// click anywhere, the close button, or Esc.
let shotVeilReturnFocus = null;

const openShotVeil = (src, opener = null) => {
  if (!src) return;
  shotVeilImg.src = src;
  shotVeil.hidden = false;
  shotVeilReturnFocus = opener;
  shotVeilClose.focus();
};

const closeShotVeil = () => {
  if (shotVeil.hidden || shotVeil.classList.contains('is-closing')) return;
  const finish = () => {
    shotVeil.classList.remove('is-closing');
    shotVeil.hidden = true;
    shotVeilImg.removeAttribute('src');
    if (shotVeilReturnFocus?.isConnected) shotVeilReturnFocus.focus();
    shotVeilReturnFocus = null;
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  shotVeil.classList.add('is-closing');
  setTimeout(finish, 140);
};

shotPreview.addEventListener('click', () => openShotVeil(shotPreview.src, shotPreview));
shotVeil.addEventListener('click', closeShotVeil);

visibilitySelect.addEventListener('change', () => {
  visibility = ['public', 'unlisted', 'private'].includes(visibilitySelect.value) ? visibilitySelect.value : 'public';
  saveDraft();
});

for (const option of TOPICS) {
  const element = document.createElement('option');
  element.value = option.slug;
  element.textContent = option.label;
  topicSelect.append(element);
}
topicSelect.addEventListener('change', () => {
  topic = isTopic(topicSelect.value) ? topicSelect.value : '';
  saveDraft();
});

const syncSource = () => {
  sourceTitle.textContent = currentTab.title || 'Reading this tab…';
  const icon = faviconUrl(currentTab.url);
  sourceFavicon.hidden = !icon;
  if (icon && sourceFavicon.src !== icon) sourceFavicon.src = icon;
  typeSelect.value = currentTab.sourceType;
  // Three states, not two: until the tab is actually known the panel is
  // "reading", never "unsupported" — the old boot order flashed a false
  // error on every open while the first network round-trips settled.
  const known = Boolean(currentTab.url);
  const supported = /^https?:/.test(currentTab.url || '');
  capUnsupported.hidden = !known || supported;
  // On chrome:// and friends the composer stops pretending: no note box, no
  // publish row, no live dot — just the one honest sentence.
  captureSection.classList.toggle('is-unsupported', known && !supported);
  mediaSelection.hidden = !supported || !isMediaType();
  textSelection.hidden = !supported || isMediaType();
  document.querySelector('#shotRow').hidden = !supported;
  syncMarks();
  syncSelectionCard();
  syncScreenshot();
};

const syncNote = () => {
  noteCount.textContent = `${note.value.length}/280`;
  syncPublishGate();
};

const setAudioStatus = (status, hint = '') => {
  audioStatus.textContent = status;
  audioHint.textContent = hint;
  audioDurationEl.textContent = format(audioDurationSeconds);
  audioRetry.hidden = !audioDraftId || Boolean(audioAssetId) || audioUploadInFlight || mediaRecorder?.state === 'recording';
  audioRecord.disabled = audioUploadInFlight;
  const isRecording = mediaRecorder?.state === 'recording';
  audioComposer.classList.toggle('is-recording', isRecording);
  audioRecord.classList.toggle('is-recording', isRecording);
  audioRecord.setAttribute('aria-label', isRecording ? 'Stop recording' : 'Start recording');
  recordIcon.hidden = isRecording;
  stopIcon.hidden = !isRecording;
};

const syncComposer = () => {
  const audio = commentaryMode === 'audio';
  note.hidden = audio;
  noteCount.hidden = audio;
  audioComposer.hidden = !audio;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === commentaryMode;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (audio) setAudioStatus(audioAssetId ? 'Audio note ready' : audioDraftId ? 'Audio note saved locally' : 'Record a 90-second take', audioAssetId ? 'Re-record to replace it before publishing.' : 'Audio is staged locally before upload.');
  syncPublishGate();
};

/* ── per-tab drafts (session storage, keyed by tab id) ─────────────── */

const draftPayload = () => ({
  sourceUrl: currentTab.url,
  sourceType: currentTab.sourceType,
  sourceTitle: currentTab.title,
  sourceHost: currentTab.host,
  sourceExcerpt: selection.text,
  clipStart: isMediaType() ? marks.start : 0,
  clipEnd: isMediaType() ? marks.end : 0,
  commentary: note.value.trim().slice(0, 280),
  commentaryMode,
  audioAssetId,
  audioDuration: audioDurationSeconds,
  audioDraftId,
  clientRequestId,
  visibility,
  topic,
  screenshotAssetId,
  anchorParagraph: selection.paragraph || 0,
  anchorPrefix: selection.prefix || '',
  anchorSuffix: selection.suffix || '',
});

const saveDraft = () => {
  if (!draftReady || !Number.isInteger(currentTabId)) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => { void extensionStorage.saveTabDraft(currentTabId, draftPayload()).catch(() => {}); }, 250);
};

const restoreDraft = (draft) => {
  selection = { text: draft.sourceExcerpt || '', paragraph: draft.anchorParagraph || 0, prefix: draft.anchorPrefix || '', suffix: draft.anchorSuffix || '' };
  marks = { start: draft.clipStart || 0, end: draft.clipEnd || 0, inSet: draft.clipStart > 0 || draft.clipEnd > 0, outSet: draft.clipEnd > 0 };
  note.value = draft.commentary || '';
  commentaryMode = draft.commentaryMode || 'text';
  audioAssetId = draft.audioAssetId || '';
  audioDurationSeconds = Number(draft.audioDuration) > 0 ? clampAudioDuration(draft.audioDuration) : 0;
  audioDraftId = draft.audioDraftId || '';
  clientRequestId = draft.clientRequestId || clientRequestId;
  visibility = draft.visibility || 'public';
  visibilitySelect.value = visibility;
  topic = isTopic(draft.topic) ? draft.topic : '';
  topicSelect.value = topic;
  screenshotAssetId = draft.screenshotAssetId || '';
  screenshotPreviewUrl = '';
  if (draft.sourceType) currentTab.sourceType = draft.sourceType;
};

const resetCaptureState = () => {
  recordingToken += 1;
  clearInterval(recordingTimer);
  setReviewTake(null);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  mediaRecorder = null;
  selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
  marks = { start: 0, end: 0, inSet: false, outSet: false };
  manualMode = false;
  playhead = { time: 0, duration: 0, paused: true, adShowing: false, at: 0 };
  bayPoster.removeAttribute('src');
  commentaryMode = 'text';
  visibility = 'public';
  visibilitySelect.value = 'public';
  topic = '';
  topicSelect.value = '';
  screenshotAssetId = '';
  screenshotPreviewUrl = '';
  audioAssetId = '';
  audioDurationSeconds = 0;
  audioDraftId = '';
  clientRequestId = crypto.randomUUID();
  note.value = '';
  manualMarks.hidden = true;
};

/* ── tab binding ───────────────────────────────────────────────────── */

const loadCurrentTab = async () => {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showError('The active tab could not be read.');
    return;
  }
  if (!tab) return;
  const url = tab.url || '';
  const changed = tab.id !== currentTabId;
  if (changed) {
    draftReady = false;
    resetCaptureState();
    currentTabId = tab.id ?? null;
    feedCache.page = null;
    if (panelMode === 'page') renderTimeline();
    // Never show the previous tab's identity while the probes run: reset to
    // the neutral reading state instantly, fill in as answers arrive.
    currentTab = { url: '', title: '', host: '', sourceType: 'article', duration: 0 };
    armGrabber('');
    syncSource();
  }
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  currentTab = { url, title: tab.title || host || 'This tab', host, sourceType: currentTab.sourceType || 'article', duration: 0 };
  currentTab.sourceType = await detectSourceType(tab.id, url);
  if (currentTabId !== tab.id) return; // a faster tab switch won the race
  void installSelectionWatcher(tab.id, url);
  // The needle found a new station: the live dot swells once, the title fades in.
  if (changed) retrigger(document.querySelector('.cap-source'), 'is-retuned');
  if (changed) {
    const draft = await extensionStorage.getTabDraft(currentTabId).catch(() => null);
    if (currentTabId !== tab.id) return;
    if (draft && draft.sourceUrl === url) restoreDraft(draft);
  }
  resolvedSource = null;
  syncSource();
  syncNote();
  syncComposer();
  draftReady = true;
  if (backendOnline && /^https?:/.test(url)) {
    try {
      const resolved = await resolveSourceUrl(url, currentTab.title);
      // A slow resolve for a tab we already left must never stamp its
      // details onto the tab we are on now.
      if (currentTab.url !== url) return;
      resolvedSource = resolved;
      // The moment gets a face: the resolver's thumbnail rides the bay.
      if (resolvedSource.poster) bayPoster.src = resolvedSource.poster;
      else bayPoster.removeAttribute('src');
      // The live tab title is the source of truth for the strip; the resolver
      // fills in what the tab cannot know (canonical URL, media URL, duration).
      if (!tab.title && resolvedSource.title) currentTab.title = resolvedSource.title;
      currentTab.host = resolvedSource.host || currentTab.host;
      currentTab.duration = resolvedSource.duration || 0;
      if (resolvedSource.sourceType) currentTab.sourceType = resolvedSource.sourceType;
      syncSource();
    } catch { /* the page's own details are enough to capture */ }
  }
  if (panelMode === 'page') await loadTimeline('page');
};

chrome.tabs?.onActivated?.addListener(() => { void loadCurrentTab(); });
chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
  // SPA navigations change the URL without a load cycle — rebind on both.
  if (changeInfo.status === 'complete' || changeInfo.url) void loadCurrentTab();
});

/* ── marks ─────────────────────────────────────────────────────────── */

// A mark press with no reachable player drops into typed times — chosen
// copy, not an error, and the way back stays on screen.
const enterManualMode = () => {
  manualMode = true;
  syncMarks();
  bayNote.innerHTML = 'No player found on this tab — type the times instead.';
  manualIn.focus();
};

const captureMark = async (boundary) => {
  if (panelMode !== 'capture') setPanelMode('capture');
  const player = await readPlayerTime();
  if (!player) { enterManualMode(); return; }
  if (player.duration && !currentTab.duration) currentTab.duration = player.duration;
  if (boundary === 'in') {
    marks.start = player.time;
    marks.inSet = true;
    if (!marks.outSet || marks.end < marks.start) { marks.end = marks.start; marks.outSet = marks.outSet && marks.end >= marks.start; }
  } else {
    marks.end = player.time;
    marks.outSet = true;
    // Out-first is the natural retroactive reach — "that was good" —
    // so window back a default 30s instead of inventing a dead range.
    if (!marks.inSet) {
      marks.start = Math.max(0, marks.end - 30);
      marks.inSet = true;
      showToast('Start set 30s back — drag it to adjust');
    } else if (marks.start > marks.end) {
      marks.start = Math.max(0, marks.end);
    }
  }
  clampMarks();
  syncMarks();
  retrigger(boundary === 'in' ? markIn : markOut, 'just-set');
  retrigger(bandSel, 'just-set');
  saveDraft();
};

// Twitch's Alt+X, ours: the whole podcast and streaming world converged
// on "that was good — keep the last N seconds."
const captureLastN = async (seconds) => {
  if (panelMode !== 'capture') setPanelMode('capture');
  const player = await readPlayerTime();
  if (!player) { enterManualMode(); return; }
  if (player.duration && !currentTab.duration) currentTab.duration = player.duration;
  marks.end = player.time;
  marks.start = Math.max(0, player.time - seconds);
  marks.inSet = true;
  marks.outSet = true;
  clampMarks();
  syncMarks();
  retrigger(markIn, 'just-set');
  retrigger(markOut, 'just-set');
  retrigger(bandSel, 'just-set');
  saveDraft();
};

/* the handles: drag to shape the moment, arrows to nudge it */
let dragging = null;

const bandSeconds = (clientX) => {
  const rect = band.getBoundingClientRect();
  if (!rect.width) return 0;
  return ((clientX - rect.left) / rect.width) * bandScale();
};

const applyBoundary = (boundary, seconds) => {
  if (marks.inSet && marks.outSet) {
    const next = moveClipBoundary(marks.start, marks.end, boundary, seconds, { max: bandScale(), maxDuration: MAX_CLIP_SECONDS });
    marks.start = next.start;
    marks.end = next.end;
  } else if (boundary === 'start') {
    marks.start = Math.max(0, Math.min(seconds, bandScale()));
    if (marks.outSet && marks.end < marks.start) marks.end = marks.start;
  } else {
    marks.end = Math.max(0, Math.min(seconds, bandScale()));
  }
  syncMarks();
};

for (const handle of [markIn, markOut]) {
  const boundary = handle === markIn ? 'start' : 'end';
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = boundary;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (dragging !== boundary) return;
    applyBoundary(boundary, bandSeconds(event.clientX));
  });
  handle.addEventListener('pointerup', () => {
    if (dragging !== boundary) return;
    dragging = null;
    saveDraft();
    // scrub-to-seek: releasing a handle parks the page player on it,
    // so the page itself is the preview monitor
    void seekPlayer(boundary === 'start' ? marks.start : marks.end);
  });
  handle.addEventListener('pointercancel', () => { dragging = null; saveDraft(); });
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    let delta = 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -step;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = step;
    if (!delta) return;
    event.preventDefault();
    applyBoundary(boundary, (boundary === 'start' ? marks.start : marks.end) + delta);
    saveDraft();
  });
}

bayPrimary.addEventListener('click', () => {
  if (marks.inSet && marks.outSet) { void playSelection(); return; }
  if (marks.inSet) { void captureMark('out'); return; }
  void captureMark('in');
});
bayLast30.addEventListener('click', () => { void captureLastN(30); });
bayClear.addEventListener('click', () => {
  marks = { start: 0, end: 0, inSet: false, outSet: false };
  syncMarks();
  saveDraft();
  bayPrimary.focus();
});
typeToggle.addEventListener('click', () => { manualMode = true; syncMarks(); manualIn.focus(); });
playerToggle.addEventListener('click', () => { manualMode = false; syncMarks(); });

const applyManualMark = (boundary, input) => {
  const parsed = parseTimeInput(input.value);
  if (parsed === null) {
    input.value = format(boundary === 'in' ? marks.start : marks.end);
    showError('Times accept 1:02 or plain seconds.');
    return;
  }
  clearError();
  if (boundary === 'in') {
    marks.start = parsed;
    marks.inSet = true;
    if (marks.end < parsed) marks.end = parsed;
  } else {
    marks.end = parsed;
    marks.outSet = true;
    if (marks.start > parsed) marks.start = parsed;
  }
  clampMarks();
  syncMarks();
  retrigger(boundary === 'in' ? markIn : markOut, 'just-set');
  saveDraft();
};

manualIn.addEventListener('change', () => applyManualMark('in', manualIn));
manualOut.addEventListener('change', () => applyManualMark('out', manualOut));

/* ── article selection ─────────────────────────────────────────────── */

// The grabber arms itself: a debounced selectionchange watcher lives in the
// page (self-guarding, injected once per document) and messages the panel,
// so the button reads "Capture 'The first few words…'" the moment a
// selection exists instead of waiting to fail.
function watchSelectionInPage() {
  if (window.__annotatedSelectionWatch) return true;
  window.__annotatedSelectionWatch = true;
  let timer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = String(window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim();
      try { chrome.runtime.sendMessage({ type: 'ANNOTATED_SELECTION', preview: text.slice(0, 80) }); } catch { /* extension reloaded */ }
    }, 250);
  });
  return true;
}

const grabLabel = $('#grabLabel');
const GRAB_IDLE_LABEL = 'Highlight a passage on the page, then capture it';

const armGrabber = (preview) => {
  const armed = Boolean(preview);
  grabSelection.classList.toggle('is-armed', armed);
  grabLabel.textContent = armed
    ? `Capture “${preview.length > 42 ? `${preview.slice(0, 42).trimEnd()}…` : preview}”`
    : GRAB_IDLE_LABEL;
};

// The live playhead: cheap direct writes, never a full re-render. The
// head is ink (it is where you are, not what you kept); the tail grows
// terracotta from the in-mark while the out-mark is still pending.
const updateBandLive = () => {
  if (panelMode !== 'capture' || !isMediaType() || manualMode) return;
  const fresh = Date.now() - playhead.at < 1200;
  bandHead.hidden = !fresh;
  if (fresh) bandHead.style.left = bandPct(playhead.time);
  const tailing = fresh && marks.inSet && !marks.outSet && !playhead.paused && playhead.time > marks.start;
  bandTail.hidden = !tailing;
  if (tailing) {
    const tailEnd = Math.min(playhead.time, marks.start + MAX_CLIP_SECONDS);
    bandTail.style.left = bandPct(marks.start);
    bandTail.style.width = `${Math.max(0, ((tailEnd - marks.start) / bandScale()) * 100)}%`;
  }
  const total = currentTab.duration || playhead.duration || 0;
  bayTotal.textContent = fresh
    ? `${playhead.adShowing ? 'ad · ' : ''}${format(playhead.time)}${total ? ` / ${format(total)}` : ''}`
    : total ? `${format(total)} total` : `${format(MAX_CLIP_SECONDS)} max`;
};

// The lease driver: while the clip bay is on stage, keep the page feed
// alive; everywhere else, let it lapse on its own.
setInterval(() => {
  if (panelMode !== 'capture' || !isMediaType() || manualMode || document.hidden) return;
  if (!Number.isInteger(currentTabId) || !/^https?:/.test(currentTab.url || '')) return;
  chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    func: watchPlayerInPage,
    args: [Date.now() + 5000],
  }).catch(() => {});
}, 2000);

chrome.runtime?.onMessage?.addListener((message, sender) => {
  if (message?.type === 'ANNOTATED_SELECTION') {
    if (sender?.tab?.id !== currentTabId) return;
    armGrabber(message.preview || '');
    return;
  }
  if (message?.type === 'ANNOTATED_PLAYER_TICK') {
    if (sender?.tab?.id !== currentTabId) return;
    playhead = { ...message.player, at: Date.now() };
    if (playhead.duration && !currentTab.duration) currentTab.duration = playhead.duration;
    updateBandLive();
    return;
  }
  // Right-click "Annotate" while the panel is already open: capture now.
  if (message?.type === 'ANNOTATED_GRAB_SELECTION' && message.tabId === currentTabId) {
    void captureSelection();
  }
});

// Right-click "Annotate" on a cold panel: the background stashed the request
// before opening us; consume it once the tab is known.
const consumePendingGrab = async () => {
  try {
    const { annotatedPendingGrab } = await chrome.storage.session.get('annotatedPendingGrab');
    if (!annotatedPendingGrab) return;
    await chrome.storage.session.remove('annotatedPendingGrab');
    if (annotatedPendingGrab.tabId === currentTabId) await captureSelection();
  } catch { /* nothing pending */ }
};

const installSelectionWatcher = async (tabId, url) => {
  if (!Number.isInteger(tabId) || !/^https?:/.test(url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: watchSelectionInPage });
  } catch { /* pages that refuse injection simply keep the un-armed grabber */ }
};

const captureSelection = async () => {
  const grabbed = await readPageSelection();
  if (!grabbed.text) {
    showError('Select some text on the page first, then capture it.');
    return;
  }
  clearError();
  selection = grabbed;
  syncSelectionCard();
  saveDraft();
  note.focus();
};

grabSelection.addEventListener('click', () => { void captureSelection(); });

passageClear.addEventListener('click', () => {
  selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
  syncSelectionCard();
  saveDraft();
  grabSelection.focus();
});

/* ── type override ─────────────────────────────────────────────────── */

typeSelect.addEventListener('change', () => {
  currentTab.sourceType = typeSelect.value;
  syncSource();
  saveDraft();
});

/* ── note + modes ──────────────────────────────────────────────────── */

note.addEventListener('input', () => { syncNote(); saveDraft(); });

document.querySelectorAll('[data-mode]').forEach((mode) => mode.addEventListener('click', () => {
  if (mode.dataset.mode !== 'audio' && mediaRecorder?.state === 'recording') stopAudioRecording();
  commentaryMode = mode.dataset.mode;
  syncComposer();
  saveDraft();
}));

/* ── audio recording ───────────────────────────────────────────────── */

const uploadStagedAudio = async () => {
  if (audioAssetId || !audioDraftId || audioUploadInFlight) return audioAssetId;
  const staged = await readAudioDraft(audioDraftId).catch(() => null);
  if (!staged?.blob) throw new Error('The local audio note is no longer available.');
  audioUploadInFlight = true;
  syncComposer();
  setAudioStatus('Uploading your take…', 'The browser is sending the staged audio.');
  try {
    const { media } = await uploadAudioRequest(staged.blob);
    audioAssetId = media.id;
    audioDurationSeconds = clampAudioDuration(staged.duration || audioDurationSeconds);
    await deleteAudioDraft(audioDraftId).catch(() => {});
    audioDraftId = '';
    saveDraft();
    setAudioStatus('Audio note ready', 'Re-record to replace it before publishing.');
    return audioAssetId;
  } catch (uploadError) {
    setAudioStatus('Audio note saved locally', uploadError.retryable ? 'Retry when the backend is available.' : uploadError.message);
    throw uploadError;
  } finally {
    audioUploadInFlight = false;
    syncComposer();
  }
};

const stopAudioRecording = () => {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  clearInterval(recordingTimer);
  mediaRecorder.stop();
};

// Voice notes were published unheard. The staged take stays reviewable —
// one button, play or stop, revoked whenever the take changes.
let reviewAudio = null;
let reviewUrl = '';
const audioReview = $('#audioReview');

const setReviewTake = (blob) => {
  if (reviewAudio) { reviewAudio.pause(); reviewAudio = null; }
  if (reviewUrl) { URL.revokeObjectURL(reviewUrl); reviewUrl = ''; }
  audioStatus.classList.remove('rec-ending');
  audioReview.hidden = !blob;
  audioReview.classList.remove('is-playing');
  audioReview.textContent = 'Review take';
  if (blob) reviewUrl = URL.createObjectURL(blob);
};

audioReview.addEventListener('click', () => {
  if (!reviewUrl) return;
  if (reviewAudio && !reviewAudio.paused) {
    reviewAudio.pause();
    reviewAudio.currentTime = 0;
    audioReview.classList.remove('is-playing');
    audioReview.textContent = 'Review take';
    return;
  }
  if (!reviewAudio) reviewAudio = new Audio(reviewUrl);
  reviewAudio.currentTime = 0;
  audioReview.classList.add('is-playing');
  audioReview.textContent = 'Stop review';
  reviewAudio.addEventListener('ended', () => {
    audioReview.classList.remove('is-playing');
    audioReview.textContent = 'Review take';
  }, { once: true });
  void reviewAudio.play().catch(() => {
    audioReview.classList.remove('is-playing');
    audioReview.textContent = 'Review take';
  });
});

const startAudioRecording = async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError('Audio recording is not supported in this browser.');
    return;
  }
  if (audioDraftId) await deleteAudioDraft(audioDraftId).catch(() => {});
  audioDraftId = '';
  audioAssetId = '';
  audioDurationSeconds = 0;
  recordingChunks = [];
  const token = ++recordingToken;
  const sourceUrl = currentTab.url;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (token !== recordingToken || currentTab.url !== sourceUrl) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      return;
    }
    const mimeType = preferredAudioMimeType();
    const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    mediaRecorder = recorder;
    recordingStartedAt = Date.now();
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      audioDurationSeconds = clampAudioDuration((Date.now() - recordingStartedAt) / 1000);
      const recordedMimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(recordingChunks, { type: recordedMimeType });
      recordingChunks = [];
      if (mediaRecorder === recorder) mediaRecorder = null;
      if (token !== recordingToken || currentTab.url !== sourceUrl) return;
      setReviewTake(blob); // hear it before you publish it
      try {
        const stagedId = await stageAudioDraft(blob, { duration: audioDurationSeconds, mimeType: recordedMimeType });
        if (token !== recordingToken || currentTab.url !== sourceUrl) {
          await deleteAudioDraft(stagedId).catch(() => {});
          return;
        }
        audioDraftId = stagedId;
        saveDraft();
        setAudioStatus('Audio note saved locally', 'Uploading the staged take…');
        await uploadStagedAudio();
      } catch (uploadError) {
        showError(uploadError.retryable ? 'Audio note saved locally. It will retry when the backend is available.' : uploadError.message || 'Audio upload failed.');
      }
      syncComposer();
    });
    recorder.start(250);
    setReviewTake(null);
    setAudioStatus('Recording your take…', `Press to stop · max ${format(MAX_AUDIO_SECONDS)}`);
    recordingTimer = setInterval(() => {
      audioDurationSeconds = clampAudioDuration((Date.now() - recordingStartedAt) / 1000);
      const remaining = Math.max(0, Math.ceil(MAX_AUDIO_SECONDS - audioDurationSeconds));
      // the last ten seconds speak up instead of cutting off by surprise
      audioStatus.classList.toggle('rec-ending', remaining <= 10);
      setAudioStatus('Recording your take…', remaining <= 10 ? `${remaining}s left — it stops itself at ${format(MAX_AUDIO_SECONDS)}` : `Press to stop · max ${format(MAX_AUDIO_SECONDS)}`);
      if (audioDurationSeconds >= MAX_AUDIO_SECONDS) stopAudioRecording();
    }, 250);
  } catch (recordingError) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    mediaRecorder = null;
    showError(recordingError.message || 'Microphone permission is required to record.');
    syncComposer();
  }
};

audioRecord.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') {
    stopAudioRecording();
    return;
  }
  void startAudioRecording().catch((recordingError) => {
    showError(recordingError.message || 'Audio recording failed.');
    syncComposer();
  });
});

audioRetry.addEventListener('click', async () => {
  try { await uploadStagedAudio(); } catch (uploadError) { showError(uploadError.message || 'Audio upload failed.'); }
});

/* ── publish ───────────────────────────────────────────────────────── */

const annotationToItem = (annotation) => ({
  slug: annotation.slug,
  url: annotation.url,
  handle: annotation.author?.handle || 'you',
  initials: (annotation.author?.displayName || annotation.author?.handle || 'A').slice(0, 1).toUpperCase(),
  displayName: annotation.author?.displayName || '',
  avatarUrl: annotation.author?.avatarUrl || '',
  time: relTime(annotation.createdAt),
  type: annotation.sourceType,
  sourceTitle: annotation.sourceTitle || annotation.sourceHost || 'Source',
  host: annotation.sourceHost || '',
  sourceUrl: annotation.sourceUrl,
  canonicalUrl: annotation.canonicalUrl || annotation.sourceUrl,
  clipStart: Number(annotation.clipStart) || 0,
  clipEnd: Number(annotation.clipEnd) || 0,
  quote: annotation.sourceExcerpt || '',
  commentary: annotation.commentary || '',
  commentaryMode: annotation.commentaryMode || 'text',
  clipUrl: annotation.clipUrl || '',
  mediaStatus: annotation.mediaStatus || 'not-applicable',
  screenshotUrl: annotation.screenshotUrl || '',
  anchorParagraph: annotation.anchorParagraph || 0,
  anchorPrefix: annotation.anchorPrefix || '',
  anchorSuffix: annotation.anchorSuffix || '',
  opens: Number(annotation.opens) || 0,
  comments: Array.isArray(annotation.comments) ? annotation.comments.length : 0,
  likes: Number(annotation.likes) || 0,
  likedByMe: Boolean(annotation.likedByMe),
  editedAt: annotation.editedAt || '',
  createdAt: annotation.createdAt || '',
});

publishButton.addEventListener('click', async () => {
  clearError();
  const blocker = publishBlocker();
  if (blocker) { publishHint.textContent = blocker; return; }
  // A reader who has never signed in gets the door, not a false 'session
  // expired' after a doomed round-trip. The capture stays exactly where it is.
  if (!(await extensionStorage.getAuthToken().catch(() => null))) {
    openSignin('Sign in to publish — your capture stays right here.');
    return;
  }
  if (commentaryMode === 'audio' && !audioAssetId && audioDraftId) {
    try { await uploadStagedAudio(); } catch (uploadError) {
      showError(uploadError.retryable ? 'Audio note saved locally. It will retry when the backend is available.' : uploadError.message || 'Finish uploading the audio note before publishing.');
      return;
    }
  }
  const payload = {
    sourceUrl: currentTab.url,
    sourceType: currentTab.sourceType,
    sourceTitle: currentTab.title,
    sourceHost: currentTab.host,
    sourceExcerpt: currentTab.sourceType === 'article' ? selection.text : (resolvedSource?.excerpt || ''),
    canonicalUrl: resolvedSource?.url || currentTab.url,
    mediaUrl: resolvedSource?.mediaUrl || undefined,
    provider: resolvedSource?.provider || undefined,
    clipStart: isMediaType() ? marks.start : 0,
    clipEnd: isMediaType() ? marks.end : 0,
    commentary: commentaryMode === 'text' ? note.value.trim().slice(0, 280) : '',
    commentaryMode,
    visibility,
    topic: isTopic(topic) ? topic : undefined,
    screenshotAssetId: screenshotAssetId || undefined,
    audioAssetId: commentaryMode === 'audio' ? audioAssetId : undefined,
    audioDuration: commentaryMode === 'audio' ? audioDurationSeconds : undefined,
    clientRequestId,
    ...(currentTab.sourceType === 'article' ? {
      anchorParagraph: selection.paragraph || undefined,
      anchorPrefix: selection.prefix || undefined,
      anchorSuffix: selection.suffix || undefined,
    } : {}),
  };
  publishButton.disabled = true;
  publishButton.classList.add('is-working');
  publishHint.textContent = 'Publishing…';
  try {
    const { annotation } = await apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) });
    await extensionStorage.clearTabDraft(currentTabId).catch(() => {});
    if (audioDraftId) await deleteAudioDraft(audioDraftId).catch(() => {});
    resetCaptureState();
    syncSource();
    syncNote();
    syncComposer();
    showPublishMoment(annotation.sourceTitle || currentTab.title);
    // Public notes land on This page so they are seen in place; unlisted and
    // private stay put — they will never appear in a public timeline.
    if ((payload.visibility || 'public') === 'public') {
      const item = annotationToItem(annotation);
      for (const key of ['recent', 'page']) {
        if (feedCache[key]?.items) feedCache[key].items.unshift(item);
      }
      if (!feedCache.page) feedCache.page = { items: [item] };
      setPanelMode('page');
      // the fresh note settles behind the veil, at rest before it lifts
      timeline.classList.add('is-inserting');
      setTimeout(() => timeline.classList.remove('is-inserting'), 300);
    }
    showToast('Published', { href: annotation.url, label: 'View page' });
  } catch (publishError) {
    if (publishError.authRequired) {
      await extensionStorage.queueCapture({ ...payload, audioDraftId }).catch(() => {});
      setAuthState(false);
      showError('Your session expired. Sign in again; this capture is safe in the local queue.');
      await refreshQueueStatus();
    } else if (publishError.retryable) {
      await extensionStorage.queueCapture({ ...payload, audioDraftId }).catch(() => {});
      showError('Backend unavailable. This capture is queued locally and will retry automatically.');
      await refreshQueueStatus();
    } else {
      showError(publishError.message || 'Annotation could not be published.');
    }
  } finally {
    publishButton.classList.remove('is-working');
    syncPublishGate();
  }
});

/* ── timeline ──────────────────────────────────────────────────────── */

const timelineMedia = (item) => {
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'video') {
    return `<div class="srcmedia"><video controls preload="metadata" src="${escapeHTML(item.clipUrl)}"></video><span class="cliptag">CLIP</span><span class="badge">${escapeHTML(format(clipSeconds))}</span></div>`;
  }
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'podcast') {
    return `<div class="srcmedia srcmedia-audio"><span class="cliptag">CLIP</span><audio controls preload="none" src="${escapeHTML(item.clipUrl)}"></audio></div>`;
  }
  if (item.screenshotUrl) {
    return `<div class="srcmedia"><img loading="lazy" src="${escapeHTML(item.screenshotUrl)}" alt="Screenshot of ${escapeHTML(item.sourceTitle)}" /></div>`;
  }
  // A clip that exists but is not ready yet says so — a just-published post
  // no longer shows an inexplicable nothing where its media will be.
  if ((item.type === 'video' || item.type === 'podcast') && ['queued', 'processing'].includes(item.mediaStatus)) {
    return `<div class="srcmedia srcmedia-processing"><span class="cliptag">CLIP</span><span class="processing-note">Processing ${escapeHTML(format(clipSeconds))} clip — it appears here when ready</span></div>`;
  }
  return '';
};

/* ── highlight on page ─────────────────────────────────────────────── */

// Someone's annotation, physically on the page you're reading: the panel
// finds the quoted passage in the live page and washes it terracotta —
// this IS the moment, so the accent is the law-correct color. Uses the
// CSS Custom Highlight API, so the page's DOM is never touched.
// Injected into the page; must stay self-contained (no closures).
function highlightPassageInPage(anchor) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const wanted = normalize(anchor.text);
  if (!wanted) return { found: false };
  // The toggle key is the full anchor identity: the same annotation
  // toggles off; a different annotation quoting the same words moves the
  // highlight instead of clearing it.
  const key = [normalize(anchor.prefix), wanted, normalize(anchor.suffix)].join('|').slice(0, 200);
  const state = window.__annotatedHighlight || (window.__annotatedHighlight = {});
  const supported = typeof Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights;
  if (supported && state.key === key && CSS.highlights.has('annotated-passage')) {
    CSS.highlights.delete('annotated-passage');
    state.key = '';
    return { found: true, cleared: true };
  }

  // Walk visible text nodes, building a whitespace-normalized string with
  // a map back to (node, offset) so a match becomes a precise Range.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'SVG') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let normalized = '';
  let pendingSpace = false;
  const map = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || '';
    for (let index = 0; index < text.length; index += 1) {
      if (/\s/.test(text[index])) { pendingSpace = normalized.length > 0; continue; }
      if (pendingSpace) { normalized += ' '; map.push(null); pendingSpace = false; }
      normalized += text[index];
      map.push({ node, offset: index });
    }
  }

  // Prefix/suffix disambiguate when the quote appears more than once —
  // the same anchors the #:~:text= deep link carries.
  const prefix = normalize(anchor.prefix).slice(-24);
  const suffix = normalize(anchor.suffix).slice(0, 24);
  let start = -1;
  if (prefix || suffix) {
    let from = 0;
    while (from <= normalized.length - wanted.length) {
      const at = normalized.indexOf(wanted, from);
      if (at === -1) break;
      const beforeOk = !prefix || normalized.slice(Math.max(0, at - prefix.length - 4), at).includes(prefix);
      const afterOk = !suffix || normalized.slice(at + wanted.length, at + wanted.length + suffix.length + 4).includes(suffix);
      if (beforeOk && afterOk) { start = at; break; }
      from = at + 1;
    }
  }
  if (start === -1) start = normalized.indexOf(wanted);
  if (start === -1) return { found: false };

  let first = start;
  while (first < start + wanted.length && !map[first]) first += 1;
  let last = start + wanted.length - 1;
  while (last > first && !map[last]) last -= 1;
  if (!map[first] || !map[last]) return { found: false };
  const range = document.createRange();
  range.setStart(map[first].node, map[first].offset);
  range.setEnd(map[last].node, map[last].offset + 1);

  if (supported) {
    if (!document.getElementById('annotated-highlight-style')) {
      const style = document.createElement('style');
      style.id = 'annotated-highlight-style';
      style.textContent = '::highlight(annotated-passage) { background-color: rgba(176, 103, 77, 0.28); }';
      document.head.appendChild(style);
    }
    CSS.highlights.set('annotated-passage', new Highlight(range));
    state.key = key;
  } else {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const target = map[first].node.parentElement;
  if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { found: true };
}

// Only rows about the page you are on can highlight it: everything on the
// This page tab, and any row whose source resolves to the current tab.
const matchesCurrentTab = (item) => {
  try {
    const source = new URL(item.canonicalUrl || item.sourceUrl);
    const tab = new URL(currentTab.url);
    return source.origin === tab.origin && source.pathname === tab.pathname;
  } catch {
    return false;
  }
};

const showOnPage = async (item) => {
  if (!Number.isInteger(currentTabId)) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: highlightPassageInPage,
      args: [{ text: item.quote, prefix: item.anchorPrefix || '', suffix: item.anchorSuffix || '' }],
    });
    const outcome = results?.[0]?.result;
    if (outcome?.cleared) return;
    if (!outcome?.found) showToast('That passage is not on this page right now.');
  } catch {
    showToast('This page cannot be highlighted.');
  }
};

const timelinePost = (item) => {
  const noteLine = item.commentary
    ? `<p class="note">${escapeHTML(item.commentary)}</p>`
    : `<p class="note">Audio note — listen on the page.</p>`;
  // The quote below carries the passage; only media moments need a chip.
  const chip = item.type === 'article' ? '' : `${format(item.clipStart)}–${format(item.clipEnd)}`;
  const quote = item.quote ? `<blockquote>&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  const favicon = faviconUrl(item.canonicalUrl || item.sourceUrl);
  return `
  <article class="post">
    ${item.avatarUrl
      ? `<span class="avatar has-photo" aria-hidden="true"><img src="${escapeHTML(item.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
      : `<span class="avatar" aria-hidden="true" style="background:${avatarColor(item.handle || item.displayName)};color:#fff">${escapeHTML(avatarInitial(item))}</span>`}
    <div class="content">
      <div class="byline"><span class="name">@${escapeHTML(item.handle)}</span>${item.editedAt ? '<span class="meta">· edited</span>' : ''}<span class="meta posttime"${item.createdAt ? ` data-created="${escapeHTML(item.createdAt)}"` : ''}>${escapeHTML(item.time)}</span></div>
      ${noteLine}
      <div class="srccard">
        <div class="srchead">${chip ? `<span class="chip">${escapeHTML(chip)}</span>` : ''}${favicon ? `<img class="favicon" src="${escapeHTML(favicon)}" alt="" loading="lazy" />` : ''}<span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(item.type)}</span></div>
        ${timelineMedia(item)}
        ${quote}
      </div>
      <div class="actions">
        <a class="act" href="${escapeHTML(item.url)}" target="_blank" rel="noreferrer" title="Open responses" aria-label="Open responses">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-8 8H4l3-3a8 8 0 1 1 14-5z"/></svg>
          ${item.comments ? `<span class="n">${item.comments}</span>` : ''}
        </a>
        <button class="act${item.likedByMe ? ' is-liked' : ''}" type="button" data-like-slug="${escapeHTML(item.slug)}" aria-label="${item.likedByMe ? 'Unlike' : 'Like'} this annotation">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
          ${item.likes ? `<span class="n">${item.likes}</span>` : ''}
        </button>
        ${item.type === 'article' && item.quote && (panelMode === 'page' || matchesCurrentTab(item)) ? `<button class="act" type="button" data-highlight-slug="${escapeHTML(item.slug)}" title="Highlight this passage on the page" aria-label="Highlight this passage on the page">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>` : ''}
        <a class="act primary" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-open-slug="${escapeHTML(item.slug)}" title="${escapeHTML(openOriginalLabel(item))}${item.opens ? ` — ${item.opens} ${item.opens === 1 ? 'open' : 'opens'} of the original` : ''}" aria-label="${escapeHTML(openOriginalLabel(item))}${item.opens ? ` — ${item.opens} ${item.opens === 1 ? 'open' : 'opens'} of the original` : ''}">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 5h5v5M19 5l-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>
          ${item.opens ? `<span class="n">${item.opens}</span>` : ''}
        </a>
        <button class="act share" type="button" data-share-url="${escapeHTML(item.url)}" title="Copy the page link" aria-label="Copy the page link">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v12M8 7l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>
        </button>
      </div>
    </div>
  </article>`;
};

const skeletonPost = () => `
  <div class="post skeleton" aria-hidden="true">
    <div class="sk sk-avatar"></div>
    <div class="content">
      <div class="sk sk-line" style="width:40%"></div>
      <div class="sk sk-line" style="width:85%"></div>
      <div class="sk sk-card"></div>
    </div>
  </div>`;

const syncTabs = () => {
  document.querySelectorAll('[data-feed-tab]').forEach((tabButton) => {
    const active = tabButton.dataset.feedTab === panelMode;
    tabButton.classList.toggle('is-active', active);
    tabButton.setAttribute('aria-selected', String(active));
    tabButton.tabIndex = active ? 0 : -1; // roving tabindex, arrows move between tabs
  });
  captureSection.hidden = panelMode !== 'capture';
  timeline.hidden = panelMode === 'capture';
};

// The real ARIA tabs pattern: arrow keys walk and activate the modes.
document.querySelector('.tabs')?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('.tabs [data-feed-tab]')];
  const index = tabs.indexOf(document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  setPanelMode(next.dataset.feedTab);
  next.focus();
});

const renderTimeline = () => {
  syncTabs();
  if (panelMode === 'capture') return;
  const cache = feedCache[panelMode];
  if (!cache) {
    timeline.innerHTML = `${skeletonPost()}${skeletonPost()}`;
    return;
  }
  if (cache.error === 'auth') {
    timeline.innerHTML = `<div class="empty"><h2>Sign in to see the people you follow.</h2><p>One account across the extension, the web, and the app.</p><button type="button" data-open-signin>Sign in</button></div>`;
    return;
  }
  if (cache.error === 'offline') {
    timeline.innerHTML = `<div class="state">You’re offline. The timeline returns with the connection — reconnecting automatically.</div>`;
    return;
  }
  if (cache.error) {
    timeline.innerHTML = `<div class="state">The timeline could not be loaded. <button type="button" data-feed-retry>Try again</button></div>`;
    return;
  }
  if (!cache.items.length) {
    const mark = '<img class="mark" src="icons/icon-128.png" alt="" aria-hidden="true" />';
    // "Yours would be the first" is a lie on chrome:// — nobody's can be.
    const pageEmpty = /^https?:/.test(currentTab.url || '')
      ? `<div class="empty">${mark}<h2>No annotations on this page yet.</h2><p>Yours would be the first.</p><button type="button" data-focus-note>Write the first note</button></div>`
      : `<div class="empty">${mark}<h2>This page can’t be annotated.</h2><p>Open a video, article, or podcast and the margin opens with it.</p></div>`;
    timeline.innerHTML = panelMode === 'page'
      ? pageEmpty
      : `<div class="empty">${mark}<h2>${panelMode === 'following' ? 'No annotations from people you follow yet.' : 'No public annotations yet.'}</h2><p>${panelMode === 'following' ? 'Follow someone whose context you want to keep up with.' : 'Capture the first source-backed moment and it will appear here.'}</p>${panelMode === 'following' ? '<button type="button" data-feed-tab-jump="recent">Browse Recent</button>' : ''}</div>`;
    return;
  }
  timeline.innerHTML = `${cache.items.map(timelinePost).join('')}${cache.nextCursor ? '<button class="load-more" type="button" data-load-more>Load more</button>' : ''}`;
  // The stagger plays only on a feed's first paint — never on the in-place
  // re-renders a like or retry causes.
  if (freshFeedTab === panelMode) {
    freshFeedTab = null;
    timeline.classList.add('is-fresh');
    setTimeout(() => timeline.classList.remove('is-fresh'), 450);
  }
};

const patchLikeButton = (button, liked, likes) => {
  button.classList.toggle('is-liked', liked);
  button.setAttribute('aria-label', `${liked ? 'Unlike' : 'Like'} this annotation`);
  let count = button.querySelector('.n');
  if (likes > 0) {
    if (!count) { count = document.createElement('span'); count.className = 'n'; button.append(count); }
    count.textContent = likes;
  } else {
    count?.remove();
  }
};

const setPanelMode = (mode) => {
  panelMode = mode;
  renderTimeline();
  // Warm caches render instantly and revalidate quietly in the background —
  // returning to Recent never shows the first fetch forever, and a
  // just-published clip picks up its processed media on re-entry.
  if (mode !== 'capture') void loadTimeline(mode, { background: Boolean(feedCache[mode]) });
};

const loadTimeline = async (tab, { background = false, append = false } = {}) => {
  if (tab === 'capture') return;
  if (!backendOnline) {
    if (!feedCache[tab]) {
      feedCache[tab] = { items: [], error: 'offline' };
      if (tab === panelMode) renderTimeline();
    }
    return;
  }
  if (!feedCache[tab] && !append) {
    feedCache[tab] = null;
    freshFeedTab = tab; // first paint of this feed gets the staggered entrance
    if (tab === panelMode) renderTimeline();
  }
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (tab === 'following') params.set('following', 'true');
    if (tab === 'page') {
      if (!/^https?:/.test(currentTab.url || '')) {
        feedCache.page = { items: [] };
        if (tab === panelMode) renderTimeline();
        return;
      }
      params.set('url', currentTab.url);
    }
    if (append && feedCache[tab]?.nextCursor) params.set('cursor', feedCache[tab].nextCursor);
    const result = await apiRequest(`/api/feed?${params}`);
    const items = (result.annotations || []).map(annotationToItem);
    feedCache[tab] = append && feedCache[tab]?.items
      ? { items: [...feedCache[tab].items, ...items], nextCursor: result.nextCursor || null }
      : { items, nextCursor: result.nextCursor || null };
  } catch (feedError) {
    // A failed background revalidate or append never clobbers a good cache.
    if (!background && !append) {
      feedCache[tab] = { items: [], error: feedError.authRequired ? 'auth' : (feedError.retryable ? 'offline' : 'load') };
    }
  }
  if (tab === panelMode) renderTimeline();
};

document.querySelectorAll('[data-feed-tab]').forEach((tabButton) => tabButton.addEventListener('click', () => {
  setPanelMode(tabButton.dataset.feedTab);
}));

timeline.addEventListener('click', async (event) => {
  if (event.target.closest('[data-open-signin]')) { openSignin(); return; }
  const shot = event.target.closest('.srcmedia img');
  if (shot) { openShotVeil(shot.src, shot); return; }
  const jump = event.target.closest('[data-feed-tab-jump]');
  if (jump) { setPanelMode(jump.dataset.feedTabJump); return; }
  const more = event.target.closest('[data-load-more]');
  if (more) {
    more.disabled = true;
    await loadTimeline(panelMode, { append: true });
    return;
  }
  const share = event.target.closest('[data-share-url]');
  if (share) {
    try {
      await navigator.clipboard.writeText(share.dataset.shareUrl);
      showToast('Link copied');
    } catch {
      showToast(share.dataset.shareUrl);
    }
    return;
  }
  const open = event.target.closest('[data-open-slug]');
  if (open) { void recordOpen(open.dataset.openSlug); return; }
  const like = event.target.closest('[data-like-slug]');
  if (like) {
    if (!(await extensionStorage.getAuthToken().catch(() => null))) { openSignin(); return; }
    const slug = like.dataset.likeSlug;
    const entries = Object.values(feedCache).flatMap((cache) => cache?.items || []).filter((entry) => entry.slug === slug);
    if (!entries.length) return;
    const liked = Boolean(entries[0].likedByMe);
    for (const entry of entries) { entry.likedByMe = !liked; entry.likes = Math.max(0, (entry.likes || 0) + (liked ? -1 : 1)); }
    // Patch the one button in place — a full re-render would destroy focus,
    // hover, and any clip mid-play for the sake of one heart.
    patchLikeButton(like, !liked, entries[0].likes);
    retrigger(like, 'just-liked');
    try {
      await apiRequest(`/api/annotations/${encodeURIComponent(slug)}/${liked ? 'unlike' : 'like'}`, { method: 'POST' });
    } catch (likeError) {
      for (const entry of entries) { entry.likedByMe = liked; entry.likes = Math.max(0, (entry.likes || 0) + (liked ? 1 : -1)); }
      renderTimeline(); // a failed round-trip earns the rebuild
      if (likeError.authRequired) { setAuthState(false); openSignin(); } else showToast('Like could not be saved.');
    }
    return;
  }
  const highlight = event.target.closest('[data-highlight-slug]');
  if (highlight) {
    const item = (feedCache[panelMode]?.items || []).find((entry) => entry.slug === highlight.dataset.highlightSlug);
    if (item) void showOnPage(item);
    return;
  }
  if (event.target.closest('[data-feed-retry]')) { feedCache[panelMode] = null; renderTimeline(); await loadTimeline(panelMode); return; }
  if (event.target.closest('[data-focus-note]')) { setPanelMode('capture'); note.focus(); }
});

/* ── queue status ──────────────────────────────────────────────────── */

const refreshQueueStatus = async () => {
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  queueStatus.hidden = captures.length === 0;
  if (!captures.length) return;
  const queued = captures.filter((capture) => capture.status === 'queued').length;
  const needsAuth = captures.filter((capture) => capture.status === 'needs-auth').length;
  const blocked = captures.filter((capture) => capture.status === 'blocked').length;
  const token = await extensionStorage.getAuthToken().catch(() => null);
  queueStatus.dataset.state = needsAuth ? 'needs-auth' : blocked ? 'blocked' : 'queued';
  queueStatusTitle.textContent = needsAuth ? 'Sign in to finish this capture' : blocked ? 'Capture needs attention' : 'Capture waiting to retry';
  queueStatusDetail.textContent = [
    queued ? `${queued} queued` : '',
    needsAuth ? `${needsAuth} needs sign-in` : '',
    blocked ? `${blocked} blocked — review and retry` : '',
  ].filter(Boolean).join(' · ');
  queueRetry.textContent = needsAuth && !token ? 'Sign in' : 'Retry now';
};

queueRetry.addEventListener('click', async () => {
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  const needsAuth = captures.some((capture) => capture.status === 'needs-auth');
  if (needsAuth && !(await extensionStorage.getAuthToken().catch(() => null))) {
    setAuthState(false);
    openSignin();
    return;
  }
  for (const capture of captures) await extensionStorage.retryPendingCapture(capture.id);
  await chrome.runtime.sendMessage({ type: 'RETRY_PENDING' }).catch(() => {});
  await refreshQueueStatus();
});

// A queued capture the background published quietly: clear the matching
// draft so nobody double-publishes, and say what happened with the link.
const consumeQueuePublished = async () => {
  try {
    const { annotatedQueuePublished } = await chrome.storage.local.get('annotatedQueuePublished');
    if (!annotatedQueuePublished) return;
    await chrome.storage.local.remove('annotatedQueuePublished');
    if (annotatedQueuePublished.sourceUrl && annotatedQueuePublished.sourceUrl === currentTab.url) {
      resetCaptureState();
      await extensionStorage.clearTabDraft(currentTabId).catch(() => {});
      syncSource();
      syncNote();
      syncComposer();
    }
    showToast('Queued capture published', annotatedQueuePublished.url ? { href: annotatedQueuePublished.url, label: 'View page' } : null);
  } catch { /* nothing recorded */ }
};

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[PENDING_KEY]) void refreshQueueStatus();
  if (areaName === 'local' && changes.annotatedQueuePublished?.newValue) void consumeQueuePublished();
});

/* ── auth ──────────────────────────────────────────────────────────── */

// One door: the header holds a single Sign in button; the providers wait
// behind it in a modal.
const anyProviderAvailable = () => Object.keys(availableProviders).some((provider) => availableProviders[provider]);

const setAuthState = (signedIn, user = panelUser) => {
  panelUser = signedIn ? user : null;
  meButton.hidden = !signedIn;
  if (signedIn) {
    meButton.textContent = String(user?.handle || user?.displayName || 'A').slice(0, 1).toUpperCase();
    meName.textContent = `@${user?.handle || 'you'}`;
  } else {
    meMenu.hidden = true;
    meButton.setAttribute('aria-expanded', 'false');
  }
  signInOpen.hidden = signedIn || !anyProviderAvailable();
  signinVeil.querySelectorAll('[data-auth]').forEach((button) => { button.hidden = !availableProviders[button.dataset.auth]; });
  if (signedIn) closeSignin();
};

let signinReturnFocus = null;
const signinContext = $('#signinContext');
const openSignin = (context = '') => {
  if (!anyProviderAvailable()) { showError('Sign-in is not configured on this backend.'); return; }
  signinVeil.classList.remove('is-closing');
  signinContext.textContent = context;
  signinContext.hidden = !context;
  signinReturnFocus = document.activeElement;
  signinVeil.hidden = false;
  signinVeil.querySelector('[data-auth]:not([hidden])')?.focus();
};

const closeSignin = () => {
  if (signinVeil.hidden || signinVeil.classList.contains('is-closing')) return;
  const finish = () => {
    signinVeil.classList.remove('is-closing');
    signinVeil.hidden = true;
    signinContext.hidden = true;
    if (signinReturnFocus?.isConnected && !signinReturnFocus.hidden) signinReturnFocus.focus();
    signinReturnFocus = null;
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  signinVeil.classList.add('is-closing');
  setTimeout(finish, 140);
};

signInOpen.addEventListener('click', openSignin);
signinCancel.addEventListener('click', closeSignin);
signinVeil.addEventListener('click', (event) => { if (event.target === signinVeil) closeSignin(); });

signinVeil.querySelectorAll('[data-auth]').forEach((button) => button.addEventListener('click', async () => {
  closeSignin(); // the system auth window takes the stage
  try {
    const user = await signIn(button.dataset.auth);
    setAuthState(true, user);
    clearError();
    await chrome.runtime.sendMessage({ type: 'RETRY_PENDING' }).catch(() => {});
    await refreshQueueStatus();
    feedCache.following = null;
    if (panelMode === 'following') await loadTimeline('following');
  } catch (authError) {
    // Closing the OAuth window is a decision, not a failure — stay quiet.
    if (/clos|cancel|did not approve/i.test(authError?.message || '')) return;
    showError(authError.message || 'Sign-in failed.');
  }
}));

// The avatar opens a small menu instead of being a one-click sign-out
// landmine: who you are, your public page, the settings the panel never
// linked to before, and sign out — deliberately last.
const setMenuOpen = (open) => {
  meMenu.hidden = !open;
  meButton.setAttribute('aria-expanded', String(open));
  if (open) meMenu.querySelector('[role="menuitem"]')?.focus();
};

meButton.addEventListener('click', () => setMenuOpen(meMenu.hidden));

document.addEventListener('click', (event) => {
  if (!meMenu.hidden && !event.target.closest('#authActions')) setMenuOpen(false);
});

document.querySelector('#menuProfile').addEventListener('click', async () => {
  setMenuOpen(false);
  const origin = await apiOrigin();
  const handle = panelUser?.handle || '';
  await chrome.tabs.create({ url: `${origin}/u/${encodeURIComponent(handle)}` }).catch(() => {});
});

document.querySelector('#menuSettings').addEventListener('click', () => {
  setMenuOpen(false);
  chrome.runtime.openOptionsPage?.();
});

document.querySelector('#menuSignOut').addEventListener('click', async () => {
  setMenuOpen(false);
  try {
    await signOut();
    setAuthState(false);
    feedCache.following = null;
    clearError();
    if (panelMode === 'following') await loadTimeline('following');
  } catch (signOutError) { showError(signOutError.message || 'Sign out failed.'); }
});

/* ── backend ───────────────────────────────────────────────────────── */

// Offline is a state to recover from, not a verdict: retries back off
// 5s → 30s, the OS 'online' signal short-circuits the wait, and the header
// chip doubles as a click-to-retry. On recovery, errored feeds reload and
// the source resolves — the panel picks itself back up.
let backendRetryTimer;
let backendRetryDelay = 5000;
const scheduleBackendRetry = () => {
  clearTimeout(backendRetryTimer);
  backendRetryTimer = setTimeout(() => { void checkBackend(); }, backendRetryDelay);
  backendRetryDelay = Math.min(backendRetryDelay * 2, 30000);
};

const checkBackend = async () => {
  const origin = await apiOrigin();
  apiOriginCache = origin;
  const wasOnline = backendOnline;
  clearTimeout(backendRetryTimer);
  try {
    await apiRequest('/api/health');
    backendOnline = true;
    backendRetryDelay = 5000;
    backendStatus.classList.add('is-live');
    backendStatus.querySelector('.backend-label').textContent = 'connected';
    backendStatus.removeAttribute('title');
    const auth = await apiRequest('/api/auth/providers').catch(() => ({ providers: {} }));
    availableProviders = auth.providers || {};
    let signedIn = Boolean(await extensionStorage.getAuthToken().catch(() => null));
    let user = null;
    if (signedIn) {
      try {
        const me = await apiRequest('/api/me');
        if (me.authenticated === false) {
          await extensionStorage.clearAuthSession().catch(() => {});
          signedIn = false;
        } else {
          user = me.user;
        }
      } catch {
        signedIn = Boolean(await extensionStorage.getAuthToken().catch(() => null));
      }
    }
    setAuthState(signedIn, user);
    await refreshQueueStatus();
    if (wasOnline === false) {
      clearError();
      for (const key of Object.keys(feedCache)) { if (feedCache[key]?.error) feedCache[key] = null; }
      renderTimeline();
      if (panelMode !== 'capture') void loadTimeline(panelMode);
      if (!resolvedSource) void loadCurrentTab();
    }
  } catch {
    backendOnline = false;
    backendStatus.classList.remove('is-live');
    backendStatus.querySelector('.backend-label').textContent = 'offline';
    backendStatus.setAttribute('title', 'Retry now');
    if (wasOnline !== false) showError('Can’t reach annotated right now — retrying quietly. Captures queue locally.');
    scheduleBackendRetry();
  }
};

backendStatus.addEventListener('click', () => {
  if (backendOnline) return;
  backendRetryDelay = 5000;
  void checkBackend();
});

window.addEventListener('online', () => {
  if (backendOnline) return;
  backendRetryDelay = 5000;
  void checkBackend();
});

/* ── keyboard: I/O marks, Ctrl/Cmd+Enter publish, Esc clears ───────── */

document.addEventListener('keydown', (event) => {
  // The account menu is a real menu: arrows walk it, Esc puts it away.
  if (!meMenu.hidden) {
    if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); meButton.focus(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...meMenu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      const next = index === -1 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next].focus();
      return;
    }
  }
  // The screenshot veil has one control; Tab stays on it, Esc closes.
  if (!shotVeil.hidden) {
    if (event.key === 'Tab') { event.preventDefault(); shotVeilClose.focus(); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeShotVeil(); return; }
  }
  // The sign-in door holds focus: Tab cycles inside it, never behind the veil.
  if (!signinVeil.hidden && event.key === 'Tab') {
    const focusables = [...signinVeil.querySelectorAll('button, a[href]')].filter((el) => !el.hidden);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!signinVeil.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    return;
  }
  const inField = event.target.closest('input, textarea, select');
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    publishButton.click();
    return;
  }
  if (inField) return;
  if (isMediaType() && (event.key === 'i' || event.key === 'I')) {
    event.preventDefault();
    void captureMark('in');
    return;
  }
  if (isMediaType() && (event.key === 'o' || event.key === 'O')) {
    event.preventDefault();
    void captureMark('out');
    return;
  }
  if (isMediaType() && (event.key === 'l' || event.key === 'L')) {
    event.preventDefault();
    void captureLastN(30);
    return;
  }
  if (event.key === 'Escape') {
    if (!signinVeil.hidden) { closeSignin(); return; }
    // Esc clears, but never destroys: the cleared capture waits behind
    // Ctrl/Cmd+Z until the next capture replaces it.
    if (currentTab.sourceType === 'article' && selection.text) {
      lastCleared = { kind: 'selection', value: selection };
      selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
      syncSelectionCard();
      saveDraft();
      showToast('Selection cleared — Ctrl/Cmd+Z restores it');
    } else if (isMediaType() && (marks.inSet || marks.outSet)) {
      lastCleared = { kind: 'marks', value: marks };
      marks = { start: 0, end: 0, inSet: false, outSet: false };
      syncMarks();
      saveDraft();
      showToast('Marks cleared — Ctrl/Cmd+Z restores them');
    }
    return;
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === 'z' || event.key === 'Z') && lastCleared && !event.target.closest('input, textarea')) {
    event.preventDefault();
    if (lastCleared.kind === 'selection') { selection = lastCleared.value; syncSelectionCard(); }
    if (lastCleared.kind === 'marks') { marks = lastCleared.value; syncMarks(); }
    lastCleared = null;
    saveDraft();
  }
});

/* ── boot ──────────────────────────────────────────────────────────── */

// Opening the panel counts as seeing your notifications: the server-side
// watermark moves, and the background worker drops the toolbar badge.
// The toolbar badge made a promise; keep it. Before the watermark moves,
// show what arrived — a digest strip naming the count and the latest event,
// opening the full notifications page on the web.
const notifDigest = $('#notifDigest');
const notifDigestCount = $('#notifDigestCount');
const notifDigestDetail = $('#notifDigestDetail');

const notificationSentence = (item) => {
  const actor = item?.actor?.displayName || (item?.actor?.handle ? `@${item.actor.handle}` : 'Someone');
  if (item?.type === 'response') return `${actor} responded to your annotation`;
  if (item?.type === 'like') return `${actor} liked your annotation`;
  if (item?.type === 'follow') return `${actor} followed you`;
  return `${actor} — new activity`;
};

notifDigest.addEventListener('click', async () => {
  notifDigest.hidden = true;
  const origin = await apiOrigin();
  window.open(`${origin}/notifications`, '_blank', 'noreferrer');
});

const markNotificationsSeen = async () => {
  try {
    const headers = await authHeaders();
    if (!headers.authorization) return;
    try {
      const digest = await apiRequest('/api/notifications');
      const unseen = Number(digest.unseenCount) || 0;
      if (unseen > 0) {
        notifDigestCount.textContent = unseen > 9 ? '9+' : String(unseen);
        notifDigestDetail.textContent = notificationSentence((digest.notifications || [])[0]);
        notifDigest.hidden = false;
      }
    } catch { /* the digest is a courtesy; the watermark still moves below */ }
    await fetch(`${await apiOrigin()}/api/notifications/seen`, { method: 'POST', headers });
    await chrome.runtime.sendMessage({ type: 'NOTIFICATIONS_SEEN' });
  } catch { /* offline or signed out — the badge keeps its count */ }
};

// First run only: frame the loop once (capture → your take → a public page
// with the source attached), then never speak of it again.
const introCard = $('#introCard');
const introGot = $('#introGot');
introGot.addEventListener('click', async () => {
  introCard.hidden = true;
  await chrome.storage.local.set({ annotatedIntroSeen: true }).catch(() => {});
});

const showIntroIfFirstRun = async () => {
  try {
    const { annotatedIntroSeen } = await chrome.storage.local.get('annotatedIntroSeen');
    introCard.hidden = Boolean(annotatedIntroSeen);
  } catch { /* stays hidden — the intro is a courtesy, not a gate */ }
};

const boot = async () => {
  await showIntroIfFirstRun();
  syncSource();
  syncNote();
  syncComposer();
  renderTimeline();
  // The tab and the backend are independent — read them in parallel so the
  // capture strip is truthful immediately instead of waiting out a cold
  // backend round-trip.
  await Promise.all([checkBackend(), loadCurrentTab()]);
  // Source resolution is gated on the backend being online; if the tab won
  // the race, run the light same-tab pass now that the backend answered.
  if (backendOnline && !resolvedSource) await loadCurrentTab();
  await consumePendingGrab();
  await consumeQueuePublished();
  await loadTimeline('recent');
  await refreshQueueStatus();
  await markNotificationsSeen();
};

void boot();
