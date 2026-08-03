import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  moveClipBoundary,
  normalizeClipRange,
} from '../src/clip-range.js';
import * as extensionRange from '../extension/clip-range.js';

test('normalizes an out-of-order range without exceeding the 90-second limit', () => {
  assert.deepEqual(normalizeClipRange(80, 12), { start: 12, end: 80 });
  assert.deepEqual(normalizeClipRange(-10, 140), { start: 0, end: MAX_CLIP_SECONDS });
});

test('keeps a minimum selectable duration', () => {
  assert.deepEqual(normalizeClipRange(40, 40), { start: 40, end: 40 + MIN_CLIP_SECONDS });
  assert.deepEqual(normalizeClipRange(90, 90), { start: 90 - MIN_CLIP_SECONDS, end: 90 });
});

test('moving start through end clamps the active boundary instead of swapping handles', () => {
  assert.deepEqual(moveClipBoundary(14, 62, 'start', 80), { start: 61, end: 62 });
  assert.deepEqual(moveClipBoundary(14, 62, 'end', 2), { start: 14, end: 15 });
});

test('extension and web range guards share the same crossing behavior', () => {
  assert.deepEqual(extensionRange.moveClipBoundary(14, 62, 'start', 80), { start: 61, end: 62 });
  assert.deepEqual(extensionRange.moveClipBoundary(14, 62, 'end', 2), { start: 14, end: 15 });
  assert.deepEqual(extensionRange.normalizeClipRange(0, 0, { allowEmpty: true }), { start: 0, end: 0 });
});
