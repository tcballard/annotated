CREATE TABLE IF NOT EXISTS annotated_records (
  collection text NOT NULL CHECK (collection IN (
    'annotations', 'comments', 'claims', 'follows', 'likes', 'media',
    'mediaJobs', 'sessions', 'extensionTickets', 'moderationAudit', 'users'
  )),
  record_id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, record_id)
);

CREATE INDEX IF NOT EXISTS annotated_records_collection_idx
  ON annotated_records (collection);

CREATE INDEX IF NOT EXISTS annotated_records_payload_gin_idx
  ON annotated_records USING gin (payload);
