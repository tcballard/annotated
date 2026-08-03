import { apiOrigin, authHeaders } from './config.js';
import { extensionStorage } from './storage.js';
import { deleteAudioDraft, readAudioDraft } from './media-draft-store.js';

const uploadStagedAudio = async (payload) => {
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
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }
  return { ...payload, audioAssetId: body.media?.id || '', audioDuration: payload.audioDuration || staged.duration || 0 };
};

const retryPendingCaptures = async () => {
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  for (const capture of captures) {
    try {
      const payload = await uploadStagedAudio(capture.payload);
      const response = await fetch(`${await apiOrigin()}/api/annotations`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (capture.payload.audioDraftId) await deleteAudioDraft(capture.payload.audioDraftId).catch(() => {});
        await extensionStorage.removePendingCapture(capture.id);
        if (body.annotation) await extensionStorage.savePublished(body.annotation);
      } else if (response.status < 500 && response.status !== 429) {
        await extensionStorage.markPendingAttempt(capture);
      }
    } catch (error) {
      if (error.retryable === false) await extensionStorage.removePendingCapture(capture.id);
      else await extensionStorage.markPendingAttempt(capture);
    }
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create('annotated-retry', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => chrome.alarms.create('annotated-retry', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'annotated-retry') retryPendingCaptures(); });

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
});
