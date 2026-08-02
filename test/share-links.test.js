import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAnnotationUrl } from '../src/share-links.js';

test('share links preserve server URLs and build a public fallback for feed items', () => {
  assert.equal(publicAnnotationUrl({ url: 'https://annotated.example/a/known' }, 'https://app.example'), 'https://annotated.example/a/known');
  assert.equal(publicAnnotationUrl({ slug: 'a moment / with context' }, 'https://app.example/'), 'https://app.example/a/a%20moment%20%2F%20with%20context');
  assert.equal(publicAnnotationUrl({ slug: 'missing-origin' }), '');
});
