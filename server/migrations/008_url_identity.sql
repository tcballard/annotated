-- One URL, one identity — in the same bytes the JS computes.
--
-- The previous annotated_url_key lower-cased the ENTIRE URL while the
-- JavaScript twin (normalizeSourceUrlKey, server/feed.js) folds only the
-- host. On PostgreSQL deployments every stored key for a URL with an
-- uppercase path or query (wikipedia titles, YouTube video IDs) could
-- never equal a query-side key, so the panel's "This page" feed was
-- permanently empty for those pages. Proven against staging:
-- ?url=https://en.wikipedia.org/wiki/Web_annotation matched 0 while the
-- lower-cased spelling matched 1.
--
-- The function is redefined to mirror the JS exactly (host-only folding,
-- port dropped, tracking/position params stripped, survivors kept in raw
-- order and encoding), every stored key is recomputed, and annotations
-- additionally store the key of their CANONICAL url so a youtu.be tab
-- matches a youtube.com capture the way file-store mode always did.

CREATE OR REPLACE FUNCTION annotated_url_key(value text) RETURNS text AS $fn$
DECLARE
  no_hash text := split_part(coalesce(value, ''), '#', 1);
  after_scheme text;
  hostport text;
  host text;
  rest text;
  path_part text;
  query_part text;
  kept text;
BEGIN
  IF no_hash !~* '^https?://' THEN RETURN ''; END IF;
  after_scheme := regexp_replace(no_hash, '^https?://', '', 'i');
  hostport := split_part(split_part(after_scheme, '/', 1), '?', 1);
  host := regexp_replace(lower(regexp_replace(hostport, ':[0-9]+$', '')), '^www\.', '');
  IF host = '' THEN RETURN ''; END IF;
  rest := substr(after_scheme, length(hostport) + 1);
  path_part := regexp_replace(split_part(rest, '?', 1), '/+$', '');
  IF path_part = '' THEN path_part := '/'; END IF;
  query_part := CASE WHEN position('?' in rest) > 0 THEN substr(rest, position('?' in rest) + 1) ELSE '' END;
  SELECT string_agg(pair, '&' ORDER BY ord) INTO kept
  FROM regexp_split_to_table(query_part, '&') WITH ORDINALITY AS split(pair, ord)
  WHERE pair <> ''
    AND lower(split_part(pair, '=', 1)) !~ '^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|twclid|yclid|wbraid|gbraid|igshid|igsh|mc_cid|mc_eid|vero_id|spm|ref|ref_src|si|feature|t)$';
  RETURN host || path_part || CASE WHEN kept IS NULL OR kept = '' THEN '' ELSE '?' || kept END;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

ALTER TABLE annotated_annotations ADD COLUMN IF NOT EXISTS canonical_url_key text NOT NULL DEFAULT '';

UPDATE annotated_annotations
   SET source_url_key = annotated_url_key(source_url),
       canonical_url_key = coalesce(annotated_url_key(canonical_url), '');

UPDATE annotated_sources SET source_url_key = annotated_url_key(source_url);

CREATE INDEX IF NOT EXISTS annotated_annotations_canonical_key_feed
  ON annotated_annotations (canonical_url_key, created_at DESC)
  WHERE status = 'published' AND visibility = 'public' AND canonical_url_key <> '';

-- The sync trigger is re-created from 006 with one change: annotations now
-- carry canonical_url_key alongside source_url_key.

CREATE OR REPLACE FUNCTION annotated_sync_legacy_record() RETURNS trigger AS $$
DECLARE
  p jsonb := CASE WHEN TG_OP = 'DELETE' THEN OLD.payload ELSE NEW.payload END;
  c text := CASE WHEN TG_OP = 'DELETE' THEN OLD.collection ELSE NEW.collection END;
  rid text := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
  canonical text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    CASE c
      WHEN 'comments' THEN DELETE FROM annotated_comments WHERE id = rid;
      WHEN 'likes' THEN DELETE FROM annotated_likes WHERE annotation_id = p->>'annotationId' AND user_id = p->>'userId';
      WHEN 'follows' THEN DELETE FROM annotated_follows WHERE follower_id = p->>'followerId' AND following_id = p->>'followingId';
      WHEN 'claims' THEN DELETE FROM annotated_claims WHERE id = rid;
      WHEN 'sessions' THEN DELETE FROM annotated_sessions WHERE id = rid;
      WHEN 'extensionTickets' THEN DELETE FROM annotated_extension_tickets WHERE token_hash = coalesce(p->>'tokenHash', rid);
      WHEN 'moderationAudit' THEN DELETE FROM annotated_moderation_audit WHERE id = rid;
      WHEN 'mediaJobs' THEN DELETE FROM annotated_media_jobs WHERE id = rid;
      WHEN 'media' THEN DELETE FROM annotated_media_artifacts WHERE id = rid;
      WHEN 'annotations' THEN DELETE FROM annotated_annotations WHERE id = rid;
      WHEN 'users' THEN DELETE FROM annotated_users WHERE id = rid AND id <> 'local-tom';
      ELSE NULL;
    END CASE;
    RETURN OLD;
  END IF;

  IF c = 'users' THEN
    INSERT INTO annotated_users (id, handle, display_name, email, avatar_url, bio, provider, provider_id, role, is_demo, last_notifications_seen_at, created_at, updated_at)
    VALUES (rid, coalesce(nullif(p->>'handle', ''), rid), coalesce(nullif(p->>'displayName', ''), p->>'handle', rid), nullif(p->>'email', ''), nullif(p->>'avatarUrl', ''), coalesce(p->>'bio', ''), nullif(p->>'provider', ''), nullif(p->>'providerId', ''), coalesce(nullif(p->>'role', ''), 'member'), coalesce((p->>'isDemo')::boolean, false), nullif(p->>'lastNotificationsSeenAt', '')::timestamptz, coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), now())
    ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url, bio = EXCLUDED.bio, provider = EXCLUDED.provider, provider_id = EXCLUDED.provider_id, role = EXCLUDED.role, is_demo = EXCLUDED.is_demo, last_notifications_seen_at = EXCLUDED.last_notifications_seen_at, updated_at = now();
  ELSIF c = 'media' THEN
    INSERT INTO annotated_media_artifacts (id, owner_id, object_key, file_name, mime_type, bytes, kind, duration_seconds, peaks, is_demo, created_at)
    VALUES (rid, nullif(p->>'ownerId', ''), coalesce(nullif(p->>'key', ''), p->>'fileName'), nullif(p->>'fileName', ''), coalesce(nullif(p->>'mimeType', ''), 'application/octet-stream'), coalesce((p->>'bytes')::bigint, 0), nullif(p->>'kind', ''), nullif(p->>'durationSeconds', '')::double precision, CASE WHEN jsonb_typeof(p->'peaks') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p->'peaks')::real) ELSE NULL END, coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now()))
    ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, object_key = EXCLUDED.object_key, file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes, kind = EXCLUDED.kind, duration_seconds = EXCLUDED.duration_seconds, peaks = EXCLUDED.peaks, is_demo = EXCLUDED.is_demo;
  ELSIF c = 'annotations' THEN
    canonical := coalesce(nullif(p->>'canonicalUrl', ''), p->>'sourceUrl');
    INSERT INTO annotated_sources (canonical_url, source_url, source_url_key, host, source_type, title, provider, updated_at)
    VALUES (canonical, p->>'sourceUrl', annotated_url_key(p->>'sourceUrl'), coalesce(p->>'sourceHost', ''), p->>'sourceType', coalesce(p->>'sourceTitle', ''), nullif(p->>'provider', ''), now())
    ON CONFLICT (canonical_url) DO UPDATE SET source_url = EXCLUDED.source_url, source_url_key = EXCLUDED.source_url_key, host = EXCLUDED.host, source_type = EXCLUDED.source_type, title = EXCLUDED.title, provider = EXCLUDED.provider, updated_at = now();
    INSERT INTO annotated_annotations (id, slug, author_id, source_id, source_url, source_url_key, canonical_url, canonical_url_key, source_host, source_type, source_title, source_excerpt, provider, media_url, commentary_mode, commentary, visibility, status, topic, client_request_id, clip_start, clip_end, audio_duration, audio_asset_id, media_asset_id, poster_asset_id, screenshot_asset_id, media_status, media_error, open_count, anchor_paragraph, anchor_prefix, anchor_suffix, is_demo, created_at, edited_at, removed_at, removed_by, removed_reason, updated_at)
    VALUES (rid, p->>'slug', p->>'authorId', canonical, p->>'sourceUrl', annotated_url_key(p->>'sourceUrl'), canonical, coalesce(annotated_url_key(canonical), ''), coalesce(p->>'sourceHost', ''), p->>'sourceType', coalesce(p->>'sourceTitle', ''), coalesce(p->>'sourceExcerpt', ''), nullif(p->>'provider', ''), nullif(p->>'mediaUrl', ''), p->>'commentaryMode', coalesce(p->>'commentary', ''), coalesce(nullif(p->>'visibility', ''), 'public'), coalesce(nullif(p->>'status', ''), 'published'), nullif(p->>'topic', ''), nullif(p->>'clientRequestId', ''), coalesce((p->>'clipStart')::double precision, 0), coalesce((p->>'clipEnd')::double precision, 0), coalesce((p->>'audioDuration')::double precision, 0), nullif(p->>'audioAssetId', ''), nullif(p->>'mediaAssetId', ''), nullif(p->>'posterAssetId', ''), nullif(p->>'screenshotAssetId', ''), coalesce(nullif(p->>'mediaStatus', ''), 'not-applicable'), nullif(p->>'mediaError', ''), coalesce((p->>'openCount')::bigint, 0), nullif(p->>'anchorParagraph', '')::integer, coalesce(p->>'anchorPrefix', ''), coalesce(p->>'anchorSuffix', ''), coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), nullif(p->>'editedAt', '')::timestamptz, nullif(p->>'removedAt', '')::timestamptz, nullif(p->>'removedBy', ''), nullif(p->>'removedReason', ''), now())
    ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, author_id = EXCLUDED.author_id, source_id = EXCLUDED.source_id, source_url = EXCLUDED.source_url, source_url_key = EXCLUDED.source_url_key, canonical_url = EXCLUDED.canonical_url, canonical_url_key = EXCLUDED.canonical_url_key, source_host = EXCLUDED.source_host, source_type = EXCLUDED.source_type, source_title = EXCLUDED.source_title, source_excerpt = EXCLUDED.source_excerpt, provider = EXCLUDED.provider, media_url = EXCLUDED.media_url, commentary_mode = EXCLUDED.commentary_mode, commentary = EXCLUDED.commentary, visibility = EXCLUDED.visibility, status = EXCLUDED.status, topic = EXCLUDED.topic, client_request_id = EXCLUDED.client_request_id, clip_start = EXCLUDED.clip_start, clip_end = EXCLUDED.clip_end, audio_duration = EXCLUDED.audio_duration, audio_asset_id = EXCLUDED.audio_asset_id, media_asset_id = EXCLUDED.media_asset_id, poster_asset_id = EXCLUDED.poster_asset_id, screenshot_asset_id = EXCLUDED.screenshot_asset_id, media_status = EXCLUDED.media_status, media_error = EXCLUDED.media_error, open_count = EXCLUDED.open_count, anchor_paragraph = EXCLUDED.anchor_paragraph, anchor_prefix = EXCLUDED.anchor_prefix, anchor_suffix = EXCLUDED.anchor_suffix, is_demo = EXCLUDED.is_demo, edited_at = EXCLUDED.edited_at, removed_at = EXCLUDED.removed_at, removed_by = EXCLUDED.removed_by, removed_reason = EXCLUDED.removed_reason, updated_at = now();
  ELSIF c = 'comments' THEN
    INSERT INTO annotated_comments (id, annotation_id, author_id, body, created_at) VALUES (rid, p->>'annotationId', p->>'authorId', p->>'body', coalesce(nullif(p->>'createdAt', '')::timestamptz, now())) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body;
  ELSIF c = 'follows' THEN
    INSERT INTO annotated_follows (follower_id, following_id, created_at) VALUES (p->>'followerId', p->>'followingId', coalesce(nullif(p->>'createdAt', '')::timestamptz, now())) ON CONFLICT (follower_id, following_id) DO UPDATE SET created_at = EXCLUDED.created_at;
  ELSIF c = 'likes' THEN
    INSERT INTO annotated_likes (annotation_id, user_id, created_at) VALUES (p->>'annotationId', p->>'userId', coalesce(nullif(p->>'createdAt', '')::timestamptz, now())) ON CONFLICT (annotation_id, user_id) DO UPDATE SET created_at = EXCLUDED.created_at;
  ELSIF c = 'claims' THEN
    INSERT INTO annotated_claims (id, annotation_id, reporter_id, reporter_contact, reason, status, via, moderator_id, resolution_note, is_demo, created_at, updated_at) VALUES (rid, p->>'annotationId', nullif(p->>'reporterId', ''), nullif(p->>'reporterContact', ''), p->>'reason', p->>'status', nullif(p->>'via', ''), nullif(p->>'moderatorId', ''), nullif(p->>'resolutionNote', ''), coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), nullif(p->>'updatedAt', '')::timestamptz) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, moderator_id = EXCLUDED.moderator_id, resolution_note = EXCLUDED.resolution_note, updated_at = EXCLUDED.updated_at;
  ELSIF c = 'sessions' THEN
    INSERT INTO annotated_sessions (id, token_hash, user_id, created_at, expires_at) VALUES (rid, p->>'tokenHash', p->>'userId', coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), (p->>'expiresAt')::timestamptz) ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at;
  ELSIF c = 'extensionTickets' THEN
    INSERT INTO annotated_extension_tickets (token_hash, user_id, return_to, expires_at) VALUES (p->>'tokenHash', p->>'userId', nullif(p->>'returnTo', ''), (p->>'expiresAt')::timestamptz) ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, return_to = EXCLUDED.return_to, expires_at = EXCLUDED.expires_at;
  ELSIF c = 'moderationAudit' THEN
    INSERT INTO annotated_moderation_audit (id, claim_id, actor_id, from_status, to_status, note, action, is_demo, created_at) VALUES (rid, p->>'claimId', nullif(p->>'actorId', ''), nullif(p->>'from', ''), p->>'to', coalesce(p->>'note', ''), nullif(p->>'action', ''), coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now())) ON CONFLICT (id) DO NOTHING;
  ELSIF c = 'mediaJobs' THEN
    INSERT INTO annotated_media_jobs (id, annotation_id, owner_id, source_url, media_url, provider, source_type, clip_start, clip_end, status, attempts, worker_id, trace_id, lease_until, retry_at, started_at, completed_at, error, failure_class, is_demo, created_at, updated_at) VALUES (rid, p->>'annotationId', nullif(p->>'ownerId', ''), p->>'sourceUrl', coalesce(nullif(p->>'mediaUrl', ''), nullif(p->>'sourceMediaUrl', '')), nullif(p->>'provider', ''), p->>'sourceType', coalesce((p->>'clipStart')::double precision, 0), (p->>'clipEnd')::double precision, p->>'status', coalesce((p->>'attempts')::integer, 0), nullif(p->>'workerId', ''), coalesce(nullif(p->>'traceId', ''), rid), nullif(p->>'leaseUntil', '')::timestamptz, nullif(p->>'retryAt', '')::timestamptz, nullif(p->>'startedAt', '')::timestamptz, nullif(p->>'completedAt', '')::timestamptz, nullif(p->>'error', ''), nullif(p->>'failureClass', ''), coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), now()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, worker_id = EXCLUDED.worker_id, lease_until = EXCLUDED.lease_until, retry_at = EXCLUDED.retry_at, started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at, error = EXCLUDED.error, failure_class = EXCLUDED.failure_class, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
