import { expect, test, chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer, freePort } from './lib/app-server.mjs';
import {
  configureExtension,
  extensionIdFromWorker,
  extensionStorageSnapshot,
  FIXTURE_SESSION_TOKEN,
  openActualSidePanel,
  signInFixtureUser,
  stopExtensionServiceWorker,
  workerContextNonce,
} from './lib/chrome-extension.mjs';
import { startFixtureServer } from './lib/fixture-server.mjs';
import { unpackReleaseExtension } from './lib/release-extension.mjs';
import { createEvidenceRecorder } from './lib/evidence.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const passage = 'A durable annotation preserves the exact passage, the author’s context, and a path back to the original source.';

const verifyNarrowPanelLayout = async (panel) => {
  const restoredViewport = panel.viewportSize() || { width: 1280, height: 800 };
  await panel.setViewportSize({ width: 360, height: 800 });
  await expect(panel.locator('#captureSection')).toBeVisible();
  const layout = await panel.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const surfaces = ['.phead', '.tabs', '.cap-source', '#publish'].map((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return {
        selector,
        present: Boolean(box),
        left: box ? Number(box.left.toFixed(1)) : null,
        right: box ? Number(box.right.toFixed(1)) : null,
      };
    });
    return {
      viewport: { width: viewportWidth, height: window.innerHeight },
      documentScrollWidth,
      horizontalOverflowPixels: Math.max(0, Math.ceil(documentScrollWidth - viewportWidth)),
      surfaces,
    };
  });
  expect(layout.viewport.width).toBe(360);
  expect(layout.horizontalOverflowPixels).toBe(0);
  for (const surface of layout.surfaces) {
    expect(surface.present, `${surface.selector} must render in the narrow panel`).toBe(true);
    expect(surface.left, `${surface.selector} must not escape the left edge`).toBeGreaterThanOrEqual(0);
    expect(surface.right, `${surface.selector} must not escape the right edge`).toBeLessThanOrEqual(layout.viewport.width + 1);
  }
  await panel.setViewportSize(restoredViewport);
  return layout;
};

const selectFixturePassage = (page) => page.locator('#passage').evaluate((element) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
});

const waitForServiceWorker = async (context) => {
  const existing = context.serviceWorkers()[0];
  return existing || context.waitForEvent('serviceworker');
};

const activeExtensionWorker = async ({ context, extensionId, wakePage }) => {
  const prefix = `chrome-extension://${extensionId}/`;
  const existing = context.serviceWorkers().find((candidate) => candidate.url().startsWith(prefix));
  if (existing) return existing;
  const created = context.waitForEvent('serviceworker', {
    predicate: (candidate) => candidate.url().startsWith(prefix),
    timeout: 10_000,
  });
  await wakePage.evaluate(() => chrome.runtime.sendMessage({ type: 'NOTIFICATIONS_SEEN' }).catch(() => null));
  return created;
};

const dismissPublishMoment = async (panel) => {
  const moment = panel.locator('.pub-moment');
  if (await moment.isVisible().catch(() => false)) await moment.click();
  await expect(moment).toHaveCount(0);
};

test('the checksummed packaged extension completes the Gate B browser loop', async ({}, testInfo) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'annotated-extension-e2e-'));
  const extensionPath = path.join(temporaryRoot, 'unpacked-extension');
  const profilePath = path.join(temporaryRoot, 'persistent-profile');
  const dataDirectory = path.join(temporaryRoot, 'data');
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(path.join(dataDirectory, 'store.json'), JSON.stringify({
    users: [{ id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard', role: 'owner' }],
    annotations: [], comments: [], claims: [], follows: [], likes: [], media: [], mediaJobs: [],
    sessions: [{
      id: 'annotated-e2e-session-row',
      tokenHash: createHash('sha256').update(FIXTURE_SESSION_TOKEN).digest('hex'),
      userId: 'local-tom',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }],
    extensionTickets: [], moderationAudit: [],
  }));
  const packaged = await unpackReleaseExtension({ repoRoot, destination: extensionPath });
  const storeListing = JSON.parse(await readFile(path.join(repoRoot, 'store-assets', 'store-listing.json'), 'utf8'));
  const expectedExtensionId = storeListing.extensionIdentity?.expectedId;
  expect(packaged.manifest.manifest_version).toBe(3);
  expect(packaged.manifest.minimum_chrome_version).toBe('116');
  expect(packaged.manifest.side_panel.default_path).toBe('sidepanel.html');
  expect(expectedExtensionId).toMatch(/^[a-p]{32}$/);
  const fixture = await startFixtureServer();
  const evidence = createEvidenceRecorder({ testInfo });
  let context;
  let app;
  let panelVideo;
  let traceStarted = false;
  let flowCompleted = false;
  let unexpectedConsoleErrors = [];
  const evidenceFinalizationErrors = [];
  const tracePath = testInfo.outputPath('gate-b-trace.zip');
  const videoPath = testInfo.outputPath('gate-b-flow.webm');
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: process.env.ANNOTATED_E2E_HEADED !== '1',
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: path.join(temporaryRoot, 'video'), size: { width: 1280, height: 800 } },
      serviceWorkers: 'allow',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--deny-permission-prompts',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    evidence.wireContext(context);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;
    const worker = await waitForServiceWorker(context);
    evidence.wireWorker(worker);
    const extensionId = extensionIdFromWorker(worker);
    expect(extensionId).toBe(expectedExtensionId);
    app = createAppServer({ repoRoot, dataDirectory, port: await freePort(), extensionId });
    await app.start();
    await configureExtension(worker, { apiOrigin: app.origin });

    const contentPage = context.pages()[0] || await context.newPage();
    await contentPage.goto(`${fixture.origin}/article`);
    const panelUsableStarted = evidence.timer();
    const { panel, hostReceipt } = await openActualSidePanel({ context, extensionId, targetPage: contentPage });
    panelVideo = panel.video();
    await expect(panel.locator('#backendStatus .backend-label')).toHaveText('connected');
    await expect(panel.locator('#sourceTitle')).toContainText('controlled article fixture');
    await expect(panel.locator('#typeSelect')).toHaveValue('article');
    evidence.duration('panel_first_usable_ms', panelUsableStarted);
    const narrowLayout = await verifyNarrowPanelLayout(panel);

    // Loopback is intentionally rejected by the production SSRF policy. This
    // makes the browser timing a controlled fallback-resolution measurement,
    // not evidence that a remote source/provider was fetched successfully.
    const sourceResolutionProof = await panel.evaluate(async ({ origin, sourceUrl }) => {
      const response = await fetch(`${origin}/api/sources/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const body = await response.json();
      return {
        status: response.status,
        canonicalUrl: body.source?.canonicalUrl || null,
        processing: body.source?.processing || null,
        error: body.source?.error || body.error || null,
      };
    }, { origin: app.origin, sourceUrl: `${fixture.origin}/article` });
    expect(sourceResolutionProof.status).toBe(400);
    expect(sourceResolutionProof.canonicalUrl).toBeNull();
    expect(sourceResolutionProof.processing).toBeNull();
    expect(sourceResolutionProof.error).toMatch(/not allowed/i);

    // OAuth cancellation uses Chrome's real identity window against a local,
    // repository-owned provider page. Credentialed provider verification is
    // deliberately a separate run and never makes CI depend on Google.
    const oauthFixture = await readFile(path.join(repoRoot, 'e2e', 'fixtures', 'oauth-cancel.html'), 'utf8');
    await context.route('https://accounts.google.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: oauthFixture,
    }));
    await expect(panel.locator('#signInOpen')).toBeVisible();
    await panel.locator('#signInOpen').click();
    await panel.evaluate(() => {
      const launchWebAuthFlow = chrome.identity.launchWebAuthFlow.bind(chrome.identity);
      window.__annotatedE2eAuthFlow = { status: 'armed', message: '' };
      chrome.identity.launchWebAuthFlow = async (...args) => {
        window.__annotatedE2eAuthFlow = { status: 'running', message: '' };
        try {
          const callback = await launchWebAuthFlow(...args);
          window.__annotatedE2eAuthFlow = { status: 'resolved', message: '' };
          return callback;
        } catch (error) {
          window.__annotatedE2eAuthFlow = { status: 'rejected', message: error?.message || String(error) };
          throw error;
        }
      };
    });
    const oauthPageCreated = context.waitForEvent('page');
    await panel.locator('[data-auth="google"]').click();
    const oauthPage = await oauthPageCreated;
    await expect.poll(() => oauthPage.url()).toMatch(/^https:\/\/accounts\.google\.com\//);
    await expect(oauthPage.getByRole('heading', { name: 'Controlled OAuth cancellation fixture' })).toBeVisible();
    await expect.poll(() => panel.evaluate(() => window.__annotatedE2eAuthFlow?.status)).toBe('running');
    await oauthPage.close();
    await contentPage.bringToFront();
    await expect.poll(() => panel.evaluate(() => window.__annotatedE2eAuthFlow)).toMatchObject({ status: 'rejected' });
    const authCancellation = await panel.evaluate(() => window.__annotatedE2eAuthFlow);
    expect(authCancellation.message).toMatch(/clos|cancel|did not approve/i);
    await expect(panel.locator('#sourceTitle')).toContainText('controlled article fixture');
    await expect(panel.locator('#error')).toBeHidden();

    // Article selection uses scripting against the live page, then persists a
    // tab-keyed draft across a full side-panel document reload.
    await selectFixturePassage(contentPage);
    await expect(panel.locator('#grabSelection')).toContainText('Capture');
    await panel.locator('#grabSelection').click();
    await expect(panel.locator('#passageText')).toContainText(passage);
    await panel.locator('#note').fill('The source stays attached to the context.');
    await evidence.attachScreenshot(panel, 'screenshot-1-capture.png');
    await expect.poll(async () => {
      const session = (await extensionStorageSnapshot(panel)).session;
      return Object.values(session).find((value) => value?.commentary === 'The source stays attached to the context.') || null;
    }).toMatchObject({ sourceExcerpt: passage, commentary: 'The source stays attached to the context.' });
    await panel.reload();
    await expect(panel.locator('#passageText')).toContainText(passage);
    await expect(panel.locator('#note')).toHaveValue('The source stays attached to the context.');

    // Permission denial reaches the real getUserMedia path. Returning to text
    // mode proves the existing selection/note remains intact.
    await panel.locator('#modeAudio').click();
    await panel.locator('#audioRecord').click();
    await expect(panel.locator('#error')).toContainText(/permission|denied|not allowed/i);
    await panel.locator('#modeText').click();
    await expect(panel.locator('#note')).toHaveValue('The source stays attached to the context.');

    // Local development auth is supplied through Chrome's actual session
    // storage, then the production publish path hits the real local server.
    await signInFixtureUser(panel);
    await panel.reload();
    await expect(panel.locator('#meButton')).toBeVisible();
    await expect(panel.locator('#publish')).toBeEnabled();
    const articlePublishStarted = evidence.timer();
    await panel.locator('#publish').click();
    await expect(panel.locator('.pub-moment')).toBeVisible();
    evidence.duration('publish_acknowledgement_ms', articlePublishStarted);
    await expect(panel.locator('#toastLink')).toHaveAttribute('href', new RegExp(`^${app.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/a/`));
    const articlePublishedUrl = await panel.locator('#toastLink').getAttribute('href');
    await dismissPublishMoment(panel);
    await expect(panel.locator('#tab-page')).toHaveAttribute('aria-selected', 'true');

    // Open-original is a real target=_blank navigation and carries the W3C
    // text fragment generated by the packaged extension.
    const articleOriginalCreated = context.waitForEvent('page');
    await panel.locator('.post .act.primary').first().click();
    const articleOriginal = await articleOriginalCreated;
    await articleOriginal.waitForLoadState('domcontentloaded');
    expect(articleOriginal.url()).toContain(`${fixture.origin}/article#:~:text=`);
    await articleOriginal.close();

    // Claim entry is the actual web-product modal on the annotation produced
    // above, backed by the same server/store—not a fixture implementation.
    const claimPage = await context.newPage();
    await claimPage.goto(articlePublishedUrl);
    await expect(claimPage.getByRole('button', { name: /Dispute fair use/i })).toBeVisible();
    await claimPage.getByRole('button', { name: /Dispute fair use/i }).click();
    await claimPage.locator('[data-action="claim-text"]').fill('Controlled Gate B claim entry; not a real rights complaint.');
    await claimPage.getByRole('button', { name: 'Send dispute' }).click();
    await expect(claimPage.getByRole('heading', { name: 'Dispute received' })).toBeVisible();
    const claims = await fetch(`${app.origin}/api/claims`).then((response) => response.json());
    expect(claims.claims.some((claim) => claim.annotationId && claim.reason.includes('Controlled Gate B'))).toBe(true);
    await claimPage.close();
    await contentPage.bringToFront();

    // The fixture uses a real <video> element with a deterministic, locally
    // owned clock. Detection/marking/preview are the packaged scripting path.
    await contentPage.goto(`${fixture.origin}/player`);
    await expect(panel.locator('#typeSelect')).toHaveValue('video');
    await contentPage.evaluate(() => window.annotatedFixturePlayer.setTime(12));
    await panel.locator('#bayPrimary').click();
    await expect(panel.locator('#bayPrimaryLabel')).toHaveText('Mark out');
    await contentPage.evaluate(() => window.annotatedFixturePlayer.setTime(19));
    await panel.locator('#bayPrimary').click();
    await expect(panel.locator('#bayPrimaryLabel')).toHaveText('Play selection');
    await expect(panel.locator('#durationChip')).toHaveText('0:12–0:19');
    await expect(panel.locator('#bayMeta')).toContainText('0:07');
    await evidence.attachScreenshot(panel, 'screenshot-2-media-range.png');
    const playbackStarted = evidence.timer();
    await panel.locator('#bayPrimary').click();
    await expect.poll(() => contentPage.evaluate(() => window.annotatedFixturePlayer.snapshot().playCalls)).toBe(1);
    evidence.duration('playback_readiness_ms', playbackStarted);
    const played = await contentPage.evaluate(() => window.annotatedFixturePlayer.snapshot());
    expect(played.currentTime).toBeGreaterThanOrEqual(11);
    expect(played.currentTime).toBeLessThan(13);

    await panel.locator('#note').fill('The deterministic player keeps marks exact.');
    await expect(panel.locator('#publish')).toBeEnabled();
    const videoPublishStarted = evidence.timer();
    await panel.locator('#publish').click();
    await expect(panel.locator('.pub-moment')).toBeVisible();
    evidence.duration('publish_acknowledgement_ms', videoPublishStarted);
    await dismissPublishMoment(panel);
    await evidence.attachScreenshot(panel, 'screenshot-3-published.png');
    const videoOriginalCreated = context.waitForEvent('page');
    await panel.locator('.post .act.primary').first().click();
    const videoOriginal = await videoOriginalCreated;
    await videoOriginal.waitForLoadState('domcontentloaded');
    expect(videoOriginal.url()).toMatch(new RegExp(`^${fixture.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/player#t=1[12]$`));
    await videoOriginal.close();
    await contentPage.bringToFront();

    // Queue on a real connection failure, terminate the real MV3 worker,
    // restart the backend, then wake a fresh worker through Retry now.
    await contentPage.goto(`${fixture.origin}/article?offline-queue=1`);
    await expect(panel.locator('#typeSelect')).toHaveValue('article');
    await selectFixturePassage(contentPage);
    await panel.locator('#grabSelection').click();
    await panel.locator('#note').fill('This capture survives an offline publish and worker restart.');
    await app.stop();
    await panel.locator('#publish').click();
    await expect(panel.locator('#queueStatus')).toBeVisible();
    await expect.poll(async () => (await extensionStorageSnapshot(panel)).local.annotatedPendingCaptures?.length || 0).toBe(1);
    const workerForSuspension = await activeExtensionWorker({ context, extensionId, wakePage: panel });
    evidence.wireWorker(workerForSuspension);
    const workerBefore = await workerContextNonce(workerForSuspension);
    const replacementWorkerCreated = context.waitForEvent('serviceworker', {
      predicate: (candidate) => candidate !== workerForSuspension && candidate.url() === workerForSuspension.url(),
      timeout: 20_000,
    });
    await stopExtensionServiceWorker({ context, extensionId });
    await app.start();
    await panel.locator('#queueRetry').click();
    const recoveredWorker = await replacementWorkerCreated;
    evidence.wireWorker(recoveredWorker);
    await expect.poll(async () => (await extensionStorageSnapshot(recoveredWorker)).local.annotatedPendingCaptures?.length || 0, { timeout: 20_000 }).toBe(0);
    const workerAfter = await workerContextNonce(recoveredWorker);
    expect(workerAfter).not.toBe(workerBefore);
    await expect(panel.locator('#queueStatus')).toBeHidden();
    await expect(panel.locator('#toastText')).toHaveText('Queued capture published');

    const stored = JSON.parse(await readFile(app.dataPath, 'utf8'));
    expect(stored.annotations).toHaveLength(3);
    expect(stored.annotations.some((annotation) => annotation.commentary.includes('survives an offline publish'))).toBe(true);
    await expect.poll(() => evidence.durationSamples.source_resolution_ms.length).toBeGreaterThan(0);

    const receipt = {
      schemaVersion: 1,
      gate: 'gate-b-packaged-extension-browser',
      release: { version: packaged.release.version, sha256: packaged.sha256, artifactPath: packaged.release.artifactPath },
      extension: { id: extensionId, expectedId: expectedExtensionId, manifestVersion: packaged.manifest.manifest_version },
      browser: await contentPage.evaluate(() => navigator.userAgent),
      nativeHost: hostReceipt,
      automation: {
        surface: hostReceipt.automationSurface,
        narrowLayout,
      },
      sourceResolution: {
        fixture: 'controlled-loopback',
        outcome: sourceResolutionProof.processing,
        ssrfBoundaryObserved: /not allowed/i.test(sourceResolutionProof.error || ''),
        verifiesRemoteProviderFetch: false,
      },
      storeCaptureMode: process.env.ANNOTATED_E2E_STORE_MODE === '1',
      durationSamplesMs: evidence.durationSamples,
      capabilities: {
        browserVerified: ['side-panel', 'capture', 'commentary', 'source-links', 'landing-pages', 'claims'],
        explicitlyNotProviderVerified: ['oauth', 'sources'],
      },
      metrics: {
        'extension.package.checksum_verified': 1,
        'extension.identity.expected_id_verified': 1,
        'extension.side_panel.native_opened': 1,
        'extension.side_panel.options_path_verified': 1,
        'extension.side_panel.devtools_target_discovered': 1,
        'extension.side_panel.narrow_layout_no_overflow': 1,
        'extension.source_resolution.controlled_ssrf_fallback': 1,
        'extension.capture.article_selection': 1,
        'extension.capture.draft_restored': 1,
        'extension.player.detected': 1,
        'extension.player.range_previewed': 1,
        'extension.commentary.permission_denial_handled': 1,
        'extension.oauth.cancellation_handled': 1,
        'extension.publish.direct_succeeded': 2,
        'extension.publish.offline_queued': 1,
        'extension.service_worker.recovered': 1,
        'extension.open_original.navigated': 2,
        'extension.claim.submitted': 1,
      },
    };
    const receiptBody = `${JSON.stringify(receipt, null, 2)}\n`;
    const receiptPath = testInfo.outputPath('gate-b-browser-receipt.json');
    await writeFile(receiptPath, receiptBody);
    await testInfo.attach('gate-b-browser-receipt', { path: receiptPath, contentType: 'application/json' });
    flowCompleted = true;
  } finally {
    await app?.stop().catch(() => {});
    if (traceStarted) {
      try {
        await context?.tracing.stop({ path: tracePath });
        await testInfo.attach('gate-b-trace', { path: tracePath, contentType: 'application/zip' });
      } catch (error) {
        evidenceFinalizationErrors.push(new Error(`Gate B trace finalization failed: ${error.message}`, { cause: error }));
      }
    } else if (flowCompleted) evidenceFinalizationErrors.push(new Error('Gate B completed without starting a trace.'));
    await context?.close().catch(() => {});
    if (panelVideo) {
      try {
        await panelVideo.saveAs(videoPath);
        await testInfo.attach('gate-b-flow-video', { path: videoPath, contentType: 'video/webm' });
      } catch (error) {
        evidenceFinalizationErrors.push(new Error(`Gate B video finalization failed: ${error.message}`, { cause: error }));
      }
    } else if (flowCompleted) evidenceFinalizationErrors.push(new Error('Gate B completed without a panel video handle.'));
    await fixture.close().catch(() => {});
    const serverLogPath = testInfo.outputPath('app-server.log');
    await writeFile(serverLogPath, app?.logs() || '');
    await testInfo.attach('app-server-log', { path: serverLogPath, contentType: 'text/plain' });
    ({ unexpectedConsoleErrors } = await evidence.writeArtifacts());
    await rm(temporaryRoot, { recursive: true, force: true });
    if (flowCompleted && unexpectedConsoleErrors.length) {
      const summary = unexpectedConsoleErrors.slice(0, 5).map((entry) => `${entry.surface}: ${entry.message}`).join(' | ');
      evidenceFinalizationErrors.push(new Error(`Gate B observed ${unexpectedConsoleErrors.length} unexpected browser runtime error(s): ${summary}`));
    }
    if (flowCompleted && evidenceFinalizationErrors.length) throw new AggregateError(evidenceFinalizationErrors, 'Gate B evidence finalization failed.');
  }
});
