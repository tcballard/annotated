import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { checkStore, closeStore, readStore, storageDescription, updateStore } from './store.js';
import { normalizeAudioMimeType, serveStoredMedia, writeIncomingMedia } from './media-store.js';
import { getObjectStore } from './object-store.js';
import { cancelMediaJob, checkMediaRuntime, enqueueMediaJob, recoverMediaJobs, retryMediaJobForAnnotation } from './media-worker.js';
import { resolveSource } from './source-resolver.js';
import { matchesFeedQuery, normalizeFeedCursor, normalizeFeedLimit, normalizeFeedQuery } from './feed.js';
import { validateAnnotation, validateClaim, validateComment } from './validation.js';
import { assertAuthConfiguration, authIsRequired, currentUser, exchangeExtensionTicket, finishOAuth, logout, parseCookies, providerStatus, startOAuth } from './auth.js';
import { assertHardeningConfiguration, requestId, securityHeaders } from './hardening.js';
import { closeRateLimitStore, rateLimitAsync } from './rate-limit.js';
import { canUseAudioAsset } from './media-access.js';
import { metricsSnapshot, recordRequest } from './observability.js';
import { findIdempotentAnnotation } from './idempotency.js';
import { findActiveClaim, validateClaimTransition } from './moderation.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const require = createRequire(import.meta.url);
const { version: releaseVersion } = require('../package.json');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const corsOrigin = process.env.CORS_ORIGIN || '*';

const send = (response, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders({ api: true }), 'access-control-allow-origin': corsOrigin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-request-id', ...(corsOrigin === '*' ? {} : { 'access-control-allow-credentials': 'true', vary: 'Origin' }), ...headers });
  response.end(payload);
};

const notFound = (response) => send(response, 404, { error: 'Not found.' });
const redirect = (response, location, headers = {}) => {
  response.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  response.end();
};
const unauthorized = (response) => send(response, 401, { error: 'Sign in is required.' });
const forbidden = (response) => send(response, 403, { error: 'You do not have permission for this action.' });
const mutationAllowed = async (request, actor, name, limit = 60) => (await rateLimitAsync(`${request.socket?.remoteAddress || 'unknown'}:${actor?.id || 'anonymous'}:${name}`, { limit })).allowed;
const isModerator = (user) => Boolean(user && (['owner', 'admin', 'moderator'].includes(user.role) || String(process.env.MODERATOR_USER_IDS || '').split(',').map((value) => value.trim()).includes(user.id)));
const oauthErrorRedirect = (request) => {
  const fallback = `${process.env.APP_ORIGIN || publicOrigin}/?auth=error`;
  const returnTo = parseCookies(request.headers.cookie).annotated_oauth_return;
  if (!returnTo) return fallback;
  try {
    const target = new URL(returnTo);
    const appOrigin = new URL(process.env.APP_ORIGIN || publicOrigin).origin;
    const extension = target.protocol === 'https:' && target.hostname.endsWith('.chromiumapp.org');
    if (target.origin !== appOrigin && !extension) return fallback;
    target.searchParams.set('auth', 'error');
    return target.toString();
  } catch {
    return fallback;
  }
};

const readJson = async (request) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body is too large.');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new Error('Request body must be valid JSON.'); }
};

const slugify = (value) => String(value).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'annotation';
const publicUser = (user) => user ? {
  id: user.id,
  handle: user.handle,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl || null,
  bio: user.bio || '',
} : null;

const withComments = (annotation, store, viewerId = '') => ({
  ...annotation,
  url: `${publicOrigin}/a/${annotation.slug}`,
  audioUrl: annotation.audioAssetId ? `${publicOrigin}/media/${annotation.audioAssetId}` : null,
  clipUrl: annotation.mediaAssetId ? `${publicOrigin}/media/${annotation.mediaAssetId}` : null,
  author: publicUser((store.users || []).find((user) => user.id === annotation.authorId)) || { id: annotation.authorId, handle: annotation.authorId, displayName: annotation.authorId },
  likes: (store.likes || []).filter((like) => like.annotationId === annotation.id).length,
  likedByMe: Boolean(viewerId && (store.likes || []).some((like) => like.annotationId === annotation.id && like.userId === viewerId)),
  comments: (store.comments || []).filter((comment) => comment.annotationId === annotation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((comment) => ({ ...comment, author: publicUser((store.users || []).find((user) => user.id === comment.authorId)) || { id: comment.authorId, handle: comment.authorId } })),
  claims: undefined,
});

const handleApi = async (request, response, pathname) => {
  if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok', version: releaseVersion, persistence: storageDescription(), metrics: metricsSnapshot() });
  if (request.method === 'GET' && pathname === '/api/ready') {
    try {
      await checkStore();
      await getObjectStore().check();
      const mediaRuntime = process.env.NODE_ENV === 'production' ? await checkMediaRuntime({ includeProvider: true }) : { status: 'development' };
      return send(response, 200, { status: 'ready', persistence: storageDescription(), mediaRuntime });
    } catch (error) {
      return send(response, 503, { status: 'not-ready', error: error.message });
    }
  }
  if (request.method === 'GET' && pathname === '/api/auth/providers') return send(response, 200, { required: authIsRequired(), providers: providerStatus() });

  const authStartMatch = pathname.match(/^\/api\/auth\/(google|x)\/start$/);
  if (authStartMatch && request.method === 'GET') {
    try {
      const result = await startOAuth(request, authStartMatch[1], new URL(request.url || '/', publicOrigin).searchParams.get('return_to') || '');
      return redirect(response, result.location, { 'set-cookie': result.cookies });
    } catch (error) {
      return send(response, error.message.startsWith('Too many') ? 429 : 503, { error: error.message });
    }
  }

  const authCallbackMatch = pathname.match(/^\/api\/auth\/(google|x)\/callback$/);
  if (authCallbackMatch && request.method === 'GET') {
    try {
      const result = await finishOAuth(request, authCallbackMatch[1], new URL(request.url || '/', publicOrigin));
      return redirect(response, result.redirectTo || `${process.env.APP_ORIGIN || publicOrigin}/?auth=success`, { 'set-cookie': [result.cookie, ...result.clearCookies] });
    } catch (error) {
      console.error('OAuth callback failed:', error.message);
      return redirect(response, oauthErrorRedirect(request));
    }
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') return send(response, 200, { status: 'signed-out' }, { 'set-cookie': await logout(request) });

  if (request.method === 'POST' && pathname === '/api/auth/extension/exchange') {
    const payload = await readJson(request);
    try { return send(response, 200, await exchangeExtensionTicket(payload.ticket)); } catch (error) { return send(response, 401, { error: error.message }); }
  }

  if (request.method === 'GET' && pathname === '/api/me') {
    const user = await currentUser(request);
    return user ? send(response, 200, { user, authenticated: true }) : unauthorized(response);
  }

  if (request.method === 'POST' && pathname === '/api/sources/resolve') {
    const payload = await readJson(request);
    return send(response, 200, { source: await resolveSource(payload.url) });
  }

  if (request.method === 'POST' && pathname === '/api/media/audio') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    let mimeType;
    try { mimeType = normalizeAudioMimeType(request.headers['content-type']); } catch (error) { return send(response, 415, { error: error.message }); }
    if (!(await mutationAllowed(request, actor, 'audio-upload', 10))) return send(response, 429, { error: 'Too many audio uploads. Try again later.' }, { 'retry-after': '60' });
    const media = await writeIncomingMedia(request, mimeType);
    await updateStore((store) => ({ ...store, media: [...(store.media || []), { id: media.id, key: media.key, fileName: media.fileName, mimeType: media.mimeType, bytes: media.bytes, ownerId: actor?.id || 'local-tom', createdAt: media.createdAt }] }));
    return send(response, 201, { media: { id: media.id, mimeType: media.mimeType, bytes: media.bytes, url: `${publicOrigin}/media/${media.id}` } });
  }

  if (request.method === 'GET' && pathname === '/api/feed') {
    const store = await readStore();
    const viewer = await currentUser(request);
    const query = new URL(request.url || '/', publicOrigin).searchParams;
    const limit = normalizeFeedLimit(query.get('limit'));
    const offset = normalizeFeedCursor(query.get('cursor'));
    const sourceType = query.get('sourceType');
    const search = normalizeFeedQuery(query.get('q'));
    const followingOnly = query.get('following') === 'true' && viewer;
    const followedIds = new Set((store.follows || []).filter((follow) => follow.followerId === viewer?.id).map((follow) => follow.followingId));
    const candidates = store.annotations.filter((item) => item.status === 'published' && (!sourceType || item.sourceType === sourceType) && (!followingOnly || followedIds.has(item.authorId) || item.authorId === viewer.id) && matchesFeedQuery(item, store.users || [], search)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = candidates.slice(offset, offset + limit);
    return send(response, 200, { annotations: page.map((item) => withComments(item, store, viewer?.id)), nextCursor: offset + page.length < candidates.length ? String(offset + page.length) : null, query: search || null });
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && request.method === 'GET') {
    const store = await readStore();
    const profile = (store.users || []).find((user) => user.handle === decodeURIComponent(profileMatch[1]) || user.id === decodeURIComponent(profileMatch[1]));
    if (!profile) return notFound(response);
    const viewer = await currentUser(request);
    const annotationCount = store.annotations.filter((annotation) => annotation.authorId === profile.id && annotation.status === 'published').length;
    const annotations = store.annotations
      .filter((annotation) => annotation.authorId === profile.id && annotation.status === 'published')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((annotation) => withComments(annotation, store, viewer?.id));
    return send(response, 200, {
      profile: {
        ...publicUser(profile),
        followers: (store.follows || []).filter((follow) => follow.followingId === profile.id).length,
        following: (store.follows || []).filter((follow) => follow.followerId === profile.id).length,
        isFollowing: Boolean(viewer && (store.follows || []).some((follow) => follow.followerId === viewer.id && follow.followingId === profile.id)),
        annotationCount,
        annotations,
      },
    });
  }

  const followMatch = pathname.match(/^\/api\/users\/([^/]+)\/(follow|unfollow)$/);
  if (followMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const targetId = decodeURIComponent(followMatch[1]);
    const knownUsers = (await readStore()).users || [];
    if (!knownUsers.some((user) => user.id === targetId)) return notFound(response);
    if (targetId === actor?.id) return send(response, 422, { error: 'You cannot follow yourself.' });
    if (!(await mutationAllowed(request, actor, 'follow', 60))) return send(response, 429, { error: 'Too many follow changes. Try again later.' }, { 'retry-after': '60' });
    let following = followMatch[2] === 'follow';
    const result = await updateStore((store) => {
      const exists = (store.follows || []).some((follow) => follow.followerId === (actor?.id || 'local-tom') && follow.followingId === targetId);
      const follows = following && !exists
        ? [...(store.follows || []), { id: randomUUID(), followerId: actor?.id || 'local-tom', followingId: targetId, createdAt: new Date().toISOString() }]
        : !following ? (store.follows || []).filter((follow) => !(follow.followerId === (actor?.id || 'local-tom') && follow.followingId === targetId)) : store.follows || [];
      return { ...store, follows };
    });
    following = result.follows.some((follow) => follow.followerId === (actor?.id || 'local-tom') && follow.followingId === targetId);
    return send(response, 200, { following });
  }

  const cancelJobMatch = pathname.match(/^\/api\/media\/jobs\/([0-9a-f-]+)\/cancel$/i);
  if (cancelJobMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const cancelled = await cancelMediaJob(cancelJobMatch[1], actor?.id || 'local-tom');
    return cancelled ? send(response, 200, { status: 'cancelled' }) : send(response, 404, { error: 'Media job not found or cannot be cancelled.' });
  }

  const retryMediaMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/media\/retry$/);
  if (retryMediaMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'media-retry', 10))) return send(response, 429, { error: 'Too many media retries. Try again later.' }, { 'retry-after': '60' });
    const store = await readStore();
    const annotation = store.annotations.find((item) => item.slug === retryMediaMatch[1] || item.id === retryMediaMatch[1]);
    if (!annotation) return notFound(response);
    const job = await retryMediaJobForAnnotation(annotation.id, actor?.id || 'local-tom');
    if (!job) return send(response, 409, { error: 'This annotation has no failed media job available to retry.' });
    const next = await readStore();
    const updated = next.annotations.find((item) => item.id === annotation.id);
    return send(response, 202, { annotation: withComments(updated, next, actor?.id), job: { id: job.id, status: job.status } });
  }

  if (request.method === 'POST' && pathname === '/api/annotations') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'annotation', 30))) return send(response, 429, { error: 'Too many publishes. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const { errors, normalized } = validateAnnotation(payload);
    if (errors.length) return send(response, 422, { errors });
    if (normalized.commentaryMode === 'audio') {
      const store = await readStore();
      const media = (store.media || []).find((item) => item.id === normalized.audioAssetId);
      if (!canUseAudioAsset(media, actor)) return send(response, 422, { errors: ['The uploaded audio asset could not be found or is not owned by this account.'] });
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const baseSlug = slugify(normalized.sourceTitle);
    const isMedia = normalized.sourceType !== 'article';
    const ownerId = actor?.id || 'local-tom';
    const candidate = { id, slug: `${baseSlug}-${id.slice(0, 6)}`, status: 'published', createdAt: now, authorId: ownerId, mediaStatus: isMedia ? 'queued' : 'not-applicable', ...normalized };
    let created = false;
    let annotation;
    const next = await updateStore((store) => {
      const existing = findIdempotentAnnotation(store.annotations, ownerId, normalized.clientRequestId);
      if (existing) {
        annotation = existing;
        return store;
      }
      created = true;
      annotation = candidate;
      return { ...store, annotations: [...store.annotations, annotation] };
    });
    if (!created) return send(response, 200, { annotation: withComments(annotation, next, actor?.id) });
    if (isMedia) void enqueueMediaJob({ annotationId: id, sourceUrl: normalized.sourceUrl, sourceType: normalized.sourceType, sourceMediaUrl: normalized.mediaUrl, mediaUrl: normalized.mediaUrl, provider: normalized.provider, clipStart: normalized.clipStart, clipEnd: normalized.clipEnd }).catch((error) => console.error(error));
    return send(response, 201, { annotation: withComments(annotation, next) });
  }

  const annotationMatch = pathname.match(/^\/api\/annotations\/([^/]+)$/);
  if (annotationMatch && request.method === 'GET') {
    const store = await readStore();
    const annotation = store.annotations.find((item) => item.slug === annotationMatch[1] || item.id === annotationMatch[1]);
    return annotation ? send(response, 200, { annotation: withComments(annotation, store) }) : notFound(response);
  }

  const commentsMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/comments$/);
  if (commentsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'comment', 30))) return send(response, 429, { error: 'Too many comments. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const validation = validateComment(payload);
    if (validation.error) return send(response, 422, { error: validation.error });
    const now = new Date().toISOString();
    const result = await updateStore((store) => {
      const annotation = store.annotations.find((item) => item.slug === commentsMatch[1] || item.id === commentsMatch[1]);
      if (!annotation) return store;
      store.comments.push({ id: randomUUID(), annotationId: annotation.id, authorId: actor?.id || 'local-tom', body: validation.body, createdAt: now });
      return store;
    });
    const annotation = result.annotations.find((item) => item.slug === commentsMatch[1] || item.id === commentsMatch[1]);
    return annotation ? send(response, 201, { annotation: withComments(annotation, result, actor?.id) }) : notFound(response);
  }

  const likeMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/(like|unlike)$/);
  if (likeMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'like', 120))) return send(response, 429, { error: 'Too many like changes. Try again later.' }, { 'retry-after': '60' });
    const result = await updateStore((store) => {
      const annotation = store.annotations.find((item) => item.slug === likeMatch[1] || item.id === likeMatch[1]);
      if (!annotation) return store;
      const userId = actor?.id || 'local-tom';
      const key = (like) => like.annotationId === annotation.id && like.userId === userId;
      const likes = likeMatch[2] === 'like' ? ((store.likes || []).some(key) ? store.likes : [...(store.likes || []), { id: randomUUID(), annotationId: annotation.id, userId, createdAt: new Date().toISOString() }]) : (store.likes || []).filter((like) => !key(like));
      return { ...store, likes };
    });
    const annotation = result.annotations.find((item) => item.slug === likeMatch[1] || item.id === likeMatch[1]);
    return annotation ? send(response, 200, { annotation: withComments(annotation, result, actor?.id) }) : notFound(response);
  }

  const claimsMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/claims$/);
  if (claimsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'claim', 10))) return send(response, 429, { error: 'Too many claims. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const validation = validateClaim(payload);
    if (validation.error) return send(response, 422, { error: validation.error });
    const reporterId = actor?.id || 'local-tom';
    let created = false;
    let claim;
    const result = await updateStore((store) => {
      const annotation = store.annotations.find((item) => item.slug === claimsMatch[1] || item.id === claimsMatch[1]);
      if (!annotation) return store;
      const existing = findActiveClaim(store.claims, annotation.id, reporterId);
      if (existing) { claim = existing; return store; }
      created = true;
      claim = { id: randomUUID(), annotationId: annotation.id, reason: validation.reason, status: 'open', reporterId, createdAt: new Date().toISOString() };
      return {
        ...store,
        claims: [...(store.claims || []), claim],
        moderationAudit: [...(store.moderationAudit || []), { id: randomUUID(), claimId: claim.id, actorId: reporterId, from: null, to: 'open', note: '', createdAt: new Date().toISOString() }],
      };
    });
    const annotation = result.annotations.find((item) => item.slug === claimsMatch[1] || item.id === claimsMatch[1]);
    if (!annotation) return notFound(response);
    return send(response, created ? 201 : 200, { status: created ? 'received' : 'already-received', claim: { id: claim.id, status: claim.status } });
  }

  if (request.method === 'GET' && pathname === '/api/claims') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const store = await readStore();
    const reporterId = actor?.id || 'local-tom';
    return send(response, 200, { claims: (store.claims || []).filter((claim) => claim.reporterId === reporterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((claim) => ({ ...claim, annotation: store.annotations.find((item) => item.id === claim.annotationId) || null })) });
  }

  if (request.method === 'GET' && pathname === '/api/moderation/claims') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!isModerator(actor)) return forbidden(response);
    const store = await readStore();
    return send(response, 200, { claims: (store.claims || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((claim) => ({ ...claim, annotation: store.annotations.find((item) => item.id === claim.annotationId) || null, reporter: store.users.find((user) => user.id === claim.reporterId) || null })) });
  }

  const moderateClaimMatch = pathname.match(/^\/api\/moderation\/claims\/([^/]+)$/);
  if (moderateClaimMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!isModerator(actor)) return forbidden(response);
    if (!(await mutationAllowed(request, actor, 'moderation', 60))) return send(response, 429, { error: 'Too many moderation changes. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const currentStore = await readStore();
    const currentClaim = (currentStore.claims || []).find((item) => item.id === moderateClaimMatch[1]);
    if (!currentClaim) return notFound(response);
    const transitionError = validateClaimTransition(currentClaim.status, payload.status);
    if (transitionError) return send(response, 422, { error: transitionError });
    let found = false;
    const result = await updateStore((store) => {
      const claim = (store.claims || []).find((item) => item.id === moderateClaimMatch[1]);
      if (!claim) return store;
      found = true;
      const updated = { ...claim, status: payload.status, moderatorId: actor.id, resolutionNote: String(payload.note || '').slice(0, 2000), updatedAt: new Date().toISOString() };
      return { ...store, claims: store.claims.map((item) => item.id === claim.id ? updated : item), moderationAudit: [...(store.moderationAudit || []), { id: randomUUID(), claimId: claim.id, actorId: actor.id, from: claim.status, to: updated.status, note: updated.resolutionNote, createdAt: new Date().toISOString() }] };
    });
    return found ? send(response, 200, { claim: result.claims.find((item) => item.id === moderateClaimMatch[1]) }) : notFound(response);
  }

  return null;
};

const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const serveMedia = async (response, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound(response);
  const store = await readStore();
  const media = (store.media || []).find((item) => item.id === id);
  if (!media) return notFound(response);
  return serveStoredMedia(response, media);
};

const serveStatic = async (request, response, pathname) => {
  const relative = pathname === '/' ? 'dist/index.html' : pathname.replace(/^\//, '');
  const candidate = path.resolve(projectRoot, relative.startsWith('dist/') ? relative : `dist/${relative}`);
  if (!candidate.startsWith(path.resolve(projectRoot, 'dist'))) return notFound(response);
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return notFound(response);
    response.writeHead(200, { 'content-type': contentType[path.extname(candidate)] || 'application/octet-stream', ...securityHeaders() });
    return createReadStream(candidate).pipe(response);
  } catch {
    if (request.method === 'GET' && !path.extname(pathname)) {
      try { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders() }); return createReadStream(path.join(projectRoot, 'dist/index.html')).pipe(response); } catch { return notFound(response); }
    }
    return notFound(response);
  }
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', publicOrigin);
  const id = requestId(request);
  const startedAt = process.hrtime.bigint();
  response.setHeader('x-request-id', id);
  response.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordRequest({ method: request.method || 'UNKNOWN', path: url.pathname, status: response.statusCode, durationMs });
    console.info(JSON.stringify({ event: 'http_request', requestId: id, method: request.method, path: url.pathname, status: response.statusCode, durationMs: Math.round(durationMs) }));
  });
  try {
    if (url.pathname.startsWith('/api/') && corsOrigin !== '*' && request.headers.origin && request.headers.origin !== corsOrigin) return send(response, 403, { error: 'Request origin is not allowed.' }, { 'access-control-allow-origin': 'null' });
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return send(response, 204, '');
    if (request.method === 'GET' && url.pathname.startsWith('/media/')) return serveMedia(response, url.pathname.slice('/media/'.length));
    if (url.pathname.startsWith('/api/')) {
      const result = await handleApi(request, response, url.pathname);
      if (result !== null) return;
    }
    if (request.method === 'GET') return serveStatic(request, response, url.pathname);
    return notFound(response);
  } catch (error) {
    console.error(error);
    return send(response, error.message === 'Request body is too large.' || error.message === 'Media payload is too large.' ? 413 : 400, { error: error.message || 'Request failed.' });
  }
});

server.listen(port, host, () => {
  assertHardeningConfiguration();
  assertAuthConfiguration();
  getObjectStore();
  console.log(`annotated server listening on http://localhost:${port}`);
  recoverMediaJobs().catch((error) => console.error('media recovery failed', error));
});

const shutdown = async () => {
  await closeRateLimitStore().catch((error) => console.error('rate-limit shutdown failed', error));
  await closeStore().catch((error) => console.error('store shutdown failed', error));
  server.close(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
