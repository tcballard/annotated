import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { annotationCard, formatClipTime, ogCardData, renderOgCard, youtubeThumbnailUrl } from '../server/og-card.js';
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
  // The source is a line of its own, the shape a link preview is read in
  // (BBC's shared-quote card): the title in bold, then where it lives and
  // who kept it. No slogan crowds that row — the card's argument is the
  // quote standing next to its source.
  assert.match(flat, /"fontSize":31,"fontWeight":700/, 'the source title is the second voice, not a meta string');
  assert.match(flat, /kept by @tcballard/);
  assert.doesNotMatch(flat, /THE ORIGINAL IS ONE CLICK AWAY/, 'the slogan is retired');
  assert.doesNotMatch(flat, /SOURCE-FIRST NOTES/, 'the chrome bar carries the lockup alone');
});

test('the source line shows a thumbnail only when the body is not already showing it', () => {
  const shot = 'data:image/png;base64,SEVMTE8=';
  // a screenshot capture spends the body on the shot, so the source line
  // does not repeat it
  const shotCard = JSON.stringify(annotationCard({ ...ogCardData({ ...annotation, sourceType: 'article' }, author), screenshot: shot }));
  assert.equal((shotCard.match(/SEVMTE8=/g) || []).length, 1, 'the shot appears once, in the body');
  // a clip crops its poster to a strip, so the square beside the source is
  // the first full look at it
  const clipCard = JSON.stringify(annotationCard({ ...ogCardData(annotation, author), poster: shot }));
  assert.equal((clipCard.match(/SEVMTE8=/g) || []).length, 2, 'the poster rides in the band and beside the source');
});

test('the CLIP frame carries a poster when one exists, under its own overlays', () => {
  const poster = 'data:image/jpeg;base64,QUJD';
  const flat = JSON.stringify(annotationCard({ ...ogCardData(annotation, author), poster }));
  assert.match(flat, /data:image\/jpeg;base64,QUJD/, 'the poster rides inside the frame');
  assert.match(flat, /"CLIP"/, 'the CLIP tag stays on top of the poster');
  assert.match(flat, /0:48 · 240p/, 'the badge stays on top of the poster');
  assert.match(flat, /CardSerif/, 'the quote keeps its serif voice below the frame');
  const bare = JSON.stringify(annotationCard(ogCardData(annotation, author)));
  assert.doesNotMatch(bare, /data:image\/jpeg/, 'no poster, no phantom image node');
});

test('the YouTube thumbnail is derived from the video ID alone', () => {
  assert.equal(youtubeThumbnailUrl({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnailUrl({ sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=30' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnailUrl({ sourceUrl: 'https://youtube.com/shorts/dQw4w9WgXcQ' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnailUrl({ canonicalUrl: 'https://youtu.be/dQw4w9WgXcQ' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnailUrl({ sourceUrl: 'https://vimeo.com/12345' }), null, 'only YouTube derives a thumbnail');
  assert.equal(youtubeThumbnailUrl({ sourceUrl: 'https://youtube.com/watch?v=../../evil' }), null, 'a malformed ID derives nothing');
  assert.equal(youtubeThumbnailUrl({}), null);
});

test('a screenshot capture puts the shot itself on the card, replacing the serif block', () => {
  const article = { ...annotation, sourceType: 'article', screenshotAssetId: 'shot-1' };
  const shotData = { ...ogCardData(article, author), screenshot: 'data:image/png;base64,AAAA' };
  const flat = JSON.stringify(annotationCard(shotData));
  assert.match(flat, /"SHOT"/);
  assert.match(flat, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(flat, /CardSerif/);   // the source speaks visually here
  // Hosted media keeps its CLIP framing; a stray screenshot never displaces it.
  const clipData = { ...ogCardData(annotation, author), screenshot: 'data:image/png;base64,AAAA' };
  const clipFlat = JSON.stringify(annotationCard(clipData));
  assert.match(clipFlat, /"CLIP"/);
  assert.doesNotMatch(clipFlat, /"SHOT"/);
  assert.match(clipFlat, /CardSerif/);
});

test('permalink meta injection replaces the shell defaults — one og:image, the annotation’s', () => {
  const shell = `<html><head><title>annotated</title>
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/brand/og-default.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="/brand/og-default.png" />
  </head><body></body></html>`;
  const injected = injectAnnotationMeta(shell, annotation, author, 'https://annotated.example.com');
  assert.equal((injected.match(/property="og:image"/g) || []).length, 1);
  assert.equal((injected.match(/name="twitter:image"/g) || []).length, 1);
  assert.doesNotMatch(injected, /og-default\.png/);
  assert.match(injected, /og\/the-future-abc123\.png/);
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

test('the satori pipeline renders a card with a real embedded screenshot', async (t) => {
  const fontDir = process.env.OG_FONT_DIR || '/usr/share/fonts/truetype/dejavu';
  try {
    await access(`${fontDir}/DejaVuSans.ttf`);
  } catch {
    t.skip('card fonts unavailable in this environment');
    return;
  }
  const { Resvg } = await import('@resvg/resvg-js');
  const shotPng = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"><rect width="64" height="36" fill="#B0674D"/></svg>').render().asPng();
  const data = {
    ...ogCardData({ ...annotation, sourceType: 'article' }, author),
    screenshot: `data:image/png;base64,${Buffer.from(shotPng).toString('base64')}`,
  };
  const png = await renderOgCard(data);
  assert.ok(png.length > 10_000, 'PNG should be a real render');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
