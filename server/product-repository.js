import {
  queryDatabase,
  readStore,
  storageDescription,
  toggleFollow as legacyToggleFollow,
  toggleLike as legacyToggleLike,
  transactDatabase,
  updateStore,
} from './store.js';
import { afterKeysetCursor, keysetCursorFor, matchesFeedQuery, matchesFeedUrl, parseKeysetCursor } from './feed.js';
import { publicAnnotationsForHost, rankAnnotators } from './discovery.js';
import { rankTrendingSources, sortByTrending } from './trending.js';
import { isPubliclyListed } from './visibility.js';
import { TOPICS } from './topics.js';
import { sourceIdentity } from './source-identity.js';

const queryNative = storageDescription() === 'postgres' && process.env.ANNOTATED_RELATIONAL_READS !== 'legacy';
const iso = (value) => value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boolean = (value) => value === true || value === 'true';

const publicUser = (user) => user ? {
  id: user.id,
  handle: user.handle,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl || null,
  bio: user.bio || '',
  isDemo: Boolean(user.isDemo || user.provider === 'demo'),
} : null;

const mapUser = (row) => row ? {
  id: row.id,
  handle: row.handle,
  displayName: row.display_name,
  email: row.email,
  avatarUrl: row.avatar_url,
  bio: row.bio || '',
  provider: row.provider,
  providerId: row.provider_id,
  role: row.role,
  isDemo: boolean(row.is_demo),
  lastNotificationsSeenAt: iso(row.last_notifications_seen_at),
  createdAt: iso(row.created_at),
} : null;

const mapMedia = (row) => row ? {
  id: row.id,
  ownerId: row.owner_id,
  key: row.object_key,
  fileName: row.file_name,
  mimeType: row.mime_type,
  bytes: number(row.bytes),
  kind: row.kind,
  durationSeconds: row.duration_seconds === null ? null : number(row.duration_seconds),
  peaks: row.peaks || null,
  sha256: row.sha256 || null,
  width: row.width === null ? null : number(row.width),
  height: row.height === null ? null : number(row.height),
  probe: row.probe || null,
  verifiedAt: iso(row.verified_at),
  rightsState: row.rights_state || 'unreviewed',
  isDemo: boolean(row.is_demo),
  createdAt: iso(row.created_at),
} : null;

const mapAnnotation = (row) => row ? {
  id: row.id,
  slug: row.slug,
  authorId: row.author_id,
  sourceUrl: row.source_url,
  sourceId: row.source_identity || null,
  canonicalUrl: row.canonical_url,
  sourceHost: row.source_host,
  sourceType: row.source_type,
  sourceTitle: row.source_title,
  sourceExcerpt: row.source_excerpt,
  provider: row.provider,
  mediaUrl: row.media_url,
  commentaryMode: row.commentary_mode,
  commentary: row.commentary,
  visibility: row.visibility,
  status: row.status,
  topic: row.topic,
  clientRequestId: row.client_request_id,
  clipStart: number(row.clip_start),
  clipEnd: number(row.clip_end),
  audioDuration: number(row.audio_duration),
  audioAssetId: row.audio_asset_id,
  mediaAssetId: row.media_asset_id,
  posterAssetId: row.poster_asset_id,
  screenshotAssetId: row.screenshot_asset_id,
  mediaStatus: row.media_status,
  mediaError: row.media_error,
  openCount: number(row.open_count),
  anchorParagraph: row.anchor_paragraph,
  anchorPrefix: row.anchor_prefix || '',
  anchorSuffix: row.anchor_suffix || '',
  isDemo: boolean(row.is_demo),
  createdAt: iso(row.created_at),
  editedAt: iso(row.edited_at),
  removedAt: iso(row.removed_at),
  removedBy: row.removed_by,
  removedReason: row.removed_reason,
  author: row.author || null,
  likes: number(row.likes_count),
  likedByMe: boolean(row.liked_by_me),
  comments: Array.isArray(row.comments) ? row.comments : [],
  audioPeaks: row.audio_peaks || null,
  clipPeaks: row.clip_peaks || null,
  relationType: row.relation_type || 'response',
  receipt: {
    sourceId: row.source_identity || null,
    range: row.source_type === 'article'
      ? { paragraph: row.anchor_paragraph, prefix: row.anchor_prefix || '', exact: row.source_excerpt || '', suffix: row.anchor_suffix || '' }
      : { start: number(row.clip_start), end: number(row.clip_end), duration: Math.max(0, number(row.clip_end) - number(row.clip_start)) },
    artifact: row.clip_receipt_id ? { id: row.clip_receipt_id, type: row.clip_kind, mimeType: row.clip_mime_type, bytes: number(row.clip_bytes), sha256: row.clip_sha256, resolution: row.clip_width || row.clip_height ? { width: number(row.clip_width), height: number(row.clip_height) } : null, probe: row.clip_probe || null, verifiedAt: iso(row.clip_verified_at), rightsState: row.clip_rights_state || 'unreviewed' } : null,
  },
  publisherReply: row.publisher_reply || null,
  opens: number(row.open_count),
} : null;

const mapClaim = (row) => row ? {
  id: row.id,
  annotationId: row.annotation_id,
  reporterId: row.reporter_id,
  reporterContact: row.reporter_contact,
  reason: row.reason,
  status: row.status,
  via: row.via,
  moderatorId: row.moderator_id,
  resolutionNote: row.resolution_note,
  isDemo: boolean(row.is_demo),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  ...(row.annotation ? { annotation: row.annotation } : {}),
  ...(row.reporter ? { reporter: row.reporter } : {}),
} : null;

const annotationProjection = `
  SELECT a.*, s.source_identity,
    jsonb_build_object(
      'id', u.id, 'handle', u.handle, 'displayName', u.display_name,
      'avatarUrl', u.avatar_url, 'bio', u.bio,
      'isDemo', (u.is_demo OR u.provider = 'demo')
    ) AS author,
    coalesce(interactions.likes_count, 0)::integer AS likes_count,
    coalesce(interactions.liked_by_me, false) AS liked_by_me,
    coalesce(interactions.comments, '[]'::jsonb) AS comments,
    audio.peaks AS audio_peaks,
    clip.peaks AS clip_peaks,
    evidence.id AS clip_receipt_id, evidence.kind AS clip_kind, evidence.mime_type AS clip_mime_type,
    evidence.bytes AS clip_bytes, evidence.sha256 AS clip_sha256, evidence.width AS clip_width,
    evidence.height AS clip_height, evidence.probe AS clip_probe, evidence.verified_at AS clip_verified_at,
    evidence.rights_state AS clip_rights_state,
    publisher.reply AS publisher_reply
  FROM annotated_annotations a
  JOIN annotated_sources s ON s.canonical_url = a.source_id
  JOIN annotated_users u ON u.id = a.author_id
  LEFT JOIN annotated_media_artifacts audio ON audio.id = a.audio_asset_id
  LEFT JOIN annotated_media_artifacts clip ON clip.id = a.media_asset_id
  LEFT JOIN annotated_media_artifacts evidence ON evidence.id = coalesce(a.media_asset_id,a.screenshot_asset_id)
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('id',r.id,'body',r.body,'createdAt',r.created_at,'verified',true,'workspaceId',w.id,'domain',w.domain,'displayName',w.display_name,'actor',jsonb_build_object('id',ru.id,'handle',ru.handle,'displayName',ru.display_name)) reply
    FROM annotated_publisher_replies r JOIN annotated_publisher_workspaces w ON w.id=r.workspace_id JOIN annotated_users ru ON ru.id=r.actor_id
    WHERE r.annotation_id=a.id AND w.status='verified' ORDER BY r.created_at LIMIT 1
  ) publisher ON true
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM annotated_likes l WHERE l.annotation_id = a.id) AS likes_count,
      (SELECT EXISTS(
        SELECT 1 FROM annotated_likes mine
        WHERE mine.annotation_id = a.id AND mine.user_id = $1
      )) AS liked_by_me,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', ordered.id,
        'annotationId', ordered.annotation_id,
        'authorId', ordered.author_id,
        'body', ordered.body,
        'createdAt', ordered.created_at,
        'author', jsonb_build_object(
          'id', ordered.user_id,
          'handle', ordered.handle,
          'displayName', ordered.display_name,
          'avatarUrl', ordered.avatar_url,
          'bio', ordered.bio,
          'isDemo', (ordered.user_is_demo OR ordered.provider = 'demo')
        )
      ) ORDER BY ordered.created_at, ordered.id), '[]'::jsonb)
      FROM (
        SELECT c.*, cu.id user_id, cu.handle, cu.display_name, cu.avatar_url, cu.bio, cu.is_demo user_is_demo, cu.provider
        FROM annotated_comments c
        JOIN annotated_users cu ON cu.id = c.author_id
        WHERE c.annotation_id = a.id
        ORDER BY c.created_at, c.id
        LIMIT 200
      ) ordered) AS comments
  ) interactions ON true`;

const legacyReceipt = (annotation, store) => {
  const media = (store.media || []).find((item) => item.id === annotation.mediaAssetId) || null;
  return {
    sourceId: annotation.sourceId || sourceIdentity(annotation.canonicalUrl || annotation.sourceUrl).id,
    range: annotation.sourceType === 'article' ? { paragraph: annotation.anchorParagraph || null, prefix: annotation.anchorPrefix || '', exact: annotation.sourceExcerpt || '', suffix: annotation.anchorSuffix || '' } : { start: number(annotation.clipStart), end: number(annotation.clipEnd), duration: Math.max(0, number(annotation.clipEnd) - number(annotation.clipStart)) },
    artifact: media ? { id: media.id, type: media.kind, mimeType: media.mimeType, bytes: number(media.bytes), sha256: media.sha256 || null, resolution: media.width || media.height ? { width: number(media.width), height: number(media.height) } : null, probe: media.probe || null, verifiedAt: media.verifiedAt || null, rightsState: media.rightsState || 'unreviewed' } : null,
  };
};

const legacyRich = (annotation, store, viewerId = '') => ({
  ...annotation,
  sourceId: annotation.sourceId || sourceIdentity(annotation.canonicalUrl || annotation.sourceUrl).id,
  relationType: annotation.relationType || 'response',
  author: publicUser((store.users || []).find((user) => user.id === annotation.authorId)) || { id: annotation.authorId, handle: annotation.authorId, displayName: annotation.authorId },
  likes: (store.likes || []).filter((like) => like.annotationId === annotation.id).length,
  likedByMe: Boolean(viewerId && (store.likes || []).some((like) => like.annotationId === annotation.id && like.userId === viewerId)),
  opens: Number(annotation.openCount) || 0,
  comments: (store.comments || [])
    .filter((comment) => comment.annotationId === annotation.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => ({
      ...comment,
      author: publicUser((store.users || []).find((user) => user.id === comment.authorId)) || { id: comment.authorId, handle: comment.authorId },
    })),
  audioPeaks: annotation.audioAssetId ? ((store.media || []).find((item) => item.id === annotation.audioAssetId)?.peaks || null) : null,
  clipPeaks: annotation.mediaAssetId ? ((store.media || []).find((item) => item.id === annotation.mediaAssetId)?.peaks || null) : null,
  receipt: legacyReceipt(annotation, store),
  publisherReply: (store.publisherReplies || []).find((reply) => reply.annotationId === annotation.id) || null,
  claims: undefined,
});

export const usesQueryNativeRepository = () => queryNative;

export async function findUser(value) {
  if (!queryNative) {
    const users = (await readStore()).users || [];
    return users.find((user) => user.id === value || user.handle === value) || null;
  }
  const result = await queryDatabase(
    'SELECT * FROM annotated_users WHERE id = $1 OR lower(handle) = lower($1) LIMIT 1',
    [value],
  );
  return mapUser(result.rows[0]);
}

export async function upsertIdentity(identity, id, now = new Date().toISOString()) {
  if (!queryNative) {
    let user;
    const next = await updateStore((store) => {
      const users = store.users || [];
      user = users.find((item) => item.provider === identity.provider && item.providerId === identity.providerId);
      if (user) {
        user = { ...user, ...identity, updatedAt: now };
        return { ...store, users: users.map((item) => item.id === user.id ? user : item) };
      }
      user = { id, ...identity, createdAt: now };
      return { ...store, users: [...users, user] };
    });
    return next.users.find((item) => item.id === user.id);
  }
  const userId = await transactDatabase(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`identity:${identity.provider}:${identity.providerId}`]);
    const selected = await client.query('SELECT * FROM annotated_users WHERE provider=$1 AND provider_id=$2 FOR UPDATE', [identity.provider, identity.providerId]);
    const existing = mapUser(selected.rows[0]);
    const user = existing ? { ...existing, ...identity, updatedAt: now } : { id, ...identity, createdAt: now };
    await writeLegacy(client, 'users', user.id, user);
    return user.id;
  });
  return findUser(userId);
}

export async function findSessionUser(tokenHash) {
  if (!queryNative) {
    const store = await readStore();
    const session = (store.sessions || []).find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date());
    return session ? (store.users || []).find((user) => user.id === session.userId) || null : null;
  }
  const result = await queryDatabase(
    `SELECT u.* FROM annotated_sessions s JOIN annotated_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1`,
    [tokenHash],
  );
  return mapUser(result.rows[0]);
}

export async function putExtensionTicket(record) {
  if (!queryNative) {
    await updateStore((store) => ({ ...store, extensionTickets: [...(store.extensionTickets || []).filter((item) => new Date(item.expiresAt) > new Date()), record] }));
    return;
  }
  await transactDatabase(async (client) => {
    await client.query("DELETE FROM annotated_records WHERE collection='extensionTickets' AND (payload->>'expiresAt')::timestamptz<=now()");
    await writeLegacy(client, 'extensionTickets', record.tokenHash, record);
  });
}

export async function consumeExtensionTicket(tokenHash) {
  if (!queryNative) {
    let userId = null;
    const now = new Date();
    await updateStore((store) => {
      const match = (store.extensionTickets || []).find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > now);
      if (!match) return store;
      userId = match.userId;
      return { ...store, extensionTickets: (store.extensionTickets || []).filter((item) => item !== match) };
    });
    return userId ? findUser(userId) : null;
  }
  const userId = await transactDatabase(async (client) => {
    const consumed = await client.query('DELETE FROM annotated_extension_tickets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id', [tokenHash]);
    if (!consumed.rows[0]) return null;
    await client.query("DELETE FROM annotated_records WHERE collection='extensionTickets' AND record_id=$1", [tokenHash]);
    return consumed.rows[0].user_id;
  });
  return userId ? findUser(userId) : null;
}

export async function findMedia(id) {
  if (!queryNative) return ((await readStore()).media || []).find((item) => item.id === id) || null;
  const result = await queryDatabase('SELECT * FROM annotated_media_artifacts WHERE id = $1', [id]);
  return mapMedia(result.rows[0]);
}

export async function putMedia(media) {
  if (!queryNative) {
    await updateStore((store) => ({ ...store, media: [...(store.media || []).filter((item) => item.id !== media.id), media] }));
    return media;
  }
  await transactDatabase(async (client) => {
    await client.query(
      `INSERT INTO annotated_media_artifacts
        (id, owner_id, object_key, file_name, mime_type, bytes, kind, duration_seconds, peaks, is_demo, created_at,sha256,width,height,probe,verified_at,rights_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)
       ON CONFLICT (id) DO UPDATE SET owner_id=EXCLUDED.owner_id, object_key=EXCLUDED.object_key,
         file_name=EXCLUDED.file_name, mime_type=EXCLUDED.mime_type, bytes=EXCLUDED.bytes,
         kind=EXCLUDED.kind, duration_seconds=EXCLUDED.duration_seconds, peaks=EXCLUDED.peaks, is_demo=EXCLUDED.is_demo,
         sha256=EXCLUDED.sha256,width=EXCLUDED.width,height=EXCLUDED.height,probe=EXCLUDED.probe,verified_at=EXCLUDED.verified_at,rights_state=EXCLUDED.rights_state`,
      [media.id, media.ownerId || null, media.key || media.fileName, media.fileName || null, media.mimeType, number(media.bytes), media.kind || null, media.durationSeconds ?? null, media.peaks || null, Boolean(media.isDemo), media.createdAt || new Date().toISOString(), media.sha256 || null, media.width || null, media.height || null, JSON.stringify(media.probe || null), media.verifiedAt || null, media.rightsState || 'unreviewed'],
    );
    await writeLegacy(client, 'media', media.id, media);
  });
  return media;
}

export async function findAnnotation(slugOrId, viewerId = '', { includeRemoved = true } = {}) {
  if (!queryNative) {
    const store = await readStore();
    const annotation = (store.annotations || []).find((item) => item.id === slugOrId || item.slug === slugOrId);
    if (!annotation || (!includeRemoved && annotation.status !== 'published')) return null;
    return legacyRich(annotation, store, viewerId);
  }
  const result = await queryDatabase(
    `${annotationProjection}
     WHERE (a.id = $2 OR a.slug = $2)
       AND ($3::boolean OR a.status = 'published')
       AND (a.visibility <> 'private' OR a.author_id = $1)
     LIMIT 1`,
    [viewerId || null, slugOrId, includeRemoved],
  );
  return mapAnnotation(result.rows[0]);
}

export async function listFeed({
  viewerId = '', limit = 20, cursor = '', offset = 0, sourceType = '', search = '', urlKey = '', followingOnly = false, topic = '', trending = false,
} = {}) {
  if (!queryNative) {
    const store = await readStore();
    const followedIds = new Set((store.follows || []).filter((follow) => follow.followerId === viewerId).map((follow) => follow.followingId));
    const filtered = (store.annotations || []).filter((item) => item.status === 'published'
      && isPubliclyListed(item)
      && (!sourceType || item.sourceType === sourceType)
      && (!followingOnly || followedIds.has(item.authorId) || item.authorId === viewerId)
      && matchesFeedQuery(item, store.users || [], search)
      && matchesFeedUrl(item, urlKey));
    const topics = trending ? TOPICS.map(({ slug, label }) => ({ slug, label, count: filtered.filter((item) => item.topic === slug).length })).filter((entry) => entry.count > 0) : undefined;
    const scoped = topic ? filtered.filter((item) => item.topic === topic) : filtered;
    if (trending) {
      const candidates = sortByTrending(scoped, store);
      const page = candidates.slice(offset, offset + limit);
      return { annotations: page.map((item) => legacyRich(item, store, viewerId)), nextCursor: offset + page.length < candidates.length ? String(offset + page.length) : null, topics };
    }
    const candidates = scoped.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const keyset = parseKeysetCursor(cursor);
    const remaining = keyset ? afterKeysetCursor(candidates, keyset) : candidates.slice(offset);
    const page = remaining.slice(0, limit);
    return { annotations: page.map((item) => legacyRich(item, store, viewerId)), nextCursor: remaining.length > limit ? keysetCursorFor(page[page.length - 1]) : null };
  }

  const parameters = [viewerId || null];
  const where = ["a.status = 'published'", "a.visibility = 'public'"];
  const add = (clause, value) => { parameters.push(value); where.push(clause.replace('?', `$${parameters.length}`)); };
  if (sourceType) add('a.source_type = ?', sourceType);
  if (followingOnly) where.push('(a.author_id = $1 OR EXISTS (SELECT 1 FROM annotated_follows f WHERE f.follower_id = $1 AND f.following_id = a.author_id))');
  if (search) {
    parameters.push(search);
    const position = parameters.length;
    where.push(`(a.search_document @@ websearch_to_tsquery('simple', $${position}) OR lower(u.handle) LIKE '%' || lower($${position}) || '%' OR lower(u.display_name) LIKE '%' || lower($${position}) || '%')`);
  }
  if (urlKey) {
    // Match the capture URL or its canonical form — a youtu.be tab must find
    // the youtube.com capture, exactly as the file store's matchesFeedUrl does.
    parameters.push(urlKey);
    where.push(`(a.source_url_key = $${parameters.length} OR a.canonical_url_key = $${parameters.length})`);
  }
  const topicCountWhere = [...where];
  const topicCountParameters = [...parameters];
  if (topic) add('a.topic = ?', topic);
  const keyset = !trending ? parseKeysetCursor(cursor) : null;
  if (keyset) {
    parameters.push(keyset.createdAt, keyset.id);
    where.push(`(a.created_at, a.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length})`);
  }
  const offsetValue = trending || (!keyset && /^\d+$/u.test(String(cursor || ''))) ? Math.max(0, Number(offset) || 0) : 0;
  parameters.push(limit + 1, offsetValue);
  const limitPosition = parameters.length - 1;
  const offsetPosition = parameters.length;
  const order = trending
    ? `(a.open_count * 3 + coalesce(interactions.likes_count, 0) + jsonb_array_length(coalesce(interactions.comments, '[]'::jsonb)) * 2) / power(extract(epoch from (now() - a.created_at)) / 3600 + 2, 1.5) DESC, a.created_at DESC, a.id DESC`
    : 'a.created_at DESC, a.id DESC';
  const result = await queryDatabase(
    `${annotationProjection}
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    parameters,
  );
  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0, limit).map(mapAnnotation);
  let topics;
  if (trending) {
    const topicResult = await queryDatabase(
      `SELECT a.topic slug, count(*)::integer count
       FROM annotated_annotations a JOIN annotated_users u ON u.id = a.author_id
       WHERE ($1::text IS NULL OR $1::text IS NOT NULL) AND ${topicCountWhere.join(' AND ')} AND a.topic IS NOT NULL
       GROUP BY a.topic ORDER BY a.topic`,
      topicCountParameters,
    );
    const labels = new Map(TOPICS.map((entry) => [entry.slug, entry.label]));
    topics = topicResult.rows.filter((entry) => labels.has(entry.slug)).map((entry) => ({ slug: entry.slug, label: labels.get(entry.slug), count: number(entry.count) }));
  }
  return {
    annotations: page,
    nextCursor: hasMore && page.length ? (trending ? String(offsetValue + page.length) : keysetCursorFor(page.at(-1))) : null,
    topics,
  };
}

export async function sourceHub(host, viewerId = '', { limit = 20, offset = 0 } = {}) {
  if (!queryNative) {
    const store = await readStore();
    const all = publicAnnotationsForHost(store.annotations || [], host).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = all.slice(offset, offset + limit);
    const annotators = rankAnnotators(all, store.users || [], 5).map((entry) => ({
      ...(publicUser(entry.user) || { id: entry.authorId, handle: entry.authorId, displayName: entry.authorId }),
      annotationCount: entry.count,
      opens: entry.opens,
      isFollowing: Boolean(viewerId && (store.follows || []).some((follow) => follow.followerId === viewerId && follow.followingId === entry.authorId)),
    }));
    return {
      source: { host, annotationCount: all.length, opens: all.reduce((total, item) => total + number(item.openCount), 0) },
      annotators,
      annotations: page.map((item) => legacyRich(item, store, viewerId)),
      nextCursor: offset + page.length < all.length ? String(offset + page.length) : null,
    };
  }
  const boundedLimit = Math.min(100, Math.max(1, number(limit, 20)));
  const boundedOffset = Math.max(0, number(offset));
  const [annotations, summary, annotators] = await Promise.all([
    queryDatabase(
      `${annotationProjection}
       WHERE a.status='published' AND a.visibility='public' AND lower(a.source_host)=lower($2)
       ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
      [viewerId || null, host, boundedLimit, boundedOffset],
    ),
    queryDatabase(
      `SELECT count(*)::integer annotation_count, coalesce(sum(open_count),0)::bigint opens
       FROM annotated_annotations WHERE status='published' AND visibility='public' AND lower(source_host)=lower($1)`,
      [host],
    ),
    queryDatabase(
      `SELECT u.id,u.handle,u.display_name,u.avatar_url,u.bio,u.is_demo,u.provider,
         count(*)::integer annotation_count,coalesce(sum(a.open_count),0)::bigint opens,
         EXISTS(SELECT 1 FROM annotated_follows f WHERE f.follower_id=$1 AND f.following_id=u.id) is_following
       FROM annotated_annotations a JOIN annotated_users u ON u.id=a.author_id
       WHERE a.status='published' AND a.visibility='public' AND lower(a.source_host)=lower($2)
       GROUP BY u.id ORDER BY opens DESC, annotation_count DESC, u.id LIMIT 5`,
      [viewerId || null, host],
    ),
  ]);
  const total = number(summary.rows[0]?.annotation_count);
  return {
    source: { host, annotationCount: total, opens: number(summary.rows[0]?.opens) },
    annotators: annotators.rows.map((row) => ({ ...publicUser(mapUser(row)), annotationCount: number(row.annotation_count), opens: number(row.opens), isFollowing: boolean(row.is_following) })),
    annotations: annotations.rows.map(mapAnnotation),
    nextCursor: boundedOffset + annotations.rows.length < total ? String(boundedOffset + annotations.rows.length) : null,
  };
}

export async function trendingSources(limit = 10) {
  if (!queryNative) {
    const store = await readStore();
    return rankTrendingSources((store.annotations || []).filter((item) => item.status === 'published' && isPubliclyListed(item)), limit)
      .map(({ host, opens, annotationCount }) => ({ host, opens, annotationCount }));
  }
  const result = await queryDatabase(
    `SELECT source_host host, count(*)::integer annotation_count, coalesce(sum(open_count),0)::bigint opens,
       sum((open_count + 1) / power(extract(epoch from (now()-created_at))/3600 + 2, 1.5)) score
     FROM annotated_annotations WHERE status='published' AND visibility='public' AND source_host<>''
     GROUP BY source_host ORDER BY score DESC, opens DESC, source_host LIMIT $1`,
    [Math.min(50, Math.max(1, number(limit, 10)))],
  );
  return result.rows.map((row) => ({ host: row.host, opens: number(row.opens), annotationCount: number(row.annotation_count) }));
}

export async function listPeople(viewerId = '', search = '', limit = 10) {
  if (!queryNative) {
    const store = await readStore();
    const people = rankAnnotators((store.annotations || []).filter((item) => item.status === 'published' && isPubliclyListed(item)), store.users || [], 50)
      .filter((entry) => entry.user && (!search || `${entry.user.handle} ${entry.user.displayName}`.toLowerCase().includes(search.toLowerCase())))
      .slice(0, limit)
      .map((entry) => ({
        ...publicUser(entry.user), annotationCount: entry.count, opens: entry.opens,
        followers: (store.follows || []).filter((follow) => follow.followingId === entry.user.id).length,
        isFollowing: Boolean(viewerId && (store.follows || []).some((follow) => follow.followerId === viewerId && follow.followingId === entry.user.id)),
      }));
    return people;
  }
  const result = await queryDatabase(
    `SELECT u.*, count(a.id)::integer annotation_count, coalesce(sum(a.open_count),0)::bigint opens,
       (SELECT count(*) FROM annotated_follows followers WHERE followers.following_id=u.id)::integer followers,
       EXISTS(SELECT 1 FROM annotated_follows mine WHERE mine.follower_id=$1 AND mine.following_id=u.id) is_following
     FROM annotated_users u JOIN annotated_annotations a ON a.author_id=u.id AND a.status='published' AND a.visibility='public'
     WHERE ($2='' OR lower(u.handle) LIKE '%'||lower($2)||'%' OR lower(u.display_name) LIKE '%'||lower($2)||'%')
     GROUP BY u.id ORDER BY opens DESC, annotation_count DESC, u.id LIMIT $3`,
    [viewerId || null, search || '', Math.min(50, Math.max(1, number(limit, 10)))],
  );
  return result.rows.map((row) => ({ ...publicUser(mapUser(row)), annotationCount: number(row.annotation_count), opens: number(row.opens), followers: number(row.followers), isFollowing: boolean(row.is_following) }));
}

export async function getProfile(value, viewerId = '', limit = 20) {
  if (!queryNative) {
    const store = await readStore();
    const profile = (store.users || []).find((user) => user.handle === value || user.id === value);
    if (!profile) return null;
    const visible = (annotation) => annotation.authorId === profile.id && annotation.status === 'published' && (viewerId === profile.id || isPubliclyListed(annotation));
    const annotations = (store.annotations || []).filter(visible).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ...publicUser(profile),
      followers: (store.follows || []).filter((follow) => follow.followingId === profile.id).length,
      following: (store.follows || []).filter((follow) => follow.followerId === profile.id).length,
      isFollowing: Boolean(viewerId && (store.follows || []).some((follow) => follow.followerId === viewerId && follow.followingId === profile.id)),
      annotationCount: annotations.length,
      annotations: annotations.slice(0, limit).map((annotation) => legacyRich(annotation, store, viewerId)),
    };
  }
  const user = await findUser(value);
  if (!user) return null;
  const [counts, annotations] = await Promise.all([
    queryDatabase(
      `SELECT
         (SELECT count(*) FROM annotated_follows WHERE following_id=$1)::integer followers,
         (SELECT count(*) FROM annotated_follows WHERE follower_id=$1)::integer following,
         EXISTS(SELECT 1 FROM annotated_follows WHERE follower_id=$2 AND following_id=$1) is_following,
         (SELECT count(*) FROM annotated_annotations WHERE author_id=$1 AND status='published' AND ($2=$1 OR visibility='public'))::integer annotation_count`,
      [user.id, viewerId || null],
    ),
    queryDatabase(
      `${annotationProjection}
       WHERE a.author_id=$2 AND a.status='published' AND ($1=$2 OR a.visibility='public')
       ORDER BY a.created_at DESC,a.id DESC LIMIT $3`,
      [viewerId || null, user.id, Math.min(100, Math.max(1, number(limit, 20)))],
    ),
  ]);
  return {
    ...publicUser(user), followers: number(counts.rows[0]?.followers), following: number(counts.rows[0]?.following),
    isFollowing: boolean(counts.rows[0]?.is_following), annotationCount: number(counts.rows[0]?.annotation_count), annotations: annotations.rows.map(mapAnnotation),
  };
}

export async function listNotifications(userId, limit = 50) {
  if (!queryNative) {
    const store = await readStore();
    const mine = new Map((store.annotations || []).filter((item) => item.authorId === userId).map((item) => [item.id, item]));
    const actorOf = (id) => publicUser((store.users || []).find((user) => user.id === id)) || { id, handle: id, displayName: '' };
    const annotationRef = (annotation) => ({ slug: annotation.slug, sourceTitle: annotation.sourceTitle || annotation.sourceHost || 'your annotation' });
    return [
      ...(store.comments || []).filter((comment) => mine.has(comment.annotationId) && comment.authorId !== userId).map((comment) => ({ type: 'response', actor: actorOf(comment.authorId), body: String(comment.body || '').slice(0, 140), annotation: annotationRef(mine.get(comment.annotationId)), createdAt: comment.createdAt })),
      ...(store.likes || []).filter((like) => mine.has(like.annotationId) && like.userId !== userId).map((like) => ({ type: 'like', actor: actorOf(like.userId), annotation: annotationRef(mine.get(like.annotationId)), createdAt: like.createdAt })),
      ...(store.follows || []).filter((follow) => follow.followingId === userId).map((follow) => ({ type: 'follow', actor: actorOf(follow.followerId), createdAt: follow.createdAt })),
    ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  }
  const result = await queryDatabase(
    `SELECT event_type, actor, annotation, body, created_at FROM (
       SELECT 'response' event_type,
         jsonb_build_object('id', u.id, 'handle', u.handle, 'displayName', u.display_name, 'avatarUrl', u.avatar_url, 'bio', u.bio, 'isDemo', (u.is_demo OR u.provider='demo')) actor,
         jsonb_build_object('slug', a.slug, 'sourceTitle', coalesce(nullif(a.source_title,''), nullif(a.source_host,''), 'your annotation')) annotation,
         left(c.body, 140) body, c.created_at
       FROM annotated_comments c JOIN annotated_annotations a ON a.id=c.annotation_id JOIN annotated_users u ON u.id=c.author_id
       WHERE a.author_id=$1 AND c.author_id<>$1
       UNION ALL
       SELECT 'like', jsonb_build_object('id',u.id,'handle',u.handle,'displayName',u.display_name,'avatarUrl',u.avatar_url,'bio',u.bio,'isDemo',(u.is_demo OR u.provider='demo')),
         jsonb_build_object('slug',a.slug,'sourceTitle',coalesce(nullif(a.source_title,''),nullif(a.source_host,''),'your annotation')), null, l.created_at
       FROM annotated_likes l JOIN annotated_annotations a ON a.id=l.annotation_id JOIN annotated_users u ON u.id=l.user_id
       WHERE a.author_id=$1 AND l.user_id<>$1
       UNION ALL
       SELECT 'follow', jsonb_build_object('id',u.id,'handle',u.handle,'displayName',u.display_name,'avatarUrl',u.avatar_url,'bio',u.bio,'isDemo',(u.is_demo OR u.provider='demo')), null, null, f.created_at
       FROM annotated_follows f JOIN annotated_users u ON u.id=f.follower_id WHERE f.following_id=$1
     ) events ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(100, Math.max(1, limit))],
  );
  return result.rows.map((row) => ({ type: row.event_type, actor: row.actor, ...(row.annotation ? { annotation: row.annotation } : {}), ...(row.body ? { body: row.body } : {}), createdAt: iso(row.created_at) }));
}

export async function markNotificationsSeen(userId, seenAt = new Date().toISOString()) {
  if (!queryNative) {
    await updateStore((store) => ({ ...store, users: (store.users || []).map((user) => user.id === userId ? { ...user, lastNotificationsSeenAt: seenAt } : user) }));
    return seenAt;
  }
  await transactDatabase(async (client) => {
    const result = await client.query('UPDATE annotated_users SET last_notifications_seen_at=$2, updated_at=now() WHERE id=$1 RETURNING *', [userId, seenAt]);
    if (!result.rows[0]) throw new Error('Notification owner no longer exists.');
    await writeLegacy(client, 'users', userId, mapUser(result.rows[0]));
  });
  return seenAt;
}

export async function toggleFollow(followerId, followingId, on) {
  if (!queryNative) {
    await legacyToggleFollow(followerId, followingId, on);
    const store = await readStore();
    return (store.follows || []).some((follow) => follow.followerId === followerId && follow.followingId === followingId);
  }
  return transactDatabase(async (client) => {
    const record = { id: `follow-${followerId}-${followingId}`, followerId, followingId, createdAt: new Date().toISOString() };
    if (on) {
      await client.query('INSERT INTO annotated_follows (follower_id,following_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [followerId, followingId, record.createdAt]);
      await writeLegacy(client, 'follows', record.id, record);
    } else {
      await client.query('DELETE FROM annotated_follows WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]);
      await client.query("DELETE FROM annotated_records WHERE collection='follows' AND payload->>'followerId'=$1 AND payload->>'followingId'=$2", [followerId, followingId]);
    }
    return on;
  });
}

export async function toggleLike(annotationId, userId, on) {
  if (!queryNative) {
    await legacyToggleLike(annotationId, userId, on);
    return on;
  }
  return transactDatabase(async (client) => {
    const record = { id: `like-${annotationId}-${userId}`, annotationId, userId, createdAt: new Date().toISOString() };
    if (on) {
      await client.query('INSERT INTO annotated_likes (annotation_id,user_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [annotationId, userId, record.createdAt]);
      await writeLegacy(client, 'likes', record.id, record);
    } else {
      await client.query('DELETE FROM annotated_likes WHERE annotation_id=$1 AND user_id=$2', [annotationId, userId]);
      await client.query("DELETE FROM annotated_records WHERE collection='likes' AND payload->>'annotationId'=$1 AND payload->>'userId'=$2", [annotationId, userId]);
    }
    return on;
  });
}

export async function incrementOpen(annotationId) {
  if (!queryNative) {
    let opens = 0;
    await updateStore((store) => ({ ...store, annotations: store.annotations.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      opens = number(annotation.openCount) + 1;
      return { ...annotation, openCount: opens };
    }) }));
    return opens;
  }
  return transactDatabase(async (client) => {
    const result = await client.query('UPDATE annotated_annotations SET open_count=open_count+1, updated_at=now() WHERE id=$1 RETURNING *', [annotationId]);
    if (!result.rows[0]) return null;
    const annotation = mapAnnotation(result.rows[0]);
    await writeLegacy(client, 'annotations', annotation.id, annotation);
    return annotation.openCount;
  });
}

const writeLegacy = (client, collection, id, payload) => client.query(
  `INSERT INTO annotated_records (collection,record_id,payload,updated_at) VALUES ($1,$2,$3::jsonb,now())
   ON CONFLICT (collection,record_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,
  [collection, id, JSON.stringify(payload)],
);

export async function createAnnotation(candidate) {
  if (!queryNative) {
    let created = false;
    let annotation;
    const store = await updateStore((current) => {
      const existing = (current.annotations || []).find((item) => item.authorId === candidate.authorId && candidate.clientRequestId && item.clientRequestId === candidate.clientRequestId);
      if (existing) { annotation = existing; return current; }
      created = true;
      annotation = candidate;
      return { ...current, annotations: [...(current.annotations || []), candidate] };
    });
    return { created, annotation: legacyRich(annotation, store, candidate.authorId) };
  }
  const result = await transactDatabase(async (client) => {
    if (candidate.clientRequestId) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`annotation:${candidate.authorId}:${candidate.clientRequestId}`]);
      const existing = await client.query('SELECT id FROM annotated_annotations WHERE author_id=$1 AND client_request_id=$2 LIMIT 1', [candidate.authorId, candidate.clientRequestId]);
      if (existing.rows[0]) return { created: false, id: existing.rows[0].id };
    }
    await writeLegacy(client, 'annotations', candidate.id, candidate);
    await client.query('UPDATE annotated_sources SET source_identity=$1 WHERE canonical_url=$2', [candidate.sourceId, candidate.canonicalUrl]);
    await client.query('UPDATE annotated_annotations SET relation_type=$1 WHERE id=$2', [candidate.relationType || 'response', candidate.id]);
    return { created: true, id: candidate.id };
  });
  return { ...result, annotation: await findAnnotation(result.id, candidate.authorId) };
}

export async function updateAnnotation(slugOrId, actorId, changes) {
  if (!queryNative) {
    let updated = null;
    const store = await updateStore((current) => ({
      ...current,
      annotations: (current.annotations || []).map((item) => {
        if ((item.id !== slugOrId && item.slug !== slugOrId) || item.authorId !== actorId) return item;
        updated = { ...item, ...changes };
        return updated;
      }),
    }));
    return updated ? legacyRich(updated, store, actorId) : null;
  }
  const id = await transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_annotations WHERE (id=$1 OR slug=$1) AND author_id=$2 FOR UPDATE', [slugOrId, actorId]);
    if (!selected.rows[0]) return null;
    const updated = { ...mapAnnotation(selected.rows[0]), ...changes };
    await writeLegacy(client, 'annotations', updated.id, updated);
    return updated.id;
  });
  return id ? findAnnotation(id, actorId) : null;
}

export async function deleteAnnotation(slugOrId, actorId, { moderator = false } = {}) {
  if (!queryNative) {
    const current = await readStore();
    const annotation = (current.annotations || []).find((item) => item.id === slugOrId || item.slug === slugOrId);
    if (!annotation || (!moderator && annotation.authorId !== actorId)) return null;
    const assetIds = [annotation.audioAssetId, annotation.mediaAssetId, annotation.posterAssetId, annotation.screenshotAssetId].filter(Boolean);
    const assets = (current.media || []).filter((item) => assetIds.includes(item.id));
    await updateStore((store) => ({
      ...store,
      annotations: (store.annotations || []).filter((item) => item.id !== annotation.id),
      comments: (store.comments || []).filter((item) => item.annotationId !== annotation.id),
      likes: (store.likes || []).filter((item) => item.annotationId !== annotation.id),
      mediaJobs: (store.mediaJobs || []).filter((item) => item.annotationId !== annotation.id),
      media: (store.media || []).filter((item) => !assetIds.includes(item.id)),
    }));
    return { annotation, assets };
  }
  return transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_annotations WHERE (id=$1 OR slug=$1) FOR UPDATE', [slugOrId]);
    const row = selected.rows[0];
    if (!row || (!moderator && row.author_id !== actorId)) return null;
    const annotation = mapAnnotation(row);
    const assetIds = [row.audio_asset_id, row.media_asset_id, row.poster_asset_id, row.screenshot_asset_id].filter(Boolean);
    const assets = assetIds.length ? (await client.query('SELECT * FROM annotated_media_artifacts WHERE id=ANY($1::text[])', [assetIds])).rows.map(mapMedia) : [];
    await client.query("DELETE FROM annotated_records WHERE collection IN ('comments','likes','mediaJobs') AND payload->>'annotationId'=$1", [row.id]);
    await client.query("DELETE FROM annotated_records WHERE collection='annotations' AND record_id=$1", [row.id]);
    if (assetIds.length) await client.query("DELETE FROM annotated_records WHERE collection='media' AND record_id=ANY($1::text[])", [assetIds]);
    return { annotation, assets };
  });
}

export async function addComment(slugOrId, authorId, body, { id, createdAt } = {}) {
  const comment = { id, annotationId: '', authorId, body, createdAt };
  if (!queryNative) {
    let annotationId = '';
    const store = await updateStore((current) => {
      const annotation = (current.annotations || []).find((item) => item.id === slugOrId || item.slug === slugOrId);
      if (!annotation) return current;
      annotationId = annotation.id;
      return { ...current, comments: [...(current.comments || []), { ...comment, annotationId }] };
    });
    const annotation = (store.annotations || []).find((item) => item.id === annotationId);
    return annotation ? legacyRich(annotation, store, authorId) : null;
  }
  const annotationId = await transactDatabase(async (client) => {
    const selected = await client.query("SELECT id FROM annotated_annotations WHERE (id=$1 OR slug=$1) AND status='published' AND (visibility<>'private' OR author_id=$2) FOR SHARE", [slugOrId, authorId]);
    if (!selected.rows[0]) return null;
    comment.annotationId = selected.rows[0].id;
    await writeLegacy(client, 'comments', comment.id, comment);
    return comment.annotationId;
  });
  return annotationId ? findAnnotation(annotationId, authorId) : null;
}

export async function createClaim(slugOrId, { id, reporterId = null, reporterContact = null, reason, via = null, auditId, actorId, createdAt }) {
  if (!queryNative) {
    let claim = null;
    let created = false;
    await updateStore((store) => {
      const annotation = (store.annotations || []).find((item) => item.id === slugOrId || item.slug === slugOrId);
      if (!annotation || annotation.status !== 'published') return store;
      const existing = (store.claims || []).find((item) => item.annotationId === annotation.id && ['open', 'in_review'].includes(item.status)
        && (reporterId ? item.reporterId === reporterId : String(item.reporterContact || '').toLowerCase() === String(reporterContact || '').toLowerCase()));
      if (existing) { claim = existing; return store; }
      created = true;
      claim = { id, annotationId: annotation.id, reporterId, reporterContact, reason, status: 'open', via, createdAt };
      const audit = { id: auditId, claimId: id, actorId, from: null, to: 'open', note: '', createdAt };
      return { ...store, claims: [...(store.claims || []), claim], moderationAudit: [...(store.moderationAudit || []), audit] };
    });
    return { created, claim };
  }
  return transactDatabase(async (client) => {
    const selected = await client.query("SELECT id FROM annotated_annotations WHERE (id=$1 OR slug=$1) AND status='published' AND visibility<>'private' FOR SHARE", [slugOrId]);
    if (!selected.rows[0]) return { created: false, claim: null };
    const annotationId = selected.rows[0].id;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`claim:${annotationId}:${reporterId || String(reporterContact).toLowerCase()}`]);
    const existing = reporterId
      ? await client.query("SELECT * FROM annotated_claims WHERE annotation_id=$1 AND reporter_id=$2 AND status IN ('open','in_review') LIMIT 1", [annotationId, reporterId])
      : await client.query("SELECT * FROM annotated_claims WHERE annotation_id=$1 AND lower(reporter_contact)=lower($2) AND status IN ('open','in_review') LIMIT 1", [annotationId, reporterContact]);
    if (existing.rows[0]) return { created: false, claim: mapClaim(existing.rows[0]) };
    const claim = { id, annotationId, reporterId, reporterContact, reason, status: 'open', via, createdAt };
    await writeLegacy(client, 'claims', id, claim);
    await writeLegacy(client, 'moderationAudit', auditId, { id: auditId, claimId: id, actorId, from: null, to: 'open', note: '', createdAt });
    return { created: true, claim };
  });
}

const claimProjection = `SELECT c.*,
  jsonb_build_object('id',a.id,'slug',a.slug,'authorId',a.author_id,'sourceTitle',a.source_title,'sourceHost',a.source_host,'sourceType',a.source_type,'status',a.status,'visibility',a.visibility,'createdAt',a.created_at) annotation,
  CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'handle',u.handle,'displayName',u.display_name,'avatarUrl',u.avatar_url) END reporter
  FROM annotated_claims c LEFT JOIN annotated_annotations a ON a.id=c.annotation_id LEFT JOIN annotated_users u ON u.id=c.reporter_id`;

export async function listClaims({ reporterId = null, moderation = false } = {}) {
  if (!queryNative) {
    const store = await readStore();
    return (store.claims || []).filter((claim) => moderation || claim.reporterId === reporterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((claim) => ({
      ...claim,
      annotation: (store.annotations || []).find((item) => item.id === claim.annotationId) || null,
      ...(moderation ? { reporter: (store.users || []).find((item) => item.id === claim.reporterId) || null } : {}),
    }));
  }
  const result = await queryDatabase(`${claimProjection} ${moderation ? '' : 'WHERE c.reporter_id=$1'} ORDER BY c.created_at DESC,c.id`, moderation ? [] : [reporterId]);
  return result.rows.map(mapClaim);
}

export async function findClaim(id) {
  if (!queryNative) return ((await readStore()).claims || []).find((item) => item.id === id) || null;
  const result = await queryDatabase('SELECT * FROM annotated_claims WHERE id=$1', [id]);
  return mapClaim(result.rows[0]);
}

export async function moderateClaim(id, { actorId, status, note = '', action = null, auditId, updatedAt = new Date().toISOString() }) {
  if (!queryNative) {
    let found = false;
    let removedAssets = [];
    let updatedClaim = null;
    await updateStore((store) => {
      const claim = (store.claims || []).find((item) => item.id === id);
      if (!claim) return store;
      found = true;
      updatedClaim = { ...claim, status, moderatorId: actorId, resolutionNote: note, updatedAt };
      let next = { ...store, claims: store.claims.map((item) => item.id === id ? updatedClaim : item), moderationAudit: [...(store.moderationAudit || []), { id: auditId, claimId: id, actorId, from: claim.status, to: status, note, action, createdAt: updatedAt }] };
      if (action === 'remove') {
        const annotation = (next.annotations || []).find((item) => item.id === claim.annotationId);
        if (annotation && annotation.status !== 'removed') {
          const assetIds = [annotation.audioAssetId, annotation.mediaAssetId, annotation.posterAssetId, annotation.screenshotAssetId].filter(Boolean);
          removedAssets = (next.media || []).filter((item) => assetIds.includes(item.id));
          next = { ...next, media: (next.media || []).filter((item) => !assetIds.includes(item.id)), annotations: next.annotations.map((item) => item.id === annotation.id ? { ...item, status: 'removed', removedAt: updatedAt, removedBy: actorId, removedReason: 'rights-claim', mediaAssetId: null, audioAssetId: null, screenshotAssetId: null, posterAssetId: null, mediaStatus: 'not-applicable' } : item) };
        }
      }
      return next;
    });
    return found ? { claim: updatedClaim, removedAssets } : null;
  }
  return transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_claims WHERE id=$1 FOR UPDATE', [id]);
    const claim = mapClaim(selected.rows[0]);
    if (!claim) return null;
    const updated = { ...claim, status, moderatorId: actorId, resolutionNote: note, updatedAt };
    await writeLegacy(client, 'claims', id, updated);
    await writeLegacy(client, 'moderationAudit', auditId, { id: auditId, claimId: id, actorId, from: claim.status, to: status, note, action, createdAt: updatedAt });
    const removedAssets = [];
    if (action === 'remove' && claim.annotationId) {
      const annotationResult = await client.query("SELECT * FROM annotated_annotations WHERE id=$1 AND status<>'removed' FOR UPDATE", [claim.annotationId]);
      if (annotationResult.rows[0]) {
        const annotation = mapAnnotation(annotationResult.rows[0]);
        const assetIds = [annotation.audioAssetId, annotation.mediaAssetId, annotation.posterAssetId, annotation.screenshotAssetId].filter(Boolean);
        if (assetIds.length) removedAssets.push(...(await client.query('SELECT * FROM annotated_media_artifacts WHERE id=ANY($1::text[])', [assetIds])).rows.map(mapMedia));
        await writeLegacy(client, 'annotations', annotation.id, { ...annotation, status: 'removed', removedAt: updatedAt, removedBy: actorId, removedReason: 'rights-claim', mediaAssetId: null, audioAssetId: null, screenshotAssetId: null, posterAssetId: null, mediaStatus: 'not-applicable' });
        if (assetIds.length) await client.query("DELETE FROM annotated_records WHERE collection='media' AND record_id=ANY($1::text[])", [assetIds]);
      }
    }
    return { claim: updated, removedAssets };
  });
}

export async function transparencyReport() {
  if (!queryNative) {
    const store = await readStore();
    const counts = { total: 0, open: 0, in_review: 0, resolved: 0, rejected: 0 };
    for (const claim of (store.claims || []).filter((item) => !item.isDemo)) { counts.total += 1; if (counts[claim.status] !== undefined) counts[claim.status] += 1; }
    return {
      claims: counts,
      demonstrationClaims: (store.claims || []).filter((item) => item.isDemo).length,
      takedowns: (store.annotations || []).filter((item) => item.status === 'removed').sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || ''))).map((item) => ({ slug: item.slug, sourceHost: item.sourceHost || '', sourceType: item.sourceType || 'article', removedAt: item.removedAt || null, reason: item.removedReason || 'rights-claim' })),
    };
  }
  const [claims, takedowns] = await Promise.all([
    queryDatabase(`SELECT count(*) FILTER (WHERE NOT is_demo)::integer total,
      count(*) FILTER (WHERE NOT is_demo AND status='open')::integer open,
      count(*) FILTER (WHERE NOT is_demo AND status='in_review')::integer in_review,
      count(*) FILTER (WHERE NOT is_demo AND status='resolved')::integer resolved,
      count(*) FILTER (WHERE NOT is_demo AND status='rejected')::integer rejected,
      count(*) FILTER (WHERE is_demo)::integer demonstration FROM annotated_claims`),
    queryDatabase("SELECT slug,source_host,source_type,removed_at,removed_reason FROM annotated_annotations WHERE status='removed' ORDER BY removed_at DESC NULLS LAST,id"),
  ]);
  const row = claims.rows[0] || {};
  return {
    claims: { total: number(row.total), open: number(row.open), in_review: number(row.in_review), resolved: number(row.resolved), rejected: number(row.rejected) },
    demonstrationClaims: number(row.demonstration),
    takedowns: takedowns.rows.map((item) => ({ slug: item.slug, sourceHost: item.source_host || '', sourceType: item.source_type || 'article', removedAt: iso(item.removed_at), reason: item.removed_reason || 'rights-claim' })),
  };
}

export async function proofWorldStore() {
  if (!queryNative) return readStore();
  const [users, annotations, comments, follows, likes, claims] = await Promise.all([
    queryDatabase("SELECT * FROM annotated_users WHERE is_demo OR provider='demo' ORDER BY id LIMIT 100"),
    queryDatabase("SELECT * FROM annotated_annotations WHERE is_demo AND status='published' ORDER BY id LIMIT 500"),
    queryDatabase("SELECT id,annotation_id FROM annotated_comments WHERE annotation_id IN (SELECT id FROM annotated_annotations WHERE is_demo) LIMIT 1"),
    queryDatabase('SELECT follower_id,following_id FROM annotated_follows LIMIT 1'),
    queryDatabase('SELECT annotation_id,user_id FROM annotated_likes LIMIT 1'),
    queryDatabase('SELECT id,is_demo FROM annotated_claims WHERE is_demo LIMIT 1'),
  ]);
  return {
    users: users.rows.map(mapUser),
    annotations: annotations.rows.map(mapAnnotation),
    comments: comments.rows.map((row) => ({ id: row.id, annotationId: row.annotation_id })),
    follows: follows.rows,
    likes: likes.rows,
    claims: claims.rows.map((row) => ({ id: row.id, isDemo: row.is_demo })),
  };
}

export { mapAnnotation, mapClaim, mapMedia, mapUser, writeLegacy };
