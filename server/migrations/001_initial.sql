CREATE TABLE IF NOT EXISTS annotated_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annotated_state_gin_idx
  ON annotated_state USING gin (state);
