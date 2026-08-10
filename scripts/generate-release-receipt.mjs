#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA_VERSION = 1;
export const RECEIPT_KIND = 'annotated.release-receipt';
export const DEFAULT_RECEIPT_PATH = 'artifacts/release/receipt.json';

// Gate B budgets are release contracts, rather than tuneable inputs. A caller
// may record more measurements, but cannot make a slow run green by widening a
// threshold in its evidence manifest.
export const RELEASE_BUDGETS = Object.freeze([
  Object.freeze({ id: 'panel_first_usable_ms', label: 'Side panel first usable', statistic: 'max-observed', scope: 'deterministic-loopback-browser-regression', budgetMs: 2_000, minSamples: 1 }),
  Object.freeze({ id: 'source_resolution_ms', label: 'Controlled source-resolution fallback response', statistic: 'max-observed', scope: 'deterministic-loopback-browser-regression', budgetMs: 1_500, minSamples: 1 }),
  Object.freeze({ id: 'publish_acknowledgement_ms', label: 'Publish acknowledgement', statistic: 'max-observed', scope: 'deterministic-loopback-browser-regression', budgetMs: 1_000, minSamples: 1 }),
  Object.freeze({ id: 'media_job_pickup_ms', label: 'Media job pickup', statistic: 'max-observed', scope: 'protected-production-service-observation', budgetMs: 5_000, minSamples: 1 }),
  Object.freeze({ id: 'media_job_recovery_ms', label: 'Media job recovery', statistic: 'max-observed', scope: 'protected-production-service-observation', budgetMs: 5_000, minSamples: 1 }),
  Object.freeze({ id: 'playback_readiness_ms', label: 'Playback readiness', statistic: 'max-observed', scope: 'protected-production-service-observation', budgetMs: 3_000, minSamples: 1 }),
]);

const PASSING_STATUSES = new Set(['passed']);
const ATTEMPT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const REQUIRED_PRODUCTION_SHAPE = Object.freeze({
  browserExtension: true,
  runtimeMode: 'production',
  persistence: 'postgres',
  objectStorage: 's3',
  mediaWorker: 'standalone',
  realMediaTranscode: true,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asPosix = (value) => String(value).split(path.sep).join('/');
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value) => Number(Number(value).toFixed(3));
const asArray = (value) => value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]);

const failure = (failures, code, message, evidencePath) => {
  failures.push({ code, message, ...(evidencePath ? { path: evidencePath } : {}) });
};

const isoTime = (value, name, failures) => {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    failure(failures, 'invalid-time', `${name} must be an ISO-8601 timestamp.`, name);
    return null;
  }
  return new Date(timestamp).toISOString();
};

const decodeXml = (value = '') => value
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&');

const xmlAttributes = (tag = '') => {
  const attributes = {};
  for (const match of tag.matchAll(/([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return attributes;
};

const junitCasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu;

const parseJunitCaseRecords = (xml) => {
  const records = [];
  for (const match of xml.matchAll(junitCasePattern)) {
    const attributes = xmlAttributes(match[1]);
    const body = match[2] || '';
    const failureCount = [...body.matchAll(/<failure\b/gu)].length;
    const errorCount = [...body.matchAll(/<error\b/gu)].length;
    const skippedCount = [...body.matchAll(/<skipped\b/gu)].length;
    if (Number(failureCount > 0) + Number(errorCount > 0) + Number(skippedCount > 0) > 1) {
      throw new Error(`JUnit testcase ${attributes.name || records.length + 1} has conflicting result elements.`);
    }
    const outcome = errorCount ? 'error' : failureCount ? 'failure' : skippedCount ? 'skipped' : 'passed';
    records.push({
      outcome,
      item: {
        id: [attributes.classname, attributes.name].filter(Boolean).join(' › ') || `test-${records.length + 1}`,
        status: ['error', 'failure'].includes(outcome) ? 'failed' : outcome,
        durationMs: round((Number(attributes.time) || 0) * 1_000),
      },
    });
  }
  return records;
};

const junitCounts = (records) => ({
  tests: records.length,
  failures: records.filter((record) => record.outcome === 'failure').length,
  errors: records.filter((record) => record.outcome === 'error').length,
  skipped: records.filter((record) => record.outcome === 'skipped').length,
});

const validateJunitAggregate = (attributesSource, records, label) => {
  const attributes = xmlAttributes(attributesSource);
  const actual = junitCounts(records);
  for (const name of ['tests', 'failures', 'errors', 'skipped']) {
    if (!Object.hasOwn(attributes, name)) continue;
    if (!/^\d+$/u.test(attributes[name])) throw new Error(`JUnit ${label} ${name} aggregate must be a non-negative integer.`);
    if (Number(attributes[name]) !== actual[name]) {
      throw new Error(`JUnit ${label} ${name} aggregate declares ${attributes[name]} but contains ${actual[name]}.`);
    }
  }
};

export const parseJunit = (xml) => {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('JUnit evidence is empty.');
  const records = parseJunitCaseRecords(xml);
  const cases = records.map((record) => record.item);
  if (!cases.length) throw new Error('JUnit evidence contains no <testcase> records.');

  const withoutCases = xml.replace(junitCasePattern, '');
  if (/<(?:failure|error)\b/u.test(withoutCases)) {
    throw new Error('JUnit evidence contains a suite-level or orphan <error>/<failure> outside a <testcase>.');
  }
  for (const match of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gu)) {
    validateJunitAggregate(match[1], parseJunitCaseRecords(match[2]), `testsuite ${xmlAttributes(match[1]).name || '(unnamed)'}`);
  }
  for (const match of xml.matchAll(/<testsuites\b([^>]*)>([\s\S]*?)<\/testsuites>/gu)) {
    validateJunitAggregate(match[1], parseJunitCaseRecords(match[2]), 'testsuites');
  }
  return {
    tests: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    skipped: cases.filter((item) => item.status === 'skipped').length,
    cases,
  };
};

export const parseMediaWorkerProof = (proof, { gitSha, environment } = {}) => {
  const errors = [];
  const addError = (message, evidencePath) => errors.push({ message, path: evidencePath });
  if (!isRecord(proof)) return {
    errors: [{ message: 'Media worker proof must be a JSON object.', path: 'productionEvidence.mediaWorkerJson' }],
    measurements: {},
    retryPolicy: {},
    s3RetryPolicy: {},
  };
  if (proof.schemaVersion !== 1) addError('Media worker proof schemaVersion must be 1.', 'schemaVersion');
  if (proof.kind !== 'annotated.media-worker-integration') addError('Media worker proof kind must be annotated.media-worker-integration.', 'kind');
  if (proof.status !== 'passed') addError('Media worker proof status must be passed.', 'status');
  if (proof.gitSha !== gitSha) addError('Media worker proof gitSha must match the release receipt.', 'gitSha');
  if (proof.environment !== environment) addError('Media worker proof environment must match the release receipt.', 'environment');
  if (proof.runtimeMode !== 'production') addError('Media worker proof runtimeMode must be production.', 'runtimeMode');
  if (proof.persistence !== 'postgres') addError('Media worker proof persistence must be postgres.', 'persistence');
  if (proof.objectStorage !== 's3') addError('Media worker proof objectStorage must be s3.', 'objectStorage');
  if (proof.workerMode !== 'standalone') addError('Media worker proof workerMode must be standalone.', 'workerMode');
  if (proof.transcoder !== 'ffmpeg') addError('Media worker proof transcoder must be ffmpeg.', 'transcoder');
  if (proof.realMediaTranscode !== true) addError('Media worker proof must record a real media transcode.', 'realMediaTranscode');
  const apiProcess = {
    processRole: proof.apiProcess?.processRole,
    mediaWorkerConcurrency: Number(proof.apiProcess?.mediaWorkerConcurrency),
    readyStatus: Number(proof.apiProcess?.readyStatus),
    mediaRuntimeStatus: proof.apiProcess?.mediaRuntimeStatus,
    oauthProviderVerification: proof.apiProcess?.oauthProviderVerification,
  };
  if (proof.apiProcess?.executable !== 'server/index.js') addError('apiProcess.executable must prove the production API entry point.', 'apiProcess.executable');
  if (apiProcess.processRole !== 'api') addError('apiProcess.processRole must be api.', 'apiProcess.processRole');
  if (apiProcess.mediaWorkerConcurrency !== 0) addError('The production API must prove MEDIA_WORKER_CONCURRENCY=0.', 'apiProcess.mediaWorkerConcurrency');
  if (apiProcess.readyStatus !== 200 || apiProcess.mediaRuntimeStatus !== 'ready') addError('The production API must pass its production readiness check.', 'apiProcess.readyStatus');
  if (apiProcess.oauthProviderVerification !== false) addError('Controlled API evidence must not claim external OAuth-provider verification.', 'apiProcess.oauthProviderVerification');
  const apiQueue = {
    status: proof.apiQueue?.status,
    endpoint: proof.apiQueue?.endpoint,
    publishStatus: Number(proof.apiQueue?.publishStatus),
    authenticatedBy: proof.apiQueue?.authenticatedBy,
    annotationId: proof.apiQueue?.annotationId,
    jobId: proof.apiQueue?.jobId,
    initialStatus: proof.apiQueue?.initialStatus,
    attempts: Number(proof.apiQueue?.attempts),
    observedBeforeWorkerStart: proof.apiQueue?.observedBeforeWorkerStart,
  };
  if (apiQueue.status !== 'passed') addError('apiQueue.status must be passed.', 'apiQueue.status');
  if (apiQueue.endpoint !== 'POST /api/annotations' || apiQueue.publishStatus !== 201) addError('apiQueue must prove a successful production annotation publish.', 'apiQueue.endpoint');
  if (apiQueue.authenticatedBy !== 'isolated PostgreSQL bearer session') addError('apiQueue must prove authenticated PostgreSQL session handling.', 'apiQueue.authenticatedBy');
  if (typeof apiQueue.annotationId !== 'string' || !apiQueue.annotationId || typeof apiQueue.jobId !== 'string' || !apiQueue.jobId) addError('apiQueue must identify the API-created annotation and media job.', 'apiQueue');
  if (apiQueue.initialStatus !== 'queued' || apiQueue.attempts !== 0 || apiQueue.observedBeforeWorkerStart !== true) addError('apiQueue must prove a pristine queued job before the standalone worker starts.', 'apiQueue.observedBeforeWorkerStart');
  const retryPolicy = {
    maxAttempts: Number(proof.retryPolicy?.maxAttempts),
    retriesAllowed: proof.retryPolicy?.retriesAllowed,
    observedRetries: Number(proof.retryPolicy?.observedRetries),
    allJobsFirstAttempt: proof.retryPolicy?.allJobsFirstAttempt,
  };
  if (retryPolicy.maxAttempts !== 1) addError('retryPolicy.maxAttempts must be 1 for authoritative evidence.', 'retryPolicy.maxAttempts');
  if (retryPolicy.retriesAllowed !== false) addError('retryPolicy.retriesAllowed must be false for authoritative evidence.', 'retryPolicy.retriesAllowed');
  if (retryPolicy.observedRetries !== 0) addError('retryPolicy.observedRetries must be 0.', 'retryPolicy.observedRetries');
  if (retryPolicy.allJobsFirstAttempt !== true) addError('retryPolicy.allJobsFirstAttempt must be true.', 'retryPolicy.allJobsFirstAttempt');
  if (Number(proof.workerProcess?.mediaJobMaxAttempts) !== 1) addError('workerProcess.mediaJobMaxAttempts must prove the worker started with a one-attempt media-job policy.', 'workerProcess.mediaJobMaxAttempts');
  const s3RetryPolicy = {
    maxAttempts: Number(proof.s3RetryPolicy?.maxAttempts),
    retriesAllowed: proof.s3RetryPolicy?.retriesAllowed,
    runnerClientMaxAttempts: Number(proof.s3RetryPolicy?.runnerClientMaxAttempts),
    workerClientMaxAttempts: Number(proof.s3RetryPolicy?.workerClientMaxAttempts),
  };
  if (s3RetryPolicy.maxAttempts !== 1) addError('s3RetryPolicy.maxAttempts must be 1 for authoritative evidence.', 's3RetryPolicy.maxAttempts');
  if (s3RetryPolicy.retriesAllowed !== false) addError('s3RetryPolicy.retriesAllowed must be false for authoritative evidence.', 's3RetryPolicy.retriesAllowed');
  if (s3RetryPolicy.runnerClientMaxAttempts !== 1) addError('The evidence runner S3 client must use maxAttempts=1.', 's3RetryPolicy.runnerClientMaxAttempts');
  if (s3RetryPolicy.workerClientMaxAttempts !== 1 || Number(proof.workerProcess?.s3MaxAttempts) !== 1) addError('The standalone worker S3 client must use maxAttempts=1.', 's3RetryPolicy.workerClientMaxAttempts');

  const phaseDefinitions = [
    ['pickup', 'media_job_pickup_ms'],
    ['recovery', 'media_job_recovery_ms'],
    ['playback', 'playback_readiness_ms'],
  ];
  const measurements = {};
  for (const [phase, metric] of phaseDefinitions) {
    const record = proof[phase];
    const samples = Array.isArray(record?.samplesMs) ? record.samplesMs.map(Number) : [];
    if (record?.status !== 'passed') addError(`${phase}.status must be passed.`, `${phase}.status`);
    if (!samples.length || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) addError(`${phase}.samplesMs must contain non-negative timing evidence.`, `${phase}.samplesMs`);
    measurements[metric] = samples;
  }
  if (proof.pickup?.observed !== true) addError('pickup.observed must prove that the standalone worker claimed the queued job.', 'pickup.observed');
  if (proof.pickup?.jobId !== apiQueue.jobId || proof.pickup?.initialStatus !== 'queued') addError('pickup must claim the exact API-created queued job.', 'pickup.jobId');
  if (proof.recovery?.recoveredLease !== true) addError('recovery.recoveredLease must prove that an expired worker lease was recovered.', 'recovery.recoveredLease');
  if (proof.playback?.audioReady !== true || proof.playback?.videoReady !== true) addError('playback must prove ready audio and video delivery.', 'playback');
  if (typeof proof.evidence?.junit !== 'string' || !proof.evidence.junit) addError('Media worker proof must reference its production JUnit artifact.', 'evidence.junit');
  if (typeof proof.evidence?.log !== 'string' || !proof.evidence.log) addError('Media worker proof must reference its redacted execution log.', 'evidence.log');

  const fixtures = Array.isArray(proof.fixtures) ? proof.fixtures : [];
  for (const sourceType of ['podcast', 'video']) {
    const fixture = fixtures.find((item) => item?.sourceType === sourceType);
    if (!fixture) { addError(`A ready ${sourceType} fixture is required.`, 'fixtures'); continue; }
    if (fixture.jobStatus !== 'ready' || fixture.mediaStatus !== 'ready' || fixture.deliveryStatus !== 200 || fixture.transcoded !== true) addError(`${sourceType} must be transcoded, ready, and delivered with HTTP 200.`, `fixtures.${sourceType}`);
    if (fixture.hasAudio !== true) addError(`${sourceType} delivery must contain audio.`, `fixtures.${sourceType}.hasAudio`);
    if (Number(fixture.jobAttempts) !== 0) addError(`${sourceType} must complete without a retry attempt.`, `fixtures.${sourceType}.jobAttempts`);
    if (sourceType === 'video' && (!Number.isFinite(fixture.videoHeight) || fixture.videoHeight > 240)) addError('Video delivery must prove the bounded 240p transcode.', 'fixtures.video.videoHeight');
  }
  return { errors, measurements, apiProcess, apiQueue, retryPolicy, s3RetryPolicy, evidence: isRecord(proof.evidence) ? proof.evidence : {} };
};

const walkPlaywrightSuites = (suites, parents, output) => {
  for (const suite of Array.isArray(suites) ? suites : []) {
    const suiteParents = suite.title ? [...parents, suite.title] : parents;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        const testId = [...suiteParents, spec.title || test.title || 'unnamed test', test.projectName ? `[${test.projectName}]` : '']
          .filter(Boolean)
          .join(' › ');
        for (const [index, result] of (Array.isArray(test.results) ? test.results : []).entries()) {
          output.attempts.push({
            testId,
            attempt: Number.isInteger(result.retry) ? result.retry + 1 : index + 1,
            status: result.status || 'failed',
            durationMs: round(Number(result.duration) || 0),
            ...(result.error?.message ? { error: String(result.error.message).slice(0, 2_000) } : {}),
          });
          for (const attachment of Array.isArray(result.attachments) ? result.attachments : []) {
            if (!attachment?.path) continue;
            const contentType = String(attachment.contentType || '').toLowerCase();
            const name = String(attachment.name || '').toLowerCase();
            const item = { path: attachment.path, name: attachment.name || null, contentType: attachment.contentType || null };
            if (contentType.startsWith('image/') || name.includes('screenshot')) output.attachments.screenshots.push(item);
            else if (contentType.startsWith('video/') || name.includes('video')) output.attachments.videos.push(item);
            else if (name.includes('trace') || /application\/(?:zip|x-zip)/u.test(contentType)) output.attachments.traces.push(item);
            else if (name === 'gate-b-browser-receipt') output.attachments.gateReceipts.push(item);
            else if (name.includes('duration-samples') || name.includes('browser-metrics')) output.attachments.metrics.push(item);
            else if (name.includes('console') || name.includes('network') || /(?:ndjson|jsonl)/u.test(contentType)) output.attachments.logs.push(item);
          }
        }
      }
    }
    walkPlaywrightSuites(suite.suites, suiteParents, output);
  }
};

export const parsePlaywrightReport = (report) => {
  if (!isRecord(report)) throw new Error('Playwright JSON evidence must be an object.');
  const output = { attempts: [], attachments: { screenshots: [], videos: [], traces: [], logs: [], metrics: [], gateReceipts: [] }, topLevelErrors: Array.isArray(report.errors) ? report.errors.length : 0 };
  walkPlaywrightSuites(report.suites, [], output);
  if (!output.attempts.length) throw new Error('Playwright JSON evidence contains no test attempts.');
  return output;
};

const normalizeExplicitAttempts = (attempts, failures) => {
  if (!Array.isArray(attempts)) return [];
  return attempts.map((attempt, index) => {
    const itemPath = `browser.attempts[${index}]`;
    const testId = typeof attempt?.testId === 'string' ? attempt.testId.trim() : '';
    const number = Number(attempt?.attempt);
    const status = String(attempt?.status || '');
    const durationMs = Number(attempt?.durationMs);
    if (!testId) failure(failures, 'invalid-attempt', 'Every explicit browser attempt needs a testId.', `${itemPath}.testId`);
    if (!Number.isInteger(number) || number < 1) failure(failures, 'invalid-attempt', 'Attempt numbers must be positive integers.', `${itemPath}.attempt`);
    if (!ATTEMPT_STATUSES.has(status)) failure(failures, 'invalid-attempt', `Unsupported attempt status: ${status || '(empty)'}.`, `${itemPath}.status`);
    if (!Number.isFinite(durationMs) || durationMs < 0) failure(failures, 'invalid-attempt', 'Attempt durationMs must be a non-negative number.', `${itemPath}.durationMs`);
    return { testId, attempt: number, status, durationMs: Number.isFinite(durationMs) ? round(durationMs) : 0, ...(attempt?.error ? { error: String(attempt.error).slice(0, 2_000) } : {}) };
  });
};

export const summarizeAttempts = (attempts) => {
  const groups = new Map();
  for (const attempt of attempts) {
    if (!groups.has(attempt.testId)) groups.set(attempt.testId, []);
    groups.get(attempt.testId).push(attempt);
  }
  const tests = [...groups.entries()].map(([testId, entries]) => {
    const sorted = [...entries].sort((left, right) => left.attempt - right.attempt);
    const final = sorted.at(-1);
    const retried = sorted.length > 1 || sorted.some((item) => item.attempt > 1);
    const flaky = retried || (PASSING_STATUSES.has(final.status) && sorted.slice(0, -1).some((item) => !PASSING_STATUSES.has(item.status)));
    return { testId, finalStatus: final.status, attempts: sorted.length, retried, flaky };
  });
  return {
    tests: tests.length,
    passed: tests.filter((item) => item.finalStatus === 'passed').length,
    failed: tests.filter((item) => !['passed', 'skipped'].includes(item.finalStatus)).length,
    skipped: tests.filter((item) => item.finalStatus === 'skipped').length,
    attempts: attempts.length,
    retries: attempts.length - tests.length,
    flaky: tests.filter((item) => item.flaky).length,
    cases: tests,
  };
};

export const percentile = (samples, proportion) => {
  if (!Array.isArray(samples) || !samples.length) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(proportion * ordered.length) - 1);
  return ordered[index];
};

const measurementValues = (input, id, failures) => {
  const raw = input?.measurements?.[id];
  if (!Array.isArray(raw)) {
    failure(failures, 'missing-slo-evidence', `Missing measurements for ${id}.`, `measurements.${id}`);
    return [];
  }
  return raw.map((sample, index) => Number(isRecord(sample) ? sample.valueMs : sample)).filter((value, index) => {
    if (Number.isFinite(value) && value >= 0) return true;
    failure(failures, 'invalid-slo-sample', `${id} sample ${index + 1} must be a non-negative number of milliseconds.`, `measurements.${id}[${index}]`);
    return false;
  });
};

export const evaluateReleaseBudgets = (input, failures = []) => {
  const results = RELEASE_BUDGETS.map((definition) => {
    const samples = measurementValues(input, definition.id, failures);
    const observedMaxMs = samples.length ? Math.max(...samples) : null;
    let status = 'passed';
    if (samples.length < definition.minSamples) {
      status = 'failed';
      failure(failures, 'insufficient-slo-evidence', `${definition.label} needs at least ${definition.minSamples} sample.`, `measurements.${definition.id}`);
    } else if (observedMaxMs > definition.budgetMs) {
      status = 'failed';
      failure(failures, 'release-budget-breach', `${definition.label} observed maximum ${round(observedMaxMs)}ms exceeds the ${definition.budgetMs}ms release budget.`, `measurements.${definition.id}`);
    }
    return {
      id: definition.id,
      label: definition.label,
      unit: 'ms',
      statistic: definition.statistic,
      scope: definition.scope,
      budgetMs: definition.budgetMs,
      minSamples: definition.minSamples,
      sampleCount: samples.length,
      samplesMs: samples.map(round),
      observedMaxMs: observedMaxMs === null ? null : round(observedMaxMs),
      status,
    };
  });
  return {
    status: results.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    classification: 'release-gate-observations',
    productionLatencySlo: false,
    results,
  };
};

const containedPath = (value, baseDirectory) => {
  const base = path.resolve(baseDirectory);
  const absolutePath = path.resolve(base, typeof value === 'string' ? value : value?.path || '');
  const relativePath = path.relative(base, absolutePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) throw new Error('path must name a file inside --base-dir');
  return { base, absolutePath, relativePath: asPosix(relativePath) };
};
const resolveEvidencePath = (value, baseDirectory) => containedPath(value, baseDirectory).absolutePath;
const evidencePathKey = (value, baseDirectory) => {
  try { return resolveEvidencePath(value, baseDirectory); }
  catch { return null; }
};
const displayEvidencePath = (value) => asPosix(typeof value === 'string' ? value : value?.path || '');

const referenceFile = async (value, baseDirectory, failures, label, { allowEmpty = false } = {}) => {
  const displayPath = displayEvidencePath(value);
  if (!displayPath) {
    failure(failures, 'missing-evidence-path', `${label} is missing a path.`, label);
    return null;
  }
  try {
    const resolved = containedPath(value, baseDirectory);
    const [realBase, realFile] = await Promise.all([realpath(resolved.base), realpath(resolved.absolutePath)]);
    const realRelative = path.relative(realBase, realFile);
    if (!realRelative || realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) throw new Error('path resolves outside --base-dir');
    const absolutePath = resolved.absolutePath;
    const details = await stat(absolutePath);
    if (!details.isFile()) throw new Error('not a file');
    const bytes = await readFile(absolutePath);
    if (!bytes.length && !allowEmpty) throw new Error('empty file');
    return { path: resolved.relativePath, sha256: sha256(bytes), bytes: bytes.length };
  } catch (error) {
    const code = /(?:inside|outside) --base-dir/u.test(error.message) ? 'evidence-outside-base' : 'missing-evidence-file';
    failure(failures, code, `${label} is not a portable, readable${allowEmpty ? '' : ', non-empty'} file: ${error.message}.`, displayPath);
    return null;
  }
};

const uniquePathValues = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = displayEvidencePath(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const referenceFiles = async (values, baseDirectory, failures, label, options) => {
  const referenced = await Promise.all(uniquePathValues(Array.isArray(values) ? values : []).map((value, index) => referenceFile(value, baseDirectory, failures, `${label}[${index}]`, options)));
  return referenced.filter(Boolean);
};

const ensureEvidenceKinds = (evidence, failures) => {
  if (!evidence.playwright) failure(failures, 'missing-browser-evidence', 'A Playwright JSON report is required.', 'browser.playwrightJson');
  if (!evidence.junit) failure(failures, 'missing-browser-evidence', 'A JUnit report is required.', 'browser.junit');
  if (!evidence.logs.some((item) => /console/i.test(item.path))) failure(failures, 'missing-browser-evidence', 'A console log artifact is required.', 'browser.logs');
  if (!evidence.logs.some((item) => /network/i.test(item.path))) failure(failures, 'missing-browser-evidence', 'A network log artifact is required.', 'browser.logs');
  if (!evidence.screenshots.length) failure(failures, 'missing-browser-evidence', 'At least one browser screenshot is required.', 'browser.screenshots');
  if (!evidence.videos.length) failure(failures, 'missing-browser-evidence', 'At least one browser video is required.', 'browser.videos');
  if (!evidence.traces.length) failure(failures, 'missing-browser-evidence', 'At least one browser trace is required.', 'browser.traces');
  if (!evidence.browserMetrics.length) failure(failures, 'missing-browser-evidence', 'A Playwright-attached browser duration-samples JSON file is required.', 'browser.metricsJson');
  if (!evidence.browserGate) failure(failures, 'missing-browser-evidence', 'The Playwright-attached Gate B browser receipt is required.', 'browser.gateReceipt');
};

const productionShapeFailures = (shape, failures) => {
  for (const [key, expected] of Object.entries(REQUIRED_PRODUCTION_SHAPE)) {
    if (shape?.[key] !== expected) failure(failures, 'not-production-shaped', `productionShape.${key} must be ${JSON.stringify(expected)}.`, `productionShape.${key}`);
  }
};

const normalizeArtifact = async (artifact, baseDirectory, failures) => {
  if (!artifact?.version || typeof artifact.version !== 'string') failure(failures, 'missing-artifact-metadata', 'artifact.version is required.', 'artifact.version');
  const referenced = await referenceFile(artifact?.path, baseDirectory, failures, 'artifact.path');
  if (!referenced) return { version: artifact?.version || null, path: displayEvidencePath(artifact?.path), sha256: null, bytes: null };
  if (artifact.sha256 && artifact.sha256 !== referenced.sha256) failure(failures, 'artifact-checksum-mismatch', 'The declared extension artifact checksum does not match the file.', referenced.path);
  if (artifact.bytes !== undefined && Number(artifact.bytes) !== referenced.bytes) failure(failures, 'artifact-size-mismatch', 'The declared extension artifact byte size does not match the file.', referenced.path);
  return { version: artifact.version, ...referenced };
};

const readJsonFile = async (value, baseDirectory) => JSON.parse(await readFile(resolveEvidencePath(value, baseDirectory), 'utf8'));

const checkExplicitAttemptParity = (reported, explicit, failures) => {
  if (!explicit.length) return;
  const signature = (item) => `${item.testId}\u0000${item.attempt}\u0000${item.status}`;
  const reportSignatures = new Set(reported.map(signature));
  const explicitSignatures = new Set(explicit.map(signature));
  if (reportSignatures.size !== explicitSignatures.size || [...reportSignatures].some((item) => !explicitSignatures.has(item))) {
    failure(failures, 'attempt-report-mismatch', 'Explicit attempts do not match the Playwright JSON report; retries cannot be replaced or hidden.', 'browser.attempts');
  }
};

export const generateReleaseReceipt = async (input, { authoritative = true, baseDirectory = process.cwd(), now = () => new Date() } = {}) => {
  if (!isRecord(input)) throw new TypeError('Release evidence manifest must be a JSON object.');
  const failures = [];
  const startedAt = isoTime(input.startedAt, 'startedAt', failures);
  const completedAt = isoTime(input.completedAt, 'completedAt', failures);
  if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) failure(failures, 'invalid-time-range', 'completedAt must not precede startedAt.', 'completedAt');

  const gitSha = String(input.gitSha || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(gitSha)) failure(failures, 'invalid-git-sha', 'gitSha must be the full 40-character commit SHA.', 'gitSha');
  const environment = String(input.environment || '').trim().toLowerCase();
  if (!environment) failure(failures, 'missing-environment', 'environment is required.', 'environment');
  if (authoritative && !['staging', 'production'].includes(environment)) failure(failures, 'non-release-environment', 'Authoritative receipts require environment=staging or production. Use --non-authoritative for local or CI-only evidence.', 'environment');

  let origin = null;
  try {
    const parsed = new URL(input.origin || '');
    if (authoritative && parsed.protocol !== 'https:') throw new Error('authoritative origins must use HTTPS');
    if (parsed.username || parsed.password) throw new Error('credentials are not permitted');
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    origin = parsed.origin;
  } catch (error) {
    failure(failures, 'invalid-origin', `origin must be a valid${authoritative ? ' HTTPS' : ''} release origin: ${error.message}.`, 'origin');
  }

  productionShapeFailures(input.productionShape, failures);
  const artifact = await normalizeArtifact(input.artifact, baseDirectory, failures);

  const browserInput = isRecord(input.browser) ? input.browser : {};
  if (browserInput.engine !== 'chromium') failure(failures, 'invalid-browser-engine', 'browser.engine must be chromium for the Chrome extension release gate.', 'browser.engine');
  const playwrightReference = await referenceFile(browserInput.playwrightJson, baseDirectory, failures, 'browser.playwrightJson');
  const junitReference = await referenceFile(browserInput.junit, baseDirectory, failures, 'browser.junit');
  let parsedPlaywright = { attempts: [], attachments: { screenshots: [], videos: [], traces: [], logs: [], metrics: [], gateReceipts: [] }, topLevelErrors: 0 };
  let junitSummary = { tests: 0, passed: 0, failed: 0, skipped: 0, cases: [] };
  if (playwrightReference) {
    try { parsedPlaywright = parsePlaywrightReport(await readJsonFile(browserInput.playwrightJson, baseDirectory)); }
    catch (error) { failure(failures, 'invalid-playwright-report', error.message, playwrightReference.path); }
  }
  if (junitReference) {
    try { junitSummary = parseJunit(await readFile(resolveEvidencePath(browserInput.junit, baseDirectory), 'utf8')); }
    catch (error) { failure(failures, 'invalid-junit-report', error.message, junitReference.path); }
  }

  const productionEvidenceInput = isRecord(input.productionEvidence) ? input.productionEvidence : {};
  const integrationJunitReference = await referenceFile(productionEvidenceInput.integrationJunit, baseDirectory, failures, 'productionEvidence.integrationJunit');
  const mediaWorkerReference = await referenceFile(productionEvidenceInput.mediaWorkerJson, baseDirectory, failures, 'productionEvidence.mediaWorkerJson');
  let productionJunitSummary = { tests: 0, passed: 0, failed: 0, skipped: 0, cases: [] };
  let mediaWorkerProof = { errors: [], measurements: {}, retryPolicy: {}, s3RetryPolicy: {}, evidence: {} };
  let mediaWorkerDocument = null;
  if (integrationJunitReference) {
    try {
      productionJunitSummary = parseJunit(await readFile(resolveEvidencePath(productionEvidenceInput.integrationJunit, baseDirectory), 'utf8'));
      if (productionJunitSummary.failed || productionJunitSummary.skipped) failure(failures, 'production-integration-failure', `Production integration JUnit has ${productionJunitSummary.failed} failure(s) and ${productionJunitSummary.skipped} skip(s).`, integrationJunitReference.path);
      const caseNames = productionJunitSummary.cases.map((item) => item.id).join(' ');
      if (!/postgres(?:ql)?/iu.test(caseNames) || !/(?:\bs3\b|object[ -]?stor)/iu.test(caseNames)) failure(failures, 'incomplete-production-integration', 'Production integration JUnit must identify real PostgreSQL and S3/object-storage coverage.', integrationJunitReference.path);
    } catch (error) { failure(failures, 'invalid-production-junit', error.message, integrationJunitReference.path); }
  }
  if (mediaWorkerReference) {
    try {
      mediaWorkerDocument = await readJsonFile(productionEvidenceInput.mediaWorkerJson, baseDirectory);
      mediaWorkerProof = parseMediaWorkerProof(mediaWorkerDocument, { gitSha, environment });
      for (const error of mediaWorkerProof.errors) failure(failures, 'invalid-media-worker-proof', error.message, `${mediaWorkerReference.path}#${error.path}`);
    } catch (error) { failure(failures, 'invalid-media-worker-proof', error.message, mediaWorkerReference.path); }
  }
  if (mediaWorkerDocument?.evidence?.junit && integrationJunitReference
    && evidencePathKey(mediaWorkerDocument.evidence.junit, baseDirectory) !== evidencePathKey(productionEvidenceInput.integrationJunit, baseDirectory)) {
    failure(failures, 'production-evidence-mismatch', 'The production JUnit path does not match the media-worker proof record.', integrationJunitReference.path);
  }
  const reportedWorkerLog = mediaWorkerDocument?.evidence?.log;
  const configuredWorkerLog = productionEvidenceInput.mediaWorkerLog || reportedWorkerLog;
  if (productionEvidenceInput.mediaWorkerLog && reportedWorkerLog
    && evidencePathKey(productionEvidenceInput.mediaWorkerLog, baseDirectory) !== evidencePathKey(reportedWorkerLog, baseDirectory)) {
    failure(failures, 'production-evidence-mismatch', 'The configured media worker log does not match the proof record.', displayEvidencePath(productionEvidenceInput.mediaWorkerLog));
  }
  const mediaWorkerLogReference = await referenceFile(configuredWorkerLog, baseDirectory, failures, 'productionEvidence.mediaWorkerLog');

  const metricAttachments = uniquePathValues(parsedPlaywright.attachments.metrics);
  const explicitMetrics = uniquePathValues(asArray(browserInput.metricsJson));
  if (explicitMetrics.length) {
    const attached = new Set(metricAttachments.map((item) => evidencePathKey(item, baseDirectory)).filter(Boolean));
    for (const metric of explicitMetrics) {
      if (!attached.has(evidencePathKey(metric, baseDirectory))) failure(failures, 'unbound-browser-metrics', 'browser.metricsJson must also be an attachment in the Playwright JSON report.', displayEvidencePath(metric));
    }
  }
  const selectedMetrics = explicitMetrics.length ? explicitMetrics : metricAttachments;
  const browserMetricReferences = await referenceFiles(selectedMetrics, baseDirectory, failures, 'browser.metricsJson');
  const browserMeasurements = {};
  for (const metric of selectedMetrics) {
    try {
      const document = await readJsonFile(metric, baseDirectory);
      const measurements = isRecord(document?.measurements) ? document.measurements : document;
      if (!isRecord(measurements)) throw new Error('duration samples must be a JSON object');
      for (const [name, samples] of Object.entries(measurements)) {
        if (!Array.isArray(samples)) continue;
        browserMeasurements[name] ||= [];
        browserMeasurements[name].push(...samples);
      }
    } catch (error) { failure(failures, 'invalid-browser-metrics', error.message, displayEvidencePath(metric)); }
  }

  const explicitAttempts = normalizeExplicitAttempts(browserInput.attempts, failures);
  checkExplicitAttemptParity(parsedPlaywright.attempts, explicitAttempts, failures);
  const attempts = explicitAttempts.length ? explicitAttempts : parsedPlaywright.attempts;
  const testSummary = summarizeAttempts(attempts);
  if (!testSummary.tests) failure(failures, 'missing-browser-tests', 'The release run contains no browser integration tests.', 'browser.playwrightJson');
  if (testSummary.failed) failure(failures, 'browser-test-failure', `${testSummary.failed} browser test(s) did not pass.`, 'browser.playwrightJson');
  if (testSummary.skipped) failure(failures, 'browser-test-skipped', `${testSummary.skipped} browser test(s) were skipped; release integration evidence must be complete.`, 'browser.playwrightJson');
  if (testSummary.retries || testSummary.flaky) failure(failures, 'browser-test-flake', `${testSummary.retries} retry attempt(s) and ${testSummary.flaky} flaky test(s) were observed; a retry cannot silently become green.`, 'browser.playwrightJson');
  if (parsedPlaywright.topLevelErrors) failure(failures, 'playwright-run-error', `Playwright reported ${parsedPlaywright.topLevelErrors} top-level error(s).`, 'browser.playwrightJson');
  if (junitSummary.failed) failure(failures, 'junit-test-failure', `JUnit reported ${junitSummary.failed} failed test(s).`, 'browser.junit');
  if (junitSummary.skipped) failure(failures, 'junit-test-skipped', `JUnit reported ${junitSummary.skipped} skipped test(s).`, 'browser.junit');
  if (junitSummary.tests && testSummary.tests && junitSummary.tests !== testSummary.tests) failure(failures, 'browser-report-mismatch', `JUnit reports ${junitSummary.tests} tests but Playwright JSON reports ${testSummary.tests}.`, 'browser.junit');

  const attachmentPaths = parsedPlaywright.attachments;
  const gateReceiptPaths = uniquePathValues(attachmentPaths.gateReceipts);
  if (gateReceiptPaths.length !== 1) failure(failures, 'browser-gate-receipt-count', `Exactly one Playwright-attached Gate B browser receipt is required; found ${gateReceiptPaths.length}.`, 'browser.gateReceipt');
  const browserGateReference = gateReceiptPaths.length === 1
    ? await referenceFile(gateReceiptPaths[0], baseDirectory, failures, 'browser.gateReceipt')
    : null;
  let gateCapabilityIds = [];
  if (browserGateReference) {
    try {
      const gate = await readJsonFile(gateReceiptPaths[0], baseDirectory);
      if (gate.schemaVersion !== 1 || gate.gate !== 'gate-b-packaged-extension-browser') throw new Error('Gate receipt schema or kind is invalid.');
      if (gate.release?.version !== artifact.version || gate.release?.sha256 !== artifact.sha256) throw new Error('Gate receipt does not match the extension artifact.');
      if (gate.extension?.manifestVersion !== 3) throw new Error('Gate receipt does not prove a Manifest V3 extension.');
      if (!/^[a-p]{32}$/u.test(gate.extension?.expectedId || '') || gate.extension?.id !== gate.extension.expectedId) throw new Error('Gate receipt runtime extension identity does not match the committed Store identity.');
      if (gate.nativeHost?.openedEvent?.path !== 'sidepanel.html' || gate.nativeHost?.options?.path !== 'sidepanel.html') throw new Error('Gate receipt does not prove the packaged side-panel path opened.');
      if (gate.metrics?.['extension.package.checksum_verified'] !== 1 || gate.metrics?.['extension.identity.expected_id_verified'] !== 1 || gate.metrics?.['extension.side_panel.native_opened'] !== 1) throw new Error('Gate receipt does not contain the checksum, extension-identity, and native-host proof metrics.');
      if (gate.automation?.narrowLayout?.horizontalOverflowPixels !== 0 || gate.metrics?.['extension.side_panel.narrow_layout_no_overflow'] !== 1) throw new Error('Gate receipt does not contain the narrow side-panel layout proof.');
      if (gate.sourceResolution?.fixture !== 'controlled-loopback' || gate.sourceResolution?.verifiesRemoteProviderFetch !== false || gate.sourceResolution?.ssrfBoundaryObserved !== true || gate.metrics?.['extension.source_resolution.controlled_ssrf_fallback'] !== 1) throw new Error('Gate receipt does not preserve controlled source-resolution fallback truth.');
      gateCapabilityIds = Array.isArray(gate.capabilities?.browserVerified)
        ? [...new Set(gate.capabilities.browserVerified.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
        : [];
      if (!gateCapabilityIds.length) throw new Error('Gate receipt contains no browser-verified capability IDs.');
      const explicitlyUnverified = new Set(Array.isArray(gate.capabilities?.explicitlyNotProviderVerified) ? gate.capabilities.explicitlyNotProviderVerified : []);
      if (gateCapabilityIds.some((id) => explicitlyUnverified.has(id))) throw new Error('Gate receipt marks one capability as both verified and explicitly unverified.');
    } catch (error) {
      failure(failures, 'invalid-browser-gate-receipt', error.message, browserGateReference.path);
      gateCapabilityIds = [];
    }
  }
  const evidence = {
    playwright: playwrightReference,
    junit: junitReference,
    browserGate: browserGateReference,
    logs: await referenceFiles([...asArray(browserInput.logs), ...attachmentPaths.logs], baseDirectory, failures, 'browser.logs', { allowEmpty: true }),
    screenshots: await referenceFiles([...asArray(browserInput.screenshots), ...attachmentPaths.screenshots], baseDirectory, failures, 'browser.screenshots'),
    videos: await referenceFiles([...asArray(browserInput.videos), ...attachmentPaths.videos], baseDirectory, failures, 'browser.videos'),
    traces: await referenceFiles([...asArray(browserInput.traces), ...attachmentPaths.traces], baseDirectory, failures, 'browser.traces'),
    browserMetrics: browserMetricReferences,
    productionIntegration: {
      junit: integrationJunitReference,
      summary: {
        tests: productionJunitSummary.tests,
        passed: productionJunitSummary.passed,
        failed: productionJunitSummary.failed,
        skipped: productionJunitSummary.skipped,
      },
    },
    mediaWorker: {
      report: mediaWorkerReference,
      log: mediaWorkerLogReference,
      summary: {
        apiQueueObserved: Boolean(mediaWorkerReference) && mediaWorkerProof.errors.length === 0 && mediaWorkerProof.apiQueue?.observedBeforeWorkerStart === true,
        pickupObserved: Boolean(mediaWorkerReference) && mediaWorkerProof.errors.length === 0,
        recoveryObserved: Boolean(mediaWorkerReference) && mediaWorkerProof.errors.length === 0,
        audioPlaybackReady: Boolean(mediaWorkerReference) && mediaWorkerProof.errors.length === 0,
        videoPlaybackReady: Boolean(mediaWorkerReference) && mediaWorkerProof.errors.length === 0,
        maxAttempts: mediaWorkerProof.retryPolicy.maxAttempts ?? null,
        retriesAllowed: mediaWorkerProof.retryPolicy.retriesAllowed ?? null,
        observedRetries: mediaWorkerProof.retryPolicy.observedRetries ?? null,
        allJobsFirstAttempt: mediaWorkerProof.retryPolicy.allJobsFirstAttempt ?? null,
        s3MaxAttempts: mediaWorkerProof.s3RetryPolicy.maxAttempts ?? null,
        s3RetriesAllowed: mediaWorkerProof.s3RetryPolicy.retriesAllowed ?? null,
        s3RunnerClientMaxAttempts: mediaWorkerProof.s3RetryPolicy.runnerClientMaxAttempts ?? null,
        s3WorkerClientMaxAttempts: mediaWorkerProof.s3RetryPolicy.workerClientMaxAttempts ?? null,
      },
    },
  };
  ensureEvidenceKinds(evidence, failures);

  // Worker pickup, lease recovery, and playback timings come from the hashed
  // production proof, never from caller-asserted manifest booleans.
  const measuredInput = {
    ...input,
    measurements: {
      panel_first_usable_ms: browserMeasurements.panel_first_usable_ms,
      source_resolution_ms: browserMeasurements.source_resolution_ms,
      publish_acknowledgement_ms: browserMeasurements.publish_acknowledgement_ms,
      ...mediaWorkerProof.measurements,
    },
  };
  const performance = evaluateReleaseBudgets(measuredInput, failures);
  const declaredCapabilityIds = Array.isArray(input.capabilityIds) ? [...new Set(input.capabilityIds.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))] : [];
  if (!declaredCapabilityIds.length) failure(failures, 'missing-capability-ids', 'At least one capabilityId is required so the receipt can be used as capability evidence.', 'capabilityIds');
  if (gateCapabilityIds.length && JSON.stringify([...declaredCapabilityIds].sort()) !== JSON.stringify([...gateCapabilityIds].sort())) {
    failure(failures, 'capability-gate-mismatch', 'capabilityIds must exactly match the hashed Gate B browser receipt.', 'capabilityIds');
  }
  const capabilityIds = gateCapabilityIds.length ? gateCapabilityIds : declaredCapabilityIds;

  const hasGateFailure = failures.length > 0;
  const status = authoritative ? (hasGateFailure ? 'failed' : 'passed') : 'non-authoritative';
  const generatedAt = now().toISOString();
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    authoritative,
    status,
    generatedAt,
    gitSha,
    environment,
    origin,
    startedAt,
    completedAt,
    durationMs: startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null,
    artifact,
    productionShape: { ...(isRecord(input.productionShape) ? input.productionShape : {}) },
    browser: {
      runner: 'playwright',
      engine: String(browserInput.engine || ''),
      testSummary: {
        tests: testSummary.tests,
        passed: testSummary.passed,
        failed: testSummary.failed,
        skipped: testSummary.skipped,
        attempts: testSummary.attempts,
        retries: testSummary.retries,
        flaky: testSummary.flaky,
      },
      reliabilityStatus: testSummary.failed || testSummary.skipped || testSummary.retries || testSummary.flaky ? 'failed' : 'passed',
      junitSummary: { tests: junitSummary.tests, passed: junitSummary.passed, failed: junitSummary.failed, skipped: junitSummary.skipped },
    },
    performance,
    evidence,
    capabilityEvidence: {
      status: status === 'passed' ? 'verified' : status,
      verifiedAt: completedAt,
      gitSha,
      artifactSha256: artifact.sha256,
      capabilityIds,
    },
    failures,
  };
};

export const parseGeneratorArguments = (argv) => {
  const options = { inputPath: process.env.RELEASE_EVIDENCE_MANIFEST || '', outputPath: process.env.RELEASE_RECEIPT_PATH || DEFAULT_RECEIPT_PATH, baseDirectory: process.cwd(), authoritative: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') options.inputPath = argv[++index] || '';
    else if (argument === '--output') options.outputPath = argv[++index] || '';
    else if (argument === '--base-dir') options.baseDirectory = path.resolve(argv[++index] || '');
    else if (argument === '--non-authoritative') options.authoritative = false;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.inputPath) throw new Error('Provide --input <release-evidence.json> or RELEASE_EVIDENCE_MANIFEST.');
  if (!options.help && !options.outputPath) throw new Error('--output must not be empty.');
  return options;
};

const usage = `Usage: node scripts/generate-release-receipt.mjs --input <manifest.json> [options]\n\nOptions:\n  --output <path>          Receipt output (default: ${DEFAULT_RECEIPT_PATH})\n  --base-dir <path>        Base for evidence paths (default: current directory)\n  --non-authoritative      Permit local/non-release evidence; never emits passed\n`;

const main = async () => {
  let options;
  try { options = parseGeneratorArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error(usage); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  let input;
  try { input = JSON.parse(await readFile(path.resolve(options.inputPath), 'utf8')); }
  catch (error) { console.error(`Could not read release evidence manifest: ${error.message}`); process.exitCode = 2; return; }
  const receipt = await generateReleaseReceipt(input, { authoritative: options.authoritative, baseDirectory: options.baseDirectory });
  const outputPath = path.resolve(options.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: receipt.status, authoritative: receipt.authoritative, receipt: asPosix(options.outputPath), gitSha: receipt.gitSha, artifactSha256: receipt.artifact.sha256, tests: receipt.browser.testSummary, performance: receipt.performance.status, failures: receipt.failures }, null, 2));
  if (receipt.failures.length) process.exitCode = 1;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
