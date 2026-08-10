-- Gate 2: first-class, query-native product tables.
--
-- annotated_records remains temporarily as the rollback journal while the
-- application dual-writes and compares. Product reads and worker claiming
-- cut over to these tables; JSONB is retained only for flexible event/media
-- evidence, not as the product's primary data model.

CREATE OR REPLACE FUNCTION annotated_url_key(value text) RETURNS text AS $$
  SELECT CASE
    WHEN value IS NULL OR value = '' THEN ''
    WHEN position('/' in regexp_replace(split_part(value, '#', 1), '^https?://(www\.)?', '', 'i')) = 0
      THEN lower(regexp_replace(split_part(value, '#', 1), '^https?://(www\.)?', '', 'i')) || '/'
    ELSE regexp_replace(lower(regexp_replace(split_part(value, '#', 1), '^https?://(www\.)?', '', 'i')), '/+([?]|$)', '\1')
  END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE TABLE IF NOT EXISTS annotated_users (
  id text PRIMARY KEY,
  handle text NOT NULL,
  display_name text NOT NULL,
  email text,
  avatar_url text,
  bio text NOT NULL DEFAULT '',
  provider text,
  provider_id text,
  role text NOT NULL DEFAULT 'member',
  is_demo boolean NOT NULL DEFAULT false,
  last_notifications_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS annotated_users_handle_ci_idx ON annotated_users (lower(handle));

CREATE TABLE IF NOT EXISTS annotated_sources (
  canonical_url text PRIMARY KEY,
  source_url text NOT NULL,
  source_url_key text NOT NULL,
  host text NOT NULL DEFAULT '',
  source_type text NOT NULL CHECK (source_type IN ('article', 'video', 'podcast')),
  title text NOT NULL DEFAULT '',
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_sources_host_idx ON annotated_sources (host);

CREATE TABLE IF NOT EXISTS annotated_media_artifacts (
  id text PRIMARY KEY,
  owner_id text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  object_key text NOT NULL UNIQUE,
  file_name text,
  mime_type text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  kind text,
  duration_seconds double precision,
  peaks real[],
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotated_annotations (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  author_id text NOT NULL REFERENCES annotated_users(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  source_id text NOT NULL REFERENCES annotated_sources(canonical_url) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  source_url text NOT NULL,
  source_url_key text NOT NULL,
  canonical_url text NOT NULL,
  source_host text NOT NULL DEFAULT '',
  source_type text NOT NULL CHECK (source_type IN ('article', 'video', 'podcast')),
  source_title text NOT NULL DEFAULT '',
  source_excerpt text NOT NULL DEFAULT '',
  provider text,
  media_url text,
  commentary_mode text NOT NULL CHECK (commentary_mode IN ('text', 'audio')),
  commentary text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed')),
  topic text,
  client_request_id text,
  clip_start double precision NOT NULL DEFAULT 0 CHECK (clip_start >= 0),
  clip_end double precision NOT NULL DEFAULT 0 CHECK (clip_end >= clip_start AND clip_end - clip_start <= 90.05),
  audio_duration double precision NOT NULL DEFAULT 0 CHECK (audio_duration >= 0 AND audio_duration <= 90.05),
  audio_asset_id text REFERENCES annotated_media_artifacts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  media_asset_id text REFERENCES annotated_media_artifacts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  poster_asset_id text REFERENCES annotated_media_artifacts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  screenshot_asset_id text REFERENCES annotated_media_artifacts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  media_status text NOT NULL DEFAULT 'not-applicable',
  media_error text,
  open_count bigint NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  anchor_paragraph integer,
  anchor_prefix text NOT NULL DEFAULT '',
  anchor_suffix text NOT NULL DEFAULT '',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  removed_at timestamptz,
  removed_by text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  removed_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(source_title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(source_excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(commentary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(source_host, '')), 'C')
  ) STORED,
  UNIQUE (author_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS annotated_annotations_recent_idx
  ON annotated_annotations (created_at DESC, id DESC) WHERE status = 'published' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS annotated_annotations_author_recent_idx
  ON annotated_annotations (author_id, created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS annotated_annotations_source_recent_idx
  ON annotated_annotations (source_host, created_at DESC, id DESC) WHERE status = 'published' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS annotated_annotations_canonical_idx
  ON annotated_annotations (canonical_url, created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS annotated_annotations_url_key_idx
  ON annotated_annotations (source_url_key, created_at DESC) WHERE status = 'published' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS annotated_annotations_search_idx ON annotated_annotations USING gin (search_document);

CREATE TABLE IF NOT EXISTS annotated_comments (
  id text PRIMARY KEY,
  annotation_id text NOT NULL REFERENCES annotated_annotations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  author_id text NOT NULL REFERENCES annotated_users(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_comments_annotation_idx ON annotated_comments (annotation_id, created_at, id);
CREATE INDEX IF NOT EXISTS annotated_comments_author_idx ON annotated_comments (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS annotated_follows (
  follower_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  following_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS annotated_follows_following_idx ON annotated_follows (following_id, created_at DESC);

CREATE TABLE IF NOT EXISTS annotated_likes (
  annotation_id text NOT NULL REFERENCES annotated_annotations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (annotation_id, user_id)
);
CREATE INDEX IF NOT EXISTS annotated_likes_user_idx ON annotated_likes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS annotated_claims (
  id text PRIMARY KEY,
  annotation_id text REFERENCES annotated_annotations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  reporter_id text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  reporter_contact text,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
  via text,
  moderator_id text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  resolution_note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS annotated_claims_reporter_idx ON annotated_claims (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS annotated_claims_queue_idx ON annotated_claims (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS annotated_claims_active_user_idx
  ON annotated_claims (annotation_id, reporter_id) WHERE reporter_id IS NOT NULL AND status IN ('open', 'in_review');
CREATE UNIQUE INDEX IF NOT EXISTS annotated_claims_active_contact_idx
  ON annotated_claims (annotation_id, lower(reporter_contact)) WHERE reporter_contact IS NOT NULL AND status IN ('open', 'in_review');

CREATE TABLE IF NOT EXISTS annotated_sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS annotated_sessions_expiry_idx ON annotated_sessions (expires_at);

CREATE TABLE IF NOT EXISTS annotated_extension_tickets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  return_to text,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS annotated_extension_tickets_expiry_idx ON annotated_extension_tickets (expires_at);

CREATE TABLE IF NOT EXISTS annotated_moderation_audit (
  id text PRIMARY KEY,
  claim_id text NOT NULL REFERENCES annotated_claims(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  actor_id text,
  from_status text,
  to_status text NOT NULL,
  note text NOT NULL DEFAULT '',
  action text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_moderation_audit_claim_idx ON annotated_moderation_audit (claim_id, created_at);

CREATE TABLE IF NOT EXISTS annotated_media_jobs (
  id text PRIMARY KEY,
  annotation_id text NOT NULL REFERENCES annotated_annotations(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  owner_id text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  source_url text NOT NULL,
  media_url text,
  provider text,
  source_type text NOT NULL CHECK (source_type IN ('video', 'podcast')),
  clip_start double precision NOT NULL CHECK (clip_start >= 0),
  clip_end double precision NOT NULL CHECK (clip_end > clip_start AND clip_end - clip_start <= 90.05),
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'cancelled', 'superseded', 'dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  worker_id text,
  trace_id text NOT NULL,
  lease_until timestamptz,
  retry_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  failure_class text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_media_jobs_claim_idx
  ON annotated_media_jobs (coalesce(retry_at, created_at), created_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS annotated_media_jobs_lease_idx
  ON annotated_media_jobs (lease_until, created_at, id) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS annotated_media_jobs_annotation_idx ON annotated_media_jobs (annotation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS annotated_media_jobs_provider_idx ON annotated_media_jobs (provider, status, created_at);

CREATE TABLE IF NOT EXISTS annotated_product_events (
  id text PRIMARY KEY,
  event_name text NOT NULL,
  actor_id text REFERENCES annotated_users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  annotation_id text REFERENCES annotated_annotations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  trace_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (jsonb_typeof(evidence_metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS annotated_product_events_name_time_idx ON annotated_product_events (event_name, occurred_at DESC);

-- Pre-seed every referenced principal so deferred foreign keys can reconcile
-- imperfect legacy/demo rows without inventing cross-user relationships.
INSERT INTO annotated_users (id, handle, display_name, role)
VALUES ('local-tom', 'tcballard', 'Tom Ballard', 'owner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO annotated_users (id, handle, display_name)
SELECT principal, 'legacy-' || substring(md5(principal), 1, 20), principal
FROM (
  SELECT payload->>'authorId' principal FROM annotated_records WHERE collection IN ('annotations', 'comments')
  UNION SELECT payload->>'userId' FROM annotated_records WHERE collection IN ('likes', 'sessions')
  UNION SELECT payload->>'followerId' FROM annotated_records WHERE collection = 'follows'
  UNION SELECT payload->>'followingId' FROM annotated_records WHERE collection = 'follows'
  UNION SELECT payload->>'reporterId' FROM annotated_records WHERE collection = 'claims'
  UNION SELECT payload->>'moderatorId' FROM annotated_records WHERE collection = 'claims'
  UNION SELECT payload->>'ownerId' FROM annotated_records WHERE collection IN ('media', 'mediaJobs')
) principals
WHERE principal IS NOT NULL AND principal <> ''
ON CONFLICT (id) DO NOTHING;

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
    INSERT INTO annotated_annotations (id, slug, author_id, source_id, source_url, source_url_key, canonical_url, source_host, source_type, source_title, source_excerpt, provider, media_url, commentary_mode, commentary, visibility, status, topic, client_request_id, clip_start, clip_end, audio_duration, audio_asset_id, media_asset_id, poster_asset_id, screenshot_asset_id, media_status, media_error, open_count, anchor_paragraph, anchor_prefix, anchor_suffix, is_demo, created_at, edited_at, removed_at, removed_by, removed_reason, updated_at)
    VALUES (rid, p->>'slug', p->>'authorId', canonical, p->>'sourceUrl', annotated_url_key(p->>'sourceUrl'), canonical, coalesce(p->>'sourceHost', ''), p->>'sourceType', coalesce(p->>'sourceTitle', ''), coalesce(p->>'sourceExcerpt', ''), nullif(p->>'provider', ''), nullif(p->>'mediaUrl', ''), p->>'commentaryMode', coalesce(p->>'commentary', ''), coalesce(nullif(p->>'visibility', ''), 'public'), coalesce(nullif(p->>'status', ''), 'published'), nullif(p->>'topic', ''), nullif(p->>'clientRequestId', ''), coalesce((p->>'clipStart')::double precision, 0), coalesce((p->>'clipEnd')::double precision, 0), coalesce((p->>'audioDuration')::double precision, 0), nullif(p->>'audioAssetId', ''), nullif(p->>'mediaAssetId', ''), nullif(p->>'posterAssetId', ''), nullif(p->>'screenshotAssetId', ''), coalesce(nullif(p->>'mediaStatus', ''), 'not-applicable'), nullif(p->>'mediaError', ''), coalesce((p->>'openCount')::bigint, 0), nullif(p->>'anchorParagraph', '')::integer, coalesce(p->>'anchorPrefix', ''), coalesce(p->>'anchorSuffix', ''), coalesce((p->>'isDemo')::boolean, false), coalesce(nullif(p->>'createdAt', '')::timestamptz, now()), nullif(p->>'editedAt', '')::timestamptz, nullif(p->>'removedAt', '')::timestamptz, nullif(p->>'removedBy', ''), nullif(p->>'removedReason', ''), now())
    ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, author_id = EXCLUDED.author_id, source_id = EXCLUDED.source_id, source_url = EXCLUDED.source_url, source_url_key = EXCLUDED.source_url_key, canonical_url = EXCLUDED.canonical_url, source_host = EXCLUDED.source_host, source_type = EXCLUDED.source_type, source_title = EXCLUDED.source_title, source_excerpt = EXCLUDED.source_excerpt, provider = EXCLUDED.provider, media_url = EXCLUDED.media_url, commentary_mode = EXCLUDED.commentary_mode, commentary = EXCLUDED.commentary, visibility = EXCLUDED.visibility, status = EXCLUDED.status, topic = EXCLUDED.topic, client_request_id = EXCLUDED.client_request_id, clip_start = EXCLUDED.clip_start, clip_end = EXCLUDED.clip_end, audio_duration = EXCLUDED.audio_duration, audio_asset_id = EXCLUDED.audio_asset_id, media_asset_id = EXCLUDED.media_asset_id, poster_asset_id = EXCLUDED.poster_asset_id, screenshot_asset_id = EXCLUDED.screenshot_asset_id, media_status = EXCLUDED.media_status, media_error = EXCLUDED.media_error, open_count = EXCLUDED.open_count, anchor_paragraph = EXCLUDED.anchor_paragraph, anchor_prefix = EXCLUDED.anchor_prefix, anchor_suffix = EXCLUDED.anchor_suffix, is_demo = EXCLUDED.is_demo, edited_at = EXCLUDED.edited_at, removed_at = EXCLUDED.removed_at, removed_by = EXCLUDED.removed_by, removed_reason = EXCLUDED.removed_reason, updated_at = now();
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

DROP TRIGGER IF EXISTS annotated_records_relational_sync ON annotated_records;
CREATE TRIGGER annotated_records_relational_sync
AFTER INSERT OR UPDATE OR DELETE ON annotated_records
FOR EACH ROW EXECUTE FUNCTION annotated_sync_legacy_record();

-- Backfill by replaying the canonical EAV journal through the same projection
-- used during the dual-write window. This keeps migration and live-write
-- semantics identical and makes rollback comparison deterministic.
UPDATE annotated_records SET updated_at = updated_at;
