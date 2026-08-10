#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RECEIPT_PATH,
  RECEIPT_KIND,
  RECEIPT_SCHEMA_VERSION,
  RELEASE_BUDGETS,
  parseJunit,
  parseMediaWorkerProof,
  parsePlaywrightReport,
  percentile,
  summarizeAttempts,
} from './generate-release-receipt.mjs';

const REQUIRED_PRODUCTION_SHAPE = Object.freeze({
  browserExtension: true,
  runtimeMode: 'production',
  persistence: 'postgres',
  objectStorage: 's3',
  mediaWorker: 'standalone',
  realMediaTranscode: true,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value) => Number(Number(value).toFixed(3));

const add = (errors, code, message, evidencePath) => errors.push({ code, message, ...(evidencePath ? { path: evidencePath } : {}) });

const validateReference = (reference, errors, evidencePath, { allowEmpty = false } = {}) => {
  if (!isRecord(reference)) { add(errors, 'missing-reference', `${evidencePath} must be an evidence reference.`, evidencePath); return; }
  if (typeof reference.path !== 'string' || !reference.path) add(errors, 'invalid-reference', `${evidencePath}.path is required.`, `${evidencePath}.path`);
  else if (reference.path.includes('\\') || path.isAbsolute(reference.path) || path.win32.isAbsolute(reference.path) || reference.path.split('/').includes('..') || path.posix.normalize(reference.path) !== reference.path || reference.path.startsWith('./')) add(errors, 'invalid-reference', `${evidencePath}.path must be a canonical relative POSIX path inside the evidence base.`, `${evidencePath}.path`);
  if (!/^[0-9a-f]{64}$/u.test(reference.sha256 || '')) add(errors, 'invalid-reference', `${evidencePath}.sha256 must be a SHA-256 digest.`, `${evidencePath}.sha256`);
  if (!Number.isInteger(reference.bytes) || reference.bytes < (allowEmpty ? 0 : 1)) add(errors, 'invalid-reference', `${evidencePath}.bytes must be ${allowEmpty ? 'a non-negative' : 'a positive'} integer.`, `${evidencePath}.bytes`);
};

export const validateReleaseReceipt = (receipt, { allowNonAuthoritative = false } = {}) => {
  const errors = [];
  if (!isRecord(receipt)) return [{ code: 'invalid-receipt', message: 'Release receipt must be a JSON object.' }];
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) add(errors, 'schema-version', `schemaVersion must be ${RECEIPT_SCHEMA_VERSION}.`, 'schemaVersion');
  if (receipt.kind !== RECEIPT_KIND) add(errors, 'receipt-kind', `kind must be ${RECEIPT_KIND}.`, 'kind');
  if (receipt.authoritative !== true && receipt.authoritative !== false) add(errors, 'authority', 'authoritative must be a boolean.', 'authoritative');
  if (!receipt.authoritative && !allowNonAuthoritative) add(errors, 'authority', 'A non-authoritative receipt cannot satisfy a release gate.', 'authoritative');
  const expectedStatus = receipt.authoritative ? 'passed' : 'non-authoritative';
  if (receipt.status !== expectedStatus) add(errors, 'receipt-status', `A ${receipt.authoritative ? 'release' : 'non-authoritative'} receipt must have status=${expectedStatus}.`, 'status');
  if (!/^[0-9a-f]{40}$/u.test(receipt.gitSha || '')) add(errors, 'git-sha', 'gitSha must be a full 40-character commit SHA.', 'gitSha');
  if (receipt.authoritative && !['staging', 'production'].includes(receipt.environment)) add(errors, 'environment', 'Authoritative receipts require staging or production evidence.', 'environment');
  if (typeof receipt.environment !== 'string' || !receipt.environment) add(errors, 'environment', 'environment is required.', 'environment');

  for (const key of ['generatedAt', 'startedAt', 'completedAt']) {
    if (!Number.isFinite(Date.parse(receipt[key] || ''))) add(errors, 'time', `${key} must be an ISO-8601 timestamp.`, key);
  }
  if (Number.isFinite(Date.parse(receipt.startedAt || '')) && Number.isFinite(Date.parse(receipt.completedAt || '')) && Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) add(errors, 'time', 'completedAt must not precede startedAt.', 'completedAt');
  if (!Number.isFinite(receipt.durationMs) || receipt.durationMs < 0) add(errors, 'time', 'durationMs must be a non-negative number.', 'durationMs');
  try {
    const origin = new URL(receipt.origin || '');
    if (receipt.authoritative && origin.protocol !== 'https:') throw new Error('must use HTTPS');
    if (origin.username || origin.password) throw new Error('must not include credentials');
  } catch (error) { add(errors, 'origin', `origin is invalid: ${error.message}.`, 'origin'); }

  for (const [key, expected] of Object.entries(REQUIRED_PRODUCTION_SHAPE)) {
    if (receipt.productionShape?.[key] !== expected) add(errors, 'production-shape', `productionShape.${key} must be ${JSON.stringify(expected)}.`, `productionShape.${key}`);
  }

  if (!isRecord(receipt.artifact)) add(errors, 'artifact', 'artifact metadata is required.', 'artifact');
  else {
    if (typeof receipt.artifact.version !== 'string' || !receipt.artifact.version) add(errors, 'artifact', 'artifact.version is required.', 'artifact.version');
    validateReference(receipt.artifact, errors, 'artifact');
  }

  const summary = receipt.browser?.testSummary;
  if (receipt.browser?.runner !== 'playwright') add(errors, 'browser-runner', 'browser.runner must be playwright.', 'browser.runner');
  if (receipt.browser?.engine !== 'chromium') add(errors, 'browser-engine', 'browser.engine must be chromium for the Chrome extension gate.', 'browser.engine');
  if (!isRecord(summary)) add(errors, 'browser-summary', 'browser.testSummary is required.', 'browser.testSummary');
  else {
    if (!Number.isInteger(summary.tests) || summary.tests < 1) add(errors, 'browser-summary', 'At least one browser integration test is required.', 'browser.testSummary.tests');
    if (summary.passed !== summary.tests) add(errors, 'browser-summary', 'Every browser integration test must pass.', 'browser.testSummary.passed');
    for (const key of ['failed', 'skipped', 'retries', 'flaky']) if (summary[key] !== 0) add(errors, key === 'retries' || key === 'flaky' ? 'browser-flake' : 'browser-summary', `browser.testSummary.${key} must be zero.`, `browser.testSummary.${key}`);
    if (!Number.isInteger(summary.attempts) || summary.attempts !== summary.tests) add(errors, 'browser-flake', 'Attempt count must equal test count; retry attempts never count as green.', 'browser.testSummary.attempts');
  }
  if (receipt.browser?.reliabilityStatus !== 'passed') add(errors, 'browser-reliability', 'browser.reliabilityStatus must be passed.', 'browser.reliabilityStatus');
  const junitSummary = receipt.browser?.junitSummary;
  if (!isRecord(junitSummary)) add(errors, 'junit-summary', 'browser.junitSummary is required.', 'browser.junitSummary');
  else if (summary) {
    if (junitSummary.tests !== summary.tests || junitSummary.passed !== summary.passed) add(errors, 'report-mismatch', 'JUnit and Playwright test totals must match.', 'browser.junitSummary');
    if (junitSummary.failed !== 0 || junitSummary.skipped !== 0) add(errors, 'junit-summary', 'JUnit failures and skips must be zero.', 'browser.junitSummary');
  }

  const evidence = receipt.evidence;
  if (!isRecord(evidence)) add(errors, 'evidence', 'evidence references are required.', 'evidence');
  else {
    validateReference(evidence.playwright, errors, 'evidence.playwright');
    validateReference(evidence.junit, errors, 'evidence.junit');
    validateReference(evidence.browserGate, errors, 'evidence.browserGate');
    for (const key of ['logs', 'screenshots', 'videos', 'traces']) {
      if (!Array.isArray(evidence[key])) add(errors, 'evidence', `evidence.${key} must be an array.`, `evidence.${key}`);
      else evidence[key].forEach((reference, index) => validateReference(reference, errors, `evidence.${key}[${index}]`, { allowEmpty: key === 'logs' }));
    }
    if (Array.isArray(evidence.logs) && !evidence.logs.some((item) => /console/i.test(item.path || ''))) add(errors, 'evidence', 'Console log evidence is required.', 'evidence.logs');
    if (Array.isArray(evidence.logs) && !evidence.logs.some((item) => /network/i.test(item.path || ''))) add(errors, 'evidence', 'Network log evidence is required.', 'evidence.logs');
    if (Array.isArray(evidence.screenshots) && evidence.screenshots.length < 1) add(errors, 'evidence', 'At least one screenshot is required.', 'evidence.screenshots');
    if (Array.isArray(evidence.videos) && evidence.videos.length < 1) add(errors, 'evidence', 'At least one video is required.', 'evidence.videos');
    if (Array.isArray(evidence.traces) && evidence.traces.length < 1) add(errors, 'evidence', 'At least one trace is required.', 'evidence.traces');
    if (!Array.isArray(evidence.browserMetrics) || evidence.browserMetrics.length < 1) add(errors, 'evidence', 'At least one browser duration-samples artifact is required.', 'evidence.browserMetrics');
    else evidence.browserMetrics.forEach((reference, index) => validateReference(reference, errors, `evidence.browserMetrics[${index}]`));
    validateReference(evidence.productionIntegration?.junit, errors, 'evidence.productionIntegration.junit');
    const integration = evidence.productionIntegration?.summary;
    if (!isRecord(integration) || !Number.isInteger(integration.tests) || integration.tests < 1 || integration.passed !== integration.tests || integration.failed !== 0 || integration.skipped !== 0) add(errors, 'production-integration', 'Production PostgreSQL/S3 JUnit must have at least one passing test and zero failures/skips.', 'evidence.productionIntegration.summary');
    validateReference(evidence.mediaWorker?.report, errors, 'evidence.mediaWorker.report');
    validateReference(evidence.mediaWorker?.log, errors, 'evidence.mediaWorker.log');
    const worker = evidence.mediaWorker?.summary;
    for (const key of ['pickupObserved', 'recoveryObserved', 'audioPlaybackReady', 'videoPlaybackReady']) {
      if (worker?.[key] !== true) add(errors, 'media-worker-evidence', `evidence.mediaWorker.summary.${key} must be true.`, `evidence.mediaWorker.summary.${key}`);
    }
    if (worker?.maxAttempts !== 1) add(errors, 'media-worker-retry-policy', 'evidence.mediaWorker.summary.maxAttempts must be 1.', 'evidence.mediaWorker.summary.maxAttempts');
    if (worker?.retriesAllowed !== false) add(errors, 'media-worker-retry-policy', 'evidence.mediaWorker.summary.retriesAllowed must be false.', 'evidence.mediaWorker.summary.retriesAllowed');
    if (worker?.observedRetries !== 0) add(errors, 'media-worker-retry-policy', 'evidence.mediaWorker.summary.observedRetries must be 0.', 'evidence.mediaWorker.summary.observedRetries');
    if (worker?.allJobsFirstAttempt !== true) add(errors, 'media-worker-retry-policy', 'evidence.mediaWorker.summary.allJobsFirstAttempt must be true.', 'evidence.mediaWorker.summary.allJobsFirstAttempt');
    if (worker?.s3MaxAttempts !== 1 || worker?.s3RunnerClientMaxAttempts !== 1 || worker?.s3WorkerClientMaxAttempts !== 1) add(errors, 'media-worker-retry-policy', 'Both authoritative S3 clients must use maxAttempts=1.', 'evidence.mediaWorker.summary');
    if (worker?.s3RetriesAllowed !== false) add(errors, 'media-worker-retry-policy', 'S3 SDK retries must be disabled for authoritative evidence.', 'evidence.mediaWorker.summary.s3RetriesAllowed');
  }

  if (receipt.performance?.status !== 'passed' || receipt.performance?.classification !== 'release-gate-observations' || receipt.performance?.productionLatencySlo !== false) add(errors, 'performance-status', 'performance must be a passing release-gate observation and must not claim a production latency SLO.', 'performance');
  const results = Array.isArray(receipt.performance?.results) ? receipt.performance.results : [];
  if (results.length !== RELEASE_BUDGETS.length) add(errors, 'release-budget-results', `Exactly ${RELEASE_BUDGETS.length} release budget results are required.`, 'performance.results');
  for (const definition of RELEASE_BUDGETS) {
    const matches = results.filter((item) => item?.id === definition.id);
    if (matches.length !== 1) { add(errors, 'release-budget-result', `Exactly one ${definition.id} result is required.`, 'performance.results'); continue; }
    const result = matches[0];
    if (result.statistic !== definition.statistic || result.scope !== definition.scope || result.budgetMs !== definition.budgetMs || result.minSamples !== definition.minSamples || result.unit !== 'ms') add(errors, 'release-budget-contract', `${definition.id} changed its fixed release budget, scope, or aggregation.`, `performance.results.${definition.id}`);
    if (!Array.isArray(result.samplesMs) || result.samplesMs.length < definition.minSamples || result.samplesMs.some((sample) => !Number.isFinite(sample) || sample < 0)) add(errors, 'release-budget-samples', `${definition.id} needs valid measurement samples.`, `performance.results.${definition.id}.samplesMs`);
    else {
      const computedMaximum = round(Math.max(...result.samplesMs));
      if (result.sampleCount !== result.samplesMs.length) add(errors, 'release-budget-samples', `${definition.id} sampleCount does not match its samples.`, `performance.results.${definition.id}.sampleCount`);
      if (result.observedMaxMs !== computedMaximum) add(errors, 'release-budget-aggregation', `${definition.id} observed maximum does not match its samples.`, `performance.results.${definition.id}.observedMaxMs`);
      if (computedMaximum > definition.budgetMs) add(errors, 'release-budget-breach', `${definition.id} observed maximum ${computedMaximum}ms exceeds ${definition.budgetMs}ms.`, `performance.results.${definition.id}`);
    }
    if (result.status !== 'passed') add(errors, 'performance-status', `${definition.id} status must be passed.`, `performance.results.${definition.id}.status`);
  }

  if (!Array.isArray(receipt.failures) || receipt.failures.length !== 0) add(errors, 'recorded-failures', 'A passing release receipt must have no recorded failures.', 'failures');
  const capability = receipt.capabilityEvidence;
  const expectedCapabilityStatus = receipt.authoritative ? 'verified' : 'non-authoritative';
  if (!isRecord(capability)) add(errors, 'capability-evidence', 'capabilityEvidence is required.', 'capabilityEvidence');
  else {
    if (capability.status !== expectedCapabilityStatus) add(errors, 'capability-evidence', `capabilityEvidence.status must be ${expectedCapabilityStatus}.`, 'capabilityEvidence.status');
    if (capability.gitSha !== receipt.gitSha) add(errors, 'capability-evidence', 'Capability build SHA does not match the receipt.', 'capabilityEvidence.gitSha');
    if (capability.artifactSha256 !== receipt.artifact?.sha256) add(errors, 'capability-evidence', 'Capability artifact checksum does not match the receipt.', 'capabilityEvidence.artifactSha256');
    if (capability.verifiedAt !== receipt.completedAt) add(errors, 'capability-evidence', 'Capability verification time must match run completion.', 'capabilityEvidence.verifiedAt');
    if (!Array.isArray(capability.capabilityIds) || !capability.capabilityIds.length) add(errors, 'capability-evidence', 'At least one capability ID is required.', 'capabilityEvidence.capabilityIds');
  }
  return errors;
};

const referencedFiles = (receipt) => {
  const files = [];
  if (receipt.artifact) files.push({ reference: receipt.artifact, label: 'artifact' });
  if (receipt.evidence?.playwright) files.push({ reference: receipt.evidence.playwright, label: 'evidence.playwright' });
  if (receipt.evidence?.junit) files.push({ reference: receipt.evidence.junit, label: 'evidence.junit' });
  if (receipt.evidence?.browserGate) files.push({ reference: receipt.evidence.browserGate, label: 'evidence.browserGate' });
  if (receipt.evidence?.productionIntegration?.junit) files.push({ reference: receipt.evidence.productionIntegration.junit, label: 'evidence.productionIntegration.junit' });
  if (receipt.evidence?.mediaWorker?.report) files.push({ reference: receipt.evidence.mediaWorker.report, label: 'evidence.mediaWorker.report' });
  if (receipt.evidence?.mediaWorker?.log) files.push({ reference: receipt.evidence.mediaWorker.log, label: 'evidence.mediaWorker.log' });
  for (const [index, reference] of (receipt.evidence?.browserMetrics || []).entries()) files.push({ reference, label: `evidence.browserMetrics[${index}]` });
  for (const key of ['logs', 'screenshots', 'videos', 'traces']) {
    for (const [index, reference] of (receipt.evidence?.[key] || []).entries()) files.push({ reference, label: `evidence.${key}[${index}]` });
  }
  return files;
};

export const verifyReceiptFiles = async (receipt, { baseDirectory = process.cwd() } = {}) => {
  const errors = [];
  const contents = new Map();
  const absoluteBase = path.resolve(baseDirectory);
  let realBase = absoluteBase;
  try { realBase = await realpath(absoluteBase); }
  catch (error) { add(errors, 'evidence-base-missing', `Evidence base cannot be resolved: ${error.message}.`, absoluteBase); }
  for (const { reference, label } of referencedFiles(receipt)) {
    if (!reference?.path) continue;
    const absolutePath = path.resolve(absoluteBase, reference.path);
    const lexicalRelative = path.relative(absoluteBase, absolutePath);
    if (!lexicalRelative || lexicalRelative.startsWith(`..${path.sep}`) || lexicalRelative === '..' || path.isAbsolute(lexicalRelative)) {
      add(errors, 'evidence-outside-base', `${label} escapes the evidence base.`, reference.path);
      continue;
    }
    try {
      const realFile = await realpath(absolutePath);
      const realRelative = path.relative(realBase, realFile);
      if (!realRelative || realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) throw new Error('path resolves outside the evidence base');
      const details = await stat(absolutePath);
      if (!details.isFile()) throw new Error('not a file');
      const bytes = await readFile(absolutePath);
      contents.set(label, bytes);
      if (bytes.length !== reference.bytes) add(errors, 'evidence-size-mismatch', `${label} byte size changed.`, reference.path);
      if (sha256(bytes) !== reference.sha256) add(errors, 'evidence-checksum-mismatch', `${label} checksum changed.`, reference.path);
    } catch (error) { add(errors, 'evidence-file-missing', `${label} cannot be verified: ${error.message}.`, reference.path); }
  }
  try {
    const report = parsePlaywrightReport(JSON.parse(contents.get('evidence.playwright')?.toString('utf8') || ''));
    const summary = summarizeAttempts(report.attempts);
    for (const key of ['tests', 'passed', 'failed', 'skipped', 'attempts', 'retries', 'flaky']) {
      if (summary[key] !== receipt.browser?.testSummary?.[key]) add(errors, 'playwright-summary-mismatch', `Playwright ${key} no longer matches the receipt.`, 'evidence.playwright');
    }
    if (report.topLevelErrors) add(errors, 'playwright-run-error', `Playwright evidence contains ${report.topLevelErrors} top-level error(s).`, 'evidence.playwright');
  } catch (error) { add(errors, 'invalid-playwright-report', `Playwright evidence cannot be parsed: ${error.message}.`, 'evidence.playwright'); }
  try {
    const junit = parseJunit(contents.get('evidence.junit')?.toString('utf8') || '');
    for (const key of ['tests', 'passed', 'failed', 'skipped']) {
      if (junit[key] !== receipt.browser?.junitSummary?.[key]) add(errors, 'junit-summary-mismatch', `JUnit ${key} no longer matches the receipt.`, 'evidence.junit');
    }
  } catch (error) { add(errors, 'invalid-junit-report', `JUnit evidence cannot be parsed: ${error.message}.`, 'evidence.junit'); }
  try {
    const report = parsePlaywrightReport(JSON.parse(contents.get('evidence.playwright')?.toString('utf8') || ''));
    const gateAttachments = report.attachments.gateReceipts || [];
    if (gateAttachments.length !== 1 || path.resolve(baseDirectory, gateAttachments[0].path) !== path.resolve(baseDirectory, receipt.evidence?.browserGate?.path || '')) {
      add(errors, 'browser-gate-report-mismatch', 'The hashed Gate B receipt must be the one attached to the Playwright report.', 'evidence.browserGate');
    }
    const gate = JSON.parse(contents.get('evidence.browserGate')?.toString('utf8') || '');
    if (gate.schemaVersion !== 1 || gate.gate !== 'gate-b-packaged-extension-browser') throw new Error('schema or kind is invalid');
    if (gate.release?.version !== receipt.artifact?.version || gate.release?.sha256 !== receipt.artifact?.sha256) throw new Error('artifact identity does not match');
    if (gate.extension?.manifestVersion !== 3) throw new Error('Manifest V3 proof is missing');
    if (!/^[a-p]{32}$/u.test(gate.extension?.expectedId || '') || gate.extension?.id !== gate.extension.expectedId) throw new Error('runtime extension identity does not match the committed Store identity');
    if (gate.nativeHost?.openedEvent?.path !== 'sidepanel.html' || gate.nativeHost?.options?.path !== 'sidepanel.html') throw new Error('native side-panel path proof is missing');
    if (gate.metrics?.['extension.package.checksum_verified'] !== 1 || gate.metrics?.['extension.identity.expected_id_verified'] !== 1 || gate.metrics?.['extension.side_panel.native_opened'] !== 1) throw new Error('checksum, extension identity, or native-host metric is missing');
    if (gate.automation?.narrowLayout?.horizontalOverflowPixels !== 0 || gate.metrics?.['extension.side_panel.narrow_layout_no_overflow'] !== 1) throw new Error('narrow side-panel layout proof is missing');
    if (gate.sourceResolution?.fixture !== 'controlled-loopback' || gate.sourceResolution?.verifiesRemoteProviderFetch !== false || gate.sourceResolution?.ssrfBoundaryObserved !== true || gate.metrics?.['extension.source_resolution.controlled_ssrf_fallback'] !== 1) throw new Error('controlled source-resolution fallback truth is missing');
    const gateCapabilityIds = [...new Set(Array.isArray(gate.capabilities?.browserVerified) ? gate.capabilities.browserVerified : [])].sort();
    const receiptCapabilityIds = [...new Set(receipt.capabilityEvidence?.capabilityIds || [])].sort();
    if (JSON.stringify(gateCapabilityIds) !== JSON.stringify(receiptCapabilityIds)) throw new Error('capability IDs do not match');
  } catch (error) { add(errors, 'invalid-browser-gate-receipt', `Gate B browser receipt cannot be verified: ${error.message}.`, 'evidence.browserGate'); }
  try {
    const production = parseJunit(contents.get('evidence.productionIntegration.junit')?.toString('utf8') || '');
    const names = production.cases.map((item) => item.id).join(' ');
    if (production.failed || production.skipped || !/postgres(?:ql)?/iu.test(names) || !/(?:\bs3\b|object[ -]?stor)/iu.test(names)) add(errors, 'production-integration', 'Production JUnit does not prove passing PostgreSQL and S3/object-storage integration.', 'evidence.productionIntegration.junit');
    for (const key of ['tests', 'passed', 'failed', 'skipped']) {
      if (production[key] !== receipt.evidence?.productionIntegration?.summary?.[key]) add(errors, 'production-summary-mismatch', `Production JUnit ${key} no longer matches the receipt.`, 'evidence.productionIntegration.junit');
    }
  } catch (error) { add(errors, 'invalid-production-junit', `Production JUnit cannot be parsed: ${error.message}.`, 'evidence.productionIntegration.junit'); }
  try {
    const document = JSON.parse(contents.get('evidence.mediaWorker.report')?.toString('utf8') || '');
    const proof = parseMediaWorkerProof(document, { gitSha: receipt.gitSha, environment: receipt.environment });
    for (const error of proof.errors) add(errors, 'invalid-media-worker-proof', error.message, `evidence.mediaWorker.report#${error.path}`);
    if (document.evidence?.junit && path.resolve(baseDirectory, document.evidence.junit) !== path.resolve(baseDirectory, receipt.evidence?.productionIntegration?.junit?.path || '')) add(errors, 'production-evidence-mismatch', 'Media worker proof JUnit path does not match the receipt reference.', 'evidence.mediaWorker.report');
    if (document.evidence?.log && path.resolve(baseDirectory, document.evidence.log) !== path.resolve(baseDirectory, receipt.evidence?.mediaWorker?.log?.path || '')) add(errors, 'production-evidence-mismatch', 'Media worker proof log path does not match the receipt reference.', 'evidence.mediaWorker.report');
    const recordedPolicy = receipt.evidence?.mediaWorker?.summary || {};
    const apiQueueObserved = proof.apiQueue?.observedBeforeWorkerStart === true;
    if (recordedPolicy.apiQueueObserved !== apiQueueObserved) add(errors, 'media-worker-api-queue-mismatch', 'API queue observation no longer matches the hashed proof.', 'evidence.mediaWorker.report');
    for (const key of ['maxAttempts', 'retriesAllowed', 'observedRetries', 'allJobsFirstAttempt']) {
      if (recordedPolicy[key] !== proof.retryPolicy[key]) add(errors, 'media-worker-retry-policy-mismatch', `Media worker ${key} no longer matches the hashed proof.`, 'evidence.mediaWorker.report');
    }
    for (const [summaryKey, proofKey] of [['s3MaxAttempts', 'maxAttempts'], ['s3RetriesAllowed', 'retriesAllowed'], ['s3RunnerClientMaxAttempts', 'runnerClientMaxAttempts'], ['s3WorkerClientMaxAttempts', 'workerClientMaxAttempts']]) {
      if (recordedPolicy[summaryKey] !== proof.s3RetryPolicy[proofKey]) add(errors, 'media-worker-retry-policy-mismatch', `Media worker ${summaryKey} no longer matches the hashed proof.`, 'evidence.mediaWorker.report');
    }
    for (const [metric, samples] of Object.entries(proof.measurements)) {
      const receiptSamples = receipt.performance?.results?.find((item) => item.id === metric)?.samplesMs || [];
      if (JSON.stringify(samples.map(round)) !== JSON.stringify(receiptSamples)) add(errors, 'worker-timing-mismatch', `${metric} must come from the hashed media worker proof.`, 'evidence.mediaWorker.report');
    }
  } catch (error) { add(errors, 'invalid-media-worker-proof', `Media worker proof cannot be parsed: ${error.message}.`, 'evidence.mediaWorker.report'); }
  try {
    const measurements = {};
    for (const [index] of (receipt.evidence?.browserMetrics || []).entries()) {
      const document = JSON.parse(contents.get(`evidence.browserMetrics[${index}]`)?.toString('utf8') || '');
      const source = isRecord(document?.measurements) ? document.measurements : document;
      if (!isRecord(source)) throw new Error(`browser metric artifact ${index + 1} is not an object`);
      for (const [name, samples] of Object.entries(source)) {
        if (!Array.isArray(samples)) continue;
        measurements[name] ||= [];
        measurements[name].push(...samples.map(Number));
      }
    }
    for (const metric of ['panel_first_usable_ms', 'source_resolution_ms', 'publish_acknowledgement_ms']) {
      const receiptSamples = receipt.performance?.results?.find((item) => item.id === metric)?.samplesMs || [];
      if (JSON.stringify((measurements[metric] || []).map(round)) !== JSON.stringify(receiptSamples)) add(errors, 'browser-timing-mismatch', `${metric} must come from the hashed Playwright duration-samples attachment.`, 'evidence.browserMetrics');
    }
  } catch (error) { add(errors, 'invalid-browser-metrics', `Browser metrics cannot be parsed: ${error.message}.`, 'evidence.browserMetrics'); }
  return errors;
};

export const parseCheckArguments = (argv) => {
  const options = { receiptPath: process.env.RELEASE_RECEIPT_PATH || DEFAULT_RECEIPT_PATH, baseDirectory: process.cwd(), allowNonAuthoritative: false, verifyFiles: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--receipt') options.receiptPath = argv[++index] || '';
    else if (argument === '--base-dir') options.baseDirectory = path.resolve(argv[++index] || '');
    else if (argument === '--allow-non-authoritative') options.allowNonAuthoritative = true;
    else if (argument === '--metadata-only') options.verifyFiles = false;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.receiptPath) throw new Error('--receipt must not be empty.');
  return options;
};

const usage = `Usage: node scripts/check-release-slo.mjs [options]\n\nOptions:\n  --receipt <path>              Receipt input (default: ${DEFAULT_RECEIPT_PATH})\n  --base-dir <path>             Base for evidence paths (default: current directory)\n  --allow-non-authoritative     Explicitly validate a local/non-release receipt\n  --metadata-only               Do not re-hash referenced files\n`;

const main = async () => {
  let options;
  try { options = parseCheckArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error(usage); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  let receipt;
  try { receipt = JSON.parse(await readFile(path.resolve(options.receiptPath), 'utf8')); }
  catch (error) { console.error(`Could not read release receipt: ${error.message}`); process.exitCode = 2; return; }
  const errors = validateReleaseReceipt(receipt, { allowNonAuthoritative: options.allowNonAuthoritative });
  if (options.verifyFiles) errors.push(...await verifyReceiptFiles(receipt, { baseDirectory: options.baseDirectory }));
  console.log(JSON.stringify({ status: errors.length ? 'failed' : 'passed', receipt: options.receiptPath, authoritative: receipt.authoritative, gitSha: receipt.gitSha, artifactSha256: receipt.artifact?.sha256 || null, performance: receipt.performance?.results?.map(({ id, observedMaxMs, budgetMs, scope, status }) => ({ id, observedMaxMs, budgetMs, scope, status })) || [], errors }, null, 2));
  if (errors.length) process.exitCode = 1;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
