CREATE TABLE IF NOT EXISTS annotated_rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS annotated_rate_limit_buckets_expiry_idx
  ON annotated_rate_limit_buckets (expires_at);
