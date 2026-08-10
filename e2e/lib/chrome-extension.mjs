const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export const FIXTURE_SESSION_TOKEN = 'annotated-e2e-session';

export const extensionIdFromWorker = (worker) => {
  const match = worker.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
  if (!match) throw new Error(`Could not derive the extension ID from ${worker.url()}.`);
  return match[1];
};

export const configureExtension = async (worker, { apiOrigin, signedIn = false }) => {
  await worker.evaluate(async ({ origin, withSession, token }) => {
    await chrome.storage.local.set({
      annotatedConfig: { apiOrigin: origin },
      annotatedIntroSeen: true,
    });
    await chrome.storage.session.clear();
    if (withSession) {
      await chrome.storage.session.set({
        annotatedSession: {
          token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          user: { id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard', role: 'owner' },
        },
      });
    }
  }, { origin: apiOrigin, withSession: signedIn, token: FIXTURE_SESSION_TOKEN });
};

export const signInFixtureUser = (worker) => worker.evaluate(async (token) => {
  await chrome.storage.session.set({
    annotatedSession: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: { id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard', role: 'owner' },
    },
  });
}, FIXTURE_SESSION_TOKEN);

// This deliberately opens Chrome's real side-panel host. The click occurs on
// an extension page in a separate popup window, so it carries a genuine user
// activation while the controlled content tab remains active in its window.
// Playwright cannot currently expose the native side-panel WebContents
// (microsoft/playwright#26693). After proving onOpened fired, CI drives the
// exact same packaged document in a background extension tab in the target
// window. This keeps every extension API/content-tab boundary real while
// making the one unautomatable Chrome host boundary explicit.
export const openActualSidePanel = async ({ context, extensionId, targetPage, timeout = 15_000 }) => {
  const extensionOrigin = `chrome-extension://${extensionId}`;
  const controller = await context.newPage();
  await controller.goto(`${extensionOrigin}/options.html`);
  const launcherCreated = context.waitForEvent('page');
  await controller.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 420, height: 720 }), `${extensionOrigin}/options.html?e2e-panel-launcher=1`);
  const launcher = await launcherCreated;
  await launcher.waitForLoadState('domcontentloaded');
  const targetTab = await controller.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => tab.url === url);
    return match ? { id: match.id, windowId: match.windowId } : null;
  }, targetPage.url());
  if (!Number.isInteger(targetTab?.id)) throw new Error(`The controlled content tab could not be resolved for ${targetPage.url()}.`);
  const browser = context.browser();
  const targetSession = browser
    ? await browser.newBrowserCDPSession()
    : await context.newCDPSession(targetPage);
  const targetsBefore = await targetSession.send('Target.getTargets');
  const existingTargetIds = new Set(targetsBefore.targetInfos.map((target) => target.targetId));
  const createdTargetIds = new Set();
  targetSession.on('Target.targetCreated', ({ targetInfo }) => {
    if (!existingTargetIds.has(targetInfo.targetId)) createdTargetIds.add(targetInfo.targetId);
  });
  await targetSession.send('Target.setDiscoverTargets', { discover: true });
  await controller.close();
  await targetPage.bringToFront();
  await launcher.evaluate(({ tabId }) => {
    if (!chrome.sidePanel.onOpened) throw new Error('Chrome 141+ is required to verify that the native side panel opened.');
    window.__annotatedE2ePanelOpened = new Promise((resolve) => {
      const listener = (info) => {
        if (info.tabId !== undefined && info.tabId !== tabId) return;
        chrome.sidePanel.onOpened.removeListener(listener);
        resolve({ path: info.path, tabId: info.tabId, windowId: info.windowId });
      };
      chrome.sidePanel.onOpened.addListener(listener);
    });
    const button = document.createElement('button');
    button.id = 'annotated-e2e-open-real-panel';
    button.textContent = 'Open real Annotated side panel';
    button.addEventListener('click', async () => {
      try {
        await chrome.sidePanel.open({ tabId });
        document.documentElement.dataset.panelOpen = 'true';
      } catch (error) {
        document.documentElement.dataset.panelError = error?.message || String(error);
      }
    });
    document.body.replaceChildren(button);
  }, { tabId: targetTab.id });
  // CDP can dispatch a trusted click to a background page, but Chrome's
  // transient user-activation check is tied to the foreground extension
  // surface. Focus the launcher explicitly so Xvfb/window-manager variance
  // cannot turn the native-host assertion into an intermittent rejection.
  await launcher.bringToFront();
  await launcher.locator('#annotated-e2e-open-real-panel').click();
  const opened = await Promise.race([
    launcher.evaluate(() => window.__annotatedE2ePanelOpened),
    sleep(timeout).then(() => null),
  ]);
  const openingError = await launcher.evaluate(() => document.documentElement.dataset.panelError || '');
  if (openingError) throw new Error(`Chrome rejected the real side-panel gesture: ${openingError}`);
  if (!opened
    || opened.path !== 'sidepanel.html'
    || opened.windowId !== targetTab.windowId
    || (opened.tabId !== undefined && opened.tabId !== targetTab.id)) {
    throw new Error(`Chrome did not confirm opening the packaged side panel in the controlled content window: ${JSON.stringify(opened)}.`);
  }
  const options = await launcher.evaluate((tabId) => chrome.sidePanel.getOptions({ tabId }), targetTab.id);
  if (options.path !== 'sidepanel.html' || options.enabled === false) throw new Error(`The opened panel options did not point to sidepanel.html: ${JSON.stringify(options)}`);

  const targetDeadline = Date.now() + timeout;
  let nativeTarget = null;
  while (!nativeTarget && Date.now() < targetDeadline) {
    const snapshot = await targetSession.send('Target.getTargets');
    nativeTarget = snapshot.targetInfos.find((target) => (
      !existingTargetIds.has(target.targetId)
      && target.url.startsWith(`${extensionOrigin}/sidepanel.html`)
    ));
    if (!nativeTarget) await sleep(100);
  }
  await targetSession.detach().catch(() => {});
  if (!nativeTarget) throw new Error('Chrome confirmed sidePanel.onOpened, but CDP did not expose the packaged native-host target.');
  // The host-open contract is now fully evidenced. Close the native instance
  // before creating the automation tab so two copies of the panel do not race
  // on tab listeners or draft storage during the remainder of the suite.
  await launcher.evaluate((windowId) => chrome.sidePanel.close({ windowId }), targetTab.windowId);

  const automationPageCreated = context.waitForEvent('page');
  await launcher.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), {
    windowId: targetTab.windowId,
    url: `${extensionOrigin}/sidepanel.html`,
  });
  const panel = await automationPageCreated;
  await launcher.close();
  await panel.waitForLoadState('domcontentloaded');
  // Re-activate the fixture. The automation document remains alive as a
  // background tab and rebinds through its production tabs.onActivated path.
  await targetPage.bringToFront();
  const isExtensionSurface = await panel.evaluate(() => location.pathname.endsWith('/sidepanel.html') && Boolean(chrome.sidePanel));
  if (!isExtensionSurface) throw new Error('The discovered target is not the packaged extension side-panel document.');
  return {
    panel,
    hostReceipt: {
      openedEvent: opened,
      options: { enabled: options.enabled !== false, path: options.path },
      target: {
        targetId: nativeTarget.targetId,
        type: nativeTarget.type,
        subtype: nativeTarget.subtype || null,
        url: nativeTarget.url,
        targetCreatedObserved: createdTargetIds.has(nativeTarget.targetId),
      },
      automationSurface: 'packaged-extension-background-tab',
    },
  };
};

const waitForWorkerVersion = async (session, extensionId, timeout = 10_000) => {
  let match = null;
  const inspect = (event) => {
    match ||= (event.versions || []).find((version) => version.scriptURL?.startsWith(`chrome-extension://${extensionId}/`));
  };
  session.on('ServiceWorker.workerVersionUpdated', inspect);
  await session.send('ServiceWorker.enable');
  const deadline = Date.now() + timeout;
  while (!match && Date.now() < deadline) await sleep(50);
  return match;
};

// MV3 recovery is proved by stopping the real registered worker through CDP,
// then waking it through the product's existing RETRY_PENDING message. The
// caller compares an injected per-JS-context nonce before/after; no product
// test hook is involved.
export const stopExtensionServiceWorker = async ({ context, extensionId }) => {
  const browser = context.browser();
  // browser() may be null for launchPersistentContext. The ServiceWorker
  // domain is also exposed on a Chromium page session, which keeps this gate
  // compatible with the persistent profile it is specifically meant to test.
  const session = browser
    ? await browser.newBrowserCDPSession()
    : await context.newCDPSession(context.pages()[0]);
  try {
    const version = await waitForWorkerVersion(session, extensionId);
    if (!version?.versionId) throw new Error('Chrome did not report the packaged extension service-worker version.');
    let stopped = version.runningStatus === 'stopped';
    const inspect = (event) => {
      const current = (event.versions || []).find((candidate) => candidate.versionId === version.versionId);
      if (current?.runningStatus === 'stopped') stopped = true;
    };
    session.on('ServiceWorker.workerVersionUpdated', inspect);
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    const deadline = Date.now() + 10_000;
    while (!stopped && Date.now() < deadline) await sleep(50);
    if (!stopped) throw new Error('Chrome did not confirm that the packaged extension service worker stopped.');
    return version.versionId;
  } finally {
    await session.detach().catch(() => {});
  }
};

export const workerContextNonce = (worker) => worker.evaluate(() => {
  globalThis.__annotatedE2eWorkerContext ||= crypto.randomUUID();
  return globalThis.__annotatedE2eWorkerContext;
});

export const extensionStorageSnapshot = (worker) => worker.evaluate(async () => ({
  local: await chrome.storage.local.get(null),
  session: await chrome.storage.session.get(null),
}));
