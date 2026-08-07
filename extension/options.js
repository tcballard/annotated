import { DEFAULT_API_ORIGIN, extensionStorage } from './storage.js';

const input = document.querySelector('#apiOrigin');
const status = document.querySelector('#status');
const form = document.querySelector('#settingsForm');
const saveButton = document.querySelector('#save');
const resetButton = document.querySelector('#reset');

const setStatus = (message, state = 'idle') => {
  status.textContent = message;
  status.dataset.state = state;
};

const setBusy = (busy) => {
  saveButton.disabled = busy;
  resetButton.disabled = busy;
  input.disabled = busy;
  saveButton.textContent = busy ? 'Saving…' : 'Save connection';
};

// Saving is not the same as working: after every save the page actually
// asks the origin whether it answers as annotated, and says which.
const verifyConnection = async (origin) => {
  setStatus('Saved. Checking the connection…', 'idle');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${origin}/api/health`, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error();
    setStatus('Connected ✓ — this origin answers as annotated.', 'success');
  } catch {
    setStatus('Saved, but nothing answered at this origin. The panel will keep retrying quietly.', 'error');
  }
};

const loadSettings = async () => {
  try {
    input.value = await extensionStorage.getApiOrigin();
    setStatus('Ready to connect.', 'idle');
  } catch (error) {
    setStatus(error.message || 'Could not load settings.', 'error');
  }
};
void loadSettings();

const versionStamp = document.querySelector('#versionStamp');
if (versionStamp && chrome.runtime?.getManifest) versionStamp.textContent = `v${chrome.runtime.getManifest().version}`;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input.value.trim()) {
    setStatus('Enter an API origin before saving.', 'error');
    input.focus();
    return;
  }
  setBusy(true);
  try {
    await extensionStorage.saveApiOrigin(input.value);
    input.value = await extensionStorage.getApiOrigin();
    await verifyConnection(input.value);
  } catch (error) {
    setStatus(error.message || 'Could not save settings.', 'error');
  } finally {
    setBusy(false);
  }
});

resetButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    await extensionStorage.saveApiOrigin(DEFAULT_API_ORIGIN);
    input.value = DEFAULT_API_ORIGIN;
    await verifyConnection(DEFAULT_API_ORIGIN);
  } catch (error) {
    setStatus(error.message || 'Could not restore the local origin.', 'error');
  } finally {
    setBusy(false);
  }
});

input.addEventListener('input', () => {
  if (status.dataset.state !== 'error') return;
  setStatus('Ready to try again.', 'idle');
});
