import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isTopic, TOPIC_SLUGS, TOPICS, topicLabel } from '../server/topics.js';
import { validateAnnotation } from '../server/validation.js';

test('the taxonomy is small, slugged, and labelled', () => {
  assert.ok(TOPICS.length >= 8 && TOPICS.length <= 12, 'the list stays curated, not sprawling');
  for (const topic of TOPICS) {
    assert.match(topic.slug, /^[a-z]+$/);
    assert.ok(topic.label.length >= 2);
  }
  assert.equal(isTopic('ai'), true);
  assert.equal(isTopic('crypto-scams'), false);
  assert.equal(topicLabel('legal'), 'Legal');
  assert.equal(topicLabel('nope'), '');
  assert.deepEqual([...new Set(TOPIC_SLUGS)].length, TOPIC_SLUGS.length, 'slugs are unique');
});

test('annotations accept a valid topic, reject an invented one, default to none', () => {
  const base = { sourceUrl: 'https://example.com/story', sourceType: 'article', sourceTitle: 'Story', sourceExcerpt: 'A passage.', commentaryMode: 'text', commentary: 'A note.' };
  assert.equal(validateAnnotation({ ...base, topic: 'legal' }).normalized.topic, 'legal');
  assert.equal(validateAnnotation(base).normalized.topic, null);
  assert.equal(validateAnnotation({ ...base, topic: '' }).normalized.topic, null);
  assert.ok(validateAnnotation({ ...base, topic: 'made-up' }).errors.some((error) => /topic/.test(error)));
});

test('the web and extension taxonomy copies stay in lockstep with the server', async () => {
  const server = await readFile(new URL('../server/topics.js', import.meta.url), 'utf8');
  const web = await readFile(new URL('../src/topics.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../extension/topics.js', import.meta.url), 'utf8');
  assert.equal(web, server, 'src/topics.js must be a byte-for-byte copy of server/topics.js');
  assert.equal(panel, server, 'extension/topics.js must be a byte-for-byte copy of server/topics.js');
});
