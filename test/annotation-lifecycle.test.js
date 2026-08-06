import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationAssetIds, canEditCommentary, EDIT_WINDOW_MS, editWindowRemainingMs, removalTombstone, validateModerationAction } from '../server/annotation-lifecycle.js';

test('the note edit window is thirty minutes from publish, boundary inclusive', () => {
  const createdAt = new Date('2026-08-05T12:00:00Z').toISOString();
  const annotation = { createdAt };
  const at = (minutes) => Date.parse(createdAt) + minutes * 60 * 1000;
  assert.equal(EDIT_WINDOW_MS, 30 * 60 * 1000);
  assert.equal(canEditCommentary(annotation, at(0)), true);
  assert.equal(canEditCommentary(annotation, at(29)), true);
  assert.equal(canEditCommentary(annotation, at(30)), true);
  assert.equal(canEditCommentary(annotation, at(31)), false);
  assert.equal(canEditCommentary({ createdAt: 'garbage' }, at(0)), false);
  assert.equal(editWindowRemainingMs(annotation, at(20)), 10 * 60 * 1000);
  assert.equal(editWindowRemainingMs(annotation, at(45)), 0);
});

test('a takedown only rides on the resolve transition', () => {
  assert.equal(validateModerationAction('resolved', 'remove'), null);
  assert.equal(validateModerationAction('resolved', undefined), null);
  assert.equal(validateModerationAction('resolved', ''), null);
  assert.match(validateModerationAction('in_review', 'remove'), /resolved claim/);
  assert.match(validateModerationAction('resolved', 'nuke'), /must be "remove"/);
});

test('tombstones expose the removal, never the content', () => {
  const tombstone = removalTombstone({ slug: 'gone-abc123', removedReason: 'rights-claim', removedAt: '2026-08-05T12:00:00Z', commentary: 'secret', sourceUrl: 'https://example.com' });
  assert.deepEqual(tombstone, { slug: 'gone-abc123', removed: true, reason: 'rights-claim', removedAt: '2026-08-05T12:00:00Z' });
});

test('removal collects every hosted asset the annotation holds', () => {
  assert.deepEqual(annotationAssetIds({ mediaAssetId: 'clip-1', audioAssetId: 'audio-1', screenshotAssetId: 'shot-1', posterAssetId: 'poster-1' }), ['clip-1', 'audio-1', 'shot-1', 'poster-1']);
  assert.deepEqual(annotationAssetIds({ mediaAssetId: null }), []);
});
