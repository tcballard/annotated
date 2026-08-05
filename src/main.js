import './styles.css';
import { api } from './api.js';
import { deleteMediaDraft, readMediaDraft, stageMediaDraft } from './media-draft-store.js';
import { mediaPresentation } from './media-presentation.js';
import { publicAnnotationUrl } from './share-links.js';
import { authNoticeFromSearch, enabledProviders, oauthStartUrl, providerLabel } from './auth-ui.js';
import { MAX_CLIP_SECONDS } from './clip-range.js';
import { openOriginalHref, openOriginalLabel } from './deep-link.js';

const app = document.querySelector('#app');

const icons = {
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>',
  respond: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l3-3a8 8 0 1 1 14-5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  claim: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/></svg>',
  follow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h3a1 1 0 0 1 1 1v15l-8-4-8 4V5a1 1 0 0 1 1-1h3"/><path d="M12 3v8M8.5 7.5h7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.3 4.3L19 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
};

const escapeHTML = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatTime = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

// Accepts "62", "1:02", or "1:02:03" and returns whole seconds.
export const parseTimeInput = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d+(?::[0-5]?\d){0,2}$/.test(text)) return null;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

const relTime = (iso) => {
  const stamp = Date.parse(iso || '');
  if (!Number.isFinite(stamp)) return 'just now';
  const seconds = Math.max(0, (Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const sourceLabels = { video: 'video', article: 'article', podcast: 'podcast' };
const annotationVerb = (type) => type === 'article' ? 'annotated an article' : `annotated a ${sourceLabels[type] || 'source'}`;
const canModerate = () => Boolean(state.user && ['owner', 'admin', 'moderator'].includes(state.user.role));

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const normalizeSource = (item = {}) => {
  const type = item.sourceType || item.type || 'article';
  const url = item.sourceUrl || item.url || '';
  const host = item.host || item.sourceHost || hostOf(url);
  return {
    label: sourceLabels[type] || 'source',
    host,
    url,
    canonicalUrl: item.canonicalUrl || url,
    title: item.title || item.sourceTitle || host || 'Untitled source',
    duration: Number(item.duration) || 0,
    excerpt: item.excerpt || item.sourceExcerpt || '',
    mediaUrl: item.mediaUrl || item.sourceMediaUrl || '',
    provider: item.provider || '',
  };
};

const initialState = {
  activeView: 'feed',
  profileHandle: '',
  profileData: null,
  profileLoading: false,
  libraryData: null,
  libraryLoading: false,
  hubHost: '',
  hubData: null,
  hubLoading: false,
  peopleResults: [],
  curators: [],
  sourceType: 'video',
  sourceUrl: '',
  clipStart: 0,
  clipEnd: 0,
  articleExcerpt: '',
  commentary: '',
  commentaryMode: 'text',
  visibility: 'public',
  isRecording: false,
  recordedAudio: false,
  audioAssetId: '',
  audioUrl: '',
  audioDuration: 0,
  audioDraftId: '',
  clientRequestId: globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`,
  isUploadingAudio: false,
  recordingSeconds: 0,
  clipUrl: '',
  mediaStatus: 'not-applicable',
  mediaError: '',
  isRetryingMedia: false,
  published: false,
  following: false,
  followingIds: {},
  commentDraft: '',
  claimOpen: false,
  claimSlug: '',
  claimTitle: '',
  claimReason: '',
  claimError: '',
  claimSubmitted: false,
  toast: '',
  toastLink: null,
  customSource: null,
  publishedSlug: '',
  publishedAnnotation: null,
  publishedLoading: false,
  feedAnnotations: [],
  feedLoading: false,
  feedError: '',
  feedLoaded: false,
  feedFollowing: false,
  feedCursor: null,
  feedQuery: '',
  moderationClaims: [],
  moderationLoading: false,
  user: null,
  authProviders: {},
  authRequired: false,
  authNotice: '',
  authPrompt: '',
  serverStatus: 'checking',
  serverError: '',
  sourceError: '',
  isResolvingSource: false,
  isPublishing: false,
};

const draftStorageKey = 'annotated-draft-v1';
const draftFields = ['sourceType', 'sourceUrl', 'clipStart', 'clipEnd', 'articleExcerpt', 'commentary', 'commentaryMode', 'customSource', 'audioAssetId', 'audioUrl', 'audioDuration', 'audioDraftId', 'clientRequestId', 'visibility'];
const VISIBILITIES = ['public', 'unlisted', 'private'];

const saved = (() => {
  try {
    const raw = localStorage.getItem(draftStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(draftFields.filter((field) => field in parsed).map((field) => [field, parsed[field]]));
  } catch { return {}; }
})();

const state = { ...initialState, ...saved };
state.clientRequestId ||= globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`;
state.published = false;
state.publishedSlug = '';
state.publishedAnnotation = null;
state.recordedAudio = Boolean(state.audioAssetId);
let toastTimer;
let mediaRecorder;
let recordingStream;
let recordingChunks = [];
let recordingTimer;
let recordingStartedAt = 0;
let mediaPollTimer;
let claimReturnFocus = null;
let pendingCommentFocus = false;

const persist = () => {
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 2,
      sourceType: state.sourceType,
      sourceUrl: state.sourceUrl,
      clipStart: state.clipStart,
      clipEnd: state.clipEnd,
      articleExcerpt: state.articleExcerpt,
      commentary: state.commentary,
      commentaryMode: state.commentaryMode,
      visibility: state.visibility,
      audioAssetId: state.audioAssetId,
      audioUrl: state.audioUrl,
      audioDuration: state.audioDuration,
      audioDraftId: state.audioDraftId,
      clientRequestId: state.clientRequestId,
      customSource: state.customSource,
    }));
  } catch { /* private mode or blocked storage; the app remains usable */ }
};

const clearDraft = () => {
  try { localStorage.removeItem(draftStorageKey); } catch { /* blocked storage */ }
  state.customSource = null;
  state.sourceUrl = '';
  state.articleExcerpt = '';
  state.commentary = '';
  state.commentaryMode = 'text';
  state.visibility = 'public';
  state.clipStart = 0;
  state.clipEnd = 0;
  state.audioAssetId = '';
  state.audioUrl = '';
  state.audioDuration = 0;
  state.recordedAudio = false;
  state.clientRequestId = globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`;
};

const notify = (message, link = null) => {
  state.toast = message;
  state.toastLink = link;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = '';
    state.toastLink = null;
    render();
  }, link ? 5200 : 2800);
};

const icon = (name, className = '') => `<span class="icon ${className}">${icons[name] || ''}</span>`;

/* ── auth ──────────────────────────────────────────────────────────── */

const authLinks = (className = 'auth-prompt-link') => enabledProviders(state.authProviders)
  .map((provider) => `<a class="${className}" href="${escapeHTML(oauthStartUrl(provider))}">Sign in with ${providerLabel(provider)}</a>`)
  .join('');

const chromeAuth = () => {
  if (state.user) {
    const initials = escapeHTML((state.user.displayName || state.user.handle || 'A').slice(0, 2).toUpperCase());
    return `<span class="auth"><button class="me" data-action="logout" aria-label="Sign out ${escapeHTML(state.user.handle || '')}" title="Sign out">${initials}</button></span>`;
  }
  const providers = enabledProviders(state.authProviders);
  if (!providers.length) return `<span class="auth"><span class="connection-note">${state.serverStatus === 'offline' ? 'offline' : 'local'}</span></span>`;
  const [first, ...rest] = providers;
  return `<span class="auth"><a class="auth-link" href="${escapeHTML(oauthStartUrl(first))}">Sign in with ${providerLabel(first)}</a>${rest.map((provider) => `<a class="auth-link" href="${escapeHTML(oauthStartUrl(provider))}">${providerLabel(provider)}</a>`).join('')}</span>`;
};

const authStateView = () => {
  const noticeCopy = {
    success: 'Signed in. Your identity is connected to this workspace.',
    error: 'Sign-in did not complete. Nothing was published or changed.',
    cancelled: 'Sign-in was cancelled. Your draft is still here.',
  }[state.authNotice];
  const notice = noticeCopy ? `<div class="auth-notice ${state.authNotice === 'success' ? 'is-success' : 'is-error'}" role="status"><span>${escapeHTML(noticeCopy)}</span><button class="auth-notice-dismiss" data-action="dismiss-auth" aria-label="Dismiss sign-in message">${icon('close')}</button></div>` : '';
  const promptLinks = authLinks() || '<span class="auth-prompt-unavailable">No sign-in provider is available.</span>';
  const prompt = state.authPrompt && !state.user ? `<div class="auth-prompt" role="alert"><div><strong>${escapeHTML(state.authPrompt)}</strong><span class="auth-prompt-note">Your draft and current page stay put while you sign in.</span></div><div class="auth-prompt-actions">${promptLinks}<button class="auth-prompt-dismiss" data-action="dismiss-auth">Not now</button></div></div>` : '';
  return `${notice}${prompt}`;
};

const requestSignIn = (action) => {
  if (!state.authRequired || state.user) return false;
  state.authNotice = '';
  state.authPrompt = `Sign in to ${action}.`;
  render();
  return true;
};

const recoverAuthError = (error, message = 'Your session has expired. Sign in again to continue.') => {
  if (error?.status !== 401) return false;
  state.user = null;
  state.isPublishing = false;
  state.isUploadingAudio = false;
  state.authRequired = true;
  state.authNotice = '';
  state.authPrompt = message;
  render();
  return true;
};

/* ── routing ───────────────────────────────────────────────────────── */

const routeFor = (view) => view === 'feed' ? '/'
  : view === 'capture' ? '/capture'
  : view === 'library' ? '/library'
  : view === 'moderation' ? '/moderation'
  : view === 'published' && state.publishedSlug ? `/a/${encodeURIComponent(state.publishedSlug)}`
  : view === 'profile' && state.profileHandle ? `/u/${encodeURIComponent(state.profileHandle)}`
  : view === 'hub' && state.hubHost ? `/s/${encodeURIComponent(state.hubHost)}`
  : '/';

const navigate = (view, { push = true } = {}) => {
  state.activeView = view;
  state.authPrompt = '';
  if (push) window.history.pushState({}, '', routeFor(view));
  if (view === 'moderation') loadModerationClaims().then(render);
  if (view === 'library') loadLibrary().then(render);
  if (view === 'hub') loadHub().then(render);
  render();
  window.scrollTo(0, 0);
};

const applyLocation = () => {
  const routeMatch = window.location.pathname.match(/^\/a\/([^/]+)/);
  const profileMatch = window.location.pathname.match(/^\/u\/([^/]+)/);
  const hubMatch = window.location.pathname.match(/^\/s\/([^/]+)/);
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (routeMatch) {
    state.publishedSlug = decodeURIComponent(routeMatch[1]);
    state.activeView = 'published';
  } else if (hubMatch) {
    state.hubHost = decodeURIComponent(hubMatch[1]);
    state.activeView = 'hub';
  } else if (profileMatch) {
    state.profileHandle = decodeURIComponent(profileMatch[1]);
    state.activeView = 'profile';
  } else if (window.location.pathname === '/capture' || requestedView === 'capture') {
    state.activeView = 'capture';
  } else if (window.location.pathname === '/library' || requestedView === 'published' || requestedView === 'library') {
    state.activeView = 'library';
  } else if (window.location.pathname === '/moderation') {
    state.activeView = 'moderation';
  } else {
    state.activeView = 'feed';
  }
};

/* ── data plumbing ─────────────────────────────────────────────────── */

const source = () => state.customSource || (state.sourceUrl ? normalizeSource({ sourceType: state.sourceType, sourceUrl: state.sourceUrl }) : null);

const articleExcerpt = () => String(state.articleExcerpt ?? '').trim();

const annotationToFeedItem = (annotation) => ({
  type: annotation.sourceType || 'article',
  initials: (annotation.author?.displayName || annotation.author?.handle || 'A').slice(0, 1).toUpperCase(),
  handle: annotation.author?.handle || annotation.authorId || 'user',
  time: relTime(annotation.createdAt),
  host: annotation.sourceHost || hostOf(annotation.sourceUrl),
  sourceUrl: annotation.sourceUrl,
  canonicalUrl: annotation.canonicalUrl || annotation.sourceUrl,
  sourceTitle: annotation.sourceTitle || annotation.sourceHost || 'Source',
  slug: annotation.slug,
  url: annotation.url,
  clipStart: Number(annotation.clipStart) || 0,
  clipEnd: Number(annotation.clipEnd) || 0,
  anchorParagraph: annotation.anchorParagraph || null,
  anchorPrefix: annotation.anchorPrefix || '',
  anchorSuffix: annotation.anchorSuffix || '',
  quote: annotation.sourceExcerpt || '',
  commentary: annotation.commentary || '',
  commentaryMode: annotation.commentaryMode || 'text',
  audioUrl: annotation.audioUrl || '',
  opens: Number(annotation.opens) || 0,
  comments: Array.isArray(annotation.comments) ? annotation.comments.length : 0,
  authorId: annotation.author?.id || annotation.authorId || '',
  visibility: VISIBILITIES.includes(annotation.visibility) ? annotation.visibility : 'public',
  screenshotUrl: annotation.screenshotUrl || '',
});

const chipFor = (item) => item.type === 'article'
  ? (item.anchorParagraph ? `¶ ${item.anchorParagraph}` : '¶')
  : `${formatTime(item.clipStart)}–${formatTime(item.clipEnd)}`;

const hydrateAnnotation = (annotation) => {
  state.publishedAnnotation = annotation;
  state.published = true;
  state.publishedSlug = annotation.slug;
  state.clipUrl = annotation.clipUrl || '';
  state.mediaStatus = annotation.mediaStatus || 'not-applicable';
  state.mediaError = String(annotation.mediaError || '').slice(0, 280);
  state.isRetryingMedia = false;
};

const recordOpen = (slug) => {
  if (!slug || state.serverStatus !== 'online') return;
  const path = `/api/annotations/${encodeURIComponent(slug)}/open`;
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(path)) return;
  } catch { /* fall through to fetch */ }
  fetch(path, { method: 'POST', keepalive: true, credentials: 'include' }).catch(() => {});
};

const bootstrap = async () => {
  state.authNotice = authNoticeFromSearch(window.location.search);
  applyLocation();
  if (state.authNotice) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('auth');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
  render();
  try {
    await api.health();
    state.serverStatus = 'online';
    const providers = await api.providers().catch(() => ({ providers: {}, required: false }));
    state.authProviders = providers.providers || {};
    state.authRequired = Boolean(providers.required);
    state.user = await api.me().then((result) => result.user).catch(() => null);
    if (canModerate() && state.activeView === 'moderation') await loadModerationClaims();
    if (state.publishedSlug) {
      state.publishedLoading = true;
      render();
      try {
        const { annotation } = await api.getAnnotation(state.publishedSlug);
        hydrateAnnotation(annotation);
        watchMediaProcessing();
      } catch { /* the not-found state renders below */ }
      state.publishedLoading = false;
    }
    if (state.profileHandle) await loadProfile();
    if (state.activeView === 'library') await loadLibrary();
    if (state.activeView === 'hub' && state.hubHost) await loadHub();
    await loadFeed();
    await loadCurators();
  } catch (error) {
    state.serverStatus = 'offline';
    state.serverError = error.message;
  }
  await resumeStagedAudio();
  render();
};

/* ── shared markup ─────────────────────────────────────────────────── */

const chromeBar = () => {
  const links = [
    ['feed', 'Timeline'],
    ['capture', 'Capture'],
    ['library', 'Library'],
    ...(canModerate() ? [['moderation', 'Moderation']] : []),
  ];
  return `
  <header class="chrome">
    <button class="logo" data-action="set-view" data-view="feed" aria-label="annotated home">annotated<span class="dot">.</span></button>
    <nav aria-label="Primary">
      ${links.map(([view, label]) => `<button class="nav-link ${state.activeView === view ? 'is-active' : ''}" data-action="set-view" data-view="${view}">${label}</button>`).join('')}
    </nav>
    <form class="search" data-action="chrome-search-form"><input type="search" data-action="chrome-search" placeholder="Search annotations" aria-label="Search annotations" maxlength="80" value="${escapeHTML(state.feedQuery)}"></form>
    ${chromeAuth()}
  </header>`;
};

const openOriginalAction = (item, { withLabel = true } = {}) => {
  const href = openOriginalHref(item);
  const count = item.opens ? ` <span class="n">· ${item.opens}</span>` : '';
  return `<a class="act primary" href="${escapeHTML(href)}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug || '')}">${icon('open')}${withLabel ? `Open original${count}` : `Open${count}`}</a>`;
};

const hubLink = (host) => host ? `<a href="/s/${encodeURIComponent(host)}" data-action="open-hub" data-host="${escapeHTML(host)}" title="See everything annotated from ${escapeHTML(host)}">${escapeHTML(host)}</a>` : '';

const srcCard = (item) => {
  const quote = item.quote ? `<blockquote>&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  const audioNote = item.commentaryMode === 'audio' && item.audioUrl
    ? `<div class="srcaudio"><span class="icon">${icons.mic}</span><audio controls preload="none" src="${escapeHTML(item.audioUrl)}"></audio></div>`
    : '';
  return `
  <div class="srccard">
    <div class="srchead"><span class="chip">${escapeHTML(chipFor(item))}</span><span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(sourceLabels[item.type] || 'source')}${item.host ? ` · ` : ''}</span>${hubLink(item.host)}</div>
    ${quote}
    ${audioNote}
  </div>`;
};

// One row per person, shared by people search, hub annotators, and curators.
const personRow = (person, { stat = 'opens' } = {}) => {
  const following = Boolean(state.followingIds[person.id] ?? person.isFollowing);
  const stats = stat === 'opens'
    ? `<span><strong>${Number(person.opens) || 0}</strong> opens</span><span><strong>${Number(person.annotationCount) || 0}</strong> notes</span>`
    : `<span><strong>${Number(person.followers) || 0}</strong> followers</span>`;
  return `
  <div class="librow">
    <div class="avatar" aria-hidden="true">${escapeHTML((person.displayName || person.handle || 'A').slice(0, 1).toUpperCase())}</div>
    <div class="librow-main">
      <div class="librow-title"><a href="/u/${encodeURIComponent(person.handle)}" data-action="open-profile" data-handle="${escapeHTML(person.handle)}">@${escapeHTML(person.handle)}</a></div>
      <div class="librow-note">${escapeHTML(person.displayName || '')}</div>
    </div>
    <div class="libstats">${stats}</div>
    ${person.id !== state.user?.id ? `<button class="ghost" data-action="toggle-follow" data-user-id="${escapeHTML(person.id)}">${following ? 'Following' : 'Follow'}</button>` : ''}
  </div>`;
};

const feedPost = (item) => {
  const note = item.commentary
    ? `<p class="note">${escapeHTML(item.commentary)}</p>`
    : `<p class="note">${icon('mic')} Audio note — listen on the page.</p>`;
  const followAct = item.authorId && item.authorId !== state.user?.id
    ? `<button class="act ${state.followingIds[item.authorId] ? 'is-on' : ''}" data-action="toggle-follow" data-user-id="${escapeHTML(item.authorId)}">${icon('follow')}${state.followingIds[item.authorId] ? 'Following' : 'Follow'}</button>`
    : '';
  return `
  <article class="post" data-action="open-annotation" data-slug="${escapeHTML(item.slug || '')}">
    <div class="avatar" aria-hidden="true">${escapeHTML(item.initials)}</div>
    <div class="content">
      <div class="byline"><a class="name" href="/u/${encodeURIComponent(item.handle)}" data-action="open-profile" data-handle="${escapeHTML(item.handle)}">@${escapeHTML(item.handle)}</a><span class="meta">· ${escapeHTML(item.time)} · ${escapeHTML(annotationVerb(item.type))}</span></div>
      ${note}
      ${srcCard(item)}
      <div class="actions">
        ${openOriginalAction(item)}
        <button class="act" data-action="open-respond" data-slug="${escapeHTML(item.slug || '')}">${icon('respond')}<span class="n">${item.comments || 'Respond'}</span></button>
        ${followAct}
        <button class="act" data-action="share" data-share-url="${escapeHTML(publicAnnotationUrl(item, window.location.origin))}" aria-label="Share annotation">${icon('share')}</button>
      </div>
    </div>
  </article>`;
};

const skeletonPost = () => `
  <div class="post skeleton" aria-hidden="true">
    <div class="sk sk-avatar"></div>
    <div class="content">
      <div class="sk sk-line" style="width:40%"></div>
      <div class="sk sk-line" style="width:86%"></div>
      <div class="sk sk-card"></div>
    </div>
  </div>`;

/* ── views ─────────────────────────────────────────────────────────── */

const railView = () => {
  const signCard = state.user
    ? `<div class="card"><h2>Your library</h2><p>Everything you publish keeps a live link back to its source.</p><button class="btn btn-wide" data-action="set-view" data-view="library">Open your library</button></div>`
    : `<div class="card"><h2>Build your public library</h2><p>Capture now. Sign in with X or Google when you are ready to publish, follow, or respond.</p>${enabledProviders(state.authProviders).map((provider) => `<a class="btn btn-wide" href="${escapeHTML(oauthStartUrl(provider))}">Sign in with ${providerLabel(provider)}</a>`).join('') || '<p>No sign-in provider is configured.</p>'}</div>`;
  const curatorsCard = state.curators.length ? `
    <div class="card"><h2>Curators</h2><p>Ranked by opens of the original — the people sending readers back to sources.</p>${state.curators.map((person) => {
      const following = Boolean(state.followingIds[person.id] ?? person.isFollowing);
      return `<div class="curator-row"><a href="/u/${encodeURIComponent(person.handle)}" data-action="open-profile" data-handle="${escapeHTML(person.handle)}">@${escapeHTML(person.handle)}</a><span class="curator-stat"><strong>${Number(person.opens) || 0}</strong> opens</span>${person.id !== state.user?.id ? `<button class="ghost" data-action="toggle-follow" data-user-id="${escapeHTML(person.id)}">${following ? 'Following' : 'Follow'}</button>` : ''}</div>`;
    }).join('')}</div>` : '';
  return `
  <aside class="rail">
    ${signCard}
    ${curatorsCard}
    <div class="card"><h2>The annotated rule</h2><p class="rulequote">&ldquo;A clip without its source is just a rumour.&rdquo;</p><p>Every public page points back to the original. Context travels with the moment.</p></div>
    <div class="card"><h2>Sidebar-first</h2><p>Capturing from the page you are on is faster in the Chrome sidebar.</p><p><a href="/CHROMEWEBSTORE.md" data-action="extension-note">Get the extension →</a></p></div>
  </aside>`;
};

const feedView = () => {
  const items = state.feedAnnotations.map(annotationToFeedItem);
  const emptyTitle = state.feedQuery ? `No annotations match “${escapeHTML(state.feedQuery)}”.` : state.feedFollowing ? 'No annotations from people you follow yet.' : 'No public annotations yet.';
  const emptyBody = state.feedQuery ? 'Try a different source, author, or phrase.' : state.feedFollowing ? 'Follow someone whose context you want to keep up with.' : 'Capture the first source-backed moment and it will appear here.';
  const emptyAction = state.feedQuery
    ? `<button class="ghost" data-action="clear-feed-search">Clear search</button>`
    : `<button class="btn" data-action="set-view" data-view="capture">Capture a moment</button>`;
  const list = state.feedLoading && !state.feedAnnotations.length
    ? `${skeletonPost()}${skeletonPost()}${skeletonPost()}`
    : items.length
      ? items.map(feedPost).join('')
      : `<div class="feed-empty"><img class="empty-symbol" src="/brand/app-icon-light-128.png" alt="" aria-hidden="true" /><h3>${emptyTitle}</h3><p>${emptyBody}</p>${emptyAction}</div>`;
  return `
  <div class="page">
    <main class="feed">
      <div class="feedhead">
        <h1>Timeline</h1>
        <div class="tabs" role="tablist" aria-label="Timeline filter">
          <button class="tab ${state.feedFollowing ? '' : 'is-active'}" data-action="feed-filter" data-following="false" role="tab" aria-selected="${!state.feedFollowing}">Recent</button>
          <button class="tab ${state.feedFollowing ? 'is-active' : ''}" data-action="feed-filter" data-following="true" role="tab" aria-selected="${state.feedFollowing}">Following</button>
        </div>
      </div>
      ${state.feedError ? `<div class="feed-error" role="alert">${escapeHTML(state.feedError)} <button class="ghost" data-action="feed-retry">Try again</button></div>` : ''}
      ${state.feedQuery && !state.feedLoading ? `<div class="feed-error" role="status">Results for “${escapeHTML(state.feedQuery)}” <button class="ghost" data-action="clear-feed-search">Clear</button></div>` : ''}
      ${state.feedQuery && state.peopleResults.length && !state.feedLoading ? `<div class="people-strip"><div class="lib-section">People</div>${state.peopleResults.map((person) => personRow(person, { stat: 'followers' })).join('')}</div>` : ''}
      ${list}
      ${state.feedCursor ? '<button class="feed-more" data-action="feed-more">Load more</button>' : ''}
    </main>
    ${railView()}
  </div>`;
};

const playerBlock = (annotation) => {
  const media = mediaPresentation(annotation);
  const item = annotationToFeedItem(annotation);
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  const badgeText = annotation.sourceType === 'video' ? `${formatTime(clipSeconds)} · 240p` : `${formatTime(clipSeconds)} · audio`;
  const status = state.mediaStatus === 'failed' ? 'The clip could not be prepared.'
    : state.mediaStatus === 'cancelled' ? 'Clip processing was cancelled.'
    : state.mediaStatus === 'processing' ? 'Preparing the 240p clip…'
    : 'Clip queued for processing…';
  const recovery = state.mediaStatus === 'failed' ? `<div class="media-recovery"><span>${escapeHTML(state.mediaError || 'The source could not be prepared.')}</span><button data-action="retry-media" ${state.isRetryingMedia ? 'disabled' : ''}>${state.isRetryingMedia ? 'Retrying…' : 'Retry clip'}</button></div>` : '';
  if (annotation.sourceType === 'video') {
    const inner = media.kind === 'video' && media.src && media.status === 'ready'
      ? `<video controls preload="metadata" src="${escapeHTML(media.src)}"></video><span class="cliptag">CLIP</span><span class="badge">${escapeHTML(badgeText)}</span>`
      : `<span class="cliptag">CLIP</span><div class="media-status"><span>${escapeHTML(status)}</span>${recovery}</div><span class="badge">${escapeHTML(badgeText)}</span>`;
    return `<div class="player ${media.status === 'ready' ? 'is-live' : ''}">${inner}</div>`;
  }
  const audioInner = media.kind === 'audio' && media.src && media.status === 'ready'
    ? `<span class="cliptag">CLIP</span><audio controls preload="metadata" src="${escapeHTML(media.src)}"></audio><span class="badge">${escapeHTML(badgeText)}</span>`
    : `<span class="cliptag">CLIP</span><div class="media-status"><span>${escapeHTML(status)}</span>${recovery}</div>`;
  return `<div class="audiobar">${audioInner}</div>`;
};

const permalinkView = () => {
  if (state.publishedLoading) {
    return `<div class="page single"><div class="permacard">${skeletonPost()}${skeletonPost()}</div></div>`;
  }
  const annotation = state.publishedAnnotation;
  if (!annotation) {
    return `<div class="page single"><div class="perma-empty"><img class="empty-symbol" src="/brand/app-icon-light-128.png" alt="" aria-hidden="true" /><h2>${state.publishedSlug ? 'This annotation is unavailable.' : 'Nothing here yet.'}</h2><p>${state.publishedSlug ? 'It may have been removed, or the link is wrong.' : 'Capture a moment and it will get its own page, with the source attached.'}</p><button class="btn" data-action="set-view" data-view="capture">Capture a moment</button></div></div>`;
  }
  const item = annotationToFeedItem(annotation);
  const isMedia = annotation.sourceType !== 'article' && (annotation.mediaStatus || 'not-applicable') !== 'not-applicable';
  const isMine = annotation.author?.id === state.user?.id;
  const comments = annotation.comments || [];
  const commentaryAudio = annotation.commentaryMode === 'audio' && annotation.audioUrl
    ? `<div class="commentary-audio"><span>${icon('mic')} Their take</span><audio controls preload="metadata" src="${escapeHTML(annotation.audioUrl)}"></audio></div>`
    : '';
  const note = annotation.commentary
    ? `<p class="note">${escapeHTML(annotation.commentary)}</p>`
    : commentaryAudio ? '' : '<p class="note empty-note">An audio annotation of this moment.</p>';
  const srcstrip = `<div class="srcstrip"><span class="chip">${escapeHTML(chipFor(item))}</span><span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(sourceLabels[item.type] || 'source')}${item.host ? ' · ' : ''}</span>${hubLink(item.host)}<a class="open" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug)}">${escapeHTML(openOriginalLabel(item))} ↗</a></div>`;
  const screenshot = item.screenshotUrl && !isMedia
    ? `<a class="shot" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug)}"><img src="${escapeHTML(item.screenshotUrl)}" alt="Screenshot of ${escapeHTML(item.sourceTitle)}" loading="lazy" /></a>`
    : '';
  const clip = `<div class="clip">${isMedia ? playerBlock(annotation) : screenshot}${srcstrip}</div>`;
  const pull = item.quote ? `<blockquote class="pull">&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  const respondArea = state.user || !state.authRequired
    ? `<form class="respform" data-action="comment-form"><input aria-label="Add a response" placeholder="Add a considered response…" value="${escapeHTML(state.commentDraft)}" data-action="comment-draft" maxlength="500" /><button class="btn" aria-label="Post response">Respond</button></form>`
    : `<div class="respprompt">${authLinks('auth-prompt-link') ? `${enabledProviders(state.authProviders).map((provider) => `<a href="${escapeHTML(oauthStartUrl(provider))}"><b>Sign in with ${providerLabel(provider)}</b></a>`).join(' · ')} to add a response.` : 'Sign-in is unavailable right now.'}</div>`;
  return `
  <div class="page single">
    <article class="permacard">
      <div class="byline">
        <div class="avatar" aria-hidden="true">${escapeHTML(item.initials)}</div>
        <div class="who">
          <a class="name" href="/u/${encodeURIComponent(item.handle)}" data-action="open-profile" data-handle="${escapeHTML(item.handle)}">@${escapeHTML(item.handle)}</a>
          <span class="meta">${escapeHTML(item.time)} · ${escapeHTML(item.visibility)}${item.visibility === 'private' ? ' · only you can see this' : ''}</span>
        </div>
        ${!isMine && item.authorId ? `<button class="follow" data-action="toggle-follow" data-user-id="${escapeHTML(item.authorId)}">${state.followingIds[item.authorId] ? 'Following' : 'Follow'}</button>` : ''}
      </div>
      ${note}
      ${clip}
      ${pull}
      ${commentaryAudio}
      <div class="actions">
        ${openOriginalAction(item)}
        <button class="act" data-action="focus-comment">${icon('respond')}Respond${comments.length ? ` <span class="n">· ${comments.length}</span>` : ''}</button>
        <button class="act" data-action="share" data-share-url="${escapeHTML(publicAnnotationUrl(annotation, window.location.origin))}">${icon('share')}Share</button>
        <button class="act claim" data-action="toggle-claim" data-claim-slug="${escapeHTML(item.slug)}" data-claim-title="${escapeHTML(item.sourceTitle)}">${icon('claim')}File a claim</button>
      </div>
    </article>
    <section class="responses">
      <h2>Responses</h2>
      ${comments.length ? comments.map((comment) => `<div class="resp"><div class="avatar" aria-hidden="true">${escapeHTML((comment.author?.handle || 'A').slice(0, 1).toUpperCase())}</div><div class="resp-body"><b>@${escapeHTML(comment.author?.handle || comment.authorId)}</b> <span class="meta">· ${escapeHTML(relTime(comment.createdAt))}</span><br>${escapeHTML(comment.body)}</div></div>`).join('') : '<div class="resp"><span class="meta">No responses yet. Add the first considered response.</span></div>'}
      ${respondArea}
    </section>
  </div>`;
};

const marksRow = () => {
  const length = Math.max(0, state.clipEnd - state.clipStart);
  const over = length > MAX_CLIP_SECONDS;
  return `
    <div class="marks" data-marks-row>
      <label class="markfield">In<input data-action="clip-in" inputmode="numeric" value="${escapeHTML(formatTime(state.clipStart))}" aria-label="Clip in point (minutes and seconds)" /></label>
      <label class="markfield">Out<input data-action="clip-out" inputmode="numeric" value="${escapeHTML(formatTime(state.clipEnd))}" aria-label="Clip out point (minutes and seconds)" /></label>
      <span class="chip duration ${over ? 'is-over' : ''}" data-duration-chip role="status">${escapeHTML(formatTime(length))}</span>
    </div>
    ${over ? `<div class="cap-block" data-over-reason>Clips are capped at ${formatTime(MAX_CLIP_SECONDS)}. Shorten the selection.</div>` : ''}`;
};

const passageRow = () => {
  const excerpt = articleExcerpt();
  return `
    <div class="passage">
      <div class="passage-head"><span class="chip">¶</span><span>Selected passage</span><button class="passage-clear" data-action="clear-passage" aria-label="Clear the selected passage">${icon('close')}</button></div>
      <textarea data-action="article-excerpt" maxlength="2000" aria-label="Selected passage" placeholder="Paste the passage you are annotating…">${escapeHTML(excerpt)}</textarea>
      <span class="passage-hint" data-passage-hint>${excerpt.length} characters · the landing page deep-links to this passage</span>
    </div>`;
};

const recorderRow = () => {
  const status = state.isRecording ? 'Recording your take…'
    : state.isUploadingAudio ? 'Uploading your take…'
    : state.recordedAudio ? 'Audio note ready'
    : state.audioDraftId ? 'Audio note saved locally'
    : 'Record a 90-second take';
  const hint = state.isRecording ? 'Press to stop · max 1:30'
    : state.isUploadingAudio ? 'The browser is sending your note'
    : state.recordedAudio ? 'Re-record to replace it before publishing'
    : state.audioDraftId ? 'It will retry when the backend is available'
    : 'Say the thing you want to remember';
  return `
    <div class="recorder ${state.isRecording ? 'is-recording' : ''}">
      <button class="rec-button ${state.isRecording ? 'is-recording' : ''}" data-action="toggle-record" aria-label="${state.isRecording ? 'Stop recording' : 'Start recording'}" ${state.isUploadingAudio ? 'disabled' : ''}>${icon(state.isRecording ? 'stop' : 'mic')}</button>
      <div class="rec-copy"><strong role="status">${escapeHTML(status)}</strong><small>${escapeHTML(hint)}</small></div>
      <span class="rec-wave" aria-hidden="true">${'<i></i>'.repeat(9)}</span>
      <span class="rec-time">${escapeHTML(formatTime(state.isRecording ? state.recordingSeconds : state.audioDuration))}</span>
      ${state.audioDraftId && !state.recordedAudio && !state.isUploadingAudio && !state.isRecording ? '<button class="rec-retry" data-action="retry-audio">Retry upload</button>' : ''}
    </div>`;
};

// The publish gate: one reason at a time, shown under the button. Publish
// stays disabled while a reason exists — a shipped state, not an alert.
const publishBlocker = () => {
  if (state.serverStatus !== 'online') return 'The backend is offline. Your draft is safe here.';
  if (!state.customSource) return 'Resolve a source URL first.';
  if (state.sourceType === 'article' && !articleExcerpt()) return 'Add the passage you are annotating.';
  if (state.sourceType !== 'article' && state.clipEnd - state.clipStart < 1) return 'Set In and Out marks for the moment.';
  if (state.sourceType !== 'article' && state.clipEnd - state.clipStart > MAX_CLIP_SECONDS) return `Clips are capped at ${formatTime(MAX_CLIP_SECONDS)}. Shorten the selection.`;
  if (state.commentaryMode === 'text' && !state.commentary.trim()) return 'Add a note before publishing.';
  if (state.commentaryMode === 'audio' && state.isRecording) return 'Stop the recording before publishing.';
  if (state.commentaryMode === 'audio' && state.isUploadingAudio) return 'The audio note is still uploading.';
  if (state.commentaryMode === 'audio' && !state.audioAssetId) return 'Record your audio note first.';
  return '';
};

const captureView = () => {
  const resolved = state.customSource;
  const blocker = publishBlocker();
  const sourceLine = resolved
    ? `<div class="cap-source"><span class="livedot" aria-hidden="true"></span><span class="t">${escapeHTML(resolved.title)}</span><span class="type-select"><select data-action="source-type" aria-label="Source type">${['video', 'article', 'podcast'].map((type) => `<option value="${type}" ${state.sourceType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></span></div>`
    : '';
  const selection = resolved
    ? (state.sourceType === 'article' ? passageRow() : marksRow())
    : '';
  const noteArea = state.commentaryMode === 'text'
    ? `<textarea class="cap-note" data-action="commentary" maxlength="280" aria-label="Your note" placeholder="What did you notice?">${escapeHTML(state.commentary)}</textarea>`
    : recorderRow();
  return `
  <div class="page single">
    <section class="capcard">
      <h1>Capture</h1>
      <p class="capdek">Paste a link, mark the moment, leave your context. The sidebar does this from the page you are on.</p>
      <form class="cap-url" data-action="resolve-form">
        <input data-action="source-url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://youtube.com/watch?v=… · article · podcast" aria-label="Source URL" value="${escapeHTML(state.sourceUrl)}" />
        <button class="btn" type="submit" ${state.isResolvingSource ? 'disabled' : ''}>${state.isResolvingSource ? 'Resolving…' : 'Resolve'}</button>
      </form>
      ${state.sourceError ? `<div class="cap-error" role="alert">${escapeHTML(state.sourceError)}</div>` : ''}
      ${sourceLine}
      ${selection}
      ${noteArea}
      <div class="cap-foot">
        <button class="btn" data-action="publish" ${blocker || state.isPublishing ? 'disabled' : ''}>${state.isPublishing ? 'Publishing…' : 'Publish'}</button>
        ${state.commentaryMode === 'text' ? `<span class="count" data-note-count>${state.commentary.length}/280</span>` : ''}
        <span class="type-select"><select data-action="visibility" aria-label="Who can see this annotation">${VISIBILITIES.map((option) => `<option value="${option}" ${state.visibility === option ? 'selected' : ''}>${option}</option>`).join('')}</select></span>
        <span class="mode" role="group" aria-label="Note type">
          <button class="${state.commentaryMode === 'text' ? 'is-on' : ''}" data-action="commentary-mode" data-mode="text" aria-pressed="${state.commentaryMode === 'text'}">Text</button>
          <span aria-hidden="true">·</span>
          <button class="${state.commentaryMode === 'audio' ? 'is-on' : ''}" data-action="commentary-mode" data-mode="audio" aria-pressed="${state.commentaryMode === 'audio'}">Audio</button>
        </span>
      </div>
      <div class="cap-hint" data-publish-hint>${escapeHTML(blocker || 'Nothing is published until you publish. Ctrl/Cmd+Enter publishes.')}</div>
    </section>
  </div>`;
};

const libraryView = () => {
  if (!state.user) {
    return `<div class="page single"><div class="perma-empty"><img class="empty-symbol" src="/brand/app-icon-light-128.png" alt="" aria-hidden="true" /><h2>Your library is waiting.</h2><p>Sign in to see everything you have published, with per-annotation stats.</p>${authLinks('btn')}</div></div>`;
  }
  if (state.libraryLoading) return `<div class="page single">${skeletonPost()}${skeletonPost()}</div>`;
  const profile = state.libraryData;
  const annotations = (profile?.annotations || []).map(annotationToFeedItem);
  const initials = escapeHTML((state.user.displayName || state.user.handle || 'A').slice(0, 1).toUpperCase());
  const hasDraft = Boolean(state.customSource || state.commentary.trim() || articleExcerpt());
  const draftRow = hasDraft ? `
    <div class="lib-section">Drafts</div>
    <div class="librows"><div class="librow"><div class="librow-main"><div class="librow-title">${escapeHTML(state.customSource?.title || state.sourceUrl || 'Draft in progress')}</div><div class="librow-note">${escapeHTML(state.commentary || articleExcerpt() || 'No note yet')}</div></div><button class="ghost" data-action="set-view" data-view="capture">Resume</button></div></div>` : '';
  const rows = annotations.length
    ? annotations.map((item) => `
      <div class="librow">
        <span class="chip">${escapeHTML(chipFor(item))}</span>
        <div class="librow-main">
          <div class="librow-title"><a href="/a/${encodeURIComponent(item.slug)}" data-action="open-annotation-link" data-slug="${escapeHTML(item.slug)}">${escapeHTML(item.sourceTitle)}</a>${item.visibility !== 'public' ? ` <span class="vis-tag">${escapeHTML(item.visibility)}</span>` : ''}</div>
          <div class="librow-note">${escapeHTML(item.commentary || 'Audio note')}</div>
        </div>
        <div class="libstats"><span><strong>${item.opens}</strong> opens</span><span><strong>${item.comments}</strong> responses</span></div>
      </div>`).join('')
    : `<div class="librow"><div class="librow-main"><div class="librow-title">Nothing published yet.</div><div class="librow-note">Your source-backed moments will live here.</div></div><button class="ghost" data-action="set-view" data-view="capture">Capture</button></div>`;
  const shareUrl = `${window.location.origin}/u/${encodeURIComponent(state.user.handle || '')}`;
  return `
  <div class="page single">
    <div class="libhead">
      <div class="avatar" aria-hidden="true">${initials}</div>
      <div><h1>Library</h1><div class="lib-meta">@${escapeHTML(state.user.handle || '')} · ${escapeHTML(state.user.displayName || '')}</div></div>
      <div class="lib-counts"><span><strong>${Number(profile?.annotationCount) || annotations.length}</strong> published</span><span><strong>${Number(profile?.followers) || 0}</strong> followers</span><span><strong>${Number(profile?.following) || 0}</strong> following</span></div>
    </div>
    <div class="lib-section">Published</div>
    <div class="librows">${rows}</div>
    ${draftRow}
    <div class="lib-section">Share your library</div>
    <div class="card"><p>Your public profile keeps every annotation and its source in one place.</p><button class="ghost" data-action="share" data-share-url="${escapeHTML(shareUrl)}">${icon('share')} Copy ${escapeHTML(shareUrl.replace(/^https?:\/\//, ''))}</button></div>
  </div>`;
};

const hubView = () => {
  if (state.hubLoading && !state.hubData) return `<div class="page single">${skeletonPost()}${skeletonPost()}</div>`;
  if (!state.hubData) return `<div class="page single"><div class="perma-empty"><h2>This source could not be loaded.</h2><p>${escapeHTML(state.hubHost)} may be unreachable, or the backend is offline.</p><button class="ghost" data-action="set-view" data-view="feed">${icon('back')} Back to the timeline</button></div></div>`;
  const { source: hubSource, annotators, annotations } = state.hubData;
  const items = (annotations || []).map(annotationToFeedItem);
  return `
  <div class="page single">
    <div class="libhead">
      <div class="avatar" aria-hidden="true">${escapeHTML((hubSource.host || 'S').slice(0, 1).toUpperCase())}</div>
      <div><h1>${escapeHTML(hubSource.host)}</h1><div class="lib-meta">source hub · everything annotated from here</div></div>
      <div class="lib-counts"><span><strong>${Number(hubSource.annotationCount) || 0}</strong> annotations</span><span><strong>${Number(hubSource.opens) || 0}</strong> opens driven</span></div>
    </div>
    ${annotators?.length ? `<div class="lib-section">Top annotators</div><div class="librows">${annotators.map((person) => personRow(person)).join('')}</div>` : ''}
    <div class="lib-section">Annotations</div>
    <main class="feed hub-feed">
      ${items.length ? items.map(feedPost).join('') : `<div class="feed-empty"><h3>Nothing public from ${escapeHTML(hubSource.host)} yet.</h3><p>Capture the first source-backed moment from this source.</p><button class="btn" data-action="set-view" data-view="capture">Capture a moment</button></div>`}
    </main>
  </div>`;
};

const profileView = () => {
  if (state.profileLoading) return `<div class="page single">${skeletonPost()}${skeletonPost()}</div>`;
  if (!state.profileData) return `<div class="page single"><div class="perma-empty"><h2>We could not load this profile.</h2><p>${escapeHTML(state.serverError || 'Check the handle and try again.')}</p><button class="ghost" data-action="set-view" data-view="feed">${icon('back')} Back to the timeline</button></div></div>`;
  const profile = state.profileData;
  const items = (profile.annotations || []).map(annotationToFeedItem);
  const isCurrentUser = state.user?.id === profile.id;
  const following = Boolean(state.followingIds[profile.id] ?? profile.isFollowing);
  return `
  <div class="page single">
    <div class="libhead">
      <div class="avatar" aria-hidden="true">${escapeHTML((profile.displayName || profile.handle || 'A').slice(0, 1).toUpperCase())}</div>
      <div><h1>${escapeHTML(profile.displayName || profile.handle)}</h1><div class="lib-meta">@${escapeHTML(profile.handle)}${profile.bio ? ` · ${escapeHTML(profile.bio)}` : ''}</div></div>
      <div class="lib-counts"><span><strong>${Number(profile.annotationCount) || items.length}</strong> annotations</span><span><strong>${Number(profile.followers) || 0}</strong> followers</span></div>
      ${!isCurrentUser ? `<button class="ghost ${following ? 'is-on' : ''}" data-action="toggle-follow" data-user-id="${escapeHTML(profile.id)}">${following ? 'Following' : 'Follow'}</button>` : ''}
    </div>
    <main class="feed" style="border:1px solid var(--border);border-radius:10px;min-height:0;overflow:hidden">
      ${items.length ? items.map(feedPost).join('') : `<div class="feed-empty"><h3>No annotations yet.</h3><p>Published moments appear here with their sources attached.</p></div>`}
    </main>
  </div>`;
};

const moderationView = () => {
  if (!canModerate()) return `<div class="page single"><div class="perma-empty"><h2>Moderation access is required.</h2><p>Sign in with an owner, admin, or moderator account to review claims.</p></div></div>`;
  const statuses = ['open', 'in_review', 'resolved', 'rejected'];
  const claims = state.moderationClaims || [];
  return `
  <div class="page single">
    <div class="modhead"><h1>Claims</h1><button class="ghost" data-action="refresh-moderation">${state.moderationLoading ? 'Refreshing…' : 'Refresh queue'}</button></div>
    ${claims.length ? claims.map((claim) => {
      const annotation = claim.annotation || {};
      const current = claim.status || 'open';
      return `<article class="modcard">
        <div class="mod-meta"><span class="claim-status">${escapeHTML(current.replace('_', ' '))}</span><span>${escapeHTML(claim.createdAt ? new Date(claim.createdAt).toLocaleString() : 'Recently')}</span></div>
        <h3>${escapeHTML(annotation.sourceTitle || 'Untitled annotation')}</h3>
        <p class="mod-reason">${escapeHTML(claim.reason || 'No reason supplied.')}</p>
        <div class="mod-meta"><span>Reported by ${escapeHTML(claim.reporter?.displayName || claim.reporter?.handle || claim.reporterId || 'unknown')}</span><a href="${escapeHTML(annotation.sourceUrl || '#')}" target="_blank" rel="noreferrer">Open source ${icon('open')}</a></div>
        <div class="mod-actions">${statuses.map((status) => `<button class="${current === status ? 'is-current' : ''}" data-action="moderate-claim" data-claim-id="${escapeHTML(claim.id)}" data-status="${status}" ${current === status ? 'disabled' : ''}>${status.replace('_', ' ')}</button>`).join('')}</div>
        ${claim.resolutionNote ? `<p class="mod-note">${escapeHTML(claim.resolutionNote)}</p>` : ''}
      </article>`;
    }).join('') : `<div class="perma-empty"><h2>${state.moderationLoading ? 'Loading claims…' : 'The queue is clear.'}</h2><p>New rights reports appear here with their source and reporter attached.</p></div>`}
  </div>`;
};

const claimModal = () => `<div class="modal-backdrop" data-action="close-claim">
  <div class="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title" aria-describedby="claim-description" data-action="stop-modal" data-stop-click="true">
    <button class="modal-close" data-action="close-claim" aria-label="Close claim form">${icon('close')}</button>
    <h3 id="claim-title">${state.claimSubmitted ? 'Claim received' : 'File a claim'}</h3>
    ${state.claimTitle ? `<p class="claim-context">About: ${escapeHTML(state.claimTitle)}</p>` : ''}
    ${state.claimSubmitted
      ? `<div class="claim-success" role="status"><strong>Thank you for flagging this.</strong><p id="claim-description">The report is attached to this annotation for review.</p></div><button class="btn full-button" data-action="close-claim">Done</button>`
      : `<p id="claim-description">Tell us what is wrong with this annotation. The report stays attached to the source page.</p><label>What should we review?<textarea placeholder="Describe the issue…" data-action="claim-text" aria-describedby="claim-error">${escapeHTML(state.claimReason)}</textarea></label>${state.claimError ? `<p class="claim-error" id="claim-error" role="alert">${escapeHTML(state.claimError)}</p>` : '<span id="claim-error" hidden></span>'}<button class="btn full-button" data-action="submit-claim">Send claim</button>`}
  </div>
</div>`;

const toast = () => state.toast
  ? `<div class="toast" role="status">${icon('check')}<span>${escapeHTML(state.toast)}</span>${state.toastLink ? `<a href="${escapeHTML(state.toastLink.href)}" data-action="toast-link">${escapeHTML(state.toastLink.label)}</a>` : ''}</div>`
  : '';

const footerView = () => `
  <footer>
    <a href="/privacy.html">Privacy</a>
    <a href="#" data-action="rights-note">Rights &amp; claims</a>
    <span class="footer-note">annotated © 2026 · source-first notes</span>
  </footer>`;

const render = () => {
  const view = state.activeView === 'capture' ? captureView()
    : state.activeView === 'published' ? permalinkView()
    : state.activeView === 'library' ? libraryView()
    : state.activeView === 'profile' ? profileView()
    : state.activeView === 'hub' ? hubView()
    : state.activeView === 'moderation' ? moderationView()
    : feedView();
  const offline = state.serverStatus === 'offline' ? `<div class="offline-note" role="alert">The annotated backend is unreachable. Reading and drafting still work; publishing will resume when it returns.</div>` : '';
  app.innerHTML = `${chromeBar()}${offline}${authStateView()}${view}${footerView()}${state.claimOpen ? claimModal() : ''}${toast()}`;
  for (const element of app.querySelectorAll('.chrome, .auth-notice, .auth-prompt, .page, footer, .offline-note')) {
    element.inert = state.claimOpen;
    if (state.claimOpen) element.setAttribute('aria-hidden', 'true');
  }
  if (pendingCommentFocus) {
    pendingCommentFocus = false;
    app.querySelector('[data-action="comment-draft"]')?.focus();
  }
};

/* ── capture logic ─────────────────────────────────────────────────── */

const setClipBoundary = (boundary, rawValue) => {
  const parsed = parseTimeInput(rawValue);
  if (parsed === null) return false;
  if (boundary === 'start') {
    state.clipStart = parsed;
    if (state.clipEnd < parsed) state.clipEnd = parsed;
  } else {
    state.clipEnd = parsed;
    if (state.clipStart > parsed) state.clipStart = parsed;
  }
  return true;
};

const refreshCaptureBits = () => {
  const chipEl = app.querySelector('[data-duration-chip]');
  const length = Math.max(0, state.clipEnd - state.clipStart);
  if (chipEl) {
    chipEl.textContent = formatTime(length);
    chipEl.classList.toggle('is-over', length > MAX_CLIP_SECONDS);
  }
  const blocker = publishBlocker();
  const hint = app.querySelector('[data-publish-hint]');
  if (hint) hint.textContent = blocker || 'Nothing is published until you publish. Ctrl/Cmd+Enter publishes.';
  const publishButton = app.querySelector('[data-action="publish"]');
  if (publishButton) publishButton.disabled = Boolean(blocker || state.isPublishing);
  const overReason = app.querySelector('[data-over-reason]');
  if (length <= MAX_CLIP_SECONDS && overReason) overReason.remove();
  if (length > MAX_CLIP_SECONDS && !overReason) {
    const marks = app.querySelector('[data-marks-row]');
    if (marks) {
      const reason = document.createElement('div');
      reason.className = 'cap-block';
      reason.dataset.overReason = 'true';
      reason.textContent = `Clips are capped at ${formatTime(MAX_CLIP_SECONDS)}. Shorten the selection.`;
      marks.after(reason);
    }
  }
};

const stopAudioRecording = () => {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  state.isRecording = false;
  clearInterval(recordingTimer);
  mediaRecorder.stop();
  render();
};

const uploadAudioBlob = async (blob, stagedId = '') => {
  state.isUploadingAudio = true;
  render();
  try {
    if (state.serverStatus !== 'online') throw new Error('Backend unavailable.');
    const { media } = await api.uploadAudio(blob);
    if (stagedId) await deleteMediaDraft(stagedId).catch(() => {});
    state.audioDraftId = '';
    state.audioAssetId = media.id;
    state.audioUrl = media.url;
    state.recordedAudio = true;
    state.isUploadingAudio = false;
    persist();
    notify('Audio note uploaded. It is ready to publish.');
  } catch (error) {
    state.isUploadingAudio = false;
    state.recordedAudio = false;
    state.audioDraftId = stagedId;
    persist();
    render();
    notify(stagedId ? 'Audio note saved locally. It will retry when the backend is available.' : error.message || 'Audio upload failed.');
  }
};

const retryStagedAudio = async () => {
  if (!state.audioDraftId) return;
  if (state.serverStatus !== 'online') { notify('Backend unavailable — the local audio draft is safe.'); return; }
  const staged = await readMediaDraft(state.audioDraftId).catch(() => null);
  if (!staged?.blob) {
    state.audioDraftId = '';
    persist();
    notify('The local audio draft is no longer available.');
    return;
  }
  await uploadAudioBlob(staged.blob, state.audioDraftId);
};

const resumeStagedAudio = async () => {
  if (!state.audioDraftId || state.audioAssetId || state.serverStatus !== 'online') return;
  await retryStagedAudio();
};

const startAudioRecording = async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { notify('Audio recording is not supported in this browser.'); return; }
  try {
    if (state.audioDraftId) await deleteMediaDraft(state.audioDraftId).catch(() => {});
    state.audioDraftId = '';
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(recordingStream);
    recordingChunks = [];
    recordingStartedAt = Date.now();
    state.recordedAudio = false;
    state.audioAssetId = '';
    state.audioUrl = '';
    state.audioDuration = 0;
    state.recordingSeconds = 0;
    state.isRecording = true;
    mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) recordingChunks.push(event.data); });
    mediaRecorder.addEventListener('stop', async () => {
      recordingStream?.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      state.audioDuration = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
      state.audioDraftId = await stageMediaDraft(blob, { kind: 'audio', duration: state.audioDuration }).catch(() => '');
      persist();
      await uploadAudioBlob(blob, state.audioDraftId);
    }, { once: true });
    mediaRecorder.start(1000);
    recordingTimer = setInterval(() => {
      state.recordingSeconds = Math.min(90, Math.round((Date.now() - recordingStartedAt) / 1000));
      if (state.recordingSeconds >= 90) stopAudioRecording();
      else render();
    }, 1000);
    render();
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    notify(error.message || 'Microphone permission is required to record.');
  }
};

const toggleAudioRecording = () => state.isRecording ? stopAudioRecording() : startAudioRecording();

/* ── loaders ───────────────────────────────────────────────────────── */

const loadModerationClaims = async () => {
  if (!canModerate() || state.serverStatus !== 'online') return;
  state.moderationLoading = true;
  try {
    const result = await api.moderationClaims();
    state.moderationClaims = result.claims || [];
  } catch (error) {
    state.moderationClaims = [];
    state.serverError = error.message;
  } finally {
    state.moderationLoading = false;
  }
};

const loadProfile = async () => {
  if (!state.profileHandle || state.serverStatus !== 'online') return;
  state.profileLoading = true;
  try {
    const result = await api.profile(state.profileHandle);
    state.profileData = result.profile || null;
    if (state.profileData?.id) state.followingIds[state.profileData.id] = Boolean(state.profileData.isFollowing);
  } catch (error) {
    state.profileData = null;
    state.serverError = error.message;
  } finally {
    state.profileLoading = false;
  }
};

const loadHub = async () => {
  if (!state.hubHost || state.serverStatus !== 'online') return;
  state.hubLoading = true;
  try {
    const result = await api.sourceHub(state.hubHost);
    state.hubData = result;
    for (const person of result.annotators || []) {
      if (person.id && !(person.id in state.followingIds)) state.followingIds[person.id] = Boolean(person.isFollowing);
    }
  } catch {
    state.hubData = null;
  } finally {
    state.hubLoading = false;
  }
};

const loadCurators = async () => {
  if (state.serverStatus !== 'online') return;
  try {
    const result = await api.people();
    state.curators = (result.people || []).slice(0, 3);
    for (const person of state.curators) {
      if (person.id && !(person.id in state.followingIds)) state.followingIds[person.id] = Boolean(person.isFollowing);
    }
  } catch { /* the rail card simply stays hidden */ }
};

const loadLibrary = async () => {
  if (!state.user?.handle || state.serverStatus !== 'online') return;
  state.libraryLoading = true;
  try {
    const result = await api.profile(state.user.handle);
    state.libraryData = result.profile || null;
  } catch {
    state.libraryData = null;
  } finally {
    state.libraryLoading = false;
  }
};

const loadFeed = async ({ append = false } = {}) => {
  if (state.serverStatus !== 'online') return;
  state.feedLoading = true;
  state.feedError = '';
  if (!append) render();
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (state.feedFollowing) params.set('following', 'true');
    if (state.feedQuery.trim()) params.set('q', state.feedQuery.trim());
    if (append && state.feedCursor) params.set('cursor', state.feedCursor);
    const result = await api.feed(params.toString());
    state.feedAnnotations = append ? [...state.feedAnnotations, ...(result.annotations || [])] : (result.annotations || []);
    state.feedCursor = result.nextCursor || null;
    state.feedLoaded = true;
    if (!append && state.feedQuery.trim()) {
      const people = await api.people(state.feedQuery.trim()).catch(() => ({ people: [] }));
      state.peopleResults = people.people || [];
      for (const person of state.peopleResults) {
        if (person.id && !(person.id in state.followingIds)) state.followingIds[person.id] = Boolean(person.isFollowing);
      }
    } else if (!state.feedQuery.trim()) {
      state.peopleResults = [];
    }
  } catch (error) {
    if (state.feedFollowing && error?.status === 401) {
      state.feedFollowing = false;
      state.feedCursor = null;
      recoverAuthError(error, 'Sign in to see the people you follow.');
    } else {
      state.feedError = 'The timeline could not be loaded.';
    }
  } finally {
    state.feedLoading = false;
  }
};

const watchMediaProcessing = () => {
  clearInterval(mediaPollTimer);
  if (!state.publishedSlug || !['queued', 'processing'].includes(state.mediaStatus)) return;
  mediaPollTimer = setInterval(async () => {
    if (state.serverStatus !== 'online') return;
    try {
      const { annotation } = await api.getAnnotation(state.publishedSlug);
      hydrateAnnotation(annotation);
      if (!['queued', 'processing'].includes(state.mediaStatus)) clearInterval(mediaPollTimer);
      render();
    } catch { /* a transient poll failure should not interrupt the page */ }
  }, 1500);
};

const loadSource = async () => {
  const url = state.sourceUrl.trim();
  if (!url) { state.sourceError = 'Paste a source URL first.'; render(); return; }
  if (state.serverStatus !== 'online') { state.sourceError = 'Backend unavailable — source resolution is not connected.'; render(); return; }
  state.sourceError = '';
  state.isResolvingSource = true;
  render();
  try {
    const { source: resolved } = await api.resolveSource(url);
    if (resolved.error || resolved.processing === 'metadata-unavailable') throw new Error(resolved.error || 'Source metadata could not be loaded.');
    state.customSource = normalizeSource(resolved);
    state.sourceType = resolved.sourceType;
    state.sourceUrl = resolved.sourceUrl;
    state.articleExcerpt = resolved.sourceType === 'article' ? (resolved.excerpt || '') : '';
    state.clientRequestId = globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`;
    if (state.sourceType === 'article') {
      state.clipStart = 0;
      state.clipEnd = 0;
    } else {
      state.clipStart = 0;
      state.clipEnd = Math.min(MAX_CLIP_SECONDS, Math.max(1, Math.round(Number(resolved.duration) || 60)));
    }
    state.isResolvingSource = false;
    persist();
    render();
    notify(`Resolved ${state.customSource.host || 'source'} — mark the moment.`);
  } catch (error) {
    state.isResolvingSource = false;
    state.sourceError = error.message || 'Source could not be resolved.';
    render();
  }
};

const publishAnnotation = async () => {
  if (requestSignIn('publish this annotation')) return;
  const blocker = publishBlocker();
  if (blocker) { notify(blocker); return; }
  const currentSource = state.customSource;
  state.isPublishing = true;
  render();
  try {
    const { annotation } = await api.createAnnotation({
      sourceUrl: state.sourceUrl,
      sourceType: state.sourceType,
      sourceTitle: currentSource.title,
      sourceHost: currentSource.host,
      sourceExcerpt: state.sourceType === 'article' ? articleExcerpt() : currentSource.excerpt || '',
      canonicalUrl: currentSource.canonicalUrl || state.sourceUrl,
      clipStart: state.clipStart,
      clipEnd: state.clipEnd,
      commentary: state.commentaryMode === 'text' ? state.commentary : '',
      commentaryMode: state.commentaryMode,
      visibility: state.visibility,
      audioAssetId: state.commentaryMode === 'audio' ? state.audioAssetId : undefined,
      audioDuration: state.commentaryMode === 'audio' ? state.audioDuration : undefined,
      mediaUrl: currentSource.mediaUrl || undefined,
      provider: currentSource.provider || undefined,
      clientRequestId: state.clientRequestId,
    });
    hydrateAnnotation(annotation);
    state.isPublishing = false;
    if (state.audioDraftId) await deleteMediaDraft(state.audioDraftId).catch(() => {});
    state.audioDraftId = '';
    clearDraft();
    persist();
    state.activeView = 'published';
    window.history.pushState({}, '', `/a/${encodeURIComponent(annotation.slug)}`);
    watchMediaProcessing();
    render();
    window.scrollTo(0, 0);
    notify('Published', { href: annotation.url, label: 'View page' });
    loadFeed().then(render);
  } catch (error) {
    if (recoverAuthError(error, 'Sign in to publish this annotation.')) return;
    state.isPublishing = false;
    render();
    notify(error.message || 'Annotation could not be published.');
  }
};

const copyPublicLink = async (requestedLink = '') => {
  const link = requestedLink || publicAnnotationUrl(state.publishedAnnotation, window.location.origin);
  if (!link) { notify('Publish an annotation before copying its link.'); return; }
  try {
    await navigator.clipboard.writeText(link);
    notify('Link copied.');
  } catch {
    notify(link);
  }
};

const submitComment = async () => {
  const body = state.commentDraft.trim();
  if (!body) { notify('Write something before posting.'); return; }
  if (!state.publishedSlug) return;
  if (requestSignIn('post a response')) return;
  if (state.serverStatus !== 'online') { notify('Backend unavailable — response not posted.'); return; }
  try {
    const { annotation } = await api.addComment(state.publishedSlug, body);
    state.publishedAnnotation = annotation;
    state.commentDraft = '';
    render();
    notify('Response added.');
  } catch (error) {
    if (recoverAuthError(error, 'Sign in to post a response.')) return;
    notify(error.message || 'Response could not be posted.');
  }
};

const submitClaim = async () => {
  const reason = state.claimReason.trim();
  if (!reason) {
    state.claimError = 'Tell us what should be reviewed.';
    render();
    document.querySelector('[data-action="claim-text"]')?.focus();
    return;
  }
  const claimSlug = state.claimSlug || state.publishedSlug;
  if (!claimSlug || state.serverStatus !== 'online') {
    state.claimError = 'The backend is unavailable. Your report is still here; try again when the connection returns.';
    render();
    document.querySelector('[data-action="claim-text"]')?.focus();
    return;
  }
  if (state.authRequired && !state.user) {
    state.claimOpen = false;
    requestSignIn('file a claim');
    return;
  }
  try {
    await api.fileClaim(claimSlug, reason);
    state.claimReason = '';
    state.claimError = '';
    state.claimSubmitted = true;
    render();
    document.querySelector('.full-button[data-action="close-claim"]')?.focus();
  } catch (error) {
    if (error?.status === 401) {
      state.claimOpen = false;
      recoverAuthError(error, 'Sign in to file a claim.');
      return;
    }
    state.claimError = error.message || 'Claim could not be submitted. Your report is still here.';
    render();
    document.querySelector('[data-action="claim-text"]')?.focus();
  }
};

const restoreClaimFocus = () => {
  const returnTarget = claimReturnFocus?.slug
    ? [...document.querySelectorAll('[data-action="toggle-claim"][data-claim-slug]')].find((element) => element.dataset.claimSlug === claimReturnFocus.slug)
    : document.querySelector('[data-action="toggle-claim"]');
  (returnTarget || document.querySelector('.nav-link.is-active'))?.focus();
  claimReturnFocus = null;
};

const closeClaimDialog = () => {
  state.claimOpen = false;
  state.claimSlug = '';
  state.claimTitle = '';
  state.claimError = '';
  state.claimSubmitted = false;
  render();
  restoreClaimFocus();
};

const openAnnotation = async (slug) => {
  if (!slug) return;
  state.publishedSlug = slug;
  state.publishedAnnotation = state.feedAnnotations.find((item) => item.slug === slug) || null;
  state.published = Boolean(state.publishedAnnotation);
  if (state.publishedAnnotation) {
    state.clipUrl = state.publishedAnnotation.clipUrl || '';
    state.mediaStatus = state.publishedAnnotation.mediaStatus || 'not-applicable';
    state.mediaError = String(state.publishedAnnotation.mediaError || '').slice(0, 280);
  }
  navigate('published');
  try {
    const { annotation } = await api.getAnnotation(slug);
    hydrateAnnotation(annotation);
    watchMediaProcessing();
    render();
  } catch { /* rendered from feed data; a fetch miss keeps that view */ }
};

const openProfile = (handle) => {
  if (!handle) return;
  state.profileHandle = handle;
  state.profileData = null;
  navigate('profile');
  loadProfile().then(render);
};

/* ── events ────────────────────────────────────────────────────────── */

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (target.dataset.stopClick === 'true') return;
  if (action === 'dismiss-auth') {
    state.authNotice = '';
    state.authPrompt = '';
    render();
    document.querySelector('.nav-link.is-active')?.focus();
    return;
  }
  if (action === 'set-view') {
    if (target.dataset.view === 'moderation' && !canModerate()) { notify('Moderation access is required.'); return; }
    if (state.activeView !== 'profile') state.profileHandle = '';
    navigate(target.dataset.view);
    return;
  }
  if (action === 'open-annotation') {
    if (event.target.closest('a, button:not([data-action="open-annotation"])')) return;
    event.preventDefault();
    openAnnotation(target.dataset.slug);
    return;
  }
  if (action === 'open-annotation-link') {
    event.preventDefault();
    openAnnotation(target.dataset.slug);
    return;
  }
  if (action === 'open-profile') {
    event.preventDefault();
    openProfile(target.dataset.handle);
    return;
  }
  if (action === 'open-hub') {
    event.preventDefault();
    state.hubHost = target.dataset.host || '';
    state.hubData = null;
    navigate('hub');
    return;
  }
  if (action === 'open-respond') {
    pendingCommentFocus = true;
    openAnnotation(target.dataset.slug);
    return;
  }
  if (action === 'open-original') {
    recordOpen(target.dataset.slug);
    return; // the anchor's default navigation opens the source in a new tab
  }
  if (action === 'source-type') return; // handled on change
  if (action === 'clear-passage') {
    state.articleExcerpt = '';
    persist();
    render();
    app.querySelector('[data-action="article-excerpt"]')?.focus();
    return;
  }
  if (action === 'commentary-mode') { if (state.isRecording) stopAudioRecording(); state.commentaryMode = target.dataset.mode; persist(); render(); return; }
  if (action === 'toggle-record') { toggleAudioRecording(); return; }
  if (action === 'retry-audio') { retryStagedAudio(); return; }
  if (action === 'publish') { publishAnnotation(); return; }
  if (action === 'feed-filter') {
    const following = target.dataset.following === 'true';
    if (following && requestSignIn('see the people you follow')) return;
    state.feedFollowing = following;
    state.feedCursor = null;
    loadFeed().then(render);
    return;
  }
  if (action === 'clear-feed-search') { state.feedQuery = ''; state.feedCursor = null; loadFeed().then(render); return; }
  if (action === 'feed-more') { loadFeed({ append: true }).then(render); return; }
  if (action === 'feed-retry') { loadFeed().then(render); return; }
  if (action === 'refresh-moderation') { loadModerationClaims().then(render); return; }
  if (action === 'moderate-claim') {
    if (!canModerate() || state.serverStatus !== 'online') { notify('Moderation is unavailable while the backend is offline.'); return; }
    const claimId = target.dataset.claimId;
    const status = target.dataset.status;
    (async () => {
      try {
        await api.moderateClaim(claimId, status);
        await loadModerationClaims();
        render();
        notify(`Claim marked ${status.replace('_', ' ')}.`);
      } catch (error) { notify(error.message || 'Claim status could not be saved.'); }
    })();
    return;
  }
  if (action === 'toggle-follow') {
    const userId = target.dataset.userId;
    if (!userId || state.serverStatus !== 'online') return;
    if (requestSignIn('follow this member')) return;
    const following = Boolean(state.followingIds[userId]);
    (async () => {
      try {
        const result = following ? await api.unfollow(userId) : await api.follow(userId);
        state.followingIds[userId] = result.following;
        if (state.profileData?.id === userId) {
          state.profileData.isFollowing = result.following;
          state.profileData.followers = Math.max(0, Number(state.profileData.followers || 0) + (result.following ? 1 : -1));
        }
        render();
      } catch (error) {
        if (!recoverAuthError(error, 'Sign in to follow this member.')) notify(error.message || 'Follow could not be saved.');
      }
    })();
    return;
  }
  if (action === 'retry-media') {
    if (!state.publishedSlug || state.serverStatus !== 'online' || state.isRetryingMedia) return;
    if (requestSignIn('retry this clip')) return;
    state.isRetryingMedia = true;
    render();
    (async () => {
      try {
        const result = await api.retryMedia(state.publishedSlug);
        hydrateAnnotation(result.annotation);
        watchMediaProcessing();
        render();
        notify('Clip retry queued.');
      } catch (error) {
        if (!recoverAuthError(error, 'Sign in to retry this clip.')) notify(error.message || 'Clip retry could not be queued.');
        state.isRetryingMedia = false;
        render();
      }
    })();
    return;
  }
  if (action === 'focus-comment') { document.querySelector('[data-action="comment-draft"]')?.focus(); return; }
  if (action === 'share') { copyPublicLink(target.dataset.shareUrl || ''); return; }
  if (action === 'toggle-claim') {
    claimReturnFocus = { slug: target.dataset.claimSlug || '', view: state.activeView };
    state.claimSlug = target.dataset.claimSlug || '';
    state.claimTitle = target.dataset.claimTitle || '';
    state.claimOpen = true;
    state.claimError = '';
    state.claimSubmitted = false;
    render();
    document.querySelector('[data-action="claim-text"]')?.focus();
    return;
  }
  if (action === 'close-claim') { closeClaimDialog(); return; }
  if (action === 'submit-claim') { submitClaim(); return; }
  if (action === 'rights-note') { event.preventDefault(); notify('Use “File a claim” on any annotation page to report a rights issue.'); return; }
  if (action === 'extension-note') { event.preventDefault(); notify('The extension ships with the repository — see CHROMEWEBSTORE.md.'); return; }
  if (action === 'logout') { api.logout().then(() => { state.user = null; render(); notify('Signed out.'); }).catch((error) => notify(error.message || 'Sign out failed.')); return; }
});

app.addEventListener('keydown', (event) => {
  if (state.claimOpen) {
    const dialog = app.querySelector('.claim-modal');
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeClaimDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, textarea, input, select, a[href]')]
      .filter((element) => !element.disabled && !element.hidden && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  if (state.activeView === 'capture') {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      publishAnnotation();
      return;
    }
    if (event.key === 'Escape' && !event.target.closest('input, textarea')) {
      if (state.sourceType === 'article' ? articleExcerpt() : state.clipEnd - state.clipStart > 0) {
        state.articleExcerpt = state.sourceType === 'article' ? '' : state.articleExcerpt;
        if (state.sourceType !== 'article') { state.clipStart = 0; state.clipEnd = 0; }
        persist();
        render();
      }
    }
  }
});

app.addEventListener('input', (event) => {
  const action = event.target.dataset.action;
  if (action === 'commentary') {
    state.commentary = event.target.value.slice(0, 280);
    const count = app.querySelector('[data-note-count]');
    if (count) count.textContent = `${state.commentary.length}/280`;
    persist();
    refreshCaptureBits();
  }
  if (action === 'comment-draft') state.commentDraft = event.target.value;
  if (action === 'claim-text') {
    state.claimReason = event.target.value;
    state.claimError = '';
  }
  if (action === 'source-url') { state.sourceUrl = event.target.value; state.sourceError = ''; }
  if (action === 'article-excerpt') {
    state.articleExcerpt = event.target.value.slice(0, 2000);
    const hint = app.querySelector('[data-passage-hint]');
    if (hint) hint.textContent = `${state.articleExcerpt.trim().length} characters · the landing page deep-links to this passage`;
    persist();
    refreshCaptureBits();
  }
  if (action === 'chrome-search') { /* applied on submit */ }
});

app.addEventListener('change', (event) => {
  const action = event.target.dataset.action;
  if (action === 'clip-in' || action === 'clip-out') {
    const applied = setClipBoundary(action === 'clip-in' ? 'start' : 'end', event.target.value);
    if (!applied) {
      event.target.value = formatTime(action === 'clip-in' ? state.clipStart : state.clipEnd);
      notify('Times accept 1:02 or plain seconds.');
      return;
    }
    event.target.value = formatTime(action === 'clip-in' ? state.clipStart : state.clipEnd);
    const other = app.querySelector(`[data-action="${action === 'clip-in' ? 'clip-out' : 'clip-in'}"]`);
    if (other) other.value = formatTime(action === 'clip-in' ? state.clipEnd : state.clipStart);
    persist();
    refreshCaptureBits();
  }
  if (action === 'visibility') {
    state.visibility = VISIBILITIES.includes(event.target.value) ? event.target.value : 'public';
    persist();
    return;
  }
  if (action === 'source-type') {
    state.sourceType = event.target.value;
    if (state.sourceType === 'article') { state.clipStart = 0; state.clipEnd = 0; }
    else if (state.clipEnd - state.clipStart < 1) { state.clipStart = 0; state.clipEnd = Math.min(MAX_CLIP_SECONDS, Math.max(1, Math.round(Number(state.customSource?.duration) || 60))); }
    persist();
    render();
  }
});

app.addEventListener('submit', (event) => {
  if (event.target.dataset.action === 'comment-form') {
    event.preventDefault();
    submitComment();
  }
  if (event.target.dataset.action === 'resolve-form') {
    event.preventDefault();
    loadSource();
  }
  if (event.target.dataset.action === 'chrome-search-form') {
    event.preventDefault();
    state.feedQuery = event.target.querySelector('[data-action="chrome-search"]')?.value?.trim().slice(0, 80) || '';
    state.feedCursor = null;
    if (state.activeView !== 'feed') navigate('feed');
    loadFeed().then(render);
  }
});

window.addEventListener('popstate', () => {
  applyLocation();
  if (state.activeView === 'published' && state.publishedSlug) {
    openAnnotation(state.publishedSlug);
    return;
  }
  if (state.activeView === 'profile' && state.profileHandle) { loadProfile().then(render); }
  if (state.activeView === 'library') { loadLibrary().then(render); }
  if (state.activeView === 'hub' && state.hubHost) { loadHub().then(render); }
  render();
});

render();
bootstrap();
