const DRAFT_KEY = 'annotatedDraft';
const LAST_PUBLISHED_KEY = 'annotatedLastPublished';
const CONFIG_KEY = 'annotatedConfig';
export const PENDING_KEY = 'annotatedPendingCaptures';
const SESSION_KEY = 'annotatedSession';
export const DEFAULT_API_ORIGIN = 'http://localhost:8787';
export const MAX_PENDING_CAPTURES = 5;
export const MAX_PENDING_ATTEMPTS = 8;
export const PENDING_STATUSES = new Set(['queued', 'needs-auth', 'blocked']);

const sourceTypes = new Set(['video', 'article', 'podcast']);

const boundedString = (value, max) => String(value || '').slice(0, max);
const boundedNumber = (value) => Math.max(0, Math.min(90, Number(value) || 0));

export const compactDraft = (draft = {}) => ({
  sourceUrl: boundedString(draft.sourceUrl, 2048),
  sourceType: sourceTypes.has(draft.sourceType) ? draft.sourceType : 'article',
  sourceTitle: boundedString(draft.sourceTitle, 500),
  sourceHost: boundedString(draft.sourceHost, 255),
  sourceExcerpt: boundedString(draft.sourceExcerpt, 2000),
  clipStart: boundedNumber(draft.clipStart),
  clipEnd: boundedNumber(draft.clipEnd),
  commentary: boundedString(draft.commentary, 280),
  commentaryMode: draft.commentaryMode === 'audio' ? 'audio' : 'text',
  audioAssetId: boundedString(draft.audioAssetId, 80),
  audioDuration: boundedNumber(draft.audioDuration),
  audioDraftId: boundedString(draft.audioDraftId, 80),
  clientRequestId: boundedString(draft.clientRequestId, 80),
});

export const compactPublished = (annotation = {}) => ({
  id: boundedString(annotation.id, 80),
  slug: boundedString(annotation.slug, 120),
  url: boundedString(annotation.url, 2048),
  mediaStatus: boundedString(annotation.mediaStatus, 24),
  createdAt: boundedString(annotation.createdAt, 40),
});

export const normalizeApiOrigin = (apiOrigin) => {
  const parsed = new URL(apiOrigin);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API origin must use http or https.');
  const local = parsed.hostname === 'localhost' || parsed.hostname === '::1' || /^127\./.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) throw new Error('API origin must use https outside local development.');
  return parsed.origin;
};

export const compactPending = (capture = {}) => ({
  id: boundedString(capture.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, 80),
  payload: compactDraft(capture.payload || {}),
  queuedAt: boundedString(capture.queuedAt || new Date().toISOString(), 40),
  attempts: Math.max(0, Number(capture.attempts) || 0),
  status: PENDING_STATUSES.has(capture.status) ? capture.status : 'queued',
  lastError: boundedString(capture.lastError, 240),
  lastAttemptAt: boundedString(capture.lastAttemptAt, 40),
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
    try {
      return normalizeApiOrigin(result[CONFIG_KEY]?.apiOrigin || DEFAULT_API_ORIGIN);
    } catch {
      return DEFAULT_API_ORIGIN;
    }
  },

  async saveApiOrigin(apiOrigin) {
    await chrome.storage.local.set({ [CONFIG_KEY]: { apiOrigin: normalizeApiOrigin(apiOrigin) } });
  },

  async getAuthToken() {
    if (!chrome.storage.session) return null;
    const result = await chrome.storage.session.get(SESSION_KEY);
    const session = result[SESSION_KEY];
    if (!session?.token) return null;
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      await chrome.storage.session.remove(SESSION_KEY);
      return null;
    }
    return session.token;
  },

  async saveAuthSession(session) {
    if (!chrome.storage.session) throw new Error('Chrome session storage is unavailable.');
    if (!session?.token) throw new Error('The sign-in response did not include a session token.');
    await chrome.storage.session.set({ [SESSION_KEY]: { token: boundedString(session.token, 200), expiresAt: boundedString(session.expiresAt, 40), user: session.user || null } });
  },

  async clearAuthSession() {
    if (chrome.storage.session) await chrome.storage.session.remove(SESSION_KEY);
  },

  async queueCapture(payload) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    const current = Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY].map(compactPending) : [];
    const normalizedPayload = compactDraft(payload);
    const duplicate = normalizedPayload.clientRequestId
      ? current.find((capture) => capture.payload.clientRequestId === normalizedPayload.clientRequestId)
      : null;
    const next = duplicate
      ? current.map((capture) => capture.id === duplicate.id ? compactPending({ ...capture, payload: { ...capture.payload, ...normalizedPayload } }) : capture)
      : [...current, compactPending({ payload: normalizedPayload })].slice(-MAX_PENDING_CAPTURES);
    await chrome.storage.local.set({ [PENDING_KEY]: next });
    return duplicate?.id || next[next.length - 1].id;
  },

  async getPendingCaptures() {
    const result = await chrome.storage.local.get(PENDING_KEY);
    return Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY].map(compactPending) : [];
  },

  async removePendingCapture(id) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    await chrome.storage.local.set({ [PENDING_KEY]: (result[PENDING_KEY] || []).filter((capture) => capture.id !== id) });
  },

  async updatePendingCapture(id, changes = {}) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    let updated = null;
    const next = (result[PENDING_KEY] || []).map((item) => {
      if (item.id !== id) return compactPending(item);
      updated = compactPending({ ...item, ...changes, payload: changes.payload || item.payload });
      return updated;
    });
    await chrome.storage.local.set({ [PENDING_KEY]: next });
    return updated;
  },

  async markPendingAttempt(capture, error = null) {
    const result = await chrome.storage.local.get(PENDING_KEY);
    const attempts = Number(capture.attempts || 0) + 1;
    const next = (result[PENDING_KEY] || []).map((item) => item.id === capture.id ? compactPending({
      ...item,
      attempts,
      status: error?.authRequired ? 'needs-auth' : error?.retryable === false || attempts >= MAX_PENDING_ATTEMPTS ? 'blocked' : 'queued',
      lastError: error?.message || error || item.lastError,
      lastAttemptAt: new Date().toISOString(),
    }) : compactPending(item));
    await chrome.storage.local.set({ [PENDING_KEY]: next });
    return next.find((item) => item.id === capture.id) || null;
  },

  async retryPendingCapture(id) {
    return this.updatePendingCapture(id, { attempts: 0, status: 'queued', lastError: '', lastAttemptAt: '' });
  },
};
