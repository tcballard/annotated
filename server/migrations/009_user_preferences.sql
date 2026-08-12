-- Preferences follow the account, so they live on the account: one JSON
-- record per user, defaulted empty and parsed by the shared validator on
-- the way out (packages/core/src/preferences.ts). No column per choice —
-- the shape belongs to the product, not to the schema, and every reader
-- of this column already validates it.

ALTER TABLE annotated_users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
