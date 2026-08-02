import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaPresentation } from '../src/media-presentation.js';

test('published video and podcast clips select native playback controls', () => {
  assert.deepEqual(mediaPresentation({ type: 'Video', clipUrl: 'https://cdn.example/clip.mp4', mediaStatus: 'ready' }), {
    kind: 'video', src: 'https://cdn.example/clip.mp4', status: 'ready',
  });
  assert.deepEqual(mediaPresentation({ type: 'Podcast', clipUrl: '/media/clip-id', mediaStatus: 'ready' }), {
    kind: 'audio', src: '/media/clip-id', status: 'ready',
  });
});

test('audio commentary remains playable when a clip is not available', () => {
  assert.deepEqual(mediaPresentation({ type: 'Article', audioUrl: 'https://api.example/media/audio-id' }), {
    kind: 'audio', src: 'https://api.example/media/audio-id', status: 'commentary',
  });
});

test('unready or unsafe media stays an explicit non-playable state', () => {
  assert.deepEqual(mediaPresentation({ type: 'Video', clipUrl: 'javascript:alert(1)', mediaStatus: 'processing' }), {
    kind: 'video', src: '', status: 'processing',
  });
  assert.deepEqual(mediaPresentation({ type: 'Podcast', mediaStatus: 'failed' }), {
    kind: 'audio', src: '', status: 'failed',
  });
});
