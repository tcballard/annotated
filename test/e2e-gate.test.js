import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { redact, safeUrl } from '../e2e/lib/evidence.mjs';
import { startFixtureServer } from '../e2e/lib/fixture-server.mjs';
import { safeZipEntry } from '../e2e/lib/release-extension.mjs';

const read = (relative) => readFile(new URL(`../e2e/${relative}`, import.meta.url), 'utf8');

test('the browser gate loads the checksummed packaged build in a persistent Chromium profile', async () => {
  const [spec, release, chrome] = await Promise.all([
    read('chrome-extension.spec.mjs'),
    read('lib/release-extension.mjs'),
    read('lib/chrome-extension.mjs'),
  ]);
  assert.match(spec, /chromium\.launchPersistentContext\(profilePath/);
  assert.match(spec, /channel: 'chromium'/);
  assert.match(spec, /--disable-extensions-except=/);
  assert.match(spec, /--load-extension=/);
  assert.match(spec, /unpackReleaseExtension/);
  assert.match(spec, /expectedExtensionId/);
  assert.match(spec, /expect\(extensionId\)\.toBe\(expectedExtensionId\)/);
  assert.match(spec, /minimum_chrome_version\)\.toBe\('116'\)/);
  assert.match(release, /dist', 'release', 'release\.json'/);
  assert.match(release, /createHash\('sha256'\)/);
  assert.match(release, /The sidecar checksum does not match/);
  assert.match(chrome, /chrome\.sidePanel\.open\(\{ windowId \}\)/);
  assert.match(chrome, /chrome\.sidePanel\.onOpened\.addListener/);
  assert.match(chrome, /chrome\.sidePanel\.getOptions/);
  assert.match(chrome, /const resourcePath/);
  assert.match(chrome, /resourcePath\(opened\.path\)/);
  assert.match(chrome, /Target\.getTargets/);
  assert.match(chrome, /microsoft\/playwright#26693/);
  assert.match(chrome, /chrome\.tabs\.create\(\{ windowId, url, active: true \}\)/);
});

test('the Gate B flow names every acceptance-critical browser behaviour', async () => {
  const spec = await read('chrome-extension.spec.mjs');
  const contracts = [
    ['article selection', /selectFixturePassage/],
    ['player detection', /toHaveValue\('video'\)/],
    ['mark in and out', /toHaveText\('Mark out'\)[\s\S]*toHaveText\('Play selection'\)/],
    ['audio permission denial', /#audioRecord[\s\S]*permission\|denied\|not allowed/],
    ['OAuth cancellation', /oauthAuthorizeUrl[\s\S]*oauth-cancel[\s\S]*oauthPage\.close/],
    ['offline queue', /annotatedPendingCaptures/],
    ['service-worker suspension', /stopExtensionServiceWorker/],
    ['draft restoration', /panel\.reload\(\)[\s\S]*#passageText[\s\S]*#note/],
    ['publish', /#publish/],
    ['playback', /playCalls/],
    ['open-original', /\.post \.act\.primary/],
    ['claim entry', /Dispute fair use[\s\S]*Send dispute[\s\S]*Dispute received/],
  ];
  for (const [label, pattern] of contracts) assert.match(spec, pattern, `missing browser contract: ${label}`);

  const workerControl = await read('lib/chrome-extension.mjs');
  assert.match(workerControl, /ServiceWorker\.stopWorker/);
  assert.match(workerControl, /browserControl\.newBrowserCDPSession\(\)/, 'worker control must use a browser-target CDP session');
  assert.match(spec, /--remote-debugging-address=127\.0\.0\.1/, 'the CDP control endpoint must remain loopback-only');
  assert.match(spec, /chromium\.connectOverCDP/, 'the persistent browser must expose browser-target CDP control');
  assert.match(workerControl, /RETRY_PENDING/, 'the lifecycle comment must name the product wake path');
  assert.match(spec, /workerAfter\)\.not\.toBe\(workerBefore\)/, 'a fresh worker JS context must be observed');
  assert.match(spec, /gate-b-browser-receipt\.json/);
  assert.match(spec, /'extension\.side_panel\.native_opened': 1/);
  assert.match(spec, /'extension\.identity\.expected_id_verified': 1/);
  assert.match(spec, /'extension\.side_panel\.narrow_layout_no_overflow': 1/);
  assert.match(spec, /verifiesRemoteProviderFetch: false/);
  assert.doesNotMatch(spec, /waitForTimeout\(/, 'observable state must replace fixed browser sleeps');
  assert.match(spec, /__annotatedE2eAuthFlow/);
  assert.match(spec, /extensionStorageSnapshot\(panel\)/);
});

test('controlled fixtures are local, original, deterministic, and independently servable', async (t) => {
  const [article, player, oauth, clock] = await Promise.all([read('fixtures/article.html'), read('fixtures/player.html'), read('fixtures/oauth-cancel.html'), read('fixtures/clock.webm.b64')]);
  assert.match(article, /repository-owned test fixture/);
  assert.match(article, /id="passage"/);
  assert.match(player, /repository-owned clock/);
  assert.match(player, /<video id="fixturePlayer"/);
  assert.match(player, /src="clock\.webm"/);
  assert.ok(Buffer.from(clock.trim(), 'base64').byteLength > 1_000, 'native media clock fixture must be substantive');
  assert.match(player, /window\.annotatedFixturePlayer/);
  assert.match(oauth, /Controlled OAuth cancellation fixture/);
  assert.doesNotMatch(`${article}\n${player}\n${oauth}`, /https?:\/\//, 'fixtures must not fetch third-party content');

  const server = await startFixtureServer();
  t.after(() => server.close());
  const articleResponse = await fetch(`${server.origin}/article`);
  const playerResponse = await fetch(`${server.origin}/player`);
  const oauthResponse = await fetch(`${server.origin}/oauth-cancel`);
  assert.equal(articleResponse.status, 200);
  assert.equal(playerResponse.status, 200);
  assert.equal(oauthResponse.status, 200);
  assert.match(articleResponse.headers.get('content-type'), /text\/html/);
  assert.match(await articleResponse.text(), /A durable annotation preserves/);
  assert.match(await playerResponse.text(), /Synthetic controlled video/);
  assert.match(await oauthResponse.text(), /Controlled OAuth cancellation fixture/);
});

test('ZIP extraction rejects traversal and absolute paths', () => {
  for (const entry of ['manifest.json', 'icons/icon-128.png', 'nested/path/file.js']) assert.equal(safeZipEntry(entry), true, entry);
  for (const entry of ['', '../manifest.json', 'nested/../../escape', '/etc/passwd', 'C:\\escape.txt']) assert.equal(safeZipEntry(entry), false, entry);
});

test('the handoff states both automation boundaries and separates credentialed provider verification', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Two boundaries are intentionally explicit/);
  assert.match(readme, /Playwright still cannot expose a native Chrome side-panel/);
  assert.match(readme, /gate proves the actual packaged panel opened/);
  assert.match(readme, /Production-provider OAuth verification remains a separate operator run/);
  assert.match(readme, /npx playwright install --with-deps chromium/);
});

test('release-grade browser evidence has configurable reports, captures, logs, video, and duration samples', async () => {
  const [config, spec, evidence] = await Promise.all([
    read('playwright.config.mjs'),
    read('chrome-extension.spec.mjs'),
    read('lib/evidence.mjs'),
  ]);
  for (const reporter of ['ANNOTATED_E2E_JSON_REPORT', 'ANNOTATED_E2E_JUNIT_REPORT', 'ANNOTATED_E2E_HTML_REPORT']) assert.match(config, new RegExp(reporter));
  assert.match(config, /retries: 0/, 'release evidence must never hide a retry');
  for (const screenshot of ['screenshot-1-capture.png', 'screenshot-2-media-range.png', 'screenshot-3-published.png']) assert.match(spec, new RegExp(screenshot.replace('.', '\\.')));
  for (const metric of ['panel_first_usable_ms', 'source_resolution_ms', 'publish_acknowledgement_ms', 'playback_readiness_ms']) {
    assert.match(evidence, new RegExp(metric));
    assert.match(spec, new RegExp(metric));
  }
  assert.match(spec, /recordVideo:/);
  assert.match(spec, /gate-b-flow-video/);
  assert.match(spec, /context\.tracing\.start/);
  assert.match(spec, /Gate B trace finalization failed/);
  assert.match(spec, /Gate B video finalization failed/);
  assert.match(evidence, /console-errors\.jsonl/);
  assert.match(evidence, /unexpectedConsoleErrors/);
  assert.match(spec, /Gate B observed .*unexpected browser runtime error/);
  assert.match(evidence, /network\.jsonl/);
  assert.match(evidence, /requestfailed/);
});

test('CI makes the packaged browser gate a prerequisite and keeps authoritative evidence protected', async () => {
  const [ci, release] = await Promise.all([
    read('../.github/workflows/ci.yml'),
    read('../.github/workflows/release-evidence.yml'),
  ]);
  assert.match(ci, /name: Packaged Chrome Gate B/);
  assert.match(ci, /playwright install --with-deps chromium/);
  assert.match(ci, /xvfb-run -a npm run test:e2e/);
  assert.match(ci, /needs: \[test, browser\]/);
  assert.match(release, /environment: \$\{\{ inputs\.release_environment \}\}/);
  assert.match(release, /run-production-evidence\.mjs/);
  assert.match(release, /release:evidence:compose/);
  assert.match(release, /check:release-slo/);
  assert.match(release, /ANNOTATED_STORE_RECEIPT/);
});

test('browser evidence redacts values and records only URL query keys', () => {
  assert.deepEqual(safeUrl('https://accounts.example.test/oauth?client_id=public&state=secret&code=also-secret'), {
    url: 'https://accounts.example.test/oauth',
    queryKeys: ['client_id', 'code', 'state'],
  });
  const scrubbed = redact('authorization=Bearer-secret ticket=abc state=xyz ordinary=safe');
  assert.doesNotMatch(scrubbed, /Bearer-secret|abc|xyz/);
  assert.match(scrubbed, /ordinary=safe/);
});
