// Idempotent, transparently labelled staging proof data. This runs during
// deploy only for the canonical staging service (or with an explicit opt-in).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const canonicalOrigin = JSON.parse(await readFile(path.join(projectRoot, 'config/capabilities.json'), 'utf8')).canonicalOrigin;
const explicit = process.env.ANNOTATED_SEED_PROOF_WORLD === 'allow';
let deploymentOrigin = null;
try { deploymentOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null; } catch { /* The normal boot validation reports malformed origins. */ }
const staging = deploymentOrigin === canonicalOrigin;
if (!explicit && !staging) {
  console.log('Proof-world seed skipped: this is not the canonical staging deployment.');
  process.exit(0);
}

await execFileAsync(process.execPath, ['scripts/seed-personas.mjs'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ANNOTATED_SEED_PERSONAS: 'allow' },
});

const { closeStore, readStore, updateStore } = await import('../server/store.js');
const { storeMediaFile } = await import('../server/media-store.js');
const now = new Date().toISOString();
const ids = {
  screenshot: '11111111-1111-4111-8111-111111111111',
  audio: '22222222-2222-4222-8222-222222222222',
  screenshotAnnotation: '33333333-3333-4333-8333-333333333333',
  audioAnnotation: '44444444-4444-4444-8444-444444444444',
  videoAnnotation: '55555555-5555-4555-8555-555555555555',
  podcastAnnotation: '66666666-6666-4666-8666-666666666666',
  videoJob: '77777777-7777-4777-8777-777777777777',
  podcastJob: '88888888-8888-4888-8888-888888888888',
  claim: '99999999-9999-4999-8999-999999999999',
  audit: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

let store = await readStore();
const author = (store.users || []).find((user) => user.handle === 'dev.notes');
if (!author) throw new Error('Proof-world personas were not created.');
const media = [...(store.media || [])];
if (!media.some((item) => item.id === ids.screenshot)) {
  const result = await storeMediaFile(path.join(projectRoot, 'public/brand/og-default.png'), { id: ids.screenshot, key: `shots/${ids.screenshot}.png`, mimeType: 'image/png' });
  media.push({ id: ids.screenshot, key: `shots/${ids.screenshot}.png`, fileName: result.fileName, mimeType: 'image/png', bytes: result.bytes, kind: 'screenshot', isDemo: true, createdAt: now });
}
if (!media.some((item) => item.id === ids.audio)) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotated-proof-'));
  const audioPath = path.join(temporary, 'demonstration-note.mp3');
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-codec:a', 'libmp3lame', '-q:a', '7', audioPath]);
    const result = await storeMediaFile(audioPath, { id: ids.audio, key: `audio/${ids.audio}.mp3`, mimeType: 'audio/mpeg' });
    media.push({ id: ids.audio, key: `audio/${ids.audio}.mp3`, fileName: result.fileName, mimeType: 'audio/mpeg', bytes: result.bytes, durationSeconds: 1, kind: 'audio-note', isDemo: true, createdAt: now });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

await updateStore((current) => {
  const annotations = [...(current.annotations || [])];
  const add = (annotation) => { if (!annotations.some((item) => item.id === annotation.id)) annotations.push(annotation); };
  const base = { authorId: author.id, status: 'published', visibility: 'public', isDemo: true, createdAt: now, openCount: 0, topic: 'tech' };
  add({ ...base, id: ids.screenshotAnnotation, slug: 'demonstration-screenshot-proof', sourceType: 'article', sourceUrl: 'https://github.com/tcballard/annotated', canonicalUrl: 'https://github.com/tcballard/annotated', sourceHost: 'github.com', sourceTitle: 'Annotated demonstration capture', sourceExcerpt: '', screenshotAssetId: ids.screenshot, commentaryMode: 'text', commentary: 'Demonstration: an Annotated-owned image proves the screenshot path without representing user activity.', mediaStatus: 'not-applicable', clientRequestId: 'proof-screenshot' });
  add({ ...base, id: ids.audioAnnotation, slug: 'demonstration-audio-commentary-proof', sourceType: 'article', sourceUrl: 'https://github.com/tcballard/annotated', canonicalUrl: 'https://github.com/tcballard/annotated', sourceHost: 'github.com', sourceTitle: 'Annotated audio commentary demonstration', sourceExcerpt: 'This generated tone is demonstration media, not a recording from a user.', commentaryMode: 'audio', commentary: '', audioAssetId: ids.audio, audioDuration: 1, mediaStatus: 'not-applicable', clientRequestId: 'proof-audio' });
  add({ ...base, id: ids.videoAnnotation, slug: 'demonstration-video-clip-proof', sourceType: 'video', sourceUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', canonicalUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', sourceHost: 'media.w3.org', sourceTitle: 'Sintel trailer — demonstration clip', sourceExcerpt: '', commentaryMode: 'text', commentary: 'Demonstration clip used to exercise the bounded hosted-video pipeline.', clipStart: 0, clipEnd: 3, mediaStatus: 'queued', clientRequestId: 'proof-video' });
  add({ ...base, id: ids.podcastAnnotation, slug: 'demonstration-podcast-clip-proof', sourceType: 'podcast', sourceUrl: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', canonicalUrl: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', sourceHost: 'samplelib.com', sourceTitle: 'Sample audio — demonstration podcast clip', sourceExcerpt: '', commentaryMode: 'text', commentary: 'Demonstration audio used to exercise the bounded podcast pipeline.', clipStart: 0, clipEnd: 3, mediaStatus: 'queued', clientRequestId: 'proof-podcast' });
  const mediaJobs = [...(current.mediaJobs || [])];
  const addJob = (job) => {
    const annotation = annotations.find((item) => item.id === job.annotationId);
    if (annotation?.mediaAssetId) return;
    const index = mediaJobs.findIndex((item) => item.id === job.id);
    if (index < 0) mediaJobs.push(job);
    else if (['failed', 'cancelled', 'superseded'].includes(mediaJobs[index].status)) mediaJobs[index] = job;
    if (annotation && ['failed', 'cancelled'].includes(annotation.mediaStatus)) {
      Object.assign(annotation, { mediaStatus: 'queued', mediaError: null });
    }
  };
  addJob({ id: ids.videoJob, annotationId: ids.videoAnnotation, sourceUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', sourceType: 'video', clipStart: 0, clipEnd: 3, attempts: 0, status: 'queued', isDemo: true, createdAt: now });
  addJob({ id: ids.podcastJob, annotationId: ids.podcastAnnotation, sourceUrl: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', mediaUrl: 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', provider: 'podcast', sourceType: 'podcast', clipStart: 0, clipEnd: 3, attempts: 0, status: 'queued', isDemo: true, createdAt: now });
  const claims = [...(current.claims || [])];
  if (!claims.some((item) => item.id === ids.claim)) claims.push({ id: ids.claim, annotationId: ids.screenshotAnnotation, reason: 'Demonstration claim used to prove the moderation workflow; not a real rights complaint.', status: 'resolved', reporterId: author.id, moderatorId: author.id, resolutionNote: 'Demonstration only — no takedown.', isDemo: true, createdAt: now, updatedAt: now });
  const moderationAudit = [...(current.moderationAudit || [])];
  if (!moderationAudit.some((item) => item.id === ids.audit)) moderationAudit.push({ id: ids.audit, claimId: ids.claim, actorId: author.id, from: 'open', to: 'resolved', note: 'Demonstration only.', isDemo: true, createdAt: now });
  return { ...current, media, annotations, mediaJobs, claims, moderationAudit };
});

store = await readStore();
console.log(`Proof world ready: ${store.annotations.filter((item) => item.isDemo).length} labelled demonstration annotations.`);
await closeStore();
