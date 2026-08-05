import { extensionStorage, PENDING_KEY } from './storage.js';
import { apiOrigin, authHeaders, signIn, signOut } from './config.js';
import { clampAudioDuration, MAX_AUDIO_SECONDS, preferredAudioMimeType } from './audio.js';
import { deleteAudioDraft, readAudioDraft, stageAudioDraft } from './media-draft-store.js';
import { MAX_CLIP_SECONDS } from './clip-range.js';
import { openOriginalHref, openOriginalLabel } from './deep-link.js';

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
const signOutButton = $('#signOut');
const queueStatus = $('#queueStatus');
const queueStatusTitle = $('#queueStatusTitle');
const queueStatusDetail = $('#queueStatusDetail');
const queueRetry = $('#queueRetry');
const timeline = $('#timeline');
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
let feedTab = 'recent';
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
  if (currentTab.sourceType === 'article' && !selection.text.trim()) return 'Highlight a passage on the page, then capture it.';
  if (isMediaType() && (!marks.inSet || !marks.outSet)) return 'Mark an in and an out point.';
  if (isMediaType() && marks.end - marks.start < 1) return 'The out mark must come after the in mark.';
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

const syncSource = () => {
  sourceTitle.textContent = currentTab.title || 'Reading this tab…';
  typeSelect.value = currentTab.sourceType;
  const supported = /^https?:/.test(currentTab.url || '');
  capUnsupported.hidden = supported;
  mediaSelection.hidden = !supported || !isMediaType();
  textSelection.hidden = !supported || isMediaType();
  syncMarks();
  syncSelectionCard();
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
  if (feedTab === 'page') await loadTimeline('page');
};

chrome.tabs?.onActivated?.addListener(() => { void loadCurrentTab(); });
chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') void loadCurrentTab();
});

/* ── marks ─────────────────────────────────────────────────────────── */

const captureMark = async (boundary) => {
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
  anchorParagraph: annotation.anchorParagraph || 0,
  anchorPrefix: annotation.anchorPrefix || '',
  anchorSuffix: annotation.anchorSuffix || '',
  opens: Number(annotation.opens) || 0,
  comments: Array.isArray(annotation.comments) ? annotation.comments.length : 0,
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
    // optimistic insert at the top of the timeline
    const item = annotationToItem(annotation);
    for (const key of ['recent', 'page']) {
      if (feedCache[key]?.items) feedCache[key].items.unshift(item);
    }
    renderTimeline();
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

const timelinePost = (item) => {
  const noteLine = item.commentary
    ? `<p class="note">${escapeHTML(item.commentary)}</p>`
    : `<p class="note">Audio note — listen on the page.</p>`;
  const chip = item.type === 'article'
    ? (item.anchorParagraph ? `¶ ${item.anchorParagraph}` : '¶')
    : `${format(item.clipStart)}–${format(item.clipEnd)}`;
  const quote = item.quote ? `<blockquote>&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  return `
  <article class="post">
    <div class="avatar" aria-hidden="true">${escapeHTML(item.initials)}</div>
    <div class="content">
      <div class="byline"><span class="name">@${escapeHTML(item.handle)}</span><span class="meta">· ${escapeHTML(item.time)}</span></div>
      ${noteLine}
      <div class="srccard">
        <div class="srchead"><span class="chip">${escapeHTML(chip)}</span><span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(item.type)}</span></div>
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
        <button class="act" type="button" data-share-url="${escapeHTML(item.url)}" title="Copy the page link">
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

const renderTimeline = () => {
  const cache = feedCache[feedTab];
  document.querySelectorAll('[data-feed-tab]').forEach((tabButton) => {
    const active = tabButton.dataset.feedTab === feedTab;
    tabButton.classList.toggle('is-active', active);
    tabButton.setAttribute('aria-selected', String(active));
  });
  if (!cache) {
    timeline.innerHTML = `${skeletonPost()}${skeletonPost()}`;
    return;
  }
  if (cache.error === 'auth') {
    timeline.innerHTML = `<div class="empty"><h2>Sign in to see the people you follow.</h2><p>Use the sign-in buttons in the header above.</p></div>`;
    return;
  }
  if (cache.error) {
    timeline.innerHTML = `<div class="state">The timeline could not be loaded. <button type="button" data-feed-retry>Try again</button></div>`;
    return;
  }
  if (!cache.items.length) {
    timeline.innerHTML = feedTab === 'page'
      ? `<div class="empty"><h2>No annotations on this page yet.</h2><p>Yours would be the first.</p><button type="button" data-focus-note>Write the first note</button></div>`
      : `<div class="empty"><h2>${feedTab === 'following' ? 'No annotations from people you follow yet.' : 'No public annotations yet.'}</h2><p>${feedTab === 'following' ? 'Follow someone from their page.' : 'Capture the first source-backed moment above.'}</p></div>`;
    return;
  }
  timeline.innerHTML = cache.items.map(timelinePost).join('');
};

const loadTimeline = async (tab = feedTab) => {
  if (!backendOnline) {
    feedCache[tab] = { items: [], error: 'offline' };
    if (tab === feedTab) renderTimeline();
    return;
  }
  if (!feedCache[tab]) {
    feedCache[tab] = null;
    if (tab === feedTab) renderTimeline();
  }
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (tab === 'following') params.set('following', 'true');
    if (tab === 'page') {
      if (!/^https?:/.test(currentTab.url || '')) {
        feedCache.page = { items: [] };
        if (tab === feedTab) renderTimeline();
        return;
      }
      params.set('url', currentTab.url);
    }
    const result = await apiRequest(`/api/feed?${params}`);
    feedCache[tab] = { items: (result.annotations || []).map(annotationToItem) };
  } catch (feedError) {
    feedCache[tab] = { items: [], error: feedError.authRequired ? 'auth' : 'load' };
  }
  if (tab === feedTab) renderTimeline();
};

document.querySelectorAll('[data-feed-tab]').forEach((tabButton) => tabButton.addEventListener('click', async () => {
  feedTab = tabButton.dataset.feedTab;
  renderTimeline();
  if (!feedCache[feedTab]) await loadTimeline(feedTab);
  else renderTimeline();
}));

timeline.addEventListener('click', async (event) => {
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
  if (event.target.closest('[data-feed-retry]')) { feedCache[feedTab] = null; renderTimeline(); await loadTimeline(feedTab); return; }
  if (event.target.closest('[data-focus-note]')) { note.focus(); }
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
    showError('Your session expired. Sign in again before retrying this capture.');
    setAuthState(false);
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

const setAuthState = (signedIn, user = panelUser) => {
  panelUser = signedIn ? user : null;
  signOutButton.hidden = !signedIn;
  if (signedIn) signOutButton.textContent = String(user?.handle || user?.displayName || 'A').slice(0, 1).toUpperCase();
  authActions.querySelectorAll('[data-auth]').forEach((button) => { button.hidden = signedIn || !availableProviders[button.dataset.auth]; });
};

authActions.querySelectorAll('[data-auth]').forEach((button) => button.addEventListener('click', async () => {
  try {
    const user = await signIn(button.dataset.auth);
    setAuthState(true, user);
    clearError();
    await chrome.runtime.sendMessage({ type: 'RETRY_PENDING' }).catch(() => {});
    await refreshQueueStatus();
    feedCache.following = null;
    if (feedTab === 'following') await loadTimeline('following');
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
    if (feedTab === 'following') await loadTimeline('following');
  } catch (signOutError) { showError(signOutError.message || 'Sign out failed.'); }
});

/* ── backend ───────────────────────────────────────────────────────── */

const checkBackend = async () => {
  const origin = await apiOrigin();
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

const boot = async () => {
  syncSource();
  syncNote();
  syncComposer();
  renderTimeline();
  await checkBackend();
  await loadCurrentTab();
  await loadTimeline('recent');
  await refreshQueueStatus();
};

void boot();
