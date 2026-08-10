import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const MAX_EVENTS = 5_000;

const safeUrl = (value) => {
  try {
    const url = new URL(value);
    const queryKeys = [...new Set(url.searchParams.keys())].sort();
    return { url: `${url.origin}${url.pathname}`, queryKeys };
  } catch {
    return { url: String(value || '').slice(0, 500), queryKeys: [] };
  }
};

const redact = (value) => String(value || '')
  .replace(/(authorization|bearer|ticket|token|code|state|secret)([=:]\s*)[^\s&,]+/gi, '$1$2[redacted]')
  .slice(0, 2_000);

const lineBody = (entries) => entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '';
const expectedOfflineConsoleError = (entry) => entry.level === 'error'
  && /(?:net::ERR_CONNECTION_REFUSED|Failed to load resource[^\n]*ERR_CONNECTION_REFUSED)/iu.test(entry.message || '');

export const createEvidenceRecorder = ({ testInfo }) => {
  const consoleErrors = [];
  const network = [];
  const requestStarted = new WeakMap();
  const wiredPages = new WeakSet();
  const wiredWorkers = new WeakSet();
  const durationSamples = {
    panel_first_usable_ms: [],
    source_resolution_ms: [],
    publish_acknowledgement_ms: [],
    playback_readiness_ms: [],
  };

  const push = (target, value) => {
    if (target.length < MAX_EVENTS) target.push({ at: new Date().toISOString(), ...value });
  };
  const wirePage = (page) => {
    if (wiredPages.has(page)) return;
    wiredPages.add(page);
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return;
      push(consoleErrors, { surface: 'page', level: message.type(), page: safeUrl(page.url()).url, message: redact(message.text()) });
    });
    page.on('pageerror', (error) => push(consoleErrors, { surface: 'page', level: 'exception', page: safeUrl(page.url()).url, message: redact(error?.stack || error?.message) }));
  };
  const wireWorker = (worker) => {
    if (wiredWorkers.has(worker)) return;
    wiredWorkers.add(worker);
    worker.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return;
      push(consoleErrors, { surface: 'service-worker', level: message.type(), page: safeUrl(worker.url()).url, message: redact(message.text()) });
    });
  };
  const wireContext = (context) => {
    for (const page of context.pages()) wirePage(page);
    for (const worker of context.serviceWorkers()) wireWorker(worker);
    context.on('page', wirePage);
    context.on('serviceworker', wireWorker);
    context.on('request', (request) => {
      requestStarted.set(request, performance.now());
      const target = safeUrl(request.url());
      push(network, { kind: 'request', method: request.method(), resourceType: request.resourceType(), ...target });
    });
    context.on('response', (response) => {
      const request = response.request();
      const started = requestStarted.get(request);
      const elapsedMs = Number.isFinite(started) ? performance.now() - started : null;
      const target = safeUrl(response.url());
      push(network, { kind: 'response', method: request.method(), status: response.status(), durationMs: elapsedMs === null ? null : Number(elapsedMs.toFixed(1)), ...target });
      if (target.url.endsWith('/api/sources/resolve') && elapsedMs !== null) durationSamples.source_resolution_ms.push(Number(elapsedMs.toFixed(1)));
    });
    context.on('requestfailed', (request) => {
      const target = safeUrl(request.url());
      push(network, { kind: 'requestfailed', method: request.method(), resourceType: request.resourceType(), failure: redact(request.failure()?.errorText), ...target });
    });
  };
  const timer = () => performance.now();
  const duration = (name, started) => {
    if (!durationSamples[name]) throw new Error(`Unknown browser duration metric: ${name}`);
    const value = Number((performance.now() - started).toFixed(1));
    durationSamples[name].push(value);
    return value;
  };
  const attachScreenshot = async (page, name) => {
    const screenshotPath = testInfo.outputPath(name);
    await page.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
    return screenshotPath;
  };
  const writeArtifacts = async () => {
    const consolePath = testInfo.outputPath('console-errors.jsonl');
    const networkPath = testInfo.outputPath('network.jsonl');
    const durationsPath = testInfo.outputPath('duration-samples.json');
    await mkdir(path.dirname(consolePath), { recursive: true });
    await Promise.all([
      writeFile(consolePath, lineBody(consoleErrors)),
      writeFile(networkPath, lineBody(network)),
      writeFile(durationsPath, `${JSON.stringify(durationSamples, null, 2)}\n`),
    ]);
    await Promise.all([
      testInfo.attach('console-errors', { path: consolePath, contentType: 'application/x-ndjson' }),
      testInfo.attach('network', { path: networkPath, contentType: 'application/x-ndjson' }),
      testInfo.attach('duration-samples', { path: durationsPath, contentType: 'application/json' }),
    ]);
    // The flow deliberately stops the loopback API once to prove offline
    // queueing. Chromium may surface that one refused request as a console
    // resource error; every other console error or uncaught exception fails.
    const unexpectedConsoleErrors = consoleErrors.filter((entry) => entry.level !== 'warning' && !expectedOfflineConsoleError(entry));
    return { consoleErrors, unexpectedConsoleErrors, network, durationSamples };
  };
  return { wireContext, wireWorker, timer, duration, durationSamples, attachScreenshot, writeArtifacts };
};

export { redact, safeUrl };
