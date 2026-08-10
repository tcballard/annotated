import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  generateReleaseReceipt,
  parseJunit,
  parsePlaywrightReport,
  percentile,
  summarizeAttempts,
} from '../scripts/generate-release-receipt.mjs';
import { validateReleaseReceipt, verifyReceiptFiles } from '../scripts/check-release-slo.mjs';

const fullSha = 'a'.repeat(40);
const checksum = (value) => createHash('sha256').update(value).digest('hex');

const makeFixture = async (t, overrides = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'annotated-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'artifacts/e2e/test-results/gate'), { recursive: true });
  await mkdir(path.join(directory, 'dist/release'), { recursive: true });

  const requestedEnvironment = overrides.environment || 'staging';
  const artifact = Buffer.from('PK\u0003\u0004deterministic-extension-fixture');
  const screenshot = Buffer.from('png-evidence');
  const video = Buffer.from('webm-evidence');
  const trace = Buffer.from('zip-trace-evidence');
  await writeFile(path.join(directory, 'dist/release/annotated-extension-v0.1.0.zip'), artifact);
  await writeFile(path.join(directory, 'artifacts/e2e/test-results/gate/acceptance.png'), screenshot);
  await writeFile(path.join(directory, 'artifacts/e2e/test-results/gate/video.webm'), video);
  await writeFile(path.join(directory, 'artifacts/e2e/test-results/gate/trace.zip'), trace);
  await writeFile(path.join(directory, 'artifacts/e2e/console.jsonl'), '');
  await writeFile(path.join(directory, 'artifacts/e2e/network.jsonl'), '{"method":"GET","status":200}\n');
  const browserDurations = {
    panel_first_usable_ms: [1_000],
    source_resolution_ms: [700],
    publish_acknowledgement_ms: [500],
    playback_readiness_ms: [1_200],
  };
  await writeFile(path.join(directory, 'artifacts/e2e/test-results/gate/duration-samples.json'), `${JSON.stringify(browserDurations)}\n`);
  const gateReceipt = {
    schemaVersion: 1,
    gate: 'gate-b-packaged-extension-browser',
    release: { version: '0.1.0', sha256: checksum(artifact), artifactPath: '/release/annotated-extension-v0.1.0.zip' },
    extension: { id: 'omlikcdpcdhfmdojdalfdeihgjmgikkg', expectedId: 'omlikcdpcdhfmdojdalfdeihgjmgikkg', manifestVersion: 3 },
    nativeHost: { openedEvent: { path: 'sidepanel.html' }, options: { path: 'sidepanel.html', enabled: true } },
    automation: { narrowLayout: { horizontalOverflowPixels: 0 } },
    sourceResolution: { fixture: 'controlled-loopback', ssrfBoundaryObserved: true, verifiesRemoteProviderFetch: false },
    capabilities: { browserVerified: ['side-panel', 'capture', 'hosted-clips', 'sources'], explicitlyNotProviderVerified: ['oauth'] },
    metrics: {
      'extension.package.checksum_verified': 1,
      'extension.identity.expected_id_verified': 1,
      'extension.side_panel.native_opened': 1,
      'extension.side_panel.narrow_layout_no_overflow': 1,
      'extension.source_resolution.controlled_ssrf_fallback': 1,
    },
  };
  await writeFile(path.join(directory, 'artifacts/e2e/test-results/gate/gate-b-browser-receipt.json'), `${JSON.stringify(gateReceipt)}\n`);

  const playwright = {
    config: {},
    suites: [{
      title: 'release gate',
      specs: [{
        title: 'captures and publishes from the extension',
        tests: [{
          projectName: 'chromium',
          results: [{
            retry: 0,
            status: 'passed',
            duration: 1_234,
            attachments: [
              { name: 'acceptance screenshot', contentType: 'image/png', path: 'artifacts/e2e/test-results/gate/acceptance.png' },
              { name: 'video', contentType: 'video/webm', path: 'artifacts/e2e/test-results/gate/video.webm' },
              { name: 'trace', contentType: 'application/zip', path: 'artifacts/e2e/test-results/gate/trace.zip' },
              { name: 'duration-samples', contentType: 'application/json', path: 'artifacts/e2e/test-results/gate/duration-samples.json' },
              { name: 'console-errors', contentType: 'application/x-ndjson', path: 'artifacts/e2e/console.jsonl' },
              { name: 'network', contentType: 'application/x-ndjson', path: 'artifacts/e2e/network.jsonl' },
              { name: 'gate-b-browser-receipt', contentType: 'application/json', path: 'artifacts/e2e/test-results/gate/gate-b-browser-receipt.json' },
            ],
          }],
        }],
      }],
    }],
    errors: [],
  };
  await writeFile(path.join(directory, 'artifacts/e2e/playwright-report.json'), `${JSON.stringify(playwright)}\n`);
  await writeFile(path.join(directory, 'artifacts/e2e/junit.xml'), '<?xml version="1.0"?><testsuites tests="1"><testsuite name="release gate" tests="1"><testcase classname="release gate" name="captures and publishes from the extension" time="1.234"></testcase></testsuite></testsuites>\n');
  await writeFile(path.join(directory, 'artifacts/e2e/production-integration.xml'), '<?xml version="1.0"?><testsuite name="production services" tests="1"><testcase classname="production integration" name="PostgreSQL and S3 object storage adapters work against real services" time="2.1"></testcase></testsuite>\n');
  await writeFile(path.join(directory, 'artifacts/e2e/production-evidence.log'), '{"event":"production_evidence_completed","status":"passed"}\n');
  const mediaWorkerProof = {
    schemaVersion: 1,
    kind: 'annotated.media-worker-integration',
    status: 'passed',
    gitSha: fullSha,
    environment: requestedEnvironment,
    runtimeMode: 'production',
    persistence: 'postgres',
    objectStorage: 's3',
    workerMode: 'standalone',
    transcoder: 'ffmpeg',
    realMediaTranscode: true,
    apiProcess: { executable: 'server/index.js', processRole: 'api', mediaWorkerConcurrency: 0, readyStatus: 200, mediaRuntimeStatus: 'ready', oauthProviderVerification: false },
    apiQueue: { status: 'passed', endpoint: 'POST /api/annotations', publishStatus: 201, authenticatedBy: 'isolated PostgreSQL bearer session', annotationId: 'api-video-annotation', jobId: 'api-video-job', initialStatus: 'queued', attempts: 0, observedBeforeWorkerStart: true },
    workerProcess: { processRole: 'media-worker', concurrency: 2, mediaJobMaxAttempts: 1, s3MaxAttempts: 1 },
    retryPolicy: { maxAttempts: 1, retriesAllowed: false, observedRetries: 0, allJobsFirstAttempt: true },
    s3RetryPolicy: { maxAttempts: 1, retriesAllowed: false, runnerClientMaxAttempts: 1, workerClientMaxAttempts: 1 },
    pickup: { status: 'passed', observed: true, jobId: 'api-video-job', initialStatus: 'queued', samplesMs: [2_000] },
    recovery: { status: 'passed', recoveredLease: true, samplesMs: [2_500] },
    playback: { status: 'passed', audioReady: true, videoReady: true, samplesMs: [1_500] },
    fixtures: [
      { sourceType: 'podcast', jobStatus: 'ready', mediaStatus: 'ready', jobAttempts: 0, deliveryStatus: 200, transcoded: true, hasAudio: true },
      { sourceType: 'video', jobStatus: 'ready', mediaStatus: 'ready', jobAttempts: 0, deliveryStatus: 200, transcoded: true, hasAudio: true, videoHeight: 240 },
    ],
    evidence: {
      junit: 'artifacts/e2e/production-integration.xml',
      log: 'artifacts/e2e/production-evidence.log',
    },
  };
  await writeFile(path.join(directory, 'artifacts/e2e/media-worker.json'), `${JSON.stringify(mediaWorkerProof)}\n`);

  const input = {
    gitSha: fullSha,
    environment: requestedEnvironment,
    origin: 'https://annotated-staging.up.railway.app',
    startedAt: '2026-08-10T04:00:00.000Z',
    completedAt: '2026-08-10T04:01:00.000Z',
    artifact: {
      version: '0.1.0',
      path: 'dist/release/annotated-extension-v0.1.0.zip',
      sha256: checksum(artifact),
      bytes: artifact.length,
    },
    productionShape: {
      browserExtension: true,
      runtimeMode: 'production',
      persistence: 'postgres',
      objectStorage: 's3',
      mediaWorker: 'standalone',
      realMediaTranscode: true,
    },
    browser: {
      engine: 'chromium',
      playwrightJson: 'artifacts/e2e/playwright-report.json',
      junit: 'artifacts/e2e/junit.xml',
      logs: ['artifacts/e2e/console.jsonl', 'artifacts/e2e/network.jsonl'],
    },
    productionEvidence: {
      integrationJunit: 'artifacts/e2e/production-integration.xml',
      mediaWorkerJson: 'artifacts/e2e/media-worker.json',
    },
    capabilityIds: ['side-panel', 'capture', 'hosted-clips', 'sources'],
    ...overrides,
  };
  return { directory, input, playwright, artifact, mediaWorkerProof, gateReceipt };
};

test('receipt helpers parse Playwright, JUnit, retries, and percentile diagnostics', () => {
  const report = parsePlaywrightReport({
    suites: [{ title: 'suite', specs: [{ title: 'spec', tests: [{ projectName: 'chromium', results: [{ retry: 0, status: 'failed', duration: 10 }, { retry: 1, status: 'passed', duration: 9 }] }] }] }],
    errors: [],
  });
  const summary = summarizeAttempts(report.attempts);
  assert.deepEqual({ tests: summary.tests, passed: summary.passed, attempts: summary.attempts, retries: summary.retries, flaky: summary.flaky }, { tests: 1, passed: 1, attempts: 2, retries: 1, flaky: 1 });
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  assert.deepEqual(parseJunit('<testsuite><testcase classname="a" name="pass" time="0.1"/><testcase classname="a" name="skip"><skipped/></testcase></testsuite>'), {
    tests: 2,
    passed: 1,
    failed: 0,
    skipped: 1,
    cases: [
      { id: 'a › pass', status: 'passed', durationMs: 100 },
      { id: 'a › skip', status: 'skipped', durationMs: 0 },
    ],
  });
});

test('JUnit parsing rejects suite-level errors and inconsistent aggregate counts', () => {
  assert.throws(
    () => parseJunit('<testsuite tests="1" errors="1"><error>setup exploded</error><testcase name="pass"/></testsuite>'),
    /suite-level or orphan/u,
  );
  assert.throws(
    () => parseJunit('<testsuite tests="1" failures="1"><testcase name="pass"/></testsuite>'),
    /failures aggregate declares 1 but contains 0/u,
  );
});

test('an authoritative receipt retains hashed evidence and satisfies the release checker', async (t) => {
  const fixture = await makeFixture(t);
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory, now: () => new Date('2026-08-10T04:01:01.000Z') });
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.authoritative, true);
  assert.equal(receipt.gitSha, fullSha);
  assert.equal(receipt.artifact.sha256, fixture.input.artifact.sha256);
  assert.equal(receipt.browser.reliabilityStatus, 'passed');
  assert.deepEqual(receipt.browser.testSummary, { tests: 1, passed: 1, failed: 0, skipped: 0, attempts: 1, retries: 0, flaky: 0 });
  assert.equal(receipt.evidence.screenshots[0].sha256, checksum(Buffer.from('png-evidence')));
  assert.equal(receipt.evidence.videos[0].sha256, checksum(Buffer.from('webm-evidence')));
  assert.equal(receipt.evidence.traces[0].sha256, checksum(Buffer.from('zip-trace-evidence')));
  assert.equal(receipt.evidence.productionIntegration.summary.skipped, 0);
  assert.equal(receipt.evidence.mediaWorker.summary.apiQueueObserved, true);
  assert.equal(receipt.evidence.mediaWorker.summary.recoveryObserved, true);
  assert.equal(receipt.evidence.mediaWorker.summary.maxAttempts, 1);
  assert.equal(receipt.evidence.mediaWorker.summary.observedRetries, 0);
  assert.equal(receipt.evidence.mediaWorker.summary.s3MaxAttempts, 1);
  assert.equal(receipt.evidence.mediaWorker.summary.s3WorkerClientMaxAttempts, 1);
  assert.equal(receipt.evidence.mediaWorker.log.bytes > 0, true);
  assert.equal(receipt.evidence.browserGate.bytes > 0, true);
  assert.equal(receipt.capabilityEvidence.status, 'verified');
  assert.deepEqual(validateReleaseReceipt(receipt), []);
  assert.deepEqual(await verifyReceiptFiles(receipt, { baseDirectory: fixture.directory }), []);
});

test('a final green retry remains an explicit release failure', async (t) => {
  const fixture = await makeFixture(t);
  fixture.playwright.suites[0].specs[0].tests[0].results = [
    { retry: 0, status: 'failed', duration: 900, error: { message: 'first attempt failed' } },
    { retry: 1, status: 'passed', duration: 800, attachments: [
      { name: 'screenshot', contentType: 'image/png', path: 'artifacts/e2e/test-results/gate/acceptance.png' },
      { name: 'video', contentType: 'video/webm', path: 'artifacts/e2e/test-results/gate/video.webm' },
      { name: 'duration-samples', contentType: 'application/json', path: 'artifacts/e2e/test-results/gate/duration-samples.json' },
    ] },
  ];
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/playwright-report.json'), JSON.stringify(fixture.playwright));
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.browser.testSummary.passed, 1, 'the final result remains visible');
  assert.equal(receipt.browser.testSummary.retries, 1);
  assert.equal(receipt.browser.testSummary.flaky, 1);
  assert.ok(receipt.failures.some((item) => item.code === 'browser-test-flake'));
  assert.ok(validateReleaseReceipt(receipt).some((item) => item.code === 'receipt-status'));
});

test('missing production shape, missing evidence, and an SLO breach all fail closed', async (t) => {
  const fixture = await makeFixture(t);
  fixture.input.productionShape.mediaWorker = 'in-process';
  fixture.input.browser.logs = ['artifacts/e2e/console.jsonl'];
  fixture.playwright.suites[0].specs[0].tests[0].results[0].attachments = fixture.playwright.suites[0].specs[0].tests[0].results[0].attachments.filter((item) => item.name !== 'network');
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/playwright-report.json'), JSON.stringify(fixture.playwright));
  fixture.mediaWorkerProof.playback.samplesMs = [3_001];
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/media-worker.json'), JSON.stringify(fixture.mediaWorkerProof));
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'failed');
  assert.ok(receipt.failures.some((item) => item.code === 'not-production-shaped'));
  assert.ok(receipt.failures.some((item) => item.code === 'missing-browser-evidence' && /network/u.test(item.message)));
  assert.ok(receipt.failures.some((item) => item.code === 'release-budget-breach' && /Playback/u.test(item.message)));
  assert.equal(receipt.performance.productionLatencySlo, false);
  assert.equal(receipt.performance.results.find((item) => item.id === 'playback_readiness_ms').status, 'failed');
});

test('production integration skips and unproven worker recovery cannot become release evidence', async (t) => {
  const fixture = await makeFixture(t);
  await writeFile(
    path.join(fixture.directory, 'artifacts/e2e/production-integration.xml'),
    '<testsuite name="production"><testcase classname="production" name="PostgreSQL and S3 adapters"><skipped/></testcase></testsuite>',
  );
  fixture.mediaWorkerProof.recovery = { status: 'passed', recoveredLease: false, samplesMs: [100] };
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/media-worker.json'), JSON.stringify(fixture.mediaWorkerProof));
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'failed');
  assert.ok(receipt.failures.some((item) => item.code === 'production-integration-failure'));
  assert.ok(receipt.failures.some((item) => item.code === 'invalid-media-worker-proof' && /recoveredLease/u.test(item.message)));
  assert.equal(receipt.evidence.productionIntegration.summary.skipped, 1);
  assert.equal(receipt.evidence.mediaWorker.summary.recoveryObserved, false);
});

test('a direct database fixture cannot impersonate the production API queue boundary', async (t) => {
  const fixture = await makeFixture(t);
  fixture.mediaWorkerProof.apiQueue.observedBeforeWorkerStart = false;
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/media-worker.json'), JSON.stringify(fixture.mediaWorkerProof));
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.evidence.mediaWorker.summary.apiQueueObserved, false);
  assert.ok(receipt.failures.some((item) => item.code === 'invalid-media-worker-proof' && /pristine queued job/u.test(item.message)));
});

test('authoritative worker evidence cannot pass with retries enabled or observed', async (t) => {
  const fixture = await makeFixture(t);
  fixture.mediaWorkerProof.workerProcess.mediaJobMaxAttempts = 3;
  fixture.mediaWorkerProof.retryPolicy = {
    maxAttempts: 3,
    retriesAllowed: true,
    observedRetries: 1,
    allJobsFirstAttempt: false,
  };
  fixture.mediaWorkerProof.fixtures[0].jobAttempts = 1;
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/media-worker.json'), JSON.stringify(fixture.mediaWorkerProof));

  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'failed');
  assert.ok(receipt.failures.some((item) => item.code === 'invalid-media-worker-proof' && /maxAttempts/u.test(item.message)));
  assert.ok(receipt.failures.some((item) => item.code === 'invalid-media-worker-proof' && /without a retry/u.test(item.message)));
  assert.ok(validateReleaseReceipt(receipt).some((item) => item.code === 'receipt-status'));
});

test('declared artifact metadata and explicit attempts cannot contradict primary evidence', async (t) => {
  const fixture = await makeFixture(t);
  fixture.input.artifact.sha256 = 'f'.repeat(64);
  fixture.input.browser.attempts = [{ testId: 'different test', attempt: 1, status: 'passed', durationMs: 2 }];
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.ok(receipt.failures.some((item) => item.code === 'artifact-checksum-mismatch'));
  assert.ok(receipt.failures.some((item) => item.code === 'attempt-report-mismatch'));
});

test('the redacted standalone-worker log is required and re-hashed by the checker', async (t) => {
  const fixture = await makeFixture(t);
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'passed');
  assert.match(receipt.evidence.mediaWorker.log.path, /production-evidence\.log$/u);
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/production-evidence.log'), '{"event":"tampered"}\n');
  const errors = await verifyReceiptFiles(receipt, { baseDirectory: fixture.directory });
  assert.ok(errors.some((item) => ['evidence-size-mismatch', 'evidence-checksum-mismatch'].includes(item.code) && /production-evidence\.log/u.test(item.path)));
});

test('capability claims come only from the hashed Playwright Gate B receipt', async (t) => {
  const fixture = await makeFixture(t);
  fixture.input.capabilityIds.push('oauth');
  const rejected = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.ok(rejected.failures.some((item) => item.code === 'capability-gate-mismatch'));

  fixture.input.capabilityIds = fixture.gateReceipt.capabilities.browserVerified;
  const receipt = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(receipt.status, 'passed');
  fixture.gateReceipt.capabilities.browserVerified.push('oauth');
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/test-results/gate/gate-b-browser-receipt.json'), JSON.stringify(fixture.gateReceipt));
  const errors = await verifyReceiptFiles(receipt, { baseDirectory: fixture.directory });
  assert.ok(errors.some((item) => item.code === 'evidence-checksum-mismatch' && /gate-b-browser-receipt/u.test(item.path)));
});

test('receipt paths are portable and references outside the evidence base fail closed', async (t) => {
  const fixture = await makeFixture(t);
  const attachments = fixture.playwright.suites[0].specs[0].tests[0].results[0].attachments;
  const screenshot = attachments.find((item) => item.name === 'acceptance screenshot');
  screenshot.path = path.join(fixture.directory, screenshot.path);
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/playwright-report.json'), JSON.stringify(fixture.playwright));
  const portable = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(portable.status, 'passed');
  assert.equal(portable.evidence.screenshots[0].path, 'artifacts/e2e/test-results/gate/acceptance.png');
  assert.equal(path.isAbsolute(portable.evidence.screenshots[0].path), false);

  const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-receipt-outside-'));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsideVideo = path.join(outsideDirectory, 'outside.webm');
  await writeFile(outsideVideo, 'outside evidence');
  attachments.find((item) => item.name === 'video').path = outsideVideo;
  await writeFile(path.join(fixture.directory, 'artifacts/e2e/playwright-report.json'), JSON.stringify(fixture.playwright));
  const rejected = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(rejected.status, 'failed');
  assert.ok(rejected.failures.some((item) => item.code === 'evidence-outside-base'));
  assert.equal(rejected.evidence.videos.length, 0);

  portable.evidence.screenshots[0].path = '../outside.png';
  assert.ok(validateReleaseReceipt(portable).some((item) => item.code === 'invalid-reference' && item.path === 'evidence.screenshots[0].path'));
});

test('local generation needs explicit non-authoritative mode and can never become a release receipt', async (t) => {
  const fixture = await makeFixture(t, { environment: 'local', origin: 'http://127.0.0.1:8787' });
  const accidental = await generateReleaseReceipt(fixture.input, { baseDirectory: fixture.directory });
  assert.equal(accidental.status, 'failed');
  assert.ok(accidental.failures.some((item) => item.code === 'non-release-environment'));

  const local = await generateReleaseReceipt(fixture.input, { authoritative: false, baseDirectory: fixture.directory });
  assert.equal(local.status, 'non-authoritative');
  assert.ok(validateReleaseReceipt(local).some((item) => item.code === 'authority'));
  assert.deepEqual(validateReleaseReceipt(local, { allowNonAuthoritative: true }), []);
});

test('generator and checker CLIs write and verify the default machine contract', async (t) => {
  const fixture = await makeFixture(t);
  const manifestPath = path.join(fixture.directory, 'release-evidence.json');
  const receiptPath = path.join(fixture.directory, 'artifacts/release/receipt.json');
  await writeFile(manifestPath, `${JSON.stringify(fixture.input, null, 2)}\n`);
  const generatorPath = path.resolve(new URL('../scripts/generate-release-receipt.mjs', import.meta.url).pathname);
  const checkerPath = path.resolve(new URL('../scripts/check-release-slo.mjs', import.meta.url).pathname);

  const generated = spawnSync(process.execPath, [generatorPath, '--input', manifestPath, '--output', receiptPath, '--base-dir', fixture.directory], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'passed');

  const checked = spawnSync(process.execPath, [checkerPath, '--receipt', receiptPath, '--base-dir', fixture.directory], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).status, 'passed');
});

test('release packaging independently revalidates every receipt file before embedding it', async () => {
  const source = await readFile(new URL('../scripts/build-release-artifact.mjs', import.meta.url), 'utf8');
  assert.match(source, /validateReleaseReceipt\(receipt\)/u);
  assert.match(source, /verifyReceiptFiles\(receipt, \{ baseDirectory: projectRoot \}\)/u);
  assert.match(source, /Release receipt failed independent validation/u);
});
