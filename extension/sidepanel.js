import { extensionStorage } from './storage.js';
import { apiOrigin, authHeaders, signIn } from './config.js';

const start = document.querySelector('#start');
const end = document.querySelector('#end');
const startNumber = document.querySelector('#startNumber');
const endNumber = document.querySelector('#endNumber');
const clipLength = document.querySelector('#clipLength');
const trackFill = document.querySelector('#trackFill');
const note = document.querySelector('#note');
const noteCount = document.querySelector('#noteCount');
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

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const url = tab.url || '';
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    currentTab = { url, title: tab.title || 'Current browser tab', host, sourceType: classify(url) };
    document.querySelector('#sourceTitle').textContent = currentTab.title;
    document.querySelector('#sourceUrl').textContent = url || 'Source URL unavailable';
    document.querySelector('#sourceIcon').textContent = currentTab.sourceType === 'video' ? '▶' : currentTab.sourceType === 'podcast' ? '◉' : 'T';
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
      note.placeholder = commentaryMode === 'audio' ? 'Audio publishing is coming with the media worker.' : 'What stayed with you? Add the context the original clip is missing…';
      document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === commentaryMode));
      syncRange();
      syncNote();
    }
    draftReady = true;
  } catch {
    draftReady = true;
    showError('The active tab is restricted; paste its URL into the web capture desk.');
  }
}

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
  commentaryMode = mode.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button === mode));
  note.placeholder = commentaryMode === 'audio' ? 'Audio publishing is coming with the media worker.' : 'What stayed with you? Add the context the original clip is missing…';
  saveDraft();
}));

document.querySelector('#publish').addEventListener('click', async () => {
  error.hidden = true;
  if (!note.value.trim()) { note.focus(); showError('Add a text annotation before publishing.'); return; }
  if (commentaryMode === 'audio') { showError('Audio publishing is coming with the media worker. Use Text for this pass.'); return; }
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
    commentary: note.value.trim().slice(0, 280),
    commentaryMode: 'text',
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
  } catch (publishError) {
    if (publishError.retryable) {
      await extensionStorage.queueCapture(payload).catch(() => {});
      showError('Backend unavailable. This capture is queued locally and will retry when the service worker reconnects.');
    } else showError(publishError.message || 'Annotation could not be published.');
  }
});

syncRange();
syncNote();
loadCurrentTab();
checkBackend();
