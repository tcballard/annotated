import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductionEvidenceJunit,
  cleanupProductionEvidenceFixtures,
  parseProductionEvidenceArguments,
  productionEvidenceApiEnvironment,
  productionEvidenceWorkerEnvironment,
  recordUnhandledProductionEvidenceFailure,
  summarizeMediaProbe,
  validateProductionEvidenceEnvironment,
} from '../scripts/run-production-evidence.mjs';

const productionEnvironment = {
  NODE_ENV: 'production',
  ANNOTATED_STORAGE: 'postgres',
  ANNOTATED_ASSET_STORAGE: 's3',
  DATABASE_URL: 'postgresql://example.invalid/annotated',
  S3_BUCKET: 'annotated-evidence',
  S3_REGION: 'us-east-1',
  S3_ENDPOINT: 'https://s3.example.invalid',
  S3_ACCESS_KEY_ID: 'test-access',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  RELEASE_ENVIRONMENT: 'staging',
};

test('production evidence environment refuses every non-production fallback', () => {
  assert.deepEqual(validateProductionEvidenceEnvironment(productionEnvironment), { releaseEnvironment: 'staging' });
  for (const [name, replacement] of [
    ['NODE_ENV', 'test'],
    ['ANNOTATED_STORAGE', 'file'],
    ['ANNOTATED_ASSET_STORAGE', 'local'],
    ['DATABASE_URL', ''],
    ['S3_BUCKET', ''],
    ['S3_REGION', ''],
    ['S3_ENDPOINT', ''],
    ['S3_ACCESS_KEY_ID', ''],
    ['S3_SECRET_ACCESS_KEY', ''],
    ['RELEASE_ENVIRONMENT', 'ci'],
  ]) {
    assert.throws(
      () => validateProductionEvidenceEnvironment({ ...productionEnvironment, [name]: replacement }),
      /Production evidence is fail-closed/u,
      `${name} was allowed to fall back`,
    );
  }
});

test('production evidence arguments have one explicit artifact-directory override', () => {
  assert.deepEqual(parseProductionEvidenceArguments([]), { outputDirectory: 'artifacts/production', help: false });
  assert.deepEqual(parseProductionEvidenceArguments(['--output-dir', 'tmp/proof']), { outputDirectory: 'tmp/proof', help: false });
  assert.throws(() => parseProductionEvidenceArguments(['--output-dir', '']), /must not be empty/u);
  assert.throws(() => parseProductionEvidenceArguments(['--pretend-passed']), /Unknown argument/u);
});

test('JUnit evidence records failures, escapes text, and never emits skips', () => {
  const xml = buildProductionEvidenceJunit([
    { name: 'PostgreSQL & S3', status: 'passed', durationMs: 12 },
    { name: 'worker <claim>', status: 'failed', durationMs: 34, error: 'not "ready"' },
  ], { durationMs: 46 });
  assert.match(xml, /tests="2" failures="1" errors="0" skipped="0"/u);
  assert.match(xml, /PostgreSQL &amp; S3/u);
  assert.match(xml, /worker &lt;claim&gt;/u);
  assert.match(xml, /not &quot;ready&quot;/u);
  assert.doesNotMatch(xml, /<skipped/u);
});

test('an exception outside a named production check still creates a failed JUnit testcase', () => {
  const cases = [{ name: 'environment', status: 'passed', durationMs: 4 }];
  const failures = [];
  recordUnhandledProductionEvidenceFailure({
    cases,
    failures,
    error: new Error('fixture insert failed for postgresql://secret.example/annotated'),
    durationMs: 12,
    environment: { DATABASE_URL: 'postgresql://secret.example/annotated' },
  });
  assert.equal(cases.at(-1).status, 'failed');
  assert.equal(failures.length, 1);
  assert.doesNotMatch(cases.at(-1).error, /secret\.example/u);
  const xml = buildProductionEvidenceJunit(cases, { durationMs: 16 });
  assert.match(xml, /tests="2" failures="1" errors="0" skipped="0"/u);
  assert.match(xml, /name="production evidence runner"/u);
});

test('the authoritative evidence worker is forced to one attempt', () => {
  const environment = productionEvidenceWorkerEnvironment({ MEDIA_WORKER_MAX_ATTEMPTS: '9' }, 'evidence-worker');
  assert.equal(environment.MEDIA_WORKER_ID, 'evidence-worker');
  assert.equal(environment.ANNOTATED_PROCESS_ROLE, 'media-worker');
  assert.equal(environment.MEDIA_WORKER_CONCURRENCY, '2');
  assert.equal(environment.MEDIA_WORKER_MAX_ATTEMPTS, '1');
  assert.equal(environment.S3_MAX_ATTEMPTS, '1');
});

test('the authoritative evidence API is production-shaped and cannot run media jobs', () => {
  const extensionId = 'omlikcdpcdhfmdojdalfdeihgjmgikkg';
  const environment = productionEvidenceApiEnvironment(productionEnvironment, { port: 9876, extensionId });
  assert.equal(environment.NODE_ENV, 'production');
  assert.equal(environment.ANNOTATED_PROCESS_ROLE, 'api');
  assert.equal(environment.MEDIA_WORKER_CONCURRENCY, '0');
  assert.equal(environment.MEDIA_WORKER_MAX_ATTEMPTS, '1');
  assert.equal(environment.S3_MAX_ATTEMPTS, '1');
  assert.equal(environment.PUBLIC_ORIGIN, 'http://127.0.0.1:9876');
  assert.equal(environment.APP_ORIGIN, environment.PUBLIC_ORIGIN);
  assert.equal(environment.CORS_ORIGINS, environment.PUBLIC_ORIGIN);
  assert.equal(environment.CHROME_EXTENSION_IDS, extensionId);
  assert.equal(environment.OAUTH_PROVIDERS, 'google,x');
  assert.match(environment.GOOGLE_CLIENT_ID, /production-evidence/u);
  assert.match(environment.X_CLIENT_ID, /production-evidence/u);
});

test('media probe summary is derived from real stream metadata constraints', () => {
  assert.deepEqual(summarizeMediaProbe('video', {
    format: { duration: '5.001' },
    streams: [{ codec_type: 'video', height: 240 }, { codec_type: 'audio' }],
  }), { durationSeconds: 5.001, hasAudio: true, videoHeight: 240 });
  assert.deepEqual(summarizeMediaProbe('podcast', {
    format: { duration: '4.5' },
    streams: [{ codec_type: 'audio' }],
  }), { durationSeconds: 4.5, hasAudio: true, videoHeight: null });
  assert.throws(() => summarizeMediaProbe('video', { format: { duration: 5 }, streams: [{ codec_type: 'video', height: 241 }, { codec_type: 'audio' }] }), /no taller than 240/u);
  assert.throws(() => summarizeMediaProbe('podcast', { format: { duration: 5 }, streams: [{ codec_type: 'video', height: 200 }, { codec_type: 'audio' }] }), /unexpectedly contains a video/u);
  assert.throws(() => summarizeMediaProbe('podcast', { format: { duration: 0 }, streams: [{ codec_type: 'audio' }] }), /measurable duration/u);
});

test('failure-path cleanup discovers worker assets and attempts every S3 and PostgreSQL removal', async () => {
  const deletedKeys = [];
  const deletedRecords = [];
  const pool = {
    async query(sql, values) {
      if (/SELECT payload FROM annotated_records/u.test(sql)) {
        assert.deepEqual(values, [['annotation-1']]);
        return { rows: [{ payload: { mediaAssetId: 'clip-1', posterAssetId: 'poster-1' } }] };
      }
      if (/SELECT record_id, payload FROM annotated_records/u.test(sql)) {
        assert.deepEqual(values, [['clip-1', 'poster-1']]);
        return { rows: [
          { record_id: 'clip-1', payload: { key: 'clips/clip-1.mp4' } },
          { record_id: 'poster-1', payload: { key: 'posters/poster-1.jpg' } },
        ] };
      }
      if (/DELETE FROM annotated_records/u.test(sql)) {
        deletedRecords.push(values);
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const s3 = { async send(command) { deletedKeys.push(command.input.Key); } };
  const result = await cleanupProductionEvidenceFixtures({
    pool,
    s3,
    bucket: 'evidence-bucket',
    records: [['annotations', 'annotation-1'], ['mediaJobs', 'job-1']],
    keys: ['production-evidence/source.mp4'],
  });
  assert.deepEqual(new Set(result.keys), new Set(['production-evidence/source.mp4', 'clips/clip-1.mp4', 'posters/poster-1.jpg']));
  assert.deepEqual(new Set(deletedKeys), new Set(result.keys));
  assert.ok(deletedRecords.some(([collection, id]) => collection === 'media' && id === 'clip-1'));
  assert.ok(deletedRecords.some(([collection, id]) => collection === 'media' && id === 'poster-1'));
  assert.deepEqual(deletedRecords.at(-1), ['annotations', 'annotation-1'], 'annotations stay discoverable until generated media records are removed');
});

test('cleanup continues after individual failures and reports them together', async () => {
  const attempted = [];
  const pool = {
    async query(sql, values) {
      if (/SELECT payload FROM annotated_records/u.test(sql)) return { rows: [] };
      if (/DELETE FROM annotated_records/u.test(sql)) {
        attempted.push(`pg:${values.join('/')}`);
        if (values[1] === 'job-1') throw new Error('database unavailable');
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  const s3 = {
    async send(command) {
      attempted.push(`s3:${command.input.Key}`);
      if (command.input.Key === 'source.mp4') throw new Error('object store unavailable');
    },
  };
  await assert.rejects(
    cleanupProductionEvidenceFixtures({
      pool,
      s3,
      bucket: 'evidence-bucket',
      records: [['mediaJobs', 'job-1'], ['annotations', 'annotation-1']],
      keys: ['source.mp4', 'source.wav'],
    }),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.deepEqual(attempted, [
    's3:source.mp4',
    's3:source.wav',
    'pg:mediaJobs/job-1',
    'pg:annotations/annotation-1',
  ]);
});
