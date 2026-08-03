const DRAFT_KEY = 'annotatedDraft';
const LAST_PUBLISHED_KEY = 'annotatedLastPublished';

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
};
