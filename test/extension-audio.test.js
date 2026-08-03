import assert from 'node:assert/strict';
import test from 'node:test';
import { clampAudioDuration, MAX_AUDIO_SECONDS, preferredAudioMimeType } from '../extension/audio.js';

test('extension audio helpers enforce the 90-second boundary', () => {
  assert.equal(MAX_AUDIO_SECONDS, 90);
  assert.equal(clampAudioDuration(0), 1);
  assert.equal(clampAudioDuration(12.4), 12);
  assert.equal(clampAudioDuration(120), 90);
});

test('extension audio helper selects a supported recorder mime type', () => {
  const recorder = { isTypeSupported: (mimeType) => mimeType === 'audio/webm' };
  assert.equal(preferredAudioMimeType(recorder), 'audio/webm');
  assert.equal(preferredAudioMimeType({ isTypeSupported: () => false }), '');
});
