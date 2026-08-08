import { apiOrigin, authHeaders } from './config.js';
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
        // Close the loop: a silent background success used to leave the
        // composer holding the same draft, inviting a duplicate publish.
        if (body.annotation) {
          await chrome.storage.local.set({ annotatedQueuePublished: { url: body.annotation.url || '', sourceUrl: payload.sourceUrl || '', at: Date.now() } }).catch(() => {});
        }
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

// The toolbar icon wears the unseen-notifications count, X-style: signed
// in, the pinned extension shows what's waiting without being opened.
// Opening the panel marks everything seen, which clears it.
const refreshNotificationsBadge = async () => {
  try {
    const headers = await authHeaders();
    if (!headers.authorization) return await chrome.action.setBadgeText({ text: '' });
    const origin = await apiOrigin();
    const response = await fetch(`${origin}/api/notifications`, { headers });
    if (!response.ok) return await chrome.action.setBadgeText({ text: '' });
    const body = await response.json().catch(() => ({}));
    const unseen = Number(body.unseenCount) || 0;
    await chrome.action.setBadgeBackgroundColor({ color: '#B0674D' });
    await chrome.action.setBadgeText({ text: unseen > 0 ? (unseen > 9 ? '9+' : String(unseen)) : '' });
  } catch { /* offline — leave the badge as it was */ }
};

const setupNotificationsBadge = async () => {
  await chrome.alarms.create('annotated-notifications', { periodInMinutes: 5 });
  await refreshNotificationsBadge();
};

chrome.runtime.onInstalled.addListener(() => {
  runBackgroundTask('installation setup', async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // Right-click a selection anywhere → the panel opens with it captured.
    await chrome.contextMenus.removeAll().catch(() => {});
    chrome.contextMenus.create({ id: 'annotated-capture-selection', title: 'Annotate “%s”', contexts: ['selection'] });
    await setupRetry();
    await setupNotificationsBadge();
  });
});

// Global mark keys: Alt+I / Alt+O / Alt+L work while the PAGE has focus —
// this is where Twitch's Alt+X lives. The time is read here, at keypress,
// so the mark is accurate even though the panel wakes up later. The
// sidePanel.open call must see the user gesture, so it fires before any
// await in the listener.
const readPlayerForCommand = async (tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const players = [...document.querySelectorAll('video, audio')];
      if (!players.length) return null;
      const active = players.find((el) => !el.paused && !el.ended)
        || players.find((el) => el.currentTime > 0)
        || players[0];
      return {
        time: Math.max(0, active.currentTime || 0),
        duration: Number.isFinite(active.duration) ? Math.floor(active.duration) : 0,
      };
    },
  }).catch(() => null);
  return results?.[0]?.result || null;
};

chrome.commands?.onCommand.addListener((command, tab) => {
  const boundary = { 'mark-in': 'in', 'mark-out': 'out', 'clip-last-30': 'last30' }[command];
  if (!boundary || !tab?.id) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  runBackgroundTask('global mark', async () => {
    const player = await readPlayerForCommand(tab.id);
    const mark = { tabId: tab.id, boundary, time: player ? player.time : null, duration: player?.duration || 0, at: Date.now() };
    await chrome.storage.session.set({ annotatedPendingMark: mark }).catch(() => {});
    await chrome.runtime.sendMessage({ type: 'ANNOTATED_MARK', ...mark }).catch(() => {});
  });
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'annotated-capture-selection' || !tab?.id) return;
  runBackgroundTask('context-menu capture', async () => {
    // Stash first so a cold panel finds the request at boot; the message
    // covers the already-open panel. The context-menu click is the user
    // gesture sidePanel.open requires.
    await chrome.storage.session.set({ annotatedPendingGrab: { tabId: tab.id } }).catch(() => {});
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.runtime.sendMessage({ type: 'ANNOTATED_GRAB_SELECTION', tabId: tab.id }).catch(() => {});
  });
});

chrome.runtime.onStartup.addListener(() => {
  runBackgroundTask('startup setup', async () => {
    await setupRetry();
    await setupNotificationsBadge();
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'annotated-retry') runBackgroundTask('pending capture retry', retryPendingCaptures);
  if (alarm.name === 'annotated-notifications') runBackgroundTask('notifications badge refresh', refreshNotificationsBadge);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'RETRY_PENDING') return runBackgroundTask('manual pending capture retry', retryPendingCaptures);
  if (message?.type === 'NOTIFICATIONS_SEEN') return runBackgroundTask('notifications badge clear', async () => chrome.action.setBadgeText({ text: '' }));
});

chrome.action.onClicked.addListener((tab) => {
  runBackgroundTask('side panel open', async () => {
    if (Number.isInteger(tab?.windowId)) await chrome.sidePanel.open({ windowId: tab.windowId });
  });
});
