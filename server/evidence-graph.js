import { readStore, queryDatabase, storageDescription } from './store.js';
import { sourceIdentity } from './source-identity.js';

const queryNative = () => storageDescription() === 'postgres' && process.env.ANNOTATED_RELATIONAL_READS !== 'legacy';
const iso = (value) => value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null;

const receiptFrom = (annotation, media = null) => ({
  sourceId: annotation.sourceId || sourceIdentity(annotation.canonicalUrl || annotation.sourceUrl).id,
  range: annotation.sourceType === 'article'
    ? { paragraph: annotation.anchorParagraph || null, prefix: annotation.anchorPrefix || '', exact: annotation.sourceExcerpt || '', suffix: annotation.anchorSuffix || '' }
    : { start: Number(annotation.clipStart || 0), end: Number(annotation.clipEnd || 0), duration: Math.max(0, Number(annotation.clipEnd || 0) - Number(annotation.clipStart || 0)) },
  artifact: media ? {
    id: media.id, type: media.kind, mimeType: media.mimeType || media.mime_type, bytes: Number(media.bytes || 0), sha256: media.sha256 || null,
    resolution: media.width || media.height ? { width: Number(media.width || 0), height: Number(media.height || 0) } : null,
    probe: media.probe || null, verifiedAt: media.verifiedAt || iso(media.verified_at), rightsState: media.rightsState || media.rights_state || 'unreviewed',
  } : null,
});

export const groupOverlappingEvidence = (annotations = []) => {
  const media = annotations.filter((item) => item.sourceType !== 'article').sort((a, b) => Number(a.clipStart) - Number(b.clipStart));
  const groups = [];
  for (const annotation of media) {
    const last = groups.at(-1);
    if (last && Number(annotation.clipStart) <= last.end) {
      last.end = Math.max(last.end, Number(annotation.clipEnd));
      last.annotations.push(annotation.slug);
    } else groups.push({ start: Number(annotation.clipStart), end: Number(annotation.clipEnd), annotations: [annotation.slug] });
  }
  return groups;
};

export async function exactSourceGraph(sourceId, viewerId = '', { limit = 20, cursor = '' } = {}) {
  const boundedLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  if (!queryNative()) {
    const store = await readStore();
    const matches = (store.annotations || []).filter((item) => item.status === 'published' && item.visibility === 'public' && sourceIdentity(item.canonicalUrl || item.sourceUrl).id === sourceId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const offset = Math.max(0, Number(cursor) || 0);
    const page = matches.slice(offset, offset + boundedLimit);
    const annotations = page.map((item) => ({ ...item, relationType: item.relationType || 'response', receipt: receiptFrom(item, (store.media || []).find((media) => media.id === item.mediaAssetId)) }));
    return { source: matches[0] ? { ...sourceIdentity(matches[0].canonicalUrl || matches[0].sourceUrl), title: matches[0].sourceTitle, type: matches[0].sourceType } : null, annotations, overlapGroups: groupOverlappingEvidence(annotations), nextCursor: offset + page.length < matches.length ? String(offset + page.length) : null };
  }
  const offset = Math.max(0, Number(cursor) || 0);
  const result = await queryDatabase(
    `SELECT a.*,s.source_identity,
      jsonb_build_object('id',u.id,'handle',u.handle,'displayName',u.display_name,'avatarUrl',u.avatar_url) author,
      m.id media_id,m.kind media_kind,m.mime_type media_mime_type,m.bytes media_bytes,m.sha256 media_sha256,m.width media_width,m.height media_height,m.probe media_probe,m.verified_at media_verified_at,m.rights_state media_rights_state
     FROM annotated_annotations a JOIN annotated_sources s ON s.canonical_url=a.source_id
     JOIN annotated_users u ON u.id=a.author_id LEFT JOIN annotated_media_artifacts m ON m.id=a.media_asset_id
     WHERE s.source_identity=$1 AND a.status='published' AND a.visibility='public'
     ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3`, [sourceId, boundedLimit + 1, offset],
  );
  const rows = result.rows.slice(0, boundedLimit);
  const first = rows[0];
  const annotations = rows.map((row) => {
    const annotation = { id: row.id, slug: row.slug, authorId: row.author_id, author: row.author, sourceId: row.source_identity, sourceUrl: row.source_url, canonicalUrl: row.canonical_url, sourceHost: row.source_host, sourceType: row.source_type, sourceTitle: row.source_title, sourceExcerpt: row.source_excerpt, relationType: row.relation_type, commentaryMode: row.commentary_mode, commentary: row.commentary, clipStart: Number(row.clip_start), clipEnd: Number(row.clip_end), anchorParagraph: row.anchor_paragraph, anchorPrefix: row.anchor_prefix, anchorSuffix: row.anchor_suffix, mediaStatus: row.media_status, createdAt: iso(row.created_at) };
    const media = row.media_id ? { id: row.media_id, kind: row.media_kind, mimeType: row.media_mime_type, bytes: row.media_bytes, sha256: row.media_sha256, width: row.media_width, height: row.media_height, probe: row.media_probe, verifiedAt: row.media_verified_at, rightsState: row.media_rights_state } : null;
    return { ...annotation, receipt: receiptFrom(annotation, media) };
  });
  return {
    source: first ? { id: first.source_identity, canonicalUrl: first.canonical_url, host: first.source_host, title: first.source_title, type: first.source_type } : null,
    annotations,
    overlapGroups: groupOverlappingEvidence(annotations),
    nextCursor: result.rows.length > boundedLimit ? String(offset + boundedLimit) : null,
  };
}

export { receiptFrom as evidenceReceipt };
