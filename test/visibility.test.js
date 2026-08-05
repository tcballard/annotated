import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsIndexing, canViewAnnotation, effectiveVisibility, isPubliclyListed, normalizeVisibility, VISIBILITIES } from '../server/visibility.js';
import { validateAnnotation } from '../server/validation.js';

const annotation = (visibility, authorId = 'author-1') => ({ visibility, authorId, status: 'published' });

test('visibility defaults to public, including for annotations that predate the field', () => {
  assert.deepEqual(VISIBILITIES, ['public', 'unlisted', 'private']);
  assert.equal(effectiveVisibility({}), 'public');
  assert.equal(effectiveVisibility({ visibility: 'nonsense' }), 'public');
  assert.equal(normalizeVisibility('unlisted'), 'unlisted');
  assert.equal(normalizeVisibility('secret'), null);
});

test('public and unlisted are viewable by link-holders; private is author-only', () => {
  assert.equal(canViewAnnotation(annotation('public'), ''), true);
  assert.equal(canViewAnnotation(annotation('unlisted'), ''), true);
  assert.equal(canViewAnnotation(annotation('unlisted'), 'someone-else'), true);
  assert.equal(canViewAnnotation(annotation('private'), ''), false);
  assert.equal(canViewAnnotation(annotation('private'), 'someone-else'), false);
  assert.equal(canViewAnnotation(annotation('private'), 'author-1'), true);
  assert.equal(canViewAnnotation(null, 'author-1'), false);
});

test('only public annotations are listed in feeds or indexed by crawlers', () => {
  assert.equal(isPubliclyListed(annotation('public')), true);
  assert.equal(isPubliclyListed(annotation('unlisted')), false);
  assert.equal(isPubliclyListed(annotation('private')), false);
  assert.equal(allowsIndexing(annotation('public')), true);
  assert.equal(allowsIndexing(annotation('unlisted')), false);
  assert.equal(allowsIndexing(annotation('private')), false);
});

test('the annotation payload validates and normalizes visibility', () => {
  const base = { sourceUrl: 'https://example.com/a', sourceType: 'article', sourceTitle: 'T', sourceExcerpt: 'passage', commentaryMode: 'text', commentary: 'note' };
  assert.equal(validateAnnotation({ ...base }).normalized.visibility, 'public');
  assert.equal(validateAnnotation({ ...base, visibility: 'private' }).normalized.visibility, 'private');
  assert.ok(validateAnnotation({ ...base, visibility: 'secret' }).errors.some((error) => /visibility/.test(error)));
});

test('screenshot asset IDs are bounded and optional', () => {
  const base = { sourceUrl: 'https://example.com/a', sourceType: 'article', sourceTitle: 'T', sourceExcerpt: 'passage', commentaryMode: 'text', commentary: 'note' };
  assert.equal(validateAnnotation({ ...base }).errors.length, 0);
  assert.equal(validateAnnotation({ ...base, screenshotAssetId: 'asset-1' }).errors.length, 0);
  assert.ok(validateAnnotation({ ...base, screenshotAssetId: 'x'.repeat(90) }).errors.some((error) => /screenshotAssetId/.test(error)));
});
