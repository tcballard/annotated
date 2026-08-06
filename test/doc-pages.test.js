import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('every public doc page is routed, rendered, and linked from the footer', () => {
  for (const [view, path] of [['about', '/about'], ['extension', '/extension'], ['audit', '/audit'], ['rights', '/rights'], ['terms', '/terms'], ['transparency', '/transparency']]) {
    assert.match(main, new RegExp(`${view}: '${path.replace('/', '\\/')}'`), `${view} missing from DOC_VIEWS`);
    assert.match(main, new RegExp(`state\\.activeView === '${view}'`), `${view} missing from render()`);
    assert.match(main, new RegExp(`data-view="${view}"`), `${view} not linked anywhere`);
  }
  const footer = main.slice(main.indexOf('const footerView'), main.indexOf('</footer>'));
  for (const label of ['About', 'Extension', 'Brief audit', 'Rights &amp; claims', 'Transparency', 'Terms', 'privacy.html']) {
    assert.ok(footer.includes(label), `footer missing ${label}`);
  }
});

test('the audit page carries all 11 brief requirements and the hosted-not-embedded stance', () => {
  const rows = main.slice(main.indexOf('const auditRows = ['), main.indexOf('const auditView'));
  const count = (rows.match(/\n  \['/g) || []).length;
  assert.equal(count, 11, `expected 11 audit rows, found ${count}`);
  assert.match(rows, /Hosted 240p clips — not third-party embeds/);
  assert.match(rows, /probe-verified/);
  assert.match(main, /rather than embedding third-party players/);
});

test('doc navigation stays in the SPA and old stub actions are gone', () => {
  assert.match(main, /if \(target\.tagName === 'A'\) event\.preventDefault\(\);/);
  assert.doesNotMatch(main, /rights-note|extension-note/);
  assert.match(css, /\.docbody/);
  assert.match(css, /\.audit-table/);
});
