// GENERATED from packages/core/src/capture-state.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

import { normalizeClipRange } from './clip-range.js';
export const normalizeCaptureDraft = (input = {}) => {
    const type = ['article', 'video', 'podcast'].includes(String(input.sourceType)) ? input.sourceType : 'article';
    const range = type === 'article' ? { start: 0, end: 0 } : normalizeClipRange(input.clipStart, input.clipEnd, { allowEmpty: true });
    return {
        sourceUrl: String(input.sourceUrl || '').slice(0, 2048), sourceType: type,
        sourceExcerpt: String(input.sourceExcerpt || '').trim().slice(0, 2000),
        anchorParagraph: Number.isInteger(Number(input.anchorParagraph)) && Number(input.anchorParagraph) > 0 ? Number(input.anchorParagraph) : null,
        anchorPrefix: String(input.anchorPrefix || '').slice(0, 300), anchorSuffix: String(input.anchorSuffix || '').slice(0, 300),
        clipStart: range.start, clipEnd: range.end, commentary: String(input.commentary || '').slice(0, 280),
        commentaryMode: input.commentaryMode === 'audio' ? 'audio' : 'text',
        relationType: ['supports', 'challenges', 'adds_context', 'corrects'].includes(String(input.relationType)) ? input.relationType : 'response',
    };
};
export const captureDraftBlocker = (draft) => {
    const value = normalizeCaptureDraft(draft);
    if (!value.sourceUrl)
        return 'Choose a source.';
    if (value.sourceType === 'article' && !value.sourceExcerpt)
        return 'Select a passage.';
    if (value.sourceType !== 'article' && value.clipEnd - value.clipStart < 1)
        return 'Mark a moment.';
    if (value.commentaryMode === 'text' && !value.commentary.trim())
        return 'Add your context.';
    return '';
};
