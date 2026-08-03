import { extensionStorage } from './storage.js';
import { apiOrigin, authHeaders, signIn } from './config.js';
import { clampAudioDuration, MAX_AUDIO_SECONDS, preferredAudioMimeType } from './audio.js';
import { deleteAudioDraft, readAudioDraft, stageAudioDraft } from './media-draft-store.js';

const start = document.querySelector('#start');
const end = document.querySelector('#end');
const startNumber = document.querySelector('#startNumber');
const endNumber = document.querySelector('#endNumber');
const clipLength = document.querySelector('#clipLength');
const trackFill = document.querySelector('#trackFill');
const note = document.querySelector('#note');
const noteCount = document.querySelector('#noteCount');
const audioComposer = document.querySelector('#audioComposer');
const audioRecord = document.querySelector('#audioRecord');
const audioStatus = document.querySelector('#audioStatus');
const audioHint = document.querySelector('#audioHint');
const audioDuration = document.querySelector('#audioDuration');
const audioRetry = document.querySelector('#audioRetry');
const recordIcon = document.querySelector('.record-icon');
const stopIcon = document.querySelector('.stop-icon');
const success = document.querySelector('#success');
const successLink = document.querySelector('#successLink');
const error = document.querySelector('#error');
const backendStatus = document.querySelector('#backendStatus');
const selectionCard = document.querySelector('#selectionCard');
const selectionText = document.querySelector('#selectionText');
const authActions = document.querySelector('#authActions');

let currentTab = { url: '', title: 'Current browser tab', host: '', sourceType: 'article' };
let selectedText = '';
let commentaryMode = 'text';
let draftSaveTimer;
let draftReady = false;
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
let loadedTabUrl = '';
let clientRequestId = crypto.randomUUID();

const format = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

const classify = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube') || host === 'youtu.be') return 'video';
    if (host.includes('podcast') || host.includes('spotify') || host.includes('overcast') || host.includes('soundcloud')) return 'podcast';
  } catch { /* restricted or unavailable tab */ }
  return 'article';
};

const showError = (message) => {
  error.textContent = message;
  error.hidden = false;
  success.hidden = true;
};

const setAudioStatus = (status, hint = '') => {
  audioStatus.textContent = status;
  audioHint.textContent = hint;
  audioDuration.textContent = format(audioDurationSeconds);
  audioRetry.hidden = !audioDraftId || Boolean(audioAssetId) || audioUploadInFlight || Boolean(mediaRecorder?.state === 'recording');
  audioRecord.disabled = audioUploadInFlight;
  const isRecording = mediaRecorder?.state === 'recording';
  audioRecord.classList.toggle('is-recording', isRecording);
  audioRecord.setAttribute('aria-label', isRecording ? 'Stop recording' : 'Start recording');
  recordIcon.hidden = isRecording;
  stopIcon.hidden = !isRecording;
};

const syncComposer = () => {
  const audio = commentaryMode === 'audio';
  note.hidden = audio;
  noteCount.parentElement.hidden = audio;
  audioComposer.hidden = !audio;
  if (audio) setAudioStatus(audioAssetId ? 'Audio note ready' : audioDraftId ? 'Audio note saved locally' : 'Record a 90-second take', audioAssetId ? 'Ready to publish with this annotation.' : 'Audio is staged locally before upload.');
};

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
    throw requestError;
  }
  return body;
};

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
    setAudioStatus('Audio note ready', 'Ready to publish with this annotation.');
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
    setAudioStatus('Recording your take…', `Tap stop · max ${format(MAX_AUDIO_SECONDS)}`);
    recordingTimer = setInterval(() => {
      audioDurationSeconds = clampAudioDuration((Date.now() - recordingStartedAt) / 1000);
      setAudioStatus('Recording your take…', `Tap stop · max ${format(MAX_AUDIO_SECONDS)}`);
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

const toggleAudioRecording = () => {
  if (mediaRecorder?.state === 'recording') {
    stopAudioRecording();
    return;
  }
  void startAudioRecording().catch((recordingError) => {
    showError(recordingError.message || 'Audio recording failed.');
    syncComposer();
  });
};

const draftPayload = () => ({
  sourceUrl: currentTab.url,
  sourceType: currentTab.sourceType,
  sourceTitle: currentTab.title,
  sourceHost: currentTab.host,
  sourceExcerpt: selectedText,
  clipStart: currentTab.sourceType === 'article' ? 0 : Number(start.value),
  clipEnd: currentTab.sourceType === 'article' ? 0 : Number(end.value),
  commentary: note.value.trim().slice(0, 280),
  commentaryMode,
  audioAssetId,
  audioDuration: audioDurationSeconds,
  audioDraftId,
  clientRequestId,
});

const saveDraft = () => {
  if (!draftReady) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => extensionStorage.saveDraft(draftPayload()).catch(() => {}), 250);
};

function syncRange() {
  let from = Math.max(0, Math.min(90, Number(start.value)));
  let to = Math.max(0, Math.min(90, Number(end.value)));
  if (to < from) [from, to] = [to, from];
  start.value = startNumber.value = from;
  end.value = endNumber.value = to;
  clipLength.textContent = format(to - from);
  trackFill.style.left = `${from / 90 * 100}%`;
  trackFill.style.width = `${(to - from) / 90 * 100}%`;
  saveDraft();
}

function syncNote() { noteCount.textContent = `${note.value.length}/280`; saveDraft(); }

async function readSelection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.getSelection()?.toString() || '' });
    return String(result?.[0]?.result || '').trim().slice(0, 2000);
  } catch { return ''; }
}

async function resetForNewTab(sourceType) {
  draftReady = false;
  recordingToken += 1;
  clearInterval(recordingTimer);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  mediaRecorder = null;
  if (audioDraftId) await deleteAudioDraft(audioDraftId).catch(() => {});
  selectedText = '';
  commentaryMode = 'text';
  audioAssetId = '';
  audioDurationSeconds = 0;
  audioDraftId = '';
  clientRequestId = crypto.randomUUID();
  note.value = '';
  const defaults = sourceType === 'podcast' ? [10, 64] : sourceType === 'video' ? [14, 62] : [0, 0];
  start.value = startNumber.value = defaults[0];
  end.value = endNumber.value = defaults[1];
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === 'text';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  syncRange();
  syncNote();
}

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const url = tab.url || '';
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const sourceType = classify(url);
    if (loadedTabUrl && loadedTabUrl !== url) await resetForNewTab(sourceType);
    loadedTabUrl = url;
    currentTab = { url, title: tab.title || 'Current browser tab', host, sourceType };
    document.querySelector('#sourceTitle').textContent = currentTab.title;
    document.querySelector('#sourceUrl').textContent = url || 'Source URL unavailable';
    document.querySelector('#sourceIcon').dataset.sourceType = currentTab.sourceType;
    selectedText = tab.id ? await readSelection(tab.id) : '';
    selectionCard.hidden = !selectedText;
    selectionText.textContent = selectedText;
    const draft = await extensionStorage.getDraft().catch(() => null);
    if (draft?.sourceUrl === currentTab.url) {
      selectedText = draft.sourceExcerpt || selectedText;
      selectionCard.hidden = !selectedText;
      selectionText.textContent = selectedText;
      start.value = startNumber.value = draft.clipStart;
      end.value = endNumber.value = draft.clipEnd;
      note.value = draft.commentary;
      commentaryMode = draft.commentaryMode;
      audioAssetId = draft.audioAssetId || '';
      audioDurationSeconds = Number(draft.audioDuration) > 0 ? clampAudioDuration(draft.audioDuration) : 0;
      audioDraftId = draft.audioDraftId || '';
      clientRequestId = draft.clientRequestId || clientRequestId;
      note.placeholder = 'What stayed with you? Add the context the original clip is missing…';
    document.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === commentaryMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
      syncRange();
      syncNote();
    }
    draftReady = true;
    syncComposer();
  } catch {
    draftReady = true;
    showError('The active tab is restricted; paste its URL into the web capture desk.');
    syncComposer();
  }
}

chrome.tabs?.onActivated?.addListener(() => { void loadCurrentTab(); });
chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') void loadCurrentTab();
});

async function checkBackend() {
  try {
    await apiRequest('/api/health');
    backendStatus.innerHTML = '<i></i> LIVE';
    const auth = await apiRequest('/api/auth/providers').catch(() => ({ providers: {} }));
    const providers = auth.providers || {};
    authActions.hidden = !(providers.google || providers.x);
    authActions.querySelectorAll('[data-auth]').forEach((button) => { button.hidden = !providers[button.dataset.auth]; });
  } catch {
    backendStatus.innerHTML = '<i></i> OFFLINE';
    showError('Start the annotated backend on localhost:8787 before publishing.');
  }
}

authActions.querySelectorAll('[data-auth]').forEach((button) => button.addEventListener('click', async () => {
  try {
    await signIn(button.dataset.auth);
    authActions.hidden = true;
    error.hidden = true;
    error.textContent = '';
  } catch (authError) {
    showError(authError.message || 'Sign-in failed.');
  }
}));

[start, end].forEach((input) => input.addEventListener('input', syncRange));
startNumber.addEventListener('change', () => { start.value = startNumber.value; syncRange(); });
endNumber.addEventListener('change', () => { end.value = endNumber.value; syncRange(); });
note.addEventListener('input', syncNote);

document.querySelectorAll('[data-mode]').forEach((mode) => mode.addEventListener('click', () => {
  if (mode.dataset.mode !== 'audio' && mediaRecorder?.state === 'recording') stopAudioRecording();
  commentaryMode = mode.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  note.placeholder = 'What stayed with you? Add the context the original clip is missing…';
  syncComposer();
  saveDraft();
}));

audioRecord.addEventListener('click', toggleAudioRecording);
audioRetry.addEventListener('click', async () => {
  try { await uploadStagedAudio(); } catch (uploadError) { showError(uploadError.message || 'Audio upload failed.'); }
});

document.querySelector('#publish').addEventListener('click', async () => {
  error.hidden = true;
  if (commentaryMode === 'text' && !note.value.trim()) { note.focus(); showError('Add a text annotation before publishing.'); return; }
  if (commentaryMode === 'audio' && !audioAssetId) {
    if (audioDraftId) {
      try { await uploadStagedAudio(); } catch (uploadError) {
        showError(uploadError.retryable ? 'Audio note saved locally. It will retry when the backend is available.' : uploadError.message || 'Finish uploading the audio note before publishing.');
        return;
      }
    }
    if (!audioAssetId) { showError('Record and finish uploading the audio note before publishing.'); return; }
  }
  let protocol = '';
  try { protocol = new URL(currentTab.url).protocol; } catch { /* invalid source */ }
  if (!['http:', 'https:'].includes(protocol)) { showError('This tab does not expose a publishable http(s) source URL.'); return; }
  const payload = {
    sourceUrl: currentTab.url,
    sourceType: currentTab.sourceType,
    sourceTitle: currentTab.title,
    sourceHost: currentTab.host,
    sourceExcerpt: selectedText,
    clipStart: currentTab.sourceType === 'article' ? 0 : Number(start.value),
    clipEnd: currentTab.sourceType === 'article' ? 0 : Number(end.value),
    commentary: commentaryMode === 'text' ? note.value.trim().slice(0, 280) : '',
    commentaryMode,
    audioAssetId: commentaryMode === 'audio' ? audioAssetId : undefined,
    audioDuration: commentaryMode === 'audio' ? audioDurationSeconds : undefined,
    clientRequestId,
  };
  try {
    const { annotation } = await apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) });
    success.hidden = false;
    error.hidden = true;
    successLink.href = annotation.url;
    successLink.textContent = `Open ${annotation.url.replace(/^https?:\/\//, '')} →`;
    successLink.hidden = false;
    await extensionStorage.clearDraft().catch(() => {});
    await extensionStorage.savePublished(annotation).catch(() => {});
    if (audioDraftId) await deleteAudioDraft(audioDraftId).catch(() => {});
    audioDraftId = '';
  } catch (publishError) {
    if (publishError.retryable) {
      await extensionStorage.queueCapture({ ...payload, audioDraftId }).catch(() => {});
      showError('Backend unavailable. This capture is queued locally and will retry when the service worker reconnects.');
    } else showError(publishError.message || 'Annotation could not be published.');
  }
});

syncRange();
syncNote();
syncComposer();
loadCurrentTab();
checkBackend();
