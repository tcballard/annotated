#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asPosix = (value) => String(value).split(path.sep).join('/');

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    ? asPosix(relative)
    : null;
};

const attachmentRecords = (report) => {
  const attachments = [];
  const walk = (suites) => {
    for (const suite of Array.isArray(suites) ? suites : []) {
      for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
          for (const result of Array.isArray(test.results) ? test.results : []) {
            attachments.push(...(Array.isArray(result.attachments) ? result.attachments : []));
          }
        }
      }
      walk(suite.suites);
    }
  };
  walk(report?.suites);
  return attachments;
};

const requiredTime = (value, label) => {
  const milliseconds = Date.parse(value || '');
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 timestamp.`);
  return milliseconds;
};

const browserWindow = (report) => {
  const started = requiredTime(report?.stats?.startTime, 'Playwright stats.startTime');
  const duration = Number(report?.stats?.duration);
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Playwright stats.duration must be a non-negative number.');
  return { started, completed: started + duration };
};

const readGateReceipt = async (report, root) => {
  const matches = attachmentRecords(report).filter((item) => item?.name === 'gate-b-browser-receipt');
  if (matches.length !== 1) throw new Error(`Exactly one gate-b-browser-receipt attachment is required; found ${matches.length}.`);
  const attachment = matches[0];
  if (!attachment.path) throw new Error('gate-b-browser-receipt must be attached by path so the release manifest can bind it.');
  const absolutePath = path.resolve(root, attachment.path);
  if (!inside(root, absolutePath)) throw new Error('gate-b-browser-receipt must remain inside the repository evidence directory.');
  return readJson(absolutePath);
};

export const composeReleaseEvidence = async ({
  root = projectRoot,
  releasePath = 'dist/release/release.json',
  playwrightPath = 'artifacts/e2e/playwright-report.json',
  junitPath = 'artifacts/e2e/playwright-junit.xml',
  productionProofPath = 'artifacts/production/media-worker.json',
  environment,
  origin,
} = {}) => {
  const absoluteRoot = path.resolve(root);
  const absoluteReleasePath = path.resolve(absoluteRoot, releasePath);
  const absolutePlaywrightPath = path.resolve(absoluteRoot, playwrightPath);
  const absoluteJunitPath = path.resolve(absoluteRoot, junitPath);
  const absoluteProofPath = path.resolve(absoluteRoot, productionProofPath);
  for (const [label, candidate] of [
    ['release manifest', absoluteReleasePath],
    ['Playwright report', absolutePlaywrightPath],
    ['Playwright JUnit', absoluteJunitPath],
    ['production proof', absoluteProofPath],
  ]) if (!inside(absoluteRoot, candidate)) throw new Error(`${label} must remain inside the repository.`);

  const [release, report, proof, capabilities] = await Promise.all([
    readJson(absoluteReleasePath),
    readJson(absolutePlaywrightPath),
    readJson(absoluteProofPath),
    readJson(path.join(absoluteRoot, 'config/capabilities.json')),
  ]);
  await readFile(absoluteJunitPath);

  if (!/^[0-9a-f]{40}$/u.test(release.gitSha || '')) throw new Error('release.json must contain the full release Git SHA.');
  if (!['staging', 'production'].includes(environment)) throw new Error('environment must equal staging or production.');
  const parsedOrigin = new URL(origin || '');
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password) throw new Error('origin must be a credential-free HTTPS origin.');
  if (parsedOrigin.origin !== capabilities.canonicalOrigin) throw new Error('origin must match config/capabilities.json canonicalOrigin.');
  if (proof.status !== 'passed' || proof.kind !== 'annotated.media-worker-integration') throw new Error('Production media-worker evidence must be a passing integration proof.');
  if (proof.gitSha !== release.gitSha || proof.environment !== environment) throw new Error('Production evidence must match the release Git SHA and environment.');

  const distRoot = path.dirname(path.dirname(absoluteReleasePath));
  const artifactPath = path.resolve(distRoot, String(release.artifactPath || '').replace(/^\/+/, ''));
  const artifactRelativePath = inside(absoluteRoot, artifactPath);
  if (!artifactRelativePath) throw new Error('The release artifact path must remain inside the repository.');
  const gate = await readGateReceipt(report, absoluteRoot);
  if (gate.schemaVersion !== 1 || gate.gate !== 'gate-b-packaged-extension-browser') throw new Error('The browser attachment is not a Gate B receipt.');
  if (gate.release?.version !== release.version || gate.release?.sha256 !== release.sha256) throw new Error('The browser gate receipt does not match the checksummed extension release.');
  if (gate.nativeHost?.openedEvent?.path !== 'sidepanel.html' || gate.metrics?.['extension.side_panel.native_opened'] !== 1) throw new Error('The browser gate receipt does not prove the native side-panel host opened.');

  const capabilityIds = [...new Set(gate.capabilities?.browserVerified || [])];
  const knownCapabilities = new Set((capabilities.capabilities || []).map((item) => item.id));
  if (!capabilityIds.length || capabilityIds.some((id) => !knownCapabilities.has(id))) throw new Error('The browser gate receipt contains no valid capability IDs.');

  const browser = browserWindow(report);
  const productionStarted = requiredTime(proof.startedAt, 'Production proof startedAt');
  const productionCompleted = requiredTime(proof.completedAt, 'Production proof completedAt');
  const startedAt = new Date(Math.min(browser.started, productionStarted)).toISOString();
  const completedAt = new Date(Math.max(browser.completed, productionCompleted)).toISOString();

  return {
    gitSha: release.gitSha,
    environment,
    origin: parsedOrigin.origin,
    startedAt,
    completedAt,
    artifact: {
      version: release.version,
      path: artifactRelativePath,
      sha256: release.sha256,
      bytes: release.bytes,
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
      playwrightJson: inside(absoluteRoot, absolutePlaywrightPath),
      junit: inside(absoluteRoot, absoluteJunitPath),
    },
    productionEvidence: {
      integrationJunit: proof.evidence?.junit,
      mediaWorkerJson: inside(absoluteRoot, absoluteProofPath),
      mediaWorkerLog: proof.evidence?.log,
    },
    capabilityIds,
  };
};

export const parseComposeArguments = (argv) => {
  const options = {
    output: 'artifacts/release/evidence-manifest.json',
    releasePath: 'dist/release/release.json',
    playwrightPath: 'artifacts/e2e/playwright-report.json',
    junitPath: 'artifacts/e2e/playwright-junit.xml',
    productionProofPath: 'artifacts/production/media-worker.json',
    environment: process.env.RELEASE_ENVIRONMENT || '',
    origin: process.env.RELEASE_ORIGIN || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') options.output = argv[++index] || '';
    else if (argument === '--release') options.releasePath = argv[++index] || '';
    else if (argument === '--playwright') options.playwrightPath = argv[++index] || '';
    else if (argument === '--junit') options.junitPath = argv[++index] || '';
    else if (argument === '--production-proof') options.productionProofPath = argv[++index] || '';
    else if (argument === '--environment') options.environment = argv[++index] || '';
    else if (argument === '--origin') options.origin = argv[++index] || '';
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const key of ['output', 'releasePath', 'playwrightPath', 'junitPath', 'productionProofPath']) {
    if (!options.help && !options[key]) throw new Error(`${key} must not be empty.`);
  }
  return options;
};

const usage = 'Usage: node scripts/compose-release-evidence.mjs [--output <path>] [--release <path>] [--playwright <path>] [--junit <path>] [--production-proof <path>] [--environment staging|production] [--origin <https-origin>]';

const main = async () => {
  try {
    const options = parseComposeArguments(process.argv.slice(2));
    if (options.help) { console.log(usage); return; }
    const outputPath = path.resolve(projectRoot, options.output);
    if (!inside(projectRoot, outputPath)) throw new Error('Output must remain inside the repository.');
    const manifest = await composeReleaseEvidence({ ...options, root: projectRoot });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ status: 'ready', output: inside(projectRoot, outputPath), gitSha: manifest.gitSha, capabilityIds: manifest.capabilityIds }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exitCode = 1;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
