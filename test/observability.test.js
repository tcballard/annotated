import assert from 'node:assert/strict';
import test from 'node:test';
import { metricsSnapshot, recordRequest, resetMetrics } from '../server/observability.js';

test('request telemetry is bounded and summarizes status and route timing', () => {
  resetMetrics();
  recordRequest({ method: 'GET', path: '/api/health', status: 200, durationMs: 4.4 });
  recordRequest({ method: 'POST', path: '/api/annotations', status: 503, durationMs: 9.8 });
  const snapshot = metricsSnapshot();
  assert.equal(snapshot.requests, 2);
  assert.equal(snapshot.errors, 1);
  assert.deepEqual(snapshot.statuses, { '200': 1, '503': 1 });
  assert.deepEqual(snapshot.routes['GET /api/health'], { count: 1, averageMs: 4, maxMs: 4 });
  assert.deepEqual(snapshot.routes['POST /api/annotations'], { count: 1, averageMs: 10, maxMs: 10 });
});
