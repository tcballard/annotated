import QRCode from 'qrcode';

const xmlEscape = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));

export const annotationShareDescriptor = (annotation, origin) => {
  const url = `${String(origin).replace(/\/$/, '')}/a/${encodeURIComponent(annotation.slug)}`;
  const quote = String(annotation.sourceExcerpt || annotation.commentary || '').trim().slice(0, 240);
  const author = annotation.author?.handle || annotation.authorId || 'annotator';
  return {
    version: 1,
    url,
    title: `${annotation.sourceTitle || 'Source annotation'} — Annotated`,
    text: `${quote ? `“${quote}” — ` : ''}@${author} on Annotated\n${url}`,
    imageUrl: `${String(origin).replace(/\/$/, '')}/og/${encodeURIComponent(annotation.slug)}.png`,
    embedUrl: `${url}/embed?v=1`,
    oembedUrl: `${String(origin).replace(/\/$/, '')}/api/oembed?url=${encodeURIComponent(url)}&format=json`,
    qrUrl: `${url}/qr.svg?v=1`,
    exactSource: { sourceId: annotation.sourceId || null, sourceUrl: annotation.sourceUrl, relationType: annotation.relationType || 'response', clipStart: Number(annotation.clipStart || 0), clipEnd: Number(annotation.clipEnd || 0), sourceExcerpt: annotation.sourceExcerpt || '' },
    artifactStatus: annotation.mediaStatus || 'not-applicable',
  };
};

export const annotationEmbedHtml = (annotation, origin) => {
  const share = annotationShareDescriptor(annotation, origin);
  const moment = annotation.sourceType === 'article' ? annotation.sourceExcerpt : `${Math.round(Number(annotation.clipStart || 0))}–${Math.round(Number(annotation.clipEnd || 0))} seconds`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${xmlEscape(share.title)}</title><style>body{margin:0;padding:16px;background:#f6f0e5;color:#27231f;font:15px system-ui}article{border:1px solid #cfc5b6;border-radius:12px;padding:16px}a{color:#a3482b}small{display:block;color:#746b61;margin-top:10px}</style></head><body><article><b>${xmlEscape(annotation.sourceTitle)}</b><p>${xmlEscape(annotation.commentary || moment)}</p><small>${xmlEscape(annotation.relationType || 'response')} · ${xmlEscape(annotation.sourceHost)} · artifact ${xmlEscape(share.artifactStatus)}</small><p><a href="${xmlEscape(share.url)}" target="_blank" rel="noreferrer">Open evidence on Annotated</a> · <a href="${xmlEscape(annotation.sourceUrl)}" target="_blank" rel="noreferrer">Open original</a></p></article></body></html>`;
};

export const annotationQrSvg = (annotation, origin) => QRCode.toString(annotationShareDescriptor(annotation, origin).url, { type: 'svg', margin: 2, width: 320, errorCorrectionLevel: 'M' });
