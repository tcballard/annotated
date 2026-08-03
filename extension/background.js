import { apiOrigin } from './config.js';
import { extensionStorage, MAX_PENDING_ATTEMPTS } from './storage.js';
import { deleteAudioDraft, readAudioDraft } from './media-draft-store.js';

const runBackgroundTask = (label, task) => {
  return (async () => {
    try {
      return await task();
    } catch (error) {
      console.error(`annotated ${label} failed:`, error);
      return null;
    }
  })();
};

const RETRY_LOCK_KEY = 'annotatedRetryLock';
const RETRY_LOCK_TTL_MS = 25_000;

const requestError = async (response, fallback) => {
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.errors?.join(' ') || body.error || `${fallback} (${response.status}).`);
  error.status = response.status;
  error.authRequired = response.status === 401;
  error.retryable = response.status >= 500 || response.status === 429;
  if (error.authRequired) await extensionStorage.clearAuthSession().catch(() => {});
  return error;
};

const withRetryLock = async (task) => {
  const session = chrome.storage?.session;
  if (!session) return task();
  const token = crypto.randomUUID();
  const existing = await session.get(RETRY_LOCK_KEY).catch(() => ({}));
  const lockedAt = Date.parse(existing[RETRY_LOCK_KEY]?.at || '');
  if (Number.isFinite(lockedAt) && Date.now() - lockedAt < RETRY_LOCK_TTL_MS) return null;
  await session.set({ [RETRY_LOCK_KEY]: { token, at: new Date().toISOString() } });
  try {
    return await task();
  } finally {
    const latest = await session.get(RETRY_LOCK_KEY).catch(() => ({}));
    if (latest[RETRY_LOCK_KEY]?.token === token) await session.remove(RETRY_LOCK_KEY).catch(() => {});
  }
};

const uploadStagedAudio = async (capture, origin, headers) => {
  const payload = capture.payload;
  if (!payload.audioDraftId || payload.audioAssetId) return payload;
  const staged = await readAudioDraft(payload.audioDraftId);
  if (!staged?.blob) {
    const error = new Error('The queued audio note is no longer available.');
    error.retryable = false;
    throw error;
  }
  let response;
  try {
    response = await fetch(`${origin}/api/media/audio`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': staged.mimeType || staged.blob.type || 'audio/webm', ...headers },
      body: staged.blob,
    });
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  if (!response.ok) throw await requestError(response, 'Audio upload failed');
  const body = await response.json().catch(() => ({}));
  const uploadedPayload = {
    ...payload,
    audioAssetId: body.media?.id || '',
    audioDuration: payload.audioDuration || staged.duration || 0,
    audioDraftId: '',
  };
  if (!uploadedPayload.audioAssetId) {
    const error = new Error('Audio upload did not return an asset ID.');
    error.retryable = true;
    throw error;
  }
  await extensionStorage.updatePendingCapture(capture.id, { payload: uploadedPayload });
  await deleteAudioDraft(payload.audioDraftId).catch(() => {});
  return uploadedPayload;
};

const retryPendingCapturesOnce = async () => {
  const origin = await apiOrigin();
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  let token = await extensionStorage.getAuthToken().catch(() => null);
  for (const capture of captures) {
    if (capture.status === 'blocked' || capture.attempts >= MAX_PENDING_ATTEMPTS) continue;
    if (capture.status === 'needs-auth' && !token) continue;
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    try {
      const payload = await uploadStagedAudio(capture, origin, headers);
      const response = await fetch(`${origin}/api/annotations`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (payload.audioDraftId) await deleteAudioDraft(payload.audioDraftId).catch(() => {});
        await extensionStorage.removePendingCapture(capture.id);
        if (body.annotation) await extensionStorage.savePublished(body.annotation);
      } else {
        const error = await requestError(response, 'Publish failed');
        if (error.authRequired) token = null;
        await extensionStorage.markPendingAttempt(capture, error);
      }
    } catch (error) {
      if (error.authRequired) token = null;
      await extensionStorage.markPendingAttempt(capture, error);
    }
  }
};

const retryPendingCaptures = () => withRetryLock(retryPendingCapturesOnce);

const setupRetry = async () => {
  await chrome.alarms.create('annotated-retry', { periodInMinutes: 1 });
  await retryPendingCaptures();
};

chrome.runtime.onInstalled.addListener(() => {
  runBackgroundTask('installation setup', async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await setupRetry();
  });
});

chrome.runtime.onStartup.addListener(() => {
  runBackgroundTask('startup setup', setupRetry);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'annotated-retry') runBackgroundTask('pending capture retry', retryPendingCaptures);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'RETRY_PENDING') return runBackgroundTask('manual pending capture retry', retryPendingCaptures);
});

chrome.action.onClicked.addListener((tab) => {
  runBackgroundTask('side panel open', async () => {
    if (Number.isInteger(tab?.windowId)) await chrome.sidePanel.open({ windowId: tab.windowId });
  });
});
