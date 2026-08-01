import { extensionStorage } from './storage.js';

const input = document.querySelector('#apiOrigin');
const status = document.querySelector('#status');
input.value = await extensionStorage.getApiOrigin();
document.querySelector('#save').addEventListener('click', async () => {
  try {
    await extensionStorage.saveApiOrigin(input.value);
    status.textContent = 'Saved.';
  } catch (error) {
    status.textContent = error.message;
  }
});
