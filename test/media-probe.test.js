import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAudioDurationPolicy, audioDurationWithinPolicy, parseProbedDuration } from '../server/media-probe.js';

const probeOf = (duration) => async () => JSON.stringify({ format: { duration: String(duration) } });

test('over-length audio commentary is rejected at the API boundary in strict mode', async () => {
  await assert.rejects(
    () => assertAudioDurationPolicy('/tmp/x', { runCommand: probeOf(95.2), strict: true }),
    (error) => error.statusCode === 422 && /90 seconds or shorter/.test(error.message),
  );
});

test('the 90-second cap applies even in development when the probe succeeds', async () => {
  await assert.rejects(
    () => assertAudioDurationPolicy('/tmp/x', { runCommand: probeOf(120), strict: false }),
    (error) => error.statusCode === 422,
  );
});

test('in-policy audio returns its probed duration', async () => {
  assert.equal(await assertAudioDurationPolicy('/tmp/x', { runCommand: probeOf(89.4), strict: true }), 89.4);
});

test('production fails closed on uninspectable audio; development degrades to null', async () => {
  const failing = async () => { throw new Error('probe failed'); };
  await assert.rejects(
    () => assertAudioDurationPolicy('/tmp/x', { runCommand: failing, strict: true }),
    (error) => error.statusCode === 422,
  );
  assert.equal(await assertAudioDurationPolicy('/tmp/x', { runCommand: failing, strict: false }), null);
  await assert.rejects(
    () => assertAudioDurationPolicy('/tmp/x', { runCommand: async () => 'not json', strict: true }),
    (error) => error.statusCode === 422,
  );
  assert.equal(await assertAudioDurationPolicy('/tmp/x', { runCommand: async () => 'not json', strict: false }), null);
});

test('policy tolerance covers recorder rounding but not real overruns', () => {
  assert.equal(audioDurationWithinPolicy(90.4), true);
  assert.equal(audioDurationWithinPolicy(90.6), false);
  assert.equal(audioDurationWithinPolicy(null), true);
  assert.equal(parseProbedDuration('{"format":{"duration":"12.5"}}'), 12.5);
  assert.equal(parseProbedDuration('garbage'), null);
});
