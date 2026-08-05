import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Identity law §1.1: terracotta means THE MOMENT. The accent may appear only
// on moment chips, the live source dot, mark-selection state, the CLIP tag,
// active-tab underlines, the primary "Open original" action, the pull-quote
// rule, section-header full stops, focus rings, the claim hover (mockup), and
// the logo dot. Never on generic buttons, links, alerts, or decoration.

const ACCENT_PATTERN = /var\(--accent(?:-soft)?\)|#B0674D/i;

const ALLOWED_SELECTORS = [
  /^:root$/,
  /^:focus-visible$/,
  /\.chip\b/,
  /\.livedot\b/,
  /\.markbtn\.is-set \.t$/,
  /\.cliptag\b/,
  /\.tab\.is-active::after$/,
  /\.nav-link\.is-active$/,
  /\.act\.primary(?::hover)?$/,
  /\.act\.claim:hover$/,
  /\.srcstrip \.open$/, // "Open original at 0:14 ↗" — the primary open action

  /::after$/, // section-header full stops (h1/h2-level only)
  /\.pull$/,  // the pull-quote's terracotta rule
];

const auditStylesheet = (rawCss, file) => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const violations = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = match[2];
    if (!ACCENT_PATTERN.test(body)) continue;
    const selectors = match[1].split(',').map((selector) => selector.trim().split('\n').pop().trim()).filter(Boolean);
    for (const selector of selectors) {
      if (selector.startsWith('@')) continue;
      if (!ALLOWED_SELECTORS.some((allowed) => allowed.test(selector))) {
        violations.push(`${file}: "${selector}" uses the accent`);
      }
    }
  }
  return violations;
};

test('terracotta appears only on the moment, on every surface', async () => {
  const [web, panel] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.css', import.meta.url), 'utf8'),
  ]);
  const violations = [...auditStylesheet(web, 'src/styles.css'), ...auditStylesheet(panel, 'extension/sidepanel.css')];
  assert.deepEqual(violations, [], `Accent used outside §1.1 locations:\n${violations.join('\n')}`);
});

test('the accent is the one true terracotta and the logo dot is its tint', async () => {
  for (const file of ['../src/styles.css', '../extension/sidepanel.css']) {
    const css = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(css, /--accent: #B0674D/);
    // no stray oranges or reds from earlier design systems
    assert.doesNotMatch(css, /#fa6336|#e85d3d|#d84c27/i);
  }
});
