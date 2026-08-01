const DRAFT_KEY = 'annotatedDraft';
const LAST_PUBLISHED_KEY = 'annotatedLastPublished';
const CONFIG_KEY = 'annotatedConfig';
const PENDING_KEY = 'annotatedPendingCaptures';
const SESSION_KEY = 'annotatedSession';

const sourceTypes = new Set(['video', 'article', 'podcast']);

const boundedString = (value, max) => String(value || '').slice(0, max);
const boundedNumber = (value) => Math.max(0, Math.min(90, Number(value) || 0));

const compactDraft = (draft = {}) => ({
  sourceUrl: boundedString(draft.sourceUrl, 2048),
  sourceType: sourceTypes.has(draft.sourceType) ? draft.sourceType : 'article',
  sourceTitle: boundedString(draft.sourceTitle, 500),
  sourceHost: boundedString(draft.sourceHost, 255),
  sourceExcerpt: boundedString(draft.sourceExcerpt, 2000),
  clipStart: boundedNumber(draft.clipStart),
  clipEnd: boundedNumber(draft.clipEnd),
  commentary: boundedString(draft.commentary, 280),
  commentaryMode: draft.commentaryMode === 'audio' ? 'audio' : 'text',
});

const compactPublished = (annotation = {}) => ({
  id: boundedString(annotation.id, 80),
  slug: boundedString(annotation.slug, 120),
  url: boundedString(annotation.url, 2048),
  mediaStatus: boundedString(annotation.mediaStatus, 24),
  createdAt: boundedString(annotation.createdAt, 40),
});

const compactPending = (capture = {}) => ({
  id: boundedString(capture.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, 80),
  payload: { ...compactDraft(capture.payload || {}), commentaryMode: 'text' },
  queuedAt: boundedString(capture.queuedAt || new Date().toISOString(), 40),
  attempts: Math.max(0, Number(capture.attempts) || 0),
});

export const extensionStorage = {
  async getDraft() {
    const result = await chrome.storage.local.get(DRAFT_KEY);
    return result[DRAFT_KEY] ? compactDraft(result[DRAFT_KEY]) : null;
  },

  async saveDraft(draft) {
    await chrome.storage.local.set({ [DRAFT_KEY]: compactDraft(draft) });
  },

  async clearDraft() {
    await chrome.storage.local.remove(DRAFT_KEY);
  },

  async savePublished(annotation) {
    await chrome.storage.local.set({ [LAST_PUBLISHED_KEY]: compactPublished(annotation) });
  },

  async getApiOrigin() {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    return String(result[CONFIG_KEY]?.apiOrigin || 'http://localhost:8787').replace(/\/$/, '');
  },

  async saveApiOrigin(apiOrigin) {
    const parsed = new URL(apiOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API origin must use http or https.');
    await chrome.storage.local.set({ [CONFIG_KEY]: { apiOrigin: parsed.origin } });
  },

  async getAuthToken() {
    if (!chrome.storage.session) return null;
    const result = await chrome.storage.session.get(SESSION_KEY);
    return result[SESSION_KEY]?.token || null;
  },

  async saveAuthSession(session) {
    if (!chrome.storage.session) throw new Error('Chrome session storage is unavailable.');
    await chrome.storage.session.set({ [SESSION_KEY]: { token: boundedString(session.token, 200), expiresAt: boundedString(session.expiresAt, 40), user: session.user || null } });
  },

  async clearAuthSession() {
    if (chrome.storage.session) await chrome.storage.session.remove(SESSION_KEY);
  },

  async queueCapture(payload) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    const current = Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY].map(compactPending) : [];
    const next = [...current, compactPending({ payload })].slice(-5);
    await chrome.storage.local.set({ [PENDING_KEY]: next });
    return next[next.length - 1].id;
  },

  async getPendingCaptures() {
    const result = await chrome.storage.local.get(PENDING_KEY);
    return Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY].map(compactPending) : [];
  },

  async removePendingCapture(id) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    await chrome.storage.local.set({ [PENDING_KEY]: (result[PENDING_KEY] || []).filter((capture) => capture.id !== id) });
  },

  async markPendingAttempt(capture) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    const next = (result[PENDING_KEY] || []).map((item) => item.id === capture.id ? compactPending({ ...item, attempts: Number(item.attempts || 0) + 1 }) : compactPending(item));
    await chrome.storage.local.set({ [PENDING_KEY]: next });
  },
};
