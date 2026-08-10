import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const capabilityManifest = JSON.parse(await readFile(new URL('../config/capabilities.json', import.meta.url), 'utf8'));

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

test('the audit page renders all 11 evidence-backed requirements from the capability manifest', () => {
  assert.equal(capabilityManifest.capabilities.length, 11);
  const hosted = capabilityManifest.capabilities.find((item) => item.id === 'hosted-clips');
  assert.equal(hosted.label, 'Hosted 240p clips');
  assert.match(hosted.summary, /rather than embedding/i);
  assert.match(hosted.evidenceUrl, /media-worker\.js/);
  assert.match(main, /truth\?\.capabilities/);
  assert.match(main, /Implemented, deployed and externally verified are separate states/);
});

test('doc navigation stays in the SPA and old stub actions are gone', () => {
  assert.match(main, /if \(target\.tagName === 'A'\) event\.preventDefault\(\);/);
  assert.doesNotMatch(main, /rights-note|extension-note/);
  assert.match(css, /\.docbody/);
  assert.match(css, /\.audit-table/);
});

// The five differentiation claims must survive a 90-second skim: named on
// the About page in-product, and scripted beat-for-beat in the demo.
test('the differentiation claims are legible on About and scripted in the demo', async () => {
  const about = main.slice(main.indexOf('const aboutView'), main.indexOf('const extensionView'));
  assert.match(about, /What makes this different/);
  for (const claim of ['Real clip artifacts', 'Four capture modes', 'A public margin, not a private vault', 'Round-trip receipts', 'Rights as a surface']) {
    assert.ok(about.includes(claim), `About is missing the "${claim}" claim`);
  }
  const demo = await readFile(new URL('../docs/DEMO.md', import.meta.url), 'utf8');
  for (const beat of ['Four capture modes', 'Real clip artifacts', 'A public margin', 'Round-trip receipts', 'Rights as a surface']) {
    assert.ok(demo.includes(beat), `DEMO.md is missing the "${beat}" beat`);
  }
  assert.match(demo, /Dispute fair use/);
});
