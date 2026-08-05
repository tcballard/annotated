import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { annotationCard, formatClipTime, ogCardData, renderOgCard } from '../server/og-card.js';
import { escapeHtml, injectAnnotationMeta, permalinkMeta } from '../server/permalink-meta.js';

const annotation = {
  slug: 'the-future-abc123',
  sourceType: 'video',
  sourceTitle: 'The future is built by people who keep asking why',
  sourceHost: 'youtube.com',
  sourceExcerpt: 'The future is built by people who keep asking why.',
  commentary: 'The whole segment is really about incentive design, not curiosity.',
  clipStart: 14,
  clipEnd: 62,
};

const author = { handle: 'tcballard' };

test('OG card data maps the annotation onto the miniature-permalink fields', () => {
  const data = ogCardData(annotation, author);
  assert.equal(data.momentLabel, '0:14–1:02');
  assert.equal(data.clipBadge, '0:48 · 240p');
  assert.equal(data.author, 'tcballard');
  assert.equal(data.sourceDomain, 'youtube.com');
  const article = ogCardData({ ...annotation, sourceType: 'article', anchorParagraph: 6 }, author);
  assert.equal(article.momentLabel, '¶ 6');
  assert.equal(article.clipBadge, '');
  const podcast = ogCardData({ ...annotation, sourceType: 'podcast' }, author);
  assert.equal(podcast.clipBadge, '0:48 · audio');
  assert.equal(formatClipTime(75), '1:15');
});

test('the card tree carries the ink chrome, the CLIP framing, and both voices', () => {
  const tree = annotationCard(ogCardData(annotation, author));
  const flat = JSON.stringify(tree);
  assert.match(flat, /#33383F/);          // ink chrome bar
  assert.match(flat, /"CLIP"/);           // the 240p CLIP framing
  assert.match(flat, /0:48 · 240p/);
  assert.match(flat, /CardSerif/);        // the source speaks in serif
  assert.match(flat, /#B0674D/);          // terracotta on the moment
  assert.match(flat, /THE ORIGINAL IS ONE CLICK AWAY/);
});

test('permalink meta injection escapes values and fills every required tag', () => {
  const hostile = { ...annotation, commentary: 'A "note" with <script>alert(1)</script>' };
  const html = '<html><head><title>annotated</title><meta name="description" content="x" /></head><body></body></html>';
  const injected = injectAnnotationMeta(html, hostile, author, 'https://annotated.example.com');
  assert.match(injected, /<meta property="og:title" content="[^"]*@tcballard on annotated" \/>/);
  assert.match(injected, /<meta property="og:image" content="https:\/\/annotated\.example\.com\/og\/the-future-abc123\.png" \/>/);
  assert.match(injected, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(injected, /<link rel="canonical" href="https:\/\/annotated\.example\.com\/a\/the-future-abc123" \/>/);
  assert.doesNotMatch(injected, /<script>alert/);
  assert.match(injected, /&lt;script&gt;/);
  const meta = permalinkMeta(annotation, author, 'https://annotated.example.com');
  assert.match(meta.title, /^“The future is built by people who keep asking why\.” — @tcballard on annotated$/);
  assert.equal(escapeHtml('<&"\'>'), '&lt;&amp;&quot;&#39;&gt;');
});

test('the satori pipeline renders a PNG when card fonts are present', async (t) => {
  const fontDir = process.env.OG_FONT_DIR || '/usr/share/fonts/truetype/dejavu';
  try {
    await access(`${fontDir}/DejaVuSans.ttf`);
  } catch {
    t.skip('card fonts unavailable in this environment');
    return;
  }
  const png = await renderOgCard(ogCardData(annotation, author));
  assert.ok(png.length > 10_000, 'PNG should be a real render');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
