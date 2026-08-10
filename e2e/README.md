# Packaged Chrome extension browser gate

This gate loads the checksummed ZIP produced in `dist/release/` into Playwright Chromium with a persistent profile. It opens Chrome's actual side panel from a real extension-page click and requires Chrome's `sidePanel.onOpened` confirmation for the controlled content tab.

The serial acceptance loop covers:

- article selection and tab-scoped draft restoration;
- live player detection, mark in/out, preview playback, and timestamped open-original;
- microphone permission denial and OAuth-window cancellation;
- publish through the real local Annotated server and claim entry through the real web UI;
- a real backend outage, local queueing, forced MV3 service-worker termination, worker wake/recovery, and eventual publish.

The two served pages under `fixtures/` are repository-owned. The player is a real `<video>` element with a deterministic synthetic clock, so no third-party media, account, or internet service participates in CI.

Two boundaries are intentionally explicit:

1. The fixture player's clock is synthetic so mark/playback results are deterministic and legally owned.
2. Playwright still cannot expose a native Chrome side-panel `Page` ([microsoft/playwright#26693](https://github.com/microsoft/playwright/issues/26693)). The gate proves the actual packaged panel opened, then drives the identical packaged `sidepanel.html` document in a background extension tab in the same target window. That document is also checked at the panel's 360px reference width for horizontal overflow before the 1280×800 engineering captures. Chrome scripting, selection, storage, permission denial, Chrome's OAuth window, network failure, service-worker lifecycle, API writes, web UI, and tab navigations are real; only automation of the native host container is deferred to the headed Store-evidence run. The provider document inside the OAuth window is a local intercepted fixture, not a Google credential check.

Run after building the release artifact:

```sh
npm run build
npx playwright install --with-deps chromium
npx playwright test --config e2e/playwright.config.mjs
```

Set `ANNOTATED_E2E_HEADED=1` to watch the flow locally. Production-provider OAuth verification remains a separate operator run because CI must not hold Google or X user credentials.

For the native-host assertion on Linux CI, prefer a headed Chromium window under Xvfb: `xvfb-run -a env ANNOTATED_E2E_HEADED=1 npm run test:e2e`. The product manifest requires Chrome 116 because programmatic `sidePanel.open()` starts there; this evidence runner needs Chrome/Chromium 141 or newer for `sidePanel.onOpened` and `sidePanel.close()`. It also needs Node 22, `unzip`, loopback sockets, and the Playwright FFmpeg installed with Chromium. The suite does not require external network access.

Every successful run attaches 1280×800 captures named `screenshot-1-capture.png`, `screenshot-2-media-range.png`, and `screenshot-3-published.png`, plus a trace, WebM recording, redacted console/network JSONL, duration samples, and the browser receipt. Trace or video finalization failures fail an otherwise-passing gate. The receipt also states that local `source_resolution_ms` samples exercise the controlled loopback/SSRF fallback (`metadata-unavailable`); they do not prove a remote provider fetch. `ANNOTATED_E2E_STORE_MODE=1` labels the receipt as a Store-evidence run; it does not misrepresent the automation-tab captures as native-Chrome screenshots. Use a headed operator capture for the final Store images.

Report destinations are configurable with `ANNOTATED_E2E_ARTIFACTS`, `ANNOTATED_E2E_JSON_REPORT`, `ANNOTATED_E2E_JUNIT_REPORT`, `ANNOTATED_E2E_HTML_REPORT`, and `ANNOTATED_E2E_RESULTS`.
