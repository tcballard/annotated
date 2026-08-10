-- Exact-source evidence, verified publisher workspaces, and privacy-safe
-- activation telemetry. Every public read has an indexed first-class row.

ALTER TABLE annotated_sources ADD COLUMN IF NOT EXISTS source_identity text;
UPDATE annotated_sources SET source_identity='src_'||md5(canonical_url) WHERE source_identity IS NULL;
ALTER TABLE annotated_sources ALTER COLUMN source_identity SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS annotated_sources_identity_idx ON annotated_sources(source_identity);

CREATE OR REPLACE FUNCTION annotated_assign_source_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.source_identity IS NULL OR NEW.source_identity = '' THEN
    NEW.source_identity := 'src_' || md5(NEW.canonical_url);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS annotated_sources_assign_identity ON annotated_sources;
CREATE TRIGGER annotated_sources_assign_identity
BEFORE INSERT OR UPDATE OF canonical_url,source_identity ON annotated_sources
FOR EACH ROW EXECUTE FUNCTION annotated_assign_source_identity();

ALTER TABLE annotated_annotations ADD COLUMN IF NOT EXISTS relation_type text NOT NULL DEFAULT 'response';
ALTER TABLE annotated_annotations DROP CONSTRAINT IF EXISTS annotated_annotations_relation_type_check;
ALTER TABLE annotated_annotations ADD CONSTRAINT annotated_annotations_relation_type_check CHECK (relation_type IN ('response','supports','challenges','adds_context','corrects'));
CREATE INDEX IF NOT EXISTS annotated_annotations_exact_source_idx ON annotated_annotations(source_id,created_at DESC,id DESC) WHERE status='published' AND visibility='public';
CREATE INDEX IF NOT EXISTS annotated_annotations_media_axis_idx ON annotated_annotations(source_id,clip_start,clip_end) WHERE status='published' AND visibility='public' AND source_type<>'article';

ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS probe jsonb;
ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE annotated_media_artifacts ADD COLUMN IF NOT EXISTS rights_state text NOT NULL DEFAULT 'unreviewed';
ALTER TABLE annotated_media_artifacts DROP CONSTRAINT IF EXISTS annotated_media_artifacts_rights_state_check;
ALTER TABLE annotated_media_artifacts ADD CONSTRAINT annotated_media_artifacts_rights_state_check CHECK(rights_state IN ('unreviewed','licensed','fair-use','claimed','removed'));

ALTER TABLE annotated_product_events ADD COLUMN IF NOT EXISTS anonymous_id text;
ALTER TABLE annotated_product_events ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE annotated_product_events ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE annotated_product_events ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS annotated_product_events_idempotency_idx ON annotated_product_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS annotated_product_events_source_idx ON annotated_product_events(source_id,occurred_at DESC) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS annotated_publisher_workspaces (
  id text PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL CHECK(status IN ('verified','revoked')),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL REFERENCES annotated_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotated_publisher_members (
  workspace_id text NOT NULL REFERENCES annotated_publisher_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('owner','editor','analyst')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,user_id)
);

CREATE TABLE IF NOT EXISTS annotated_publisher_verifications (
  id uuid PRIMARY KEY,
  domain text NOT NULL,
  actor_id text NOT NULL REFERENCES annotated_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  method text NOT NULL CHECK(method IN ('dns-txt','html-file','rss-token','channel-token')),
  status text NOT NULL CHECK(status IN ('pending','verified','expired','revoked')),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_publisher_verifications_actor_idx ON annotated_publisher_verifications(actor_id,created_at DESC);

CREATE TABLE IF NOT EXISTS annotated_publisher_replies (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES annotated_publisher_workspaces(id) ON DELETE RESTRICT,
  annotation_id text NOT NULL REFERENCES annotated_annotations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES annotated_users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,annotation_id)
);
CREATE INDEX IF NOT EXISTS annotated_publisher_replies_annotation_idx ON annotated_publisher_replies(annotation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS annotated_publisher_audit (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES annotated_publisher_workspaces(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES annotated_users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotated_publisher_audit_workspace_idx ON annotated_publisher_audit(workspace_id,created_at DESC);
