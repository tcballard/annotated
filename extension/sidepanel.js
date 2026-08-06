import { extensionStorage, PENDING_KEY } from './storage.js';
import { apiOrigin, authHeaders, signIn, signOut } from './config.js';
import { clampAudioDuration, MAX_AUDIO_SECONDS, preferredAudioMimeType } from './audio.js';
import { deleteAudioDraft, readAudioDraft, stageAudioDraft } from './media-draft-store.js';
import { MAX_CLIP_SECONDS } from './clip-range.js';
import { isTopic, TOPICS } from './topics.js';
import { openOriginalHref, openOriginalLabel } from './deep-link.js';
import { avatarColor, avatarInitial } from './avatar.js';

const $ = (selector) => document.querySelector(selector);

const sourceTitle = $('#sourceTitle');
const typeSelect = $('#typeSelect');
const capUnsupported = $('#capUnsupported');
const mediaSelection = $('#mediaSelection');
const textSelection = $('#textSelection');
const markIn = $('#markIn');
const markOut = $('#markOut');
const markInTime = $('#markInTime');
const markOutTime = $('#markOutTime');
const durationChip = $('#durationChip');
const markNote = $('#markNote');
const manualMarks = $('#manualMarks');
const manualIn = $('#manualIn');
const manualOut = $('#manualOut');
const overReason = $('#overReason');
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
const signOutButton = $('#signOut');
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
const feedCache = { recent: null, following: null, page: null };

const format = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

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
  document.querySelector('.pub-moment')?.remove();
};

const showPublishMoment = (title) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  dismissPublishMoment();
  const moment = document.createElement('div');
  moment.className = 'pub-moment';
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
  try {
    response = await fetch(`${await apiOrigin()}${path}`, { credentials: 'omit', headers: { 'content-type': 'application/json', ...(await authHeaders()), ...(options.headers || {}) }, ...options });
  } catch (requestError) {
    requestError.retryable = true;
    throw requestError;
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

const syncPublishGate = () => {
  const blocker = publishBlocker();
  publishButton.disabled = Boolean(blocker);
  publishHint.textContent = blocker || 'Marks follow the player. Nothing is published until you publish.';
};

const syncMarks = () => {
  const length = Math.max(0, marks.end - marks.start);
  markInTime.textContent = format(marks.start);
  markOutTime.textContent = format(marks.end);
  markIn.classList.toggle('is-set', marks.inSet);
  markOut.classList.toggle('is-set', marks.outSet);
  durationChip.textContent = format(length);
  const over = length > MAX_CLIP_SECONDS;
  durationChip.classList.toggle('is-over', over);
  overReason.hidden = !over;
  if (over) overReason.textContent = `Clips are capped at ${format(MAX_CLIP_SECONDS)}. Shorten the selection.`;
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
  typeSelect.value = currentTab.sourceType;
  const supported = /^https?:/.test(currentTab.url || '');
  capUnsupported.hidden = supported;
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
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  mediaRecorder = null;
  selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
  marks = { start: 0, end: 0, inSet: false, outSet: false };
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
  }
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  currentTab = { url, title: tab.title || host || 'This tab', host, sourceType: currentTab.sourceType || 'article', duration: 0 };
  currentTab.sourceType = await detectSourceType(tab.id, url);
  if (changed) {
    const draft = await extensionStorage.getTabDraft(currentTabId).catch(() => null);
    if (draft && draft.sourceUrl === url) restoreDraft(draft);
  }
  resolvedSource = null;
  syncSource();
  syncNote();
  syncComposer();
  draftReady = true;
  if (backendOnline && /^https?:/.test(url)) {
    try {
      resolvedSource = await resolveSourceUrl(url, currentTab.title);
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
  if (changeInfo.status === 'complete') void loadCurrentTab();
});

/* ── marks ─────────────────────────────────────────────────────────── */

const captureMark = async (boundary) => {
  if (panelMode !== 'capture') setPanelMode('capture');
  const player = await readPlayerTime();
  if (!player) {
    manualMarks.hidden = false;
    markNote.innerHTML = 'No player found on this tab — type the times instead.';
    manualIn.focus();
    return;
  }
  if (player.duration && !currentTab.duration) currentTab.duration = player.duration;
  if (boundary === 'in') {
    marks.start = player.time;
    marks.inSet = true;
    if (!marks.outSet || marks.end < marks.start) { marks.end = marks.start; marks.outSet = marks.outSet && marks.end >= marks.start; }
  } else {
    marks.end = player.time;
    marks.outSet = true;
    if (!marks.inSet || marks.start > marks.end) { marks.start = Math.max(0, marks.end); marks.inSet = true; }
  }
  syncMarks();
  saveDraft();
};

markIn.addEventListener('click', () => { void captureMark('in'); });
markOut.addEventListener('click', () => { void captureMark('out'); });

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
  syncMarks();
  saveDraft();
};

manualIn.addEventListener('change', () => applyManualMark('in', manualIn));
manualOut.addEventListener('change', () => applyManualMark('out', manualOut));

/* ── article selection ─────────────────────────────────────────────── */

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
    setAudioStatus('Recording your take…', `Press to stop · max ${format(MAX_AUDIO_SECONDS)}`);
    recordingTimer = setInterval(() => {
      audioDurationSeconds = clampAudioDuration((Date.now() - recordingStartedAt) / 1000);
      setAudioStatus('Recording your take…', `Press to stop · max ${format(MAX_AUDIO_SECONDS)}`);
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
});

publishButton.addEventListener('click', async () => {
  clearError();
  const blocker = publishBlocker();
  if (blocker) { publishHint.textContent = blocker; return; }
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
    syncPublishGate();
  }
});

/* ── timeline ──────────────────────────────────────────────────────── */

const timelineMedia = (item) => {
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'video') {
    return `<div class="srcmedia"><video controls preload="metadata" src="${escapeHTML(item.clipUrl)}"></video><span class="cliptag">CLIP</span><span class="badge">${escapeHTML(format(clipSeconds))} · 240p</span></div>`;
  }
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'podcast') {
    return `<div class="srcmedia srcmedia-audio"><span class="cliptag">CLIP</span><audio controls preload="none" src="${escapeHTML(item.clipUrl)}"></audio></div>`;
  }
  if (item.screenshotUrl) {
    return `<div class="srcmedia"><img loading="lazy" src="${escapeHTML(item.screenshotUrl)}" alt="Screenshot of ${escapeHTML(item.sourceTitle)}" /></div>`;
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
  return `
  <article class="post">
    ${item.avatarUrl
      ? `<span class="avatar has-photo" aria-hidden="true"><img src="${escapeHTML(item.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
      : `<span class="avatar" aria-hidden="true" style="background:${avatarColor(item.handle || item.displayName)};color:#fff">${escapeHTML(avatarInitial(item))}</span>`}
    <div class="content">
      <div class="byline"><span class="name">@${escapeHTML(item.handle)}</span>${item.editedAt ? '<span class="meta">· edited</span>' : ''}<span class="meta posttime">${escapeHTML(item.time)}</span></div>
      ${noteLine}
      <div class="srccard">
        <div class="srchead">${chip ? `<span class="chip">${escapeHTML(chip)}</span>` : ''}<span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(item.type)}</span></div>
        ${timelineMedia(item)}
        ${quote}
      </div>
      <div class="actions">
        <a class="act primary" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-open-slug="${escapeHTML(item.slug)}" title="${escapeHTML(openOriginalLabel(item))}">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 5h5v5M19 5l-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>
          Open${item.opens ? ` <span class="n">${item.opens}</span>` : ''}
        </a>
        <a class="act" href="${escapeHTML(item.url)}" target="_blank" rel="noreferrer" title="Open responses">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-8 8H4l3-3a8 8 0 1 1 14-5z"/></svg>
          ${item.comments ? `<span class="n">${item.comments}</span>` : 'Respond'}
        </a>
        <button class="act${item.likedByMe ? ' is-liked' : ''}" type="button" data-like-slug="${escapeHTML(item.slug)}" aria-label="${item.likedByMe ? 'Unlike' : 'Like'} this annotation">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
          ${item.likes ? `<span class="n">${item.likes}</span>` : ''}
        </button>
        ${item.type === 'article' && item.quote && (panelMode === 'page' || matchesCurrentTab(item)) ? `<button class="act" type="button" data-highlight-slug="${escapeHTML(item.slug)}" title="Highlight this passage on the page">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          On page
        </button>` : ''}
        <button class="act share" type="button" data-share-url="${escapeHTML(item.url)}" title="Copy the page link">
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
  });
  captureSection.hidden = panelMode !== 'capture';
  timeline.hidden = panelMode === 'capture';
};

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
  if (cache.error) {
    timeline.innerHTML = `<div class="state">The timeline could not be loaded. <button type="button" data-feed-retry>Try again</button></div>`;
    return;
  }
  if (!cache.items.length) {
    const mark = '<img class="mark" src="icons/icon-128.png" alt="" aria-hidden="true" />';
    timeline.innerHTML = panelMode === 'page'
      ? `<div class="empty">${mark}<h2>No annotations on this page yet.</h2><p>Yours would be the first.</p><button type="button" data-focus-note>Write the first note</button></div>`
      : `<div class="empty">${mark}<h2>${panelMode === 'following' ? 'No annotations from people you follow yet.' : 'No public annotations yet.'}</h2><p>${panelMode === 'following' ? 'Follow someone whose context you want to keep up with.' : 'Capture the first source-backed moment and it will appear here.'}</p></div>`;
    return;
  }
  timeline.innerHTML = cache.items.map(timelinePost).join('');
};

const setPanelMode = (mode) => {
  panelMode = mode;
  renderTimeline();
  if (mode !== 'capture' && !feedCache[mode]) void loadTimeline(mode);
};

const loadTimeline = async (tab) => {
  if (tab === 'capture') return;
  if (!backendOnline) {
    feedCache[tab] = { items: [], error: 'offline' };
    if (tab === panelMode) renderTimeline();
    return;
  }
  if (!feedCache[tab]) {
    feedCache[tab] = null;
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
    const result = await apiRequest(`/api/feed?${params}`);
    feedCache[tab] = { items: (result.annotations || []).map(annotationToItem) };
  } catch (feedError) {
    feedCache[tab] = { items: [], error: feedError.authRequired ? 'auth' : 'load' };
  }
  if (tab === panelMode) renderTimeline();
};

document.querySelectorAll('[data-feed-tab]').forEach((tabButton) => tabButton.addEventListener('click', () => {
  setPanelMode(tabButton.dataset.feedTab);
}));

timeline.addEventListener('click', async (event) => {
  if (event.target.closest('[data-open-signin]')) { openSignin(); return; }
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
    renderTimeline();
    try {
      await apiRequest(`/api/annotations/${encodeURIComponent(slug)}/${liked ? 'unlike' : 'like'}`, { method: 'POST' });
    } catch (likeError) {
      for (const entry of entries) { entry.likedByMe = liked; entry.likes = Math.max(0, (entry.likes || 0) + (liked ? 1 : -1)); }
      renderTimeline();
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

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[PENDING_KEY]) void refreshQueueStatus();
});

/* ── auth ──────────────────────────────────────────────────────────── */

// One door: the header holds a single Sign in button; the providers wait
// behind it in a modal.
const anyProviderAvailable = () => Object.keys(availableProviders).some((provider) => availableProviders[provider]);

const setAuthState = (signedIn, user = panelUser) => {
  panelUser = signedIn ? user : null;
  signOutButton.hidden = !signedIn;
  if (signedIn) signOutButton.textContent = String(user?.handle || user?.displayName || 'A').slice(0, 1).toUpperCase();
  signInOpen.hidden = signedIn || !anyProviderAvailable();
  signinVeil.querySelectorAll('[data-auth]').forEach((button) => { button.hidden = !availableProviders[button.dataset.auth]; });
  if (signedIn) closeSignin();
};

let signinReturnFocus = null;
const openSignin = () => {
  if (!anyProviderAvailable()) { showError('Sign-in is not configured on this backend.'); return; }
  signinReturnFocus = document.activeElement;
  signinVeil.hidden = false;
  signinVeil.querySelector('[data-auth]:not([hidden])')?.focus();
};

const closeSignin = () => {
  if (signinVeil.hidden) return;
  signinVeil.hidden = true;
  if (signinReturnFocus?.isConnected && !signinReturnFocus.hidden) signinReturnFocus.focus();
  signinReturnFocus = null;
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
    showError(authError.message || 'Sign-in failed.');
  }
}));

signOutButton.addEventListener('click', async () => {
  try {
    await signOut();
    setAuthState(false);
    feedCache.following = null;
    clearError();
    if (panelMode === 'following') await loadTimeline('following');
  } catch (signOutError) { showError(signOutError.message || 'Sign out failed.'); }
});

/* ── backend ───────────────────────────────────────────────────────── */

const checkBackend = async () => {
  const origin = await apiOrigin();
  apiOriginCache = origin;
  try {
    await apiRequest('/api/health');
    backendOnline = true;
    backendStatus.classList.add('is-live');
    backendStatus.querySelector('.backend-label').textContent = 'live';
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
  } catch {
    backendOnline = false;
    backendStatus.classList.remove('is-live');
    backendStatus.querySelector('.backend-label').textContent = 'offline';
    showError(`Annotated backend unavailable at ${origin}. Check the extension API origin in settings.`);
  }
};

/* ── keyboard: I/O marks, Ctrl/Cmd+Enter publish, Esc clears ───────── */

document.addEventListener('keydown', (event) => {
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
  if (event.key === 'Escape') {
    if (!signinVeil.hidden) { closeSignin(); return; }
    if (currentTab.sourceType === 'article' && selection.text) {
      selection = { text: '', paragraph: 0, prefix: '', suffix: '' };
      syncSelectionCard();
      saveDraft();
    } else if (isMediaType() && (marks.inSet || marks.outSet)) {
      marks = { start: 0, end: 0, inSet: false, outSet: false };
      syncMarks();
      saveDraft();
    }
  }
});

/* ── boot ──────────────────────────────────────────────────────────── */

// Opening the panel counts as seeing your notifications: the server-side
// watermark moves, and the background worker drops the toolbar badge.
const markNotificationsSeen = async () => {
  try {
    const headers = await authHeaders();
    if (!headers.authorization) return;
    await fetch(`${await apiOrigin()}/api/notifications/seen`, { method: 'POST', headers });
    await chrome.runtime.sendMessage({ type: 'NOTIFICATIONS_SEEN' });
  } catch { /* offline or signed out — the badge keeps its count */ }
};

const boot = async () => {
  syncSource();
  syncNote();
  syncComposer();
  renderTimeline();
  await checkBackend();
  await loadCurrentTab();
  await loadTimeline('recent');
  await refreshQueueStatus();
  await markNotificationsSeen();
};

void boot();
