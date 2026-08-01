const start = document.querySelector('#start');
const end = document.querySelector('#end');
const startNumber = document.querySelector('#startNumber');
const endNumber = document.querySelector('#endNumber');
const clipLength = document.querySelector('#clipLength');
const trackFill = document.querySelector('#trackFill');
const note = document.querySelector('#note');
const noteCount = document.querySelector('#noteCount');
const success = document.querySelector('#success');

const format = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

function syncRange() {
  let from = Math.max(0, Math.min(90, Number(start.value)));
  let to = Math.max(0, Math.min(90, Number(end.value)));
  if (to < from) [from, to] = [to, from];
  start.value = startNumber.value = from;
  end.value = endNumber.value = to;
  clipLength.textContent = format(to - from);
  trackFill.style.left = `${from / 90 * 100}%`;
  trackFill.style.width = `${(to - from) / 90 * 100}%`;
}

function syncNote() { noteCount.textContent = `${note.value.length}/280`; }

[start, end].forEach((input) => input.addEventListener('input', syncRange));
startNumber.addEventListener('change', () => { start.value = startNumber.value; syncRange(); });
endNumber.addEventListener('change', () => { end.value = endNumber.value; syncRange(); });
note.addEventListener('input', syncNote);

document.querySelectorAll('[data-mode]').forEach((mode) => mode.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button === mode));
  note.placeholder = mode.dataset.mode === 'audio' ? 'Audio capture is ready in the full extension build.' : 'What stayed with you? Add the context the original clip is missing…';
}));

document.querySelector('#publish').addEventListener('click', async () => {
  if (!note.value.trim()) {
    note.focus();
    return;
  }
  const payload = { start: start.value, end: end.value, note: note.value, createdAt: Date.now() };
  try { await chrome.storage.local.set({ annotatedDraft: payload }); } catch { /* browser preview fallback */ }
  success.hidden = false;
});

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    document.querySelector('#sourceTitle').textContent = tab.title || 'Current browser tab';
    document.querySelector('#sourceUrl').textContent = tab.url || 'Source URL unavailable';
    const host = tab.url ? new URL(tab.url).hostname.replace('www.', '') : '';
    document.querySelector('#sourceIcon').textContent = host.includes('youtube') ? '▶' : host.includes('spotify') || host.includes('overcast') ? '◉' : 'T';
  } catch { /* restricted tabs still leave the capture surface usable */ }
}

syncRange();
syncNote();
loadCurrentTab();
