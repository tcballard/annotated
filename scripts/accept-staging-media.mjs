import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cancelMediaJob, enqueueMediaJob } from '../server/media-worker.js';
import { removeStoredMedia } from '../server/media-store.js';
import { getObjectStore } from '../server/object-store.js';
import { closeStore, readStore, updateStore } from '../server/store.js';

const fixtures = [
  {
    name: 'audio',
    url: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
    sourceType: 'podcast',
    provider: 'podcast',
    title: 'Railway staging audio media smoke',
    expectedMime: /^audio\/webm/i,
  },
  {
    name: 'video',
    url: 'https://samplelib.com/preview/mp4/sample-5s.mp4',
    sourceType: 'video',
    provider: 'direct',
    title: 'Railway staging video media smoke',
    expectedMime: /^video\/mp4/i,
  },
];
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (process.env.ACCEPTANCE_MEDIA_SMOKE !== '1') {
  throw new Error('Set ACCEPTANCE_MEDIA_SMOKE=1 to run the destructive-and-cleanup staging smoke.');
}
assert.equal(process.env.NODE_ENV, 'production', 'The media smoke must run in production mode.');
assert.equal(process.env.ANNOTATED_STORAGE, 'postgres', 'The media smoke must use PostgreSQL.');
assert.equal(process.env.ANNOTATED_ASSET_STORAGE, 's3', 'The media smoke must use S3-compatible object storage.');

const origin = new URL(process.env.PUBLIC_ORIGIN || '');
assert.equal(origin.hostname, 'annotated-staging.up.railway.app', 'The media smoke is restricted to the Annotated Railway staging host.');
await getObjectStore().check();

const runFixture = async (fixture) => {
  const annotationId = randomUUID();
  const slug = `staging-media-smoke-${fixture.name}-${annotationId.slice(0, 8)}`;
  let job;
  let media;
  let cleanupError;
  try {
    await updateStore((store) => ({
      ...store,
      annotations: [...store.annotations, {
        id: annotationId,
        slug,
        status: 'published',
        createdAt: new Date().toISOString(),
        authorId: 'local-tom',
        sourceUrl: fixture.url,
        canonicalUrl: fixture.url,
        sourceTitle: fixture.title,
        sourceHost: 'samplelib.com',
        sourceType: fixture.sourceType,
        provider: fixture.provider,
        mediaStatus: 'queued',
        clipStart: 0,
        clipEnd: 1,
        commentaryMode: 'text',
        commentary: 'Temporary acceptance fixture; removed during cleanup.',
      }],
    }));

    job = await enqueueMediaJob({
      annotationId,
      sourceUrl: fixture.url,
      sourceType: fixture.sourceType,
      sourceMediaUrl: fixture.url,
      mediaUrl: fixture.url,
      provider: fixture.provider,
      clipStart: 0,
      clipEnd: 1,
    });

    const deadline = Date.now() + 120_000;
    let snapshot;
    while (Date.now() < deadline) {
      const store = await readStore();
      const currentJob = (store.mediaJobs || []).find((item) => item.id === job.id);
      const annotation = (store.annotations || []).find((item) => item.id === annotationId);
      if (currentJob?.status === 'failed') throw new Error(`Staging ${fixture.name} worker failed: ${currentJob.error || annotation?.mediaError || 'unknown error'}`);
      if (currentJob?.status === 'ready' && annotation?.mediaStatus === 'ready' && annotation.mediaAssetId) {
        snapshot = { currentJob, annotation, store };
        break;
      }
      await wait(1_000);
    }
    assert.ok(snapshot, `Staging ${fixture.name} media worker did not reach ready before the deadline.`);
    media = (snapshot.store.media || []).find((item) => item.id === snapshot.annotation.mediaAssetId);
    assert.ok(media, `Staging ${fixture.name} worker did not persist a media record.`);
    assert.match(media.mimeType || '', fixture.expectedMime, `Staging ${fixture.name} media record has the wrong MIME type.`);

    const delivery = await fetch(new URL(`/media/${media.id}`, origin), { redirect: 'manual' });
    assert.equal(delivery.status, 302, 'Published media must redirect to private object delivery.');
    const signedUrl = delivery.headers.get('location');
    assert.ok(signedUrl, 'Published media redirect must include a signed object URL.');
    const objectResponse = await fetch(signedUrl);
    assert.equal(objectResponse.status, 200, 'The signed object URL must serve the published media.');
    assert.match(objectResponse.headers.get('content-type') || '', fixture.expectedMime, `Staging ${fixture.name} object has the wrong MIME type.`);
    const bytes = Buffer.from(await objectResponse.arrayBuffer());
    assert.ok(bytes.length > 0, 'The delivered media object must not be empty.');

    return {
      name: fixture.name,
      sourceType: fixture.sourceType,
      fixture: fixture.url,
      jobStatus: snapshot.currentJob.status,
      mediaStatus: snapshot.annotation.mediaStatus,
      deliveryStatus: objectResponse.status,
      deliveryHost: new URL(signedUrl).hostname,
      mimeType: objectResponse.headers.get('content-type'),
      bytes: bytes.length,
    };
  } finally {
    if (job?.id) await cancelMediaJob(job.id, 'local-tom').catch((error) => { cleanupError ||= error; });
    if (media) await removeStoredMedia(media).catch((error) => { cleanupError ||= error; });
    await updateStore((store) => ({
      ...store,
      annotations: store.annotations.filter((item) => item.id !== annotationId),
      mediaJobs: (store.mediaJobs || []).filter((item) => item.id !== job?.id),
      media: (store.media || []).filter((item) => item.id !== media?.id),
    })).catch((error) => { cleanupError ||= error; });
    if (cleanupError) throw new Error(`Staging ${fixture.name} media smoke cleanup failed: ${cleanupError.message}`);
  }
};

try {
  const results = [];
  for (const fixture of fixtures) results.push(await runFixture(fixture));
  console.log(JSON.stringify({ status: 'passed', fixtures: results }, null, 2));
} finally {
  await closeStore();
}
