import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { checkStore, closeStore, storageDescription } from './store.js';
import { normalizeAudioMimeType, normalizeImageMimeType, removeStoredMedia, serveStoredMedia, writeIncomingImage, writeIncomingMedia } from './media-store.js';
import { getObjectStore } from './object-store.js';
import { cancelMediaJob, enqueueMediaJob, mediaWorkerExecution, recoverMediaJobs, retryMediaJobForAnnotation } from './media-worker.js';
import { resolveSource } from './source-resolver.js';
import { followingFeedRequiresAuth, normalizeFeedCursor, normalizeFeedLimit, normalizeFeedQuery, normalizeSourceUrlKey } from './feed.js';
import { ogCardData, renderOgCardCached } from './og-card.js';
import { escapeHtml, injectAnnotationMeta } from './permalink-meta.js';
import { allowsIndexing, canViewAnnotation, VISIBILITIES } from './visibility.js';
import { normalizeHost } from './discovery.js';
import { isTopic } from './topics.js';
import { validateAnnotation, validateClaim, validateComment } from './validation.js';
import { assertAuthConfiguration, authIsRequired, currentUser, exchangeExtensionTicket, finishOAuth, logout, mobileTicketSession, parseCookies, providerStatus, startOAuth } from './auth.js';
import { assertHardeningConfiguration, requestId, securityHeaders } from './hardening.js';
import { closeRateLimitStore, rateLimitAsync } from './rate-limit.js';
import { canUseAudioAsset, canUseImageAsset } from './media-access.js';
import { metricsSnapshot, recordRequest } from './observability.js';
import { mediaQueueSnapshot } from './media-job-repository.js';
import { validateClaimTransition } from './moderation.js';
import { canEditCommentary, removalTombstone, validateModerationAction } from './annotation-lifecycle.js';
import { isChromeExtensionRedirectUrl, resolveCorsOrigin } from './cors.js';
import { getCapabilities } from './capabilities.js';
import { exactSourceGraph } from './evidence-graph.js';
import { recordProductEvent, productFunnel } from './product-events.js';
import { addPublisherReply, createPublisherChallenge, publisherClaimIds, publisherWorkspace, verifyPublisherChallenge } from './publisher-workspace.js';
import { annotationEmbedHtml, annotationQrSvg, annotationShareDescriptor } from './share-surfaces.js';
import { envLimit, permalinkCacheControl, staticCacheControl } from './edge-cache.js';
import { createResponseCache } from './response-cache.js';
import {
  addComment,
  createAnnotation,
  createClaim,
  deleteAnnotation,
  findAnnotation,
  findClaim,
  findMedia,
  findUser,
  getProfile,
  incrementOpen,
  listFeed,
  listNotifications,
  listPeople,
  listClaims,
  markNotificationsSeen,
  moderateClaim,
  putMedia,
  proofWorldStore,
  sourceHub,
  toggleFollow,
  toggleLike,
  transparencyReport,
  trendingSources,
  updateAnnotation,
} from './product-repository.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const require = createRequire(import.meta.url);
const { version: releaseVersion } = require('../package.json');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const feedCache = createResponseCache();
const defaultCorsOrigin = resolveCorsOrigin('');

const send = (response, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const corsOrigin = response.annotatedCorsOrigin || defaultCorsOrigin;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders({ api: true }), 'access-control-allow-origin': corsOrigin, 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-request-id', ...(corsOrigin === '*' || corsOrigin === 'null' ? {} : { 'access-control-allow-credentials': 'true', vary: 'Origin' }), ...headers });
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
const operatorMetricsAllowed = (request) => {
  const expected = String(process.env.OPERATOR_METRICS_TOKEN || '');
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return expected.length >= 24 && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};
const isModerator = (user) => Boolean(user && (['owner', 'admin', 'moderator'].includes(user.role) || String(process.env.MODERATOR_USER_IDS || '').split(',').map((value) => value.trim()).includes(user.id)));
const oauthErrorRedirect = (request) => {
  const fallback = `${process.env.APP_ORIGIN || publicOrigin}/?auth=error`;
  const returnTo = parseCookies(request.headers.cookie).annotated_oauth_return;
  if (!returnTo) return fallback;
  try {
    const target = new URL(returnTo);
    const appOrigin = new URL(process.env.APP_ORIGIN || publicOrigin).origin;
    const extension = isChromeExtensionRedirectUrl(target);
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

// For the no-JS claim form: application/x-www-form-urlencoded, tightly capped.
const readForm = async (request) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Request body is too large.');
  }
  return Object.fromEntries(new URLSearchParams(body));
};

const slugify = (value) => String(value).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'annotation';
// Interactions require the actor to be able to see the annotation at all —
// a private slug behaves exactly like a nonexistent one for everyone else.
const viewableAnnotation = async (slugOrId, viewerId = '') => {
  const annotation = await findAnnotation(slugOrId, viewerId, { includeRemoved: false });
  return annotation && annotation.status === 'published' && canViewAnnotation(annotation, viewerId) ? annotation : null;
};

const withAssetUrls = (annotation) => annotation ? {
  ...annotation,
  url: `${publicOrigin}/a/${annotation.slug}`,
  audioUrl: annotation.audioAssetId ? `${publicOrigin}/media/${annotation.audioAssetId}` : null,
  clipUrl: annotation.mediaAssetId ? `${publicOrigin}/media/${annotation.mediaAssetId}` : null,
  posterUrl: annotation.posterAssetId ? `${publicOrigin}/media/${annotation.posterAssetId}` : null,
  screenshotUrl: annotation.screenshotAssetId ? `${publicOrigin}/media/${annotation.screenshotAssetId}` : null,
} : null;

const handleApi = async (request, response, pathname) => {
  if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok', version: releaseVersion, persistence: storageDescription() });
  if (request.method === 'GET' && pathname === '/api/operator/metrics') {
    if (!operatorMetricsAllowed(request)) return notFound(response);
    return send(response, 200, { process: metricsSnapshot(), mediaQueue: await mediaQueueSnapshot() });
  }
  if (request.method === 'GET' && pathname === '/api/capabilities') {
    const store = await proofWorldStore();
    return send(response, 200, await getCapabilities({ publicOrigin, releaseVersion, providers: providerStatus(), store }));
  }
  if (request.method === 'GET' && pathname === '/api/ready') {
    try {
      await checkStore();
      await getObjectStore().check();
      const mediaRuntime = process.env.NODE_ENV === 'production'
        ? { status: 'external', role: mediaWorkerExecution.processRole, concurrency: mediaWorkerExecution.concurrency }
        : { status: 'development' };
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

  // Always 200: a signed-out visit is an expected state, not an error, so the
  // signed-out console stays clean of 401 noise.
  if (request.method === 'GET' && pathname === '/api/me') {
    const user = await currentUser(request);
    return send(response, 200, { user: user || null, authenticated: Boolean(user) });
  }

  // Notifications, derived on read — responses, likes, and follows aimed at
  // the signed-in user, newest first. Nothing is stored per event, so there
  // are no counters to drift; the last-seen watermark on the user record
  // powers the unseen badge.
  if (request.method === 'GET' && pathname === '/api/notifications') {
    const viewer = await currentUser(request);
    if (!viewer) return send(response, 401, { error: 'Sign in to see notifications.' });
    const items = await listNotifications(viewer.id, 50);
    const seenAt = String(viewer.lastNotificationsSeenAt || '');
    // The extension's 5-minute badge poll is the product's only recurring
    // per-user request. The ETag names everything the response depends on
    // (newest item, count, watermark), so the steady state is a 304 that
    // never re-derives or re-ships the list — same trick as the share cards.
    const badgeTag = `"nf-${createHash('sha256').update(`${viewer.id}:${items[0]?.createdAt || ''}:${items.length}:${seenAt}`).digest('hex').slice(0, 24)}"`;
    if (request.headers['if-none-match'] === badgeTag) {
      response.writeHead(304, { etag: badgeTag, 'cache-control': 'private, no-cache', ...securityHeaders({ api: true }) });
      return response.end();
    }
    return send(response, 200, { notifications: items, unseenCount: items.filter((item) => String(item.createdAt) > seenAt).length }, { etag: badgeTag, 'cache-control': 'private, no-cache' });
  }

  if (request.method === 'POST' && pathname === '/api/notifications/seen') {
    const viewer = await currentUser(request);
    if (!viewer) return send(response, 401, { error: 'Sign in first.' });
    const seenAt = new Date().toISOString();
    await markNotificationsSeen(viewer.id, seenAt);
    return send(response, 200, { seenAt });
  }

  if (request.method === 'POST' && pathname === '/api/sources/resolve') {
    const payload = await readJson(request);
    const source = await resolveSource(payload.url);
    return send(response, 200, { source });
  }

  const exactSourceMatch = pathname.match(/^\/api\/sources\/exact\/(src_[A-Za-z0-9_-]+)$/);
  if (exactSourceMatch && request.method === 'GET') {
    const viewer = await currentUser(request);
    const query = new URL(request.url || '/', publicOrigin).searchParams;
    const graph = await exactSourceGraph(exactSourceMatch[1], viewer?.id || '', { limit: normalizeFeedLimit(query.get('limit')), cursor: query.get('cursor') || '' });
    return graph.source ? send(response, 200, graph) : notFound(response);
  }

  if (request.method === 'POST' && pathname === '/api/events') {
    const actor = await currentUser(request);
    if (!(await mutationAllowed(request, actor, 'product-event', 180))) return send(response, 429, { error: 'Too many events.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    return send(response, 202, await recordProductEvent({ ...payload, actorId: actor?.id || '', isBot: /bot|crawler|spider/i.test(String(request.headers['user-agent'] || '')) }));
  }

  if (request.method === 'GET' && pathname === '/api/operator/funnel') {
    if (!operatorMetricsAllowed(request)) return forbidden(response);
    return send(response, 200, await productFunnel({ workspaceId: new URL(request.url || '/', publicOrigin).searchParams.get('workspaceId') || '' }));
  }

  if (request.method === 'POST' && pathname === '/api/publishers/challenges') {
    const actor = await currentUser(request);
    if (!actor) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'publisher-challenge', 10))) return send(response, 429, { error: 'Too many publisher challenges.' });
    try { return send(response, 201, { challenge: await createPublisherChallenge({ ...(await readJson(request)), actorId: actor.id }) }); }
    catch (error) { return send(response, 422, { error: error.message }); }
  }

  const publisherVerifyMatch = pathname.match(/^\/api\/publishers\/challenges\/([^/]+)\/verify$/);
  if (publisherVerifyMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor) return unauthorized(response);
    try { return send(response, 200, { workspace: await verifyPublisherChallenge({ challengeId: publisherVerifyMatch[1], actorId: actor.id, ...(await readJson(request)) }) }); }
    catch (error) { return send(response, 422, { error: error.message }); }
  }

  const publisherWorkspaceMatch = pathname.match(/^\/api\/publishers\/workspaces\/([^/]+)$/);
  if (publisherWorkspaceMatch && request.method === 'GET') {
    const actor = await currentUser(request);
    if (!actor) return unauthorized(response);
    const query = new URL(request.url || '/', publicOrigin).searchParams;
    const workspace = await publisherWorkspace(publisherWorkspaceMatch[1], actor.id, { limit: normalizeFeedLimit(query.get('limit')), cursor: query.get('cursor') || '' });
    return workspace ? send(response, 200, workspace) : notFound(response);
  }

  const publisherReplyMatch = pathname.match(/^\/api\/publishers\/workspaces\/([^/]+)\/annotations\/([^/]+)\/reply$/);
  if (publisherReplyMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor) return unauthorized(response);
    try {
      const reply = await addPublisherReply({ workspaceId: publisherReplyMatch[1], annotationId: publisherReplyMatch[2], actorId: actor.id, ...(await readJson(request)) });
      return reply ? send(response, 201, { reply }) : notFound(response);
    } catch (error) { return send(response, 422, { error: error.message }); }
  }

  const publisherClaimsMatch = pathname.match(/^\/api\/publishers\/workspaces\/([^/]+)\/claims\/bulk$/);
  if (publisherClaimsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor) return unauthorized(response);
    const payload = await readJson(request);
    const ids = await publisherClaimIds(publisherClaimsMatch[1], actor.id, Array.isArray(payload.claimIds) ? payload.claimIds : []);
    if (!ids.length) return send(response, 404, { error: 'No matching workspace claims were found.' });
    const claims = await Promise.all(ids.map((id) => findClaim(id)));
    for (const currentClaim of claims) {
      const transitionError = validateClaimTransition(currentClaim?.status, payload.status);
      const actionError = validateModerationAction(payload.status, payload.action);
      if (transitionError || actionError) return send(response, 422, { error: transitionError || actionError });
    }
    const results = [];
    for (const id of ids) {
      const result = await moderateClaim(id, { actorId: actor.id, status: payload.status, note: String(payload.note || '').slice(0, 2000), action: payload.action === 'remove' ? 'remove' : null, auditId: randomUUID() });
      for (const media of result?.removedAssets || []) await removeStoredMedia(media).catch((error) => console.error('publisher takedown media removal failed', error.message));
      if (result) results.push(result.claim);
    }
    return send(response, 200, { claims: results, processed: results.length });
  }

  if (request.method === 'POST' && pathname === '/api/media/audio') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    let mimeType;
    try { mimeType = normalizeAudioMimeType(request.headers['content-type']); } catch (error) { return send(response, 415, { error: error.message }); }
    if (!(await mutationAllowed(request, actor, 'audio-upload', 10))) return send(response, 429, { error: 'Too many audio uploads. Try again later.' }, { 'retry-after': '60' });
    let media;
    try {
      media = await writeIncomingMedia(request, mimeType);
    } catch (error) {
      if (error.statusCode === 422) return send(response, 422, { error: error.message });
      throw error;
    }
    await putMedia({ id: media.id, key: media.key, fileName: media.fileName, mimeType: media.mimeType, bytes: media.bytes, peaks: media.peaks || null, sha256: media.sha256, verifiedAt: media.verifiedAt, rightsState: media.rightsState, ownerId: actor?.id || 'local-tom', createdAt: media.createdAt });
    return send(response, 201, { media: { id: media.id, mimeType: media.mimeType, bytes: media.bytes, peaks: media.peaks || null, url: `${publicOrigin}/media/${media.id}` } });
  }

  // Screenshot capture: a bounded page image that publishes WITH its source
  // link — provenance-first, unlike a bare screenshot.
  if (request.method === 'POST' && pathname === '/api/media/screenshot') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    let mimeType;
    try { mimeType = normalizeImageMimeType(request.headers['content-type']); } catch (error) { return send(response, 415, { error: error.message }); }
    if (!(await mutationAllowed(request, actor, 'screenshot-upload', 20))) return send(response, 429, { error: 'Too many screenshot uploads. Try again later.' }, { 'retry-after': '60' });
    const media = await writeIncomingImage(request, mimeType);
    await putMedia({ id: media.id, key: media.key, fileName: media.fileName, mimeType: media.mimeType, bytes: media.bytes, kind: 'screenshot', sha256: media.sha256, verifiedAt: media.verifiedAt, rightsState: media.rightsState, ownerId: actor?.id || 'local-tom', createdAt: media.createdAt });
    return send(response, 201, { media: { id: media.id, mimeType: media.mimeType, bytes: media.bytes, url: `${publicOrigin}/media/${media.id}` } });
  }

  if (request.method === 'GET' && pathname === '/api/feed') {
    // Signed-out feed pages are identical for every reader, so they are
    // served from a one-second micro-TTL cache: a read spike collapses onto
    // one page build per URL per second instead of one per request.
    // "Anonymous" is strict — production auth mode with no bearer token and
    // no session cookie — so no viewer-flavoured payload can ever be cached.
    const anonymous = authIsRequired()
      && !String(request.headers.authorization || '').startsWith('Bearer ')
      && !parseCookies(request.headers.cookie).annotated_session;
    const cacheKey = anonymous ? String(request.url || '/api/feed') : null;
    if (cacheKey) {
      const cached = feedCache.get(cacheKey);
      if (cached) return send(response, 200, cached, { 'x-cache': 'hit' });
    }
    const viewer = anonymous ? null : await currentUser(request);
    const query = new URL(request.url || '/', publicOrigin).searchParams;
    const limit = normalizeFeedLimit(query.get('limit'));
    const offset = normalizeFeedCursor(query.get('cursor'));
    const sourceType = query.get('sourceType');
    const search = normalizeFeedQuery(query.get('q'));
    const urlKey = normalizeSourceUrlKey(query.get('url'));
    const followingRequested = query.get('following') === 'true';
    if (followingFeedRequiresAuth({ requested: followingRequested, required: authIsRequired(), viewer })) return unauthorized(response);
    const followingOnly = followingRequested && Boolean(viewer);
    const topic = isTopic(query.get('topic')) ? query.get('topic') : null;
    const trending = query.get('sort') === 'trending';
    const result = await listFeed({ viewerId: viewer?.id || '', limit, cursor: query.get('cursor') || '', offset, sourceType, search, urlKey, followingOnly, topic, trending });
    const payload = JSON.stringify({ annotations: result.annotations.map(withAssetUrls), nextCursor: result.nextCursor, query: search || null, ...(result.topics ? { topics: result.topics, topic } : {}) });
    if (cacheKey) feedCache.set(cacheKey, payload);
    return send(response, 200, payload, cacheKey ? { 'x-cache': 'miss' } : {});
  }

  // Source hub: a host's public annotations and its annotators, discovery by
  // shared attention rather than by directory.
  const hubMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (hubMatch && request.method === 'GET' && hubMatch[1] !== 'resolve') {
    const host = normalizeHost(decodeURIComponent(hubMatch[1]));
    if (!host) return notFound(response);
    const viewer = await currentUser(request);
    const query = new URL(request.url || '/', publicOrigin).searchParams;
    const limit = normalizeFeedLimit(query.get('limit'));
    const offset = normalizeFeedCursor(query.get('cursor'));
    const result = await sourceHub(host, viewer?.id || '', { limit, offset });
    return send(response, 200, { ...result, annotations: result.annotations.map(withAssetUrls) });
  }

  // Trending sources: hosts gathering attention now, by decayed opens. Feeds
  // the hub system — every row is a /s/:host destination.
  if (request.method === 'GET' && pathname === '/api/trending/sources') {
    return send(response, 200, { sources: await trendingSources() });
  }

  // People discovery: annotators ranked by opens of the original; a query
  // narrows by handle or display name.
  if (request.method === 'GET' && pathname === '/api/people') {
    const viewer = await currentUser(request);
    const search = normalizeFeedQuery(new URL(request.url || '/', publicOrigin).searchParams.get('q'));
    const people = await listPeople(viewer?.id || '', search, 10);
    return send(response, 200, { people, query: search || null });
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && request.method === 'GET') {
    const viewer = await currentUser(request);
    const profile = await getProfile(decodeURIComponent(profileMatch[1]), viewer?.id || '', 20);
    if (!profile) return notFound(response);
    return send(response, 200, { profile: { ...profile, annotations: profile.annotations.map(withAssetUrls) } });
  }

  const followMatch = pathname.match(/^\/api\/users\/([^/]+)\/(follow|unfollow)$/);
  if (followMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const targetId = decodeURIComponent(followMatch[1]);
    if (!await findUser(targetId)) return notFound(response);
    if (targetId === actor?.id) return send(response, 422, { error: 'You cannot follow yourself.' });
    if (!(await mutationAllowed(request, actor, 'follow', 60))) return send(response, 429, { error: 'Too many follow changes. Try again later.' }, { 'retry-after': '60' });
    // Row-native hot path (Gate 1): a single indexed row, not a rewrite.
    const followerId = actor?.id || 'local-tom';
    const following = await toggleFollow(followerId, targetId, followMatch[2] === 'follow');
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
    const annotation = await findAnnotation(retryMediaMatch[1], actor?.id || 'local-tom');
    if (!annotation) return notFound(response);
    const job = await retryMediaJobForAnnotation(annotation.id, actor?.id || 'local-tom');
    if (!job) return send(response, 409, { error: 'This annotation has no failed media job available to retry.' });
    const updated = await findAnnotation(annotation.id, actor?.id || 'local-tom');
    return send(response, 202, { annotation: withAssetUrls(updated), job: { id: job.id, status: job.status } });
  }

  const shareMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/share$/);
  if (shareMatch && request.method === 'GET') {
    const actor = await currentUser(request);
    const annotation = await findAnnotation(decodeURIComponent(shareMatch[1]), actor?.id || '', { includeRemoved: false });
    if (!annotation || !canViewAnnotation(annotation, actor?.id || '')) return notFound(response);
    return send(response, 200, { share: annotationShareDescriptor(annotation, publicOrigin) });
  }

  if (request.method === 'GET' && pathname === '/api/oembed') {
    const requested = new URL(request.url || '/', publicOrigin).searchParams.get('url') || '';
    let parsed;
    try { parsed = new URL(requested); } catch { return send(response, 400, { error: 'A valid annotation URL is required.' }); }
    if (parsed.origin !== new URL(publicOrigin).origin) return send(response, 400, { error: 'Only this deployment can be embedded.' });
    const match = parsed.pathname.match(/^\/a\/([^/]+)$/);
    if (!match) return notFound(response);
    const annotation = await findAnnotation(decodeURIComponent(match[1]), '', { includeRemoved: false });
    if (!annotation || annotation.visibility === 'private') return notFound(response);
    return send(response, 200, { version: '1.0', type: 'rich', provider_name: 'Annotated', provider_url: publicOrigin, title: annotation.sourceTitle, html: `<iframe src="${publicOrigin}/a/${encodeURIComponent(annotation.slug)}/embed?v=1" loading="lazy" title="Annotated source evidence" style="width:100%;height:240px;border:0"></iframe>`, width: 600, height: 240 });
  }

  if (request.method === 'POST' && pathname === '/api/annotations') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'annotation', 30))) return send(response, 429, { error: 'Too many publishes. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const { errors, normalized } = validateAnnotation(payload);
    if (errors.length) return send(response, 422, { errors });
    if (normalized.commentaryMode === 'audio') {
      const media = await findMedia(normalized.audioAssetId);
      if (!canUseAudioAsset(media, actor)) return send(response, 422, { errors: ['The uploaded audio asset could not be found or is not owned by this account.'] });
    }
    if (normalized.screenshotAssetId) {
      const media = await findMedia(normalized.screenshotAssetId);
      if (!canUseImageAsset(media, actor)) return send(response, 422, { errors: ['The uploaded screenshot could not be found or is not owned by this account.'] });
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const baseSlug = slugify(normalized.sourceTitle);
    // A media clip job needs a real range; a screenshot-only capture of a
    // media page publishes without one instead of queueing a doomed job.
    const isMedia = normalized.sourceType !== 'article' && normalized.clipEnd - normalized.clipStart >= 1;
    const ownerId = actor?.id || 'local-tom';
    const candidate = { id, slug: `${baseSlug}-${id.slice(0, 6)}`, status: 'published', createdAt: now, authorId: ownerId, mediaStatus: isMedia ? 'queued' : 'not-applicable', ...normalized };
    const { created, annotation } = await createAnnotation(candidate);
    if (!created) return send(response, 200, { annotation: withAssetUrls(annotation) });
    if (isMedia) void enqueueMediaJob({ annotationId: id, sourceUrl: normalized.sourceUrl, sourceType: normalized.sourceType, sourceMediaUrl: normalized.mediaUrl, mediaUrl: normalized.mediaUrl, provider: normalized.provider, clipStart: normalized.clipStart, clipEnd: normalized.clipEnd }).catch((error) => console.error(error));
    return send(response, 201, { annotation: withAssetUrls(annotation) });
  }

  // Author delete: the record, its media, and its interactions are gone
  // outright — a 404, not a tombstone. Claims and audit entries survive.
  const annotationDeleteMatch = pathname.match(/^\/api\/annotations\/([^/]+)$/);
  if (annotationDeleteMatch && request.method === 'DELETE') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'annotation-delete', 30))) return send(response, 429, { error: 'Too many deletions. Try again later.' }, { 'retry-after': '60' });
    const annotation = await findAnnotation(annotationDeleteMatch[1], actor?.id || 'local-tom');
    if (!annotation || !canViewAnnotation(annotation, actor?.id)) return notFound(response);
    if (annotation.authorId !== (actor?.id || 'local-tom') && !isModerator(actor)) return forbidden(response);
    const deleted = await deleteAnnotation(annotation.id, actor?.id || 'local-tom', { moderator: isModerator(actor) });
    if (!deleted) return notFound(response);
    for (const media of deleted.assets) await removeStoredMedia(media).catch((error) => console.error('delete media removal failed', error.message));
    return send(response, 200, { deleted: true, slug: annotation.slug });
  }

  // Bounded edits: the note can change for thirty minutes after publish, so
  // replies never sit under a note that changed meaning later; visibility is
  // owner privacy control and may change at any time.
  if (annotationDeleteMatch && request.method === 'PATCH') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await mutationAllowed(request, actor, 'annotation-edit', 30))) return send(response, 429, { error: 'Too many edits. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const annotation = await findAnnotation(annotationDeleteMatch[1], actor?.id || 'local-tom');
    if (!annotation || annotation.status !== 'published' || !canViewAnnotation(annotation, actor?.id)) return notFound(response);
    if (annotation.authorId !== (actor?.id || 'local-tom')) return forbidden(response);
    const changes = {};
    if (payload.visibility !== undefined) {
      if (!VISIBILITIES.includes(payload.visibility)) return send(response, 422, { error: 'visibility must be public, unlisted, or private.' });
      changes.visibility = payload.visibility;
    }
    if (payload.commentary !== undefined) {
      if (annotation.commentaryMode !== 'text') return send(response, 422, { error: 'Only text notes can be edited.' });
      if (!canEditCommentary(annotation)) return send(response, 422, { error: 'Notes can be edited for 30 minutes after publishing.' });
      const commentary = String(payload.commentary).trim().slice(0, 280);
      if (!commentary) return send(response, 422, { error: 'The note cannot be empty.' });
      changes.commentary = commentary;
      changes.editedAt = new Date().toISOString();
    }
    // The topic rides the same 30-minute window as the note — a wrong tag is
    // fixable, but categorisation is not a lever to rewrite history with.
    if (payload.topic !== undefined) {
      if (payload.topic !== null && payload.topic !== '' && !isTopic(payload.topic)) return send(response, 422, { error: 'topic must be one of the published topics.' });
      if (!canEditCommentary(annotation)) return send(response, 422, { error: 'The topic can be changed for 30 minutes after publishing.' });
      changes.topic = isTopic(payload.topic) ? payload.topic : null;
    }
    if (!Object.keys(changes).length) return send(response, 422, { error: 'Nothing to update. Send commentary and/or visibility.' });
    const updated = await updateAnnotation(annotation.id, actor?.id || 'local-tom', changes);
    return updated ? send(response, 200, { annotation: withAssetUrls(updated) }) : notFound(response);
  }

  const annotationMatch = pathname.match(/^\/api\/annotations\/([^/]+)$/);
  if (annotationMatch && request.method === 'GET') {
    const viewer = await currentUser(request);
    const annotation = await findAnnotation(annotationMatch[1], viewer?.id || '');
    if (!annotation || !canViewAnnotation(annotation, viewer?.id)) return notFound(response);
    // A rights takedown leaves a public tombstone — accountability, not a 404.
    if (annotation.status === 'removed') return send(response, 410, removalTombstone(annotation));
    return send(response, 200, { annotation: withAssetUrls(annotation) });
  }

  const commentsMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/comments$/);
  if (commentsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await viewableAnnotation(commentsMatch[1], actor?.id))) return notFound(response);
    if (!(await mutationAllowed(request, actor, 'comment', 30))) return send(response, 429, { error: 'Too many comments. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const validation = validateComment(payload);
    if (validation.error) return send(response, 422, { error: validation.error });
    const annotation = await addComment(commentsMatch[1], actor?.id || 'local-tom', validation.body, { id: randomUUID(), createdAt: new Date().toISOString() });
    return annotation ? send(response, 201, { annotation: withAssetUrls(annotation) }) : notFound(response);
  }

  const likeMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/(like|unlike)$/);
  if (likeMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await viewableAnnotation(likeMatch[1], actor?.id))) return notFound(response);
    if (!(await mutationAllowed(request, actor, 'like', 120))) return send(response, 429, { error: 'Too many like changes. Try again later.' }, { 'retry-after': '60' });
    // Row-native hot path: one indexed row write plus an O(1) cache patch —
    // never a whole-store rewrite (Gate 1).
    const annotation = await findAnnotation(likeMatch[1], actor?.id || 'local-tom', { includeRemoved: false });
    if (!annotation) return notFound(response);
    await toggleLike(annotation.id, actor?.id || 'local-tom', likeMatch[2] === 'like');
    const fresh = await findAnnotation(annotation.id, actor?.id || 'local-tom', { includeRemoved: false });
    return fresh ? send(response, 200, { annotation: withAssetUrls(fresh) }) : notFound(response);
  }

  // Counts clicks on "Open original" — the traffic-back-to-source stat shown
  // on every annotation. Public by design: signed-out readers open sources too.
  const openMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/open$/);
  if (openMatch && request.method === 'POST') {
    const opener = await currentUser(request);
    if (!(await viewableAnnotation(openMatch[1], opener?.id))) return notFound(response);
    if (!(await mutationAllowed(request, null, 'open-original', envLimit('open-original', 120)))) return send(response, 429, { error: 'Too many open events. Try again later.' }, { 'retry-after': '60' });
    // Row-native hot path (Gate 1): the public, unauthenticated counter is
    // one jsonb_set on one row.
    const target = await findAnnotation(openMatch[1], opener?.id || '', { includeRemoved: false });
    if (!target) return notFound(response);
    const opens = await incrementOpen(target.id);
    return send(response, 200, { opens: Number(opens) || 0 });
  }

  const claimsMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/claims$/);
  if (claimsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!(await viewableAnnotation(claimsMatch[1], actor?.id))) return notFound(response);
    if (!(await mutationAllowed(request, actor, 'claim', 10))) return send(response, 429, { error: 'Too many claims. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const validation = validateClaim(payload);
    if (validation.error) return send(response, 422, { error: validation.error });
    const reporterId = actor?.id || 'local-tom';
    const createdAt = new Date().toISOString();
    const result = await createClaim(claimsMatch[1], { id: randomUUID(), reporterId, reason: validation.reason, auditId: randomUUID(), actorId: reporterId, createdAt });
    const { created, claim } = result;
    if (!claim) return notFound(response);
    return send(response, created ? 201 : 200, { status: created ? 'received' : 'already-received', claim: { id: claim.id, status: claim.status } });
  }

  // Public transparency: aggregate claim counts and the takedown log. Only
  // already-public data — no reporter identities, no open-claim details, and
  // no titles of removed work (consistent with the tombstone's minimalism).
  if (request.method === 'GET' && pathname === '/api/transparency') {
    return send(response, 200, await transparencyReport());
  }

  if (request.method === 'GET' && pathname === '/api/claims') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const reporterId = actor?.id || 'local-tom';
    return send(response, 200, { claims: await listClaims({ reporterId }) });
  }

  if (request.method === 'GET' && pathname === '/api/moderation/claims') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!isModerator(actor)) return forbidden(response);
    return send(response, 200, { claims: await listClaims({ moderation: true }) });
  }

  const moderateClaimMatch = pathname.match(/^\/api\/moderation\/claims\/([^/]+)$/);
  if (moderateClaimMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    if (!isModerator(actor)) return forbidden(response);
    if (!(await mutationAllowed(request, actor, 'moderation', 60))) return send(response, 429, { error: 'Too many moderation changes. Try again later.' }, { 'retry-after': '60' });
    const payload = await readJson(request);
    const currentClaim = await findClaim(moderateClaimMatch[1]);
    if (!currentClaim) return notFound(response);
    const transitionError = validateClaimTransition(currentClaim.status, payload.status);
    if (transitionError) return send(response, 422, { error: transitionError });
    const actionError = validateModerationAction(payload.status, payload.action);
    if (actionError) return send(response, 422, { error: actionError });
    const result = await moderateClaim(moderateClaimMatch[1], {
      actorId: actor.id,
      status: payload.status,
      note: String(payload.note || '').slice(0, 2000),
      action: payload.action === 'remove' ? 'remove' : null,
      auditId: randomUUID(),
    });
    if (!result) return notFound(response);
    for (const media of result.removedAssets) await removeStoredMedia(media).catch((error) => console.error('takedown media removal failed', error.message));
    return send(response, 200, { claim: result.claim });
  }

  return null;
};

const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip', '.sha256': 'text/plain; charset=utf-8' };

const serveMedia = async (response, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound(response);
  const media = await findMedia(id);
  if (!media) return notFound(response);
  return serveStoredMedia(response, media);
};

// Meta injection and OG cards serve link-holders: public and unlisted only.
// A private annotation's permalink stays a plain SPA shell (the API decides
// what the signed-in author may fetch) and its card does not exist.
const publishedAnnotationBySlug = async (slug) => {
  const annotation = await findAnnotation(slug, '', { includeRemoved: false });
  if (!annotation || !canViewAnnotation(annotation, '')) return null;
  return { annotation, author: annotation.author || await findUser(annotation.authorId) };
};

// Every published clip gets a landing page whose HTML already carries its
// title, description, canonical link, and OG card — crawlers never run the SPA.
const servePermalink = async (response, slug) => {
  const found = await publishedAnnotationBySlug(decodeURIComponent(slug)).catch(() => null);
  // Unknown or unviewable slugs get the plain shell — default brand meta,
  // absolutized like every other shell response.
  if (!found) return serveAppShell(response);
  let html;
  try { html = await readFile(path.join(projectRoot, 'dist/index.html'), 'utf8'); } catch { return notFound(response); }
  // The dispute path survives with JavaScript off: the meta injector adds a
  // visible no-script link to the plain /a/<slug>/claim form on every page.
  const payload = injectAnnotationMeta(html, found.annotation, found.author, publicOrigin, { index: allowsIndexing(found.annotation) });
  // The shell is viewer-independent (personalisation is client-side), so
  // PUBLIC pages are edge-cacheable for a minute — a shared-link stampede
  // lands on the CDN, not here. Unlisted/private stay no-store: a cached
  // owner page must never be servable to strangers.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': permalinkCacheControl(found.annotation.visibility), ...securityHeaders() });
  return response.end(payload);
};

// ── the no-JS claim form ─────────────────────────────────────────────
// Rights holders should never need an account or a working script to file a
// claim. GET renders a plain HTML form; POST accepts it form-encoded through
// the same validation, dedupe, and audit path as the in-app dialog. The
// accent stays confined to the wordmark's full stop — a claim form has no
// "moment".

const claimFormHtml = ({ annotation, mode = 'form', error = '', values = {} }) => {
  const title = mode === 'received' ? 'Dispute received' : mode === 'gone' ? 'Already taken down' : mode === 'missing' ? 'Annotation not found' : 'Dispute fair use';
  const context = annotation
    ? `<p class="ctx">About: <strong>${escapeHtml(annotation.sourceTitle || 'an annotation')}</strong>${annotation.sourceHost ? ` · ${escapeHtml(annotation.sourceHost)}` : ''}</p>`
    : '';
  const body = mode === 'received'
    ? `<p><strong>Thank you for flagging this.</strong> The report is attached to the annotation and will be reviewed. If it is upheld, the annotation is taken down and listed on the public <a href="/transparency">transparency report</a>.</p>${annotation ? `<p><a href="/a/${encodeURIComponent(annotation.slug)}">Back to the annotation</a></p>` : ''}`
    : mode === 'gone'
      ? `<p>This annotation has already been taken down after a rights claim. The public record is on the <a href="/transparency">transparency report</a>.</p>`
      : mode === 'missing'
        ? `<p>No annotation lives at this address — it may have been deleted by its author. Nothing further is needed.</p>`
        : `
    <p>Use this if the annotation misuses your work or breaches fair use. No account or JavaScript is required; the report goes into the same review queue either way.</p>
    ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
    <form method="POST">
      <label>How can we reach you?<br /><input type="email" name="contact" required maxlength="200" placeholder="you@example.com" value="${escapeHtml(values.contact || '')}" /></label>
      <label>What should we review?<br /><textarea name="reason" required maxlength="2000" rows="6" placeholder="Tell us what is wrong with this annotation…">${escapeHtml(values.reason || '')}</textarea></label>
      <div class="hp"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off" value="" /></label></div>
      <button type="submit">Send dispute</button>
    </form>
    <p class="fine">Reviews are logged with an audit trail. Read <a href="/rights">Rights &amp; claims</a> for how takedowns work.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)} · annotated</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #F5F4F0; color: #26292F; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { background: #33383F; color: #fff; font-weight: 700; font-size: 17px; padding: 12px 18px; }
  .bar .dot { color: #E0A48E; }
  main { max-width: 560px; margin: 28px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #DDDEE2; border-radius: 10px; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 10px; }
  .ctx { color: #666C74; font-size: 13.5px; margin-bottom: 12px; }
  p { margin-bottom: 10px; }
  label { display: block; font-weight: 600; font-size: 13.5px; margin: 14px 0 4px; }
  input, textarea { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid #DDDEE2; border-radius: 8px; background: #fff; color: inherit; }
  textarea { resize: vertical; }
  button { font: inherit; font-weight: 600; margin-top: 16px; padding: 11px 22px; min-height: 44px; border: 0; border-radius: 8px; background: #33383F; color: #fff; cursor: pointer; }
  button:hover { background: #26292F; }
  .err { color: #8C2F1F; font-weight: 600; }
  .fine { color: #666C74; font-size: 12.5px; margin-top: 14px; }
  .hp { position: absolute; left: -9999px; height: 0; overflow: hidden; }
  a { color: #26292F; }
</style>
</head>
<body>
<div class="bar">annotated<span class="dot">.</span></div>
<main><div class="card"><h1>${escapeHtml(title)}</h1>${context}${body}</div></main>
</body>
</html>`;
};

const sendClaimPage = (response, status, payload) => {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders() });
  return response.end(claimFormHtml(payload));
};

const serveClaimForm = async (request, response, slug) => {
  const annotation = await findAnnotation(slug, '');
  if (!annotation || annotation.visibility === 'private') return sendClaimPage(response, 404, { mode: 'missing' });
  if (annotation.status === 'removed') return sendClaimPage(response, 200, { annotation: null, mode: 'gone' });
  if (request.method === 'GET') return sendClaimPage(response, 200, { annotation });

  const actor = await currentUser(request);
  let form;
  try { form = await readForm(request); } catch { return sendClaimPage(response, 413, { annotation, mode: 'form', error: 'The submission was too large. Please shorten it.' }); }
  // A filled honeypot gets a polite success and no record.
  if (String(form.website || '').trim()) return sendClaimPage(response, 200, { annotation, mode: 'received' });
  const contact = String(form.contact || '').trim().slice(0, 200);
  const validation = validateClaim(form);
  if (!/.+@.+\..+/.test(contact)) return sendClaimPage(response, 422, { annotation, mode: 'form', error: 'Enter a contact email address so the review can reach you.', values: form });
  if (validation.error) return sendClaimPage(response, 422, { annotation, mode: 'form', error: validation.error, values: form });
  if (!(await mutationAllowed(request, actor, 'claim', 10))) return sendClaimPage(response, 429, { annotation, mode: 'form', error: 'Too many claims from this connection. Try again in a minute.', values: form });
  const reporterId = actor?.id || null;
  const createdAt = new Date().toISOString();
  await createClaim(annotation.id, { id: randomUUID(), reporterId, reporterContact: contact, reason: validation.reason, via: 'form', auditId: randomUUID(), actorId: reporterId || `form:${contact}`, createdAt });
  return sendClaimPage(response, 200, { annotation, mode: 'received' });
};

const serveOgCard = async (request, response, slug, { download = false } = {}) => {
  const found = await publishedAnnotationBySlug(decodeURIComponent(slug)).catch(() => null);
  if (!found) return notFound(response);
  const { annotation, author } = found;
  try {
    const cacheKey = [annotation.id, annotation.mediaStatus, annotation.openCount || 0, annotation.editedAt || '', annotation.visibility || 'public', annotation.screenshotAssetId || ''].join(':');
    // Crawlers refetch share cards on every unfurl. The ETag is the cache
    // key that already names everything the pixels depend on, so an
    // unchanged card answers 304 before any render happens — and s-maxage
    // lets a CDN hold it for a day while browsers keep an hour.
    const etag = `"og-${createHash('sha256').update(cacheKey).digest('hex').slice(0, 24)}"`;
    const cacheHeaders = { etag, 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' };
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ...cacheHeaders, ...securityHeaders({ api: true }) });
      return response.end();
    }
    const png = await renderOgCardCached(cacheKey, async () => {
      const data = ogCardData(annotation, author);
      // Screenshot captures put the actual image on the card. PNG only (the
      // panel captures PNG), verified by magic bytes so a mistyped or corrupt
      // upload degrades to the text layout instead of failing the render.
      if (annotation.screenshotAssetId) {
        const record = await findMedia(annotation.screenshotAssetId);
        if (record?.mimeType === 'image/png') {
          try {
            const bytes = await getObjectStore().getBytes(record);
            if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
              data.screenshot = `data:image/png;base64,${bytes.toString('base64')}`;
            }
          } catch { /* text layout */ }
        }
      }
      return data;
    });
    response.writeHead(200, {
      'content-type': 'image/png', 'content-length': png.length, ...cacheHeaders,
      ...(download ? { 'content-disposition': `attachment; filename="annotated-${annotation.slug}.png"` } : {}),
      ...securityHeaders({ api: true }),
    });
    return response.end(png);
  } catch (error) {
    console.error('OG card rendering failed:', error.message);
    return send(response, 503, { error: 'The share card is temporarily unavailable.' });
  }
};

const shareableAnnotation = async (slug) => {
  const annotation = await findAnnotation(decodeURIComponent(slug), '', { includeRemoved: false });
  return annotation && annotation.visibility !== 'private' && canViewAnnotation(annotation, '') ? annotation : null;
};

const serveAnnotationEmbed = async (request, response, slug) => {
  if (!(await mutationAllowed(request, null, 'annotation-embed', envLimit('annotation-embed', 120)))) return send(response, 429, 'Too many embed requests.', { 'retry-after': '60' });
  const annotation = await shareableAnnotation(slug);
  if (!annotation) return notFound(response);
  const headers = securityHeaders({ api: true });
  delete headers['x-frame-options'];
  response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,max-age=300', 'cross-origin-resource-policy': 'cross-origin', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'" });
  return response.end(annotationEmbedHtml(annotation, publicOrigin));
};

const serveAnnotationQr = async (request, response, slug) => {
  if (!(await mutationAllowed(request, null, 'annotation-qr', envLimit('annotation-qr', 120)))) return send(response, 429, 'Too many QR requests.', { 'retry-after': '60' });
  const annotation = await shareableAnnotation(slug);
  if (!annotation) return notFound(response);
  const svg = await annotationQrSvg(annotation, publicOrigin);
  response.writeHead(200, { ...securityHeaders({ api: true }), 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public,max-age=86400', 'cross-origin-resource-policy': 'cross-origin' });
  return response.end(svg);
};

// The app shell ships default og:/twitter: images as root-relative paths;
// crawlers require absolute URLs, so the served shell absolutizes them
// against this deployment's public origin. Cached against the file's mtime —
// a rebuild mid-process must never keep serving references to old bundles.
let appShellCache = null;
const serveAppShell = async (response) => {
  try {
    const shellPath = path.join(projectRoot, 'dist/index.html');
    const info = await stat(shellPath);
    if (!appShellCache || appShellCache.mtimeMs !== info.mtimeMs) {
      appShellCache = {
        mtimeMs: info.mtimeMs,
        html: (await readFile(shellPath, 'utf8'))
          .replaceAll('content="/brand/og-default.png"', `content="${publicOrigin}/brand/og-default.png"`),
      };
    }
  } catch { return notFound(response); }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders() });
  return response.end(appShellCache.html);
};

const serveStatic = async (request, response, pathname) => {
  if (pathname === '/') return serveAppShell(response);
  const relative = pathname === '/favicon.ico' ? 'dist/brand/favicon.ico' : pathname.replace(/^\//, '');
  const candidate = path.resolve(projectRoot, relative.startsWith('dist/') ? relative : `dist/${relative}`);
  if (!candidate.startsWith(path.resolve(projectRoot, 'dist'))) return notFound(response);
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return notFound(response);
    const staticCache = staticCacheControl(pathname);
    const releaseHeaders = staticCache ? { 'cache-control': staticCache } : {};
    response.writeHead(200, { 'content-type': contentType[path.extname(candidate)] || 'application/octet-stream', ...releaseHeaders, ...securityHeaders() });
    return createReadStream(candidate).pipe(response);
  } catch {
    if (request.method === 'GET' && !path.extname(pathname)) return serveAppShell(response);
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
    const requestCorsOrigin = resolveCorsOrigin(request.headers.origin || '');
    response.annotatedCorsOrigin = requestCorsOrigin || 'null';
    if (url.pathname.startsWith('/api/') && request.headers.origin && !requestCorsOrigin) return send(response, 403, { error: 'Request origin is not allowed.' });
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return send(response, 204, '');
    if (request.method === 'GET' && url.pathname.startsWith('/media/')) return serveMedia(response, url.pathname.slice('/media/'.length));
    const ogMatch = request.method === 'GET' ? url.pathname.match(/^\/og\/([^/]+)\.png$/) : null;
    if (ogMatch) return serveOgCard(request, response, ogMatch[1], { download: url.searchParams.has('download') });
    // The mobile shell finishes sign-in here: its one-time ticket becomes the
    // same cookie session the web app uses, then the WebView returns to the
    // surface it came from. `next` is honoured only as a local path — a
    // scheme or protocol-relative value falls back to home.
    if (request.method === 'GET' && url.pathname === '/auth/mobile/session') {
      const requestedNext = url.searchParams.get('next') || '';
      const next = /^\/(?!\/)/.test(requestedNext) ? requestedNext : '/';
      const landing = (notice) => `${next}${next.includes('?') ? '&' : '?'}auth=${notice}`;
      try {
        const { sessionCookie } = await mobileTicketSession(url.searchParams.get('ticket') || '');
        response.writeHead(302, { location: landing('success'), 'set-cookie': sessionCookie, ...securityHeaders() });
      } catch {
        response.writeHead(302, { location: landing('error'), ...securityHeaders() });
      }
      return response.end();
    }
    const claimFormMatch = ['GET', 'POST'].includes(request.method || '') ? url.pathname.match(/^\/a\/([^/]+)\/claim$/) : null;
    if (claimFormMatch) return serveClaimForm(request, response, decodeURIComponent(claimFormMatch[1]));
    const embedMatch = request.method === 'GET' ? url.pathname.match(/^\/a\/([^/]+)\/embed$/) : null;
    if (embedMatch) return serveAnnotationEmbed(request, response, embedMatch[1]);
    const qrMatch = request.method === 'GET' ? url.pathname.match(/^\/a\/([^/]+)\/qr\.svg$/) : null;
    if (qrMatch) return serveAnnotationQr(request, response, qrMatch[1]);
    const permalinkMatch = request.method === 'GET' ? url.pathname.match(/^\/a\/([^/]+)$/) : null;
    if (permalinkMatch) return servePermalink(response, permalinkMatch[1]);
    // Hub and profile routes can contain dots (hosts, handles), which the
    // static extension check would otherwise mistake for file requests —
    // serve the app shell explicitly for every single-segment SPA route.
    if (request.method === 'GET' && /^\/(s|u)\/[^/]+$/.test(url.pathname)) return serveStatic(request, response, '/');
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
  if (mediaWorkerExecution.inProcess) recoverMediaJobs().catch((error) => console.error('media recovery failed', error));
});

const shutdown = async () => {
  await closeRateLimitStore().catch((error) => console.error('rate-limit shutdown failed', error));
  await closeStore().catch((error) => console.error('store shutdown failed', error));
  server.close(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
