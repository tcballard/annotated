const allowedTypes = new Set(['video', 'article', 'podcast']);
const allowedModes = new Set(['text', 'audio']);
import { parseSourceUrl } from './source-resolver.js';

export function validateAnnotation(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { errors: ['A JSON annotation payload is required.'] };
  if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2048) errors.push('sourceUrl is required.');
  else {
    try { parseSourceUrl(input.sourceUrl); } catch (error) { errors.push(error.message); }
  }
  if (input.mediaUrl) {
    try { parseSourceUrl(input.mediaUrl); } catch (error) { errors.push(`mediaUrl: ${error.message}`); }
  }
  if (input.canonicalUrl) {
    try { parseSourceUrl(input.canonicalUrl); } catch (error) { errors.push(`canonicalUrl: ${error.message}`); }
  }
  if (input.clientRequestId !== undefined && (typeof input.clientRequestId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(input.clientRequestId))) errors.push('clientRequestId must be a bounded request ID.');
  if (!allowedTypes.has(input.sourceType)) errors.push('sourceType must be video, article, or podcast.');
  if (typeof input.sourceTitle !== 'string' || !input.sourceTitle.trim() || input.sourceTitle.length > 500) errors.push('sourceTitle is required.');
  if (!allowedModes.has(input.commentaryMode)) errors.push('commentaryMode must be text or audio.');
  if (input.commentaryMode === 'text' && (!input.commentary || !String(input.commentary).trim())) errors.push('Text commentary is required.');
  if (input.commentaryMode === 'audio' && (!input.audioAssetId || typeof input.audioAssetId !== 'string')) errors.push('An uploaded audio asset is required.');
  if (String(input.commentary || '').length > 280) errors.push('Text commentary must be 280 characters or fewer.');
  if (input.sourceExcerpt !== undefined && (typeof input.sourceExcerpt !== 'string' || input.sourceExcerpt.length > 2000)) errors.push('sourceExcerpt must be text of 2,000 characters or fewer.');
  const sourceExcerpt = typeof input.sourceExcerpt === 'string' ? input.sourceExcerpt.trim().slice(0, 2000) : '';
  if (input.sourceType === 'article' && !sourceExcerpt) errors.push('An article passage is required.');
  const start = Number(input.clipStart || 0);
  const end = Number(input.clipEnd || 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || end < start) errors.push('Clip range is invalid.');
  if (input.sourceType !== 'article' && end - start > 90) errors.push('Media clips must be 90 seconds or shorter.');
  return { errors, normalized: { ...input, sourceExcerpt, clientRequestId: input.clientRequestId || null, canonicalUrl: input.canonicalUrl || input.sourceUrl, clipStart: start, clipEnd: end, commentary: String(input.commentary || '').trim().slice(0, 280) } };
}

export function validateComment(input) {
  const body = String(input?.body || '').trim();
  if (!body || body.length > 500) return { error: 'Comment must be between 1 and 500 characters.' };
  return { body };
}

export function validateClaim(input) {
  const reason = String(input?.reason || '').trim();
  if (!reason || reason.length > 2000) return { error: 'Claim reason must be between 1 and 2,000 characters.' };
  return { reason };
}
