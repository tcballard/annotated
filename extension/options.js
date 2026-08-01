import { extensionStorage } from './storage.js';

const input = document.querySelector('#apiOrigin');
const status = document.querySelector('#status');
const loadSettings = async () => {
  try {
    input.value = await extensionStorage.getApiOrigin();
  } catch (error) {
    status.textContent = error.message || 'Could not load settings.';
  }
};
void loadSettings();
document.querySelector('#save').addEventListener('click', async () => {
  try {
    await extensionStorage.saveApiOrigin(input.value);
    status.textContent = 'Saved.';
  } catch (error) {
    status.textContent = error.message;
  }
});
