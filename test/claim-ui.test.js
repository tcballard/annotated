import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const metaSource = await readFile(new URL('../server/permalink-meta.js', import.meta.url), 'utf8');

// The bounty's verbatim hard requirement: "Every annotation page must
// include a clearly visible button to dispute fair use breaches." The
// button says exactly that, wears a bordered treatment so it reads as a
// real button among the quiet actions, and the dispute path survives
// with JavaScript off via a no-script link to the plain form.
test('every annotation page carries a clearly visible Dispute fair use button', () => {
  const permalink = mainSource.match(/const permalinkView = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(permalink, /class="act claim"/u);
  assert.match(permalink, /data-action="toggle-claim"/u);
  assert.match(permalink, /data-claim-slug="\$\{escapeHTML\(item\.slug\)\}"/u);
  assert.match(permalink, /Dispute fair use/u);
  assert.match(mainSource, /const claimSlug = state\.claimSlug \|\| state\.publishedSlug/u);
  assert.match(mainSource, /api\.fileClaim\(claimSlug, reason\)/u);
  // clearly visible: the dispute action is bordered, not just another link
  assert.match(styles, /\.act\.claim \{ border: 1px solid var\(--border\)/u);
});

test('the dispute path works without JavaScript on every served annotation page', () => {
  // the meta injector adds a no-script dispute link to every permalink shell…
  assert.match(metaSource, /noscript/u);
  assert.match(metaSource, /dispute fair use on this annotation/u);
  assert.match(metaSource, /\/a\/\$\{encodeURIComponent\(annotation\.slug\)\}\/claim/u);
  // …and the plain form itself speaks the same words
  assert.match(serverSource, /'Dispute fair use'/u);
  assert.match(serverSource, /Send dispute/u);
});

test('dispute filing confirms receipt and keeps the report on failure', () => {
  assert.match(mainSource, /state\.claimSubmitted = true/u);
  assert.match(mainSource, /Dispute received/u);
  assert.match(mainSource, /Your report is still here/u);
});
