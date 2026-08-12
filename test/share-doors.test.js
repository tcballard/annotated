import assert from 'node:assert/strict';
import test from 'node:test';
import { shareDescriptor, shareTargets } from '../src/share-kit.js';
import { BRAND_ICONS } from '../src/icons.js';

const annotation = {
  slug: 'memex-trails-1945',
  sourceTitle: 'As We May Think',
  sourceExcerpt: 'Wholly new forms of encyclopedias will appear',
  handle: 'quietsignal',
};
const descriptor = shareDescriptor(annotation, 'https://annotated.example');

test('the share doors are the same four, in the same order, from one contract', () => {
  const doors = shareTargets(descriptor);
  assert.deepEqual(doors.map((door) => door.id), ['x', 'whatsapp', 'bluesky', 'email']);
  for (const door of doors) assert.ok(door.label && door.href, `${door.id} has a label and a door`);
});

test('the X intent carries text and url separately, without doubling the link', () => {
  const x = shareTargets(descriptor).find((door) => door.id === 'x');
  const parsed = new URL(x.href);
  assert.equal(parsed.origin + parsed.pathname, 'https://x.com/intent/post');
  assert.equal(parsed.searchParams.get('url'), descriptor.url);
  assert.ok(!parsed.searchParams.get('text').includes(descriptor.url), 'the text must not repeat the url the intent already carries');
  assert.ok(parsed.searchParams.get('text').includes('@quietsignal'), 'the attribution rides along');
});

test('WhatsApp and Bluesky carry the full attributed excerpt, link included', () => {
  const doors = shareTargets(descriptor);
  for (const id of ['whatsapp', 'bluesky']) {
    const door = doors.find((entry) => entry.id === id);
    const text = new URL(door.href).searchParams.get('text');
    assert.ok(text.includes(descriptor.url), `${id} text carries the public link`);
    assert.ok(text.includes('“Wholly new forms'), `${id} text carries the excerpt`);
  }
});

test('email gets a subject and a body', () => {
  const email = shareTargets(descriptor).find((door) => door.id === 'email');
  assert.ok(email.href.startsWith('mailto:?subject='));
  assert.ok(decodeURIComponent(email.href).includes('As We May Think'));
});

test('the brand marks are filled shapes scoped to the share sheet', () => {
  assert.deepEqual(Object.keys(BRAND_ICONS).sort(), ['bluesky', 'whatsapp', 'x']);
  for (const [name, svg] of Object.entries(BRAND_ICONS)) {
    assert.ok(svg.startsWith('<svg viewBox="0 0 24 24" fill="currentColor"'), `${name} is a filled brand mark, not product stroke vocabulary`);
  }
});
