import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { closeStore, readStore, storageDescription, updateStore } from './store.js';
import { serveStoredMedia, writeIncomingMedia } from './media-store.js';
import { getObjectStore } from './object-store.js';
import { cancelMediaJob, enqueueMediaJob, recoverMediaJobs } from './media-worker.js';
import { resolveSource } from './source-resolver.js';
import { validateAnnotation, validateClaim, validateComment } from './validation.js';
import { assertAuthConfiguration, authIsRequired, currentUser, exchangeExtensionTicket, finishOAuth, logout, providerStatus, startOAuth } from './auth.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const port = Number(process.env.PORT || 8787);
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const corsOrigin = process.env.CORS_ORIGIN || '*';

const send = (response, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': corsOrigin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', ...(corsOrigin === '*' ? {} : { 'access-control-allow-credentials': 'true', vary: 'Origin' }), ...headers });
  response.end(payload);
};

const notFound = (response) => send(response, 404, { error: 'Not found.' });
const redirect = (response, location, headers = {}) => {
  response.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  response.end();
};
const unauthorized = (response) => send(response, 401, { error: 'Sign in is required.' });

const readJson = async (request) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body is too large.');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new Error('Request body must be valid JSON.'); }
};

const slugify = (value) => String(value).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'annotation';

const withComments = (annotation, store) => ({
  ...annotation,
  url: `${publicOrigin}/a/${annotation.slug}`,
  audioUrl: annotation.audioAssetId ? `${publicOrigin}/media/${annotation.audioAssetId}` : null,
  clipUrl: annotation.mediaAssetId ? `${publicOrigin}/media/${annotation.mediaAssetId}` : null,
  comments: store.comments.filter((comment) => comment.annotationId === annotation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  claims: undefined,
});

const handleApi = async (request, response, pathname) => {
  if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok', version: '0.2.0', persistence: storageDescription() });
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
      return redirect(response, `${process.env.APP_ORIGIN || publicOrigin}/?auth=error`);
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
    const mimeType = String(request.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!mimeType.startsWith('audio/')) return send(response, 415, { error: 'Audio uploads must use an audio content type.' });
    const media = await writeIncomingMedia(request, mimeType);
    await updateStore((store) => ({ ...store, media: [...(store.media || []), { id: media.id, key: media.key, fileName: media.fileName, mimeType: media.mimeType, bytes: media.bytes, ownerId: actor?.id || 'local-tom', createdAt: media.createdAt }] }));
    return send(response, 201, { media: { id: media.id, mimeType: media.mimeType, bytes: media.bytes, url: `${publicOrigin}/media/${media.id}` } });
  }

  if (request.method === 'GET' && pathname === '/api/feed') {
    const store = await readStore();
    return send(response, 200, { annotations: store.annotations.filter((item) => item.status === 'published').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => withComments(item, store)) });
  }

  const cancelJobMatch = pathname.match(/^\/api\/media\/jobs\/([0-9a-f-]+)\/cancel$/i);
  if (cancelJobMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const cancelled = await cancelMediaJob(cancelJobMatch[1], actor?.id || 'local-tom');
    return cancelled ? send(response, 200, { status: 'cancelled' }) : send(response, 404, { error: 'Media job not found or cannot be cancelled.' });
  }

  if (request.method === 'POST' && pathname === '/api/annotations') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const payload = await readJson(request);
    const { errors, normalized } = validateAnnotation(payload);
    if (errors.length) return send(response, 422, { errors });
    if (normalized.commentaryMode === 'audio') {
      const store = await readStore();
      if (!(store.media || []).some((item) => item.id === normalized.audioAssetId && item.mimeType.startsWith('audio/'))) return send(response, 422, { errors: ['The uploaded audio asset could not be found.'] });
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const baseSlug = slugify(normalized.sourceTitle);
    const isMedia = normalized.sourceType !== 'article';
    const annotation = { id, slug: `${baseSlug}-${id.slice(0, 6)}`, status: 'published', createdAt: now, authorId: actor?.id || 'local-tom', mediaStatus: isMedia ? 'queued' : 'not-applicable', ...normalized };
    const next = await updateStore((store) => ({ ...store, annotations: [...store.annotations, annotation] }));
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
    return annotation ? send(response, 201, { annotation: withComments(annotation, result) }) : notFound(response);
  }

  const claimsMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/claims$/);
  if (claimsMatch && request.method === 'POST') {
    const actor = await currentUser(request);
    if (!actor && authIsRequired()) return unauthorized(response);
    const payload = await readJson(request);
    const validation = validateClaim(payload);
    if (validation.error) return send(response, 422, { error: validation.error });
    const result = await updateStore((store) => {
      const annotation = store.annotations.find((item) => item.slug === claimsMatch[1] || item.id === claimsMatch[1]);
      if (!annotation) return store;
      store.claims.push({ id: randomUUID(), annotationId: annotation.id, reason: validation.reason, status: 'open', reporterId: actor?.id || 'local-tom', createdAt: new Date().toISOString() });
      return store;
    });
    return result.claims.some((claim) => claim.annotationId === (result.annotations.find((item) => item.slug === claimsMatch[1] || item.id === claimsMatch[1])?.id))
      ? send(response, 201, { status: 'received' })
      : notFound(response);
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
    response.writeHead(200, { 'content-type': contentType[path.extname(candidate)] || 'application/octet-stream' });
    return createReadStream(candidate).pipe(response);
  } catch {
    if (request.method === 'GET' && !path.extname(pathname)) {
      try { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return createReadStream(path.join(projectRoot, 'dist/index.html')).pipe(response); } catch { return notFound(response); }
    }
    return notFound(response);
  }
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', publicOrigin);
  try {
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

server.listen(port, '127.0.0.1', () => {
  assertAuthConfiguration();
  getObjectStore();
  console.log(`annotated server listening on http://localhost:${port}`);
  recoverMediaJobs().catch((error) => console.error('media recovery failed', error));
});

const shutdown = async () => {
  await closeStore().catch((error) => console.error('store shutdown failed', error));
  server.close(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
