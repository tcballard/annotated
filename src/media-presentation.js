const safeMediaUrl = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate, 'https://annotated.invalid');
    return ['http:', 'https:'].includes(parsed.protocol) ? candidate : '';
  } catch {
    return '';
  }
};

export const mediaPresentation = ({ sourceType = '', type = '', clipUrl = '', audioUrl = '', mediaStatus = 'unavailable' } = {}) => {
  const kind = String(sourceType || type).toLowerCase();
  const clip = safeMediaUrl(clipUrl);
  const commentary = safeMediaUrl(audioUrl);
  if (kind === 'video' && clip) return { kind: 'video', src: clip, status: 'ready' };
  if (kind === 'podcast' && clip) return { kind: 'audio', src: clip, status: 'ready' };
  if (commentary) return { kind: 'audio', src: commentary, status: 'commentary' };
  return { kind: kind === 'video' ? 'video' : kind === 'podcast' ? 'audio' : 'none', src: '', status: String(mediaStatus || 'unavailable') };
};
