-- Gate 1: the write path goes row-native. These indexes back single-row
-- like/follow toggles and the open counter, and pre-cut the feed's future
-- SQL port (Gate 1b). The partial UNIQUE indexes are load-bearing: they are
-- what makes concurrent like/follow toggles race-safe (INSERT ... ON
-- CONFLICT DO NOTHING) without the global advisory lock.
CREATE UNIQUE INDEX IF NOT EXISTS annotated_likes_identity_idx
  ON annotated_records ((payload->>'annotationId'), (payload->>'userId'))
  WHERE collection = 'likes';
CREATE UNIQUE INDEX IF NOT EXISTS annotated_follows_identity_idx
  ON annotated_records ((payload->>'followerId'), (payload->>'followingId'))
  WHERE collection = 'follows';
CREATE INDEX IF NOT EXISTS annotated_annotations_created_idx
  ON annotated_records ((payload->>'createdAt') DESC)
  WHERE collection = 'annotations';
CREATE INDEX IF NOT EXISTS annotated_annotations_slug_idx
  ON annotated_records ((payload->>'slug'))
  WHERE collection = 'annotations';
