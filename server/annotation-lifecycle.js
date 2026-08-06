// Lifecycle policy for published annotations.
//
// Removal has two deliberately different shapes:
//   - A resolved rights claim takes the annotation DOWN but leaves a public
//     tombstone (410) — the accountability trail stays visible.
//   - An author deletes their own annotation OUTRIGHT — record, media, and
//     permalink are gone (404), as an owner would expect.
//
// Editing is bounded: the note can change for EDIT_WINDOW_MS after publish,
// so replies never end up under a note that changed meaning later.
// Visibility is owner privacy control and may change at any time.

export const EDIT_WINDOW_MS = 30 * 60 * 1000;

export const canEditCommentary = (annotation, now = Date.now()) => {
  const created = Date.parse(annotation?.createdAt || '');
  return Number.isFinite(created) && now - created <= EDIT_WINDOW_MS;
};

export const editWindowRemainingMs = (annotation, now = Date.now()) => {
  const created = Date.parse(annotation?.createdAt || '');
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, EDIT_WINDOW_MS - (now - created));
};

// The takedown action rides on the resolve transition only.
export const validateModerationAction = (status, action) => {
  if (action === undefined || action === null || action === '') return null;
  if (action !== 'remove') return 'Moderation action must be "remove" when provided.';
  if (status !== 'resolved') return 'A takedown can only accompany a resolved claim.';
  return null;
};

export const removalTombstone = (annotation) => ({
  slug: annotation.slug,
  removed: true,
  reason: annotation.removedReason || 'rights-claim',
  removedAt: annotation.removedAt || null,
});

// Collects the media asset ids an annotation holds so removal can delete the
// hosted files, not just the pointers.
export const annotationAssetIds = (annotation) => [
  annotation?.mediaAssetId,
  annotation?.audioAssetId,
  annotation?.screenshotAssetId,
  annotation?.posterAssetId,
].filter(Boolean);
