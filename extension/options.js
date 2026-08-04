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

const loadSettings = async () => {
  try {
    input.value = await extensionStorage.getApiOrigin();
    setStatus('Ready to connect.', 'idle');
  } catch (error) {
    setStatus(error.message || 'Could not load settings.', 'error');
  }
};
void loadSettings();

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
    setStatus('Connection saved.', 'success');
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
    setStatus('Annotated staging restored.', 'success');
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
