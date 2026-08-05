// Server-side meta injection for /a/:slug permalinks. Crawlers and link
// unfurlers never execute the SPA, so the landing page HTML must carry the
// annotation's title, description, canonical URL, and OG card before any
// script runs. All values are escaped for attribute context.

export const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const clip = (value, max) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export const permalinkMeta = (annotation, author, publicOrigin) => {
  const handle = author?.handle || 'annotated';
  const quote = clip(annotation.sourceExcerpt || annotation.sourceTitle, 120);
  const title = `“${quote}” — @${handle} on annotated`;
  const description = clip(
    annotation.commentary || `An audio annotation of ${annotation.sourceTitle || 'a source'} — with a live link back to the original.`,
    200,
  );
  const url = `${publicOrigin}/a/${encodeURIComponent(annotation.slug)}`;
  return { title, description, url, imageUrl: `${publicOrigin}/og/${encodeURIComponent(annotation.slug)}.png` };
};

export const injectAnnotationMeta = (html, annotation, author, publicOrigin, { index = true } = {}) => {
  const meta = permalinkMeta(annotation, author, publicOrigin);
  const tags = [
    // Unlisted pages unfurl for link-holders but ask crawlers not to list them.
    ...(index ? [] : ['<meta name="robots" content="noindex" />']),
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="annotated" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*\/?>/, `<meta name="description" content="${escapeHtml(meta.description)}" />`)
    // The shell ships default og:/twitter: tags for the home page; a
    // permalink replaces them wholesale so crawlers never see two og:image.
    .replace(/[ \t]*<meta (?:property="og:|name="twitter:)[^>]*\/?>\s*\n?/g, '')
    .replace('</head>', `    ${tags}\n  </head>`)
    // Readers without JavaScript still get the source link and the claim
    // form — the rights path never depends on the app booting.
    .replace(/(<body[^>]*>)/, `$1<noscript><p>This page needs JavaScript to render. The source is <a href="${escapeHtml(annotation.sourceUrl || meta.url)}">${escapeHtml(annotation.sourceHost || 'the original')}</a>; rights holders can <a href="/a/${encodeURIComponent(annotation.slug)}/claim">file a claim without JavaScript</a>.</p></noscript>`);
};
