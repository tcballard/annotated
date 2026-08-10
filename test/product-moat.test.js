import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureDraftBlocker, normalizeCaptureDraft } from '../src/capture-state.js';
import { applyPanelDemoAction, createPanelDemoState, demoDraft } from '../src/panel-demo.js';
import { sanitizeProductEvent } from '../server/product-events.js';
import { canonicalSourceUrl, sourceIdentity } from '../server/source-identity.js';
import { annotationQrSvg, annotationShareDescriptor } from '../server/share-surfaces.js';

const migration = await readFile(new URL('../server/migrations/007_product_moat.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extension = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');
const extensionPanel = await readFile(new URL('../extension/sidepanel.html', import.meta.url), 'utf8');
const mediaStore = await readFile(new URL('../server/media-store.js', import.meta.url), 'utf8');
const mediaWorker = await readFile(new URL('../server/media-worker.js', import.meta.url), 'utf8');

test('exact source identity removes trackers, fragments, default ports, and parameter ordering', () => {
  const first = sourceIdentity('https://www.Example.com:443/story/?utm_source=x&b=2&a=1#quote');
  const second = sourceIdentity('https://example.com/story?a=1&b=2');
  assert.equal(first.id, second.id);
  assert.equal(first.canonicalUrl, 'https://example.com/story?a=1&b=2');
  assert.equal(canonicalSourceUrl('https://example.com/?fbclid=secret'), 'https://example.com/');
});

test('panel demo and packaged extension share the capture draft contract', () => {
  let state = createPanelDemoState();
  state = applyPanelDemoAction(state, 'demo-passage');
  state = applyPanelDemoAction(state, 'demo-note', 'Evidence should travel with context.');
  state = applyPanelDemoAction(state, 'demo-relation', 'adds_context');
  assert.equal(captureDraftBlocker(demoDraft(state)), '');
  state = applyPanelDemoAction(state, 'demo-publish');
  assert.equal(state.result.readOnly, true);
  assert.equal(state.result.relationType, 'adds_context');
  assert.match(extension, /normalizeCaptureDraft/);
  assert.match(extensionPanel, /id="relationSelect"/);
  assert.match(client, /\/extension\/demo/);
});

test('capture normalization preserves bounded exact anchors and typed relationships', () => {
  const draft = normalizeCaptureDraft({ sourceUrl: 'https://example.com', sourceType: 'article', sourceExcerpt: ' exact ', anchorParagraph: 3, relationType: 'corrects', commentary: 'note' });
  assert.deepEqual({ excerpt: draft.sourceExcerpt, paragraph: draft.anchorParagraph, relation: draft.relationType }, { excerpt: 'exact', paragraph: 3, relation: 'corrects' });
});

test('product events allow only the named funnel and discard sensitive metadata', () => {
  const event = sanitizeProductEvent({ eventName: 'shared', anonymousId: 'anon-1', metadata: { shareType: 'embed', fullUrl: 'https://private.example/history', passage: 'secret', note: 'secret' } });
  assert.deepEqual(event.metadata, { shareType: 'embed' });
  assert.throws(() => sanitizeProductEvent({ eventName: 'page_view' }), /Unknown product event/);
  assert.equal(sanitizeProductEvent({ eventName: 'shared', isDemo: true }), null);
});

test('share surfaces retain attribution, exact evidence, embeds, image and a real QR', async () => {
  const annotation = { id: 'a1', slug: 'proof', sourceTitle: 'Proof', sourceUrl: 'https://example.com/proof', sourceExcerpt: 'Exact words', sourceId: 'src_abc', sourceType: 'article', relationType: 'supports', author: { handle: 'tom' }, mediaStatus: 'ready' };
  const share = annotationShareDescriptor(annotation, 'https://annotated.example');
  assert.match(share.text, /@tom/);
  assert.equal(share.exactSource.sourceId, 'src_abc');
  assert.match(share.embedUrl, /\/embed\?v=1$/);
  assert.match(share.imageUrl, /\/og\/proof\.png$/);
  assert.match(await annotationQrSvg(annotation, 'https://annotated.example'), /<svg[^>]+viewBox/);
});

test('migration creates indexed source, receipt, publisher, and event contracts', () => {
  for (const table of ['publisher_workspaces', 'publisher_members', 'publisher_verifications', 'publisher_replies', 'publisher_audit']) assert.match(migration, new RegExp(`annotated_${table}`));
  for (const field of ['source_identity', 'relation_type', 'sha256', 'probe', 'verified_at', 'rights_state', 'idempotency_key']) assert.match(migration, new RegExp(field));
  assert.match(migration, /CREATE TRIGGER annotated_sources_assign_identity/);
  assert.match(migration, /NEW\.source_identity := 'src_' \|\| md5\(NEW\.canonical_url\)/);
  assert.match(migration, /annotated_annotations_exact_source_idx/);
  assert.match(api, /exactSourceGraph/);
  assert.match(api, /operator\/funnel/);
  assert.match(api, /annotationQrSvg/);
  assert.match(api, /annotation-embed', 120/);
  assert.match(api, /annotation-qr', 120/);
  assert.doesNotMatch(`${mediaStore}\n${mediaWorker}`, /rightsState: '(?:fair-use|licensed)'/, 'media processing must not infer a legal rights decision');
});
