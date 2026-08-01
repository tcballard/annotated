import { apiOrigin, authHeaders } from './config.js';
import { extensionStorage, MAX_PENDING_ATTEMPTS } from './storage.js';
import { deleteAudioDraft, readAudioDraft } from './media-draft-store.js';

const runBackgroundTask = (label, task) => {
  void (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`annotated ${label} failed:`, error);
    }
  })();
};

const uploadStagedAudio = async (capture) => {
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
    response = await fetch(`${await apiOrigin()}/api/media/audio`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': staged.mimeType || staged.blob.type || 'audio/webm', ...(await authHeaders()) },
      body: staged.blob,
    });
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.errors?.join(' ') || body.error || `Audio upload failed (${response.status}).`);
    error.status = response.status;
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }
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

const retryPendingCaptures = async () => {
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  for (const capture of captures) {
    if (capture.status === 'blocked' || capture.attempts >= MAX_PENDING_ATTEMPTS) continue;
    try {
      const payload = await uploadStagedAudio(capture);
      const response = await fetch(`${await apiOrigin()}/api/annotations`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (payload.audioDraftId) await deleteAudioDraft(payload.audioDraftId).catch(() => {});
        await extensionStorage.removePendingCapture(capture.id);
        if (body.annotation) await extensionStorage.savePublished(body.annotation);
      } else {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.errors?.join(' ') || body.error || `Publish failed (${response.status}).`);
        error.status = response.status;
        error.retryable = response.status >= 500 || response.status === 429;
        await extensionStorage.markPendingAttempt(capture, error);
      }
    } catch (error) {
      const updated = await extensionStorage.markPendingAttempt(capture, error);
      if (error.retryable === false && !updated?.payload?.audioAssetId) await extensionStorage.removePendingCapture(capture.id);
    }
  }
};

chrome.runtime.onInstalled.addListener(() => {
  runBackgroundTask('installation setup', async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.alarms.create('annotated-retry', { periodInMinutes: 1 });
  });
});

chrome.runtime.onStartup.addListener(() => {
  runBackgroundTask('startup setup', () => chrome.alarms.create('annotated-retry', { periodInMinutes: 1 }));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'annotated-retry') runBackgroundTask('pending capture retry', retryPendingCaptures);
});

chrome.action.onClicked.addListener((tab) => {
  runBackgroundTask('side panel open', async () => {
    if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
  });
});
