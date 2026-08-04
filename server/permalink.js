const text = (value, fallback = '') => String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;

export const escapeHTML = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const formatMoment = (seconds) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

const sourceDomain = (annotation) => {
  if (text(annotation.sourceHost)) return text(annotation.sourceHost).replace(/^www\./i, '');
  try { return new URL(annotation.sourceUrl).hostname.replace(/^www\./i, ''); } catch { return 'source'; }
};

export const permalinkCardData = (annotation, author) => {
  const momentStart = formatMoment(annotation.clipStart);
  const momentEnd = Number(annotation.clipEnd) > Number(annotation.clipStart) ? formatMoment(annotation.clipEnd) : '';
  const momentLabel = annotation.sourceType === 'article' ? '¶' : `${momentStart}${momentEnd ? `–${momentEnd}` : ''}`;
  const durationSeconds = annotation.sourceDuration ?? annotation.duration ?? annotation.durationSeconds;
  const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
    ? formatMoment(durationSeconds)
    : annotation.sourceType === 'article' ? 'article' : momentEnd || momentStart;
  const domain = sourceDomain(annotation);
  return {
    id: annotation.id,
    quote: text(annotation.sourceExcerpt, text(annotation.sourceTitle, 'A moment kept with its context.')),
    note: text(annotation.commentary, 'An annotation attached to this moment.'),
    author: text(author?.handle, text(annotation.authorId, 'user')).replace(/^@/, ''),
    sourceName: text(annotation.sourceAuthor, text(annotation.sourceChannel, domain)),
    sourceDomain: domain,
    sourceType: text(annotation.sourceType, 'source'),
    duration,
    momentLabel,
  };
};

const removeBaseMetadata = (html) => html
  .replace(/\s*<meta\s+name=["']description["'][^>]*>\s*/i, '\n')
  .replace(/\s*<title>[^<]*<\/title>\s*/i, '\n');

const tag = (attribute, name, content) => `<meta ${attribute}="${name}" content="${escapeHTML(content)}" />`;

export const injectPermalinkMeta = (html, annotation, author, publicOrigin) => {
  const card = permalinkCardData(annotation, author);
  const canonical = new URL(`/a/${encodeURIComponent(annotation.slug)}`, publicOrigin).toString();
  const image = new URL(`/og/${encodeURIComponent(annotation.id)}.png`, publicOrigin).toString();
  const title = `“${card.quote}”`;
  const description = `${card.note} — annotated by @${card.author} · ${card.sourceDomain} at ${card.momentLabel}`;
  const metadata = [
    `<title>${escapeHTML(title)}</title>`,
    `<meta name="description" content="${escapeHTML(description)}" />`,
    tag('property', 'og:type', 'article'),
    tag('property', 'og:site_name', 'annotated'),
    tag('property', 'og:title', title),
    tag('property', 'og:description', description),
    tag('property', 'og:url', canonical),
    tag('property', 'og:image', image),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', title),
    tag('name', 'twitter:description', description),
    tag('name', 'twitter:image', image),
    `<link rel="canonical" href="${escapeHTML(canonical)}" />`,
  ].join('\n    ');
  return removeBaseMetadata(html).replace('</head>', `    ${metadata}\n  </head>`);
};
