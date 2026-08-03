import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnnotation } from '../server/validation.js';
import { canUseAudioAsset } from '../server/media-access.js';

const mediaAnnotation = (overrides = {}) => ({
  sourceUrl: 'https://www.youtube.com/watch?v=example',
  sourceType: 'video',
  sourceTitle: 'Example video',
  commentaryMode: 'text',
  commentary: 'A useful moment.',
  clipStart: 10,
  clipEnd: 100,
  ...overrides,
});

test('accepts an exact 90-second media clip', () => {
  const result = validateAnnotation(mediaAnnotation());
  assert.deepEqual(result.errors, []);
  assert.equal(result.normalized.clipEnd - result.normalized.clipStart, 90);
});

test('rejects media clips longer than 90 seconds', () => {
  const result = validateAnnotation(mediaAnnotation({ clipEnd: 100.001 }));
  assert.ok(result.errors.includes('Media clips must be 90 seconds or shorter.'));
});

test('rejects private and non-http source URLs', () => {
  assert.ok(validateAnnotation(mediaAnnotation({ sourceUrl: 'http://127.0.0.1/private' })).errors.length);
  assert.ok(validateAnnotation(mediaAnnotation({ sourceUrl: 'file:///tmp/video.mp4' })).errors.length);
});

test('requires a server-owned audio asset for audio commentary', () => {
  const result = validateAnnotation(mediaAnnotation({ commentaryMode: 'audio', commentary: '' }));
  assert.ok(result.errors.includes('An uploaded audio asset is required.'));
});

test('audio assets can only be attached by their owner', () => {
  const media = { id: 'audio-1', mimeType: 'audio/webm', ownerId: 'user-1' };
  assert.equal(canUseAudioAsset(media, { id: 'user-1' }), true);
  assert.equal(canUseAudioAsset(media, { id: 'user-2' }), false);
  assert.equal(canUseAudioAsset({ ...media, mimeType: 'video/mp4' }, { id: 'user-1' }), false);
});

test('client request IDs are bounded and normalized for idempotent publishing', () => {
  assert.deepEqual(validateAnnotation(mediaAnnotation({ clientRequestId: 'capture-1' })).errors, []);
  assert.ok(validateAnnotation(mediaAnnotation({ clientRequestId: 'bad request' })).errors.includes('clientRequestId must be a bounded request ID.'));
  assert.ok(validateAnnotation(mediaAnnotation({ clientRequestId: 'x'.repeat(81) })).errors.includes('clientRequestId must be a bounded request ID.'));
});
