import { apiOrigin, authHeaders } from './config.js';
import { extensionStorage } from './storage.js';

const retryPendingCaptures = async () => {
  const captures = await extensionStorage.getPendingCaptures().catch(() => []);
  for (const capture of captures) {
    try {
      const response = await fetch(`${await apiOrigin()}/api/annotations`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(capture.payload),
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        await extensionStorage.removePendingCapture(capture.id);
        if (body.annotation) await extensionStorage.savePublished(body.annotation);
      } else if (response.status < 500 && response.status !== 429) {
        await extensionStorage.markPendingAttempt(capture);
      }
    } catch {
      await extensionStorage.markPendingAttempt(capture);
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
