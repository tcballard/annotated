import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const artifactRoot = process.env.ANNOTATED_E2E_ARTIFACTS || path.join(os.tmpdir(), 'annotated-extension-e2e-artifacts');

export default defineConfig({
  testDir: '.',
  testMatch: 'chrome-extension.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.ANNOTATED_E2E_JSON_REPORT || path.join(artifactRoot, 'playwright-report.json') }],
    ['junit', { outputFile: process.env.ANNOTATED_E2E_JUNIT_REPORT || path.join(artifactRoot, 'playwright-junit.xml') }],
    ['html', { open: 'never', outputFolder: process.env.ANNOTATED_E2E_HTML_REPORT || path.join(artifactRoot, 'html') }],
  ],
  outputDir: process.env.ANNOTATED_E2E_RESULTS || path.join(artifactRoot, 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
