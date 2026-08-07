import './styles.css';
import { api } from './api.js';
import { deleteMediaDraft, readMediaDraft, stageMediaDraft } from './media-draft-store.js';
import { mediaPresentation } from './media-presentation.js';
import { publicAnnotationUrl } from './share-links.js';
import { authNoticeFromSearch, enabledProviders, oauthStartUrl, providerLabel } from './auth-ui.js';
import { MAX_CLIP_SECONDS } from './clip-range.js';
import { openOriginalHref, openOriginalLabel } from './deep-link.js';
import { sharedUrlFromParams } from './share-capture.js';
import { isTopic, TOPICS, topicLabel } from './topics.js';
import { annotationToFeedItem, annotationVerb, chipFor, formatTime, hostOf, parseTimeInput, relTime, sourceLabels, VISIBILITIES } from './feed-item.js';
import { avatarColor, avatarInitial } from './avatar.js';

const app = document.querySelector('#app');

// Shell mode: the native app loads every surface with ?shell=1 — navigation
// chrome and the footer belong to its own tab bar, so the page renders
// content only. The flag sticks in sessionStorage so in-page reloads (auth
// returns, pull-to-refresh) stay chromeless after routing cleans the URL.
const SHELL_MODE = (() => {
  const requested = new URLSearchParams(window.location.search).get('shell') === '1';
  try {
    if (requested) sessionStorage.setItem('annotated-shell', '1');
    return requested || sessionStorage.getItem('annotated-shell') === '1';
  } catch {
    return requested;
  }
})();
if (SHELL_MODE) document.documentElement.classList.add('shell-mode');

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
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
};

const escapeHTML = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

// formatTime, parseTimeInput, relTime, sourceLabels, annotationVerb, and
// hostOf now live in the shared core (src/feed-item.js) — one vocabulary
// for web, extension, and the native app.
const canModerate = () => Boolean(state.user && ['owner', 'admin', 'moderator'].includes(state.user.role));

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
  signinOpen: false,
  signinContext: '',
  lightbox: null,
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
  publishedRemoved: '',
  editingNote: false,
  editNoteDraft: '',
  feedAnnotations: [],
  feedLoading: false,
  feedError: '',
  feedLoaded: false,
  feedFollowing: false,
  feedSort: 'recent',
  feedTopic: null,
  feedTopics: [],
  notifications: [],
  notificationsLoading: false,
  unseenNotifications: 0,
  publishMoment: null,
  trendingSources: [],
  topic: '',
  feedCursor: null,
  feedQuery: '',
  moderationClaims: [],
  moderationLoading: false,
  transparencyData: null,
  transparencyLoading: false,
  user: null,
  authProviders: {},
  authRequired: false,
  authNotice: '',
  serverStatus: 'checking',
  serverError: '',
  sourceError: '',
  isResolvingSource: false,
  isPublishing: false,
};

const draftStorageKey = 'annotated-draft-v1';
const draftFields = ['sourceType', 'sourceUrl', 'clipStart', 'clipEnd', 'articleExcerpt', 'commentary', 'commentaryMode', 'customSource', 'audioAssetId', 'audioUrl', 'audioDuration', 'audioDraftId', 'clientRequestId', 'visibility', 'topic'];

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
      topic: state.topic,
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
  state.topic = '';
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

// One avatar everywhere: the OAuth profile photo when the account has one,
// otherwise a deterministic colored initial — same color for the same
// handle on web, extension, and the native app.
const avatarHtml = (person = {}) => person.avatarUrl
  ? `<span class="avatar has-photo" aria-hidden="true"><img src="${escapeHTML(person.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
  : `<span class="avatar" aria-hidden="true" style="background:${avatarColor(person.handle || person.displayName)};color:#fff">${escapeHTML(avatarInitial(person))}</span>`;

/* ── auth ──────────────────────────────────────────────────────────── */

// One door: every sign-in affordance opens the same modal — the anatomy the
// extension panel established. The provider buttons are real anchors (web
// OAuth is a full-page hop), so the modal needs no JS to do its job.
const signinModal = () => {
  const providers = enabledProviders(state.authProviders);
  const doors = providers.length
    ? providers.map((provider) => `<a class="continue" href="${escapeHTML(oauthStartUrl(provider))}"><span class="pmark" aria-hidden="true">${escapeHTML(providerLabel(provider).slice(0, 1))}</span>Continue with ${providerLabel(provider)}</a>`).join('')
    : '<p class="signin-unavailable">No sign-in provider is configured on this backend.</p>';
  return `<div class="modal-backdrop" data-action="close-signin">
  <div class="signin-modal" role="dialog" aria-modal="true" aria-labelledby="signin-title">
    <h3 id="signin-title">Add your name to the margin</h3>
    <p class="signin-sub">One account across the extension, the web, and the app.</p>
    ${state.signinContext ? `<p class="signin-context">${escapeHTML(state.signinContext)} Your draft and current page stay put while you sign in.</p>` : ''}
    ${doors}
    <button class="signin-cancel" data-action="close-signin">Not now</button>
  </div>
</div>`;
};

const openSignin = (context = '') => {
  state.signinContext = context;
  state.signinOpen = true;
  render();
  document.querySelector('.signin-modal .continue')?.focus();
};

const closeSignin = () => {
  if (!state.signinOpen) return;
  state.signinOpen = false;
  state.signinContext = '';
  render();
  document.querySelector('[data-action="open-signin"]')?.focus();
};

const chromeAuth = () => {
  if (state.user) {
    const initials = escapeHTML((state.user.displayName || state.user.handle || 'A').slice(0, 2).toUpperCase());
    const face = state.user.avatarUrl
      ? `<img src="${escapeHTML(state.user.avatarUrl)}" alt="" referrerpolicy="no-referrer" />`
      : initials;
    const bell = `<button class="bell ${state.activeView === 'notifications' ? 'is-active' : ''}" data-action="open-notifications" aria-label="Notifications${state.unseenNotifications ? ` (${state.unseenNotifications} unseen)` : ''}">${icon('bell')}${state.unseenNotifications ? `<span class="n">${state.unseenNotifications > 9 ? '9+' : state.unseenNotifications}</span>` : ''}</button>`;
    return `<span class="auth">${bell}<button class="me ${state.user.avatarUrl ? 'has-photo' : ''}" data-action="logout" aria-label="Sign out ${escapeHTML(state.user.handle || '')}" title="Sign out">${face}</button></span>`;
  }
  const providers = enabledProviders(state.authProviders);
  if (!providers.length) return `<span class="auth"><span class="connection-note">${state.serverStatus === 'offline' ? 'offline' : 'local'}</span></span>`;
  return `<span class="auth"><button class="auth-link" data-action="open-signin">Sign in</button></span>`;
};

const authStateView = () => {
  const noticeCopy = {
    success: 'Signed in. Your identity is connected to this workspace.',
    error: 'Sign-in did not complete. Nothing was published or changed.',
    cancelled: 'Sign-in was cancelled. Your draft is still here.',
  }[state.authNotice];
  const notice = noticeCopy ? `<div class="auth-notice ${state.authNotice === 'success' ? 'is-success' : 'is-error'}" role="status"><span>${escapeHTML(noticeCopy)}</span><button class="auth-notice-dismiss" data-action="dismiss-auth" aria-label="Dismiss sign-in message">${icon('close')}</button></div>` : '';
  return notice;
};

const requestSignIn = (action) => {
  if (!state.authRequired || state.user) return false;
  state.authNotice = '';
  openSignin(`Sign in to ${action}.`);
  return true;
};

const recoverAuthError = (error, message = 'Your session has expired. Sign in again to continue.') => {
  if (error?.status !== 401) return false;
  state.user = null;
  state.isPublishing = false;
  state.isUploadingAudio = false;
  state.authRequired = true;
  state.authNotice = '';
  openSignin(message);
  return true;
};

/* ── routing ───────────────────────────────────────────────────────── */

// transparency is routed like a doc page but loads live data via navigate().
const DOC_VIEWS = { about: '/about', extension: '/extension', audit: '/audit', rights: '/rights', terms: '/terms', transparency: '/transparency' };

const routeFor = (view) => view === 'feed' ? '/'
  : view === 'capture' ? '/capture'
  : view === 'library' ? '/library'
  : view === 'notifications' ? '/notifications'
  : view === 'moderation' ? '/moderation'
  : DOC_VIEWS[view] ? DOC_VIEWS[view]
  : view === 'published' && state.publishedSlug ? `/a/${encodeURIComponent(state.publishedSlug)}`
  : view === 'profile' && state.profileHandle ? `/u/${encodeURIComponent(state.profileHandle)}`
  : view === 'hub' && state.hubHost ? `/s/${encodeURIComponent(state.hubHost)}`
  : '/';

const navigate = (view, { push = true } = {}) => {
  state.activeView = view;
  state.signinOpen = false;
  state.signinContext = '';
  if (push) window.history.pushState({}, '', routeFor(view));
  if (view === 'moderation') loadModerationClaims().then(render);
  if (view === 'library') loadLibrary().then(render);
  if (view === 'hub') loadHub().then(render);
  if (view === 'transparency') loadTransparency().then(render);
  if (view === 'notifications') loadNotifications().then(render);
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
  } else if (window.location.pathname === '/notifications') {
    state.activeView = 'notifications';
  } else if (window.location.pathname === '/moderation') {
    state.activeView = 'moderation';
  } else if (Object.values(DOC_VIEWS).includes(window.location.pathname)) {
    state.activeView = Object.keys(DOC_VIEWS).find((view) => DOC_VIEWS[view] === window.location.pathname);
  } else {
    state.activeView = 'feed';
  }
};

/* ── data plumbing ─────────────────────────────────────────────────── */

const source = () => state.customSource || (state.sourceUrl ? normalizeSource({ sourceType: state.sourceType, sourceUrl: state.sourceUrl }) : null);

const articleExcerpt = () => String(state.articleExcerpt ?? '').trim();

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const withinEditWindow = (annotation) => {
  const created = Date.parse(annotation?.createdAt || '');
  return Number.isFinite(created) && Date.now() - created <= EDIT_WINDOW_MS;
};

const hydrateAnnotation = (annotation) => {
  state.publishedAnnotation = annotation;
  state.published = true;
  state.publishedSlug = annotation.slug;
  state.editingNote = false;
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
      } catch (error) {
        if (error?.status === 410) state.publishedRemoved = error.body?.reason || 'rights-claim';
        /* otherwise the not-found state renders below */
      }
      state.publishedLoading = false;
    }
    if (state.profileHandle) await loadProfile();
    if (state.activeView === 'library') await loadLibrary();
    if (state.activeView === 'hub' && state.hubHost) await loadHub();
    if (state.activeView === 'transparency') await loadTransparency();
    if (state.activeView === 'notifications') await loadNotifications();
    // The bell badge: one light read; opening the view clears it for real.
    if (state.user && state.activeView !== 'notifications') {
      api.notifications().then((result) => {
        state.unseenNotifications = Number(result.unseenCount) || 0;
        if (state.unseenNotifications) render();
      }).catch(() => {});
    }
    // A Web Share Target launch (or any shared link) lands on
    // /capture?url=…&text=…&title=… — pick out the URL, clean the address
    // bar, and resolve immediately so the share is one publish away.
    if (state.activeView === 'capture') {
      const sharedUrl = sharedUrlFromParams(new URLSearchParams(window.location.search));
      if (sharedUrl) {
        state.sourceUrl = sharedUrl;
        window.history.replaceState({}, '', '/capture');
        await loadSource();
      }
    }
    await loadFeed();
    await loadCurators();
  } catch (error) {
    state.serverStatus = 'offline';
    state.serverError = error.message;
  }
  await resumeStagedAudio();
  render();
  // Installable PWA: the service worker also makes the app share-target
  // eligible on Android. Absent in dev (vite serves no /sw.js) — harmless.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* dev or unsupported */ });
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
  <header class="chrome${state.activeView === 'feed' ? ' has-rail' : ''}">
    <button class="logo" data-action="set-view" data-view="feed" aria-label="annotated home"><img src="/brand/logo-inverse.svg" alt="" aria-hidden="true" /></button>
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
  const opensTip = item.opens ? ` title="${item.opens} ${item.opens === 1 ? 'open' : 'opens'} of the original"` : '';
  return `<a class="act primary" href="${escapeHTML(href)}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug || '')}"${opensTip}>${icon('open')}${withLabel ? `Open original${count}` : `Open${count}`}</a>`;
};

const hubLink = (host) => host ? `<a href="/s/${encodeURIComponent(host)}" data-action="open-hub" data-host="${escapeHTML(host)}" title="See everything annotated from ${escapeHTML(host)}">${escapeHTML(host)}</a>` : '';

// Waveform bars for hosted audio, rendered from server-extracted peaks.
// Click seeks the sibling player; the played portion darkens via clip-path
// (updated in place on timeupdate — no re-render). Peaks are 0..100.
const waveform = (peaks) => {
  if (!Array.isArray(peaks) || !peaks.length) return '';
  const bars = peaks.map((peak) => `<span style="height:${Math.max(8, Math.min(100, Number(peak) || 0))}%"></span>`).join('');
  return `<div class="wave" data-action="wave-seek" role="presentation">
    <div class="wave-base">${bars}</div>
    <div class="wave-played" style="clip-path: inset(0 100% 0 0)">${bars}</div>
  </div>`;
};

// The media slot renders only what is actually ready — a playable hosted
// clip or a screenshot. Processing states stay on the permalink; the feed
// never shows a dead frame.
const srcCardMedia = (item) => {
  const clipSeconds = Math.max(0, item.clipEnd - item.clipStart);
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'video') {
    return `<div class="srcmedia"><video controls preload="metadata" ${item.posterUrl ? `poster="${escapeHTML(item.posterUrl)}" ` : ''}src="${escapeHTML(item.clipUrl)}"></video><span class="cliptag">CLIP</span><span class="badge">${escapeHTML(formatTime(clipSeconds))}</span></div>`;
  }
  if (item.clipUrl && item.mediaStatus === 'ready' && item.type === 'podcast') {
    return `<div class="srcmedia srcmedia-audio"><span class="cliptag">CLIP</span><div class="srcmedia-audio-main">${waveform(item.clipPeaks)}<audio controls preload="none" src="${escapeHTML(item.clipUrl)}"></audio></div><span class="badge">${escapeHTML(formatTime(clipSeconds))} · audio</span></div>`;
  }
  if (item.screenshotUrl) {
    return `<div class="srcmedia"><button class="shot-open" data-action="open-lightbox" data-src="${escapeHTML(item.screenshotUrl)}" data-alt="Screenshot of ${escapeHTML(item.sourceTitle)}" data-href="${escapeHTML(openOriginalHref(item))}" aria-label="Enlarge screenshot of ${escapeHTML(item.sourceTitle)}"><img loading="lazy" src="${escapeHTML(item.screenshotUrl)}" alt="Screenshot of ${escapeHTML(item.sourceTitle)}" /><span class="shot-hint">Click to enlarge</span></button></div>`;
  }
  return '';
};

const srcCard = (item) => {
  const quote = item.quote ? `<blockquote>&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  const audioNote = item.commentaryMode === 'audio' && item.audioUrl
    ? `<div class="srcaudio"><span class="icon">${icons.mic}</span><div class="srcaudio-main">${waveform(item.audioPeaks)}<audio controls preload="none" src="${escapeHTML(item.audioUrl)}"></audio></div>${item.audioDuration ? `<span class="srcaudio-time">${escapeHTML(formatTime(item.audioDuration))}</span>` : ''}</div>`
    : '';
  return `
  <div class="srccard">
    <div class="srchead">${item.type !== 'article' ? `<span class="chip">${escapeHTML(chipFor(item))}</span>` : ''}<span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(sourceLabels[item.type] || 'source')}${item.host ? ` · ` : ''}</span>${hubLink(item.host)}</div>
    ${srcCardMedia(item)}
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
    ${avatarHtml(person)}
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
    : `<p class="note">${icon('mic')} Audio note${item.audioDuration ? ` · ${escapeHTML(formatTime(item.audioDuration))}` : ''} — listen below.</p>`;
  const followAct = item.authorId && item.authorId !== state.user?.id
    ? `<button class="act ${state.followingIds[item.authorId] ? 'is-on' : ''}" data-action="toggle-follow" data-user-id="${escapeHTML(item.authorId)}">${icon('follow')}${state.followingIds[item.authorId] ? 'Following' : 'Follow'}</button>`
    : '';
  return `
  <article class="post" data-action="open-annotation" data-slug="${escapeHTML(item.slug || '')}">
    ${avatarHtml(item)}
    <div class="content">
      <div class="byline"><a class="name" href="/u/${encodeURIComponent(item.handle)}" data-action="open-profile" data-handle="${escapeHTML(item.handle)}">@${escapeHTML(item.handle)}</a><span class="meta">· ${escapeHTML(annotationVerb(item.type))}${item.editedAt ? ' · edited' : ''}</span>${item.topic ? `<button class="topic-tag" data-action="feed-topic" data-topic="${escapeHTML(item.topic)}" title="See what's trending in ${escapeHTML(topicLabel(item.topic))}">${escapeHTML(topicLabel(item.topic))}</button>` : ''}<span class="meta posttime">${escapeHTML(item.time)}</span></div>
      ${note}
      ${srcCard(item)}
      <div class="actions">
        <button class="act" data-action="open-respond" data-slug="${escapeHTML(item.slug || '')}">${icon('respond')}<span class="n">${item.comments || 'Respond'}</span></button>
        <button class="act ${item.likedByMe ? 'is-liked' : ''}" data-action="toggle-like" data-slug="${escapeHTML(item.slug || '')}" aria-label="${item.likedByMe ? 'Unlike' : 'Like'} this annotation">${icon('heart')}${item.likes ? `<span class="n">${item.likes}</span>` : ''}</button>
        ${followAct}
        ${openOriginalAction(item)}
        <button class="act share" data-action="share" data-share-url="${escapeHTML(publicAnnotationUrl(item, window.location.origin))}" aria-label="Share annotation">${icon('share')}</button>
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
    : `<div class="card"><h2>Build your public library</h2><p>Capture now. Sign in with X or Google when you are ready to publish, follow, or respond.</p>${enabledProviders(state.authProviders).length ? '' : '<p>No sign-in provider is configured.</p>'}</div>`;
  const trendingCard = state.trendingSources.length ? `
    <div class="card"><h2>Trending sources</h2><p>Where attention is going right now — ranked by opens of the original.</p>${state.trendingSources.map((source) => `
      <div class="trend-row"><a href="/s/${encodeURIComponent(source.host)}" data-action="open-hub" data-host="${escapeHTML(source.host)}">${escapeHTML(source.host)}</a><span class="trend-stat"><strong>${Number(source.opens) || 0}</strong> opens · ${Number(source.annotationCount) || 0} ${source.annotationCount === 1 ? 'note' : 'notes'}</span></div>`).join('')}</div>` : '';
  const curatorsCard = state.curators.length ? `
    <div class="card"><h2>Curators</h2><p>Ranked by opens of the original — the people sending readers back to sources.</p>${state.curators.map((person) => {
      const following = Boolean(state.followingIds[person.id] ?? person.isFollowing);
      return `<div class="curator-row"><a href="/u/${encodeURIComponent(person.handle)}" data-action="open-profile" data-handle="${escapeHTML(person.handle)}">@${escapeHTML(person.handle)}</a><span class="curator-stat"><strong>${Number(person.opens) || 0}</strong> opens</span>${person.id !== state.user?.id ? `<button class="ghost" data-action="toggle-follow" data-user-id="${escapeHTML(person.id)}">${following ? 'Following' : 'Follow'}</button>` : ''}</div>`;
    }).join('')}</div>` : '';
  return `
  <aside class="rail">
    ${signCard}
    ${trendingCard}
    ${curatorsCard}
    <div class="card"><h2>The annotated rule</h2><p class="rulequote">&ldquo;A clip without its source is just a rumour.&rdquo;</p><p>Every public page points back to the original. Context travels with the moment.</p></div>
    <div class="card"><h2>Sidebar-first</h2><p>Capturing from the page you are on is faster in the Chrome sidebar.</p><p><a href="/extension" data-action="set-view" data-view="extension">Get the extension →</a></p></div>
  </aside>`;
};

const feedView = () => {
  const items = state.feedAnnotations.map(annotationToFeedItem);
  const trendingEmpty = !state.feedFollowing && state.feedSort === 'trending';
  const emptyTitle = state.feedQuery ? `Nothing matches “${escapeHTML(state.feedQuery)}”.` : state.feedFollowing ? 'No annotations from people you follow yet.' : trendingEmpty ? 'Nothing is trending yet.' : 'No public annotations yet.';
  const emptyBody = state.feedQuery ? 'Try a different source, author, or phrase.' : state.feedFollowing ? 'Follow someone whose context you want to keep up with.' : trendingEmpty ? 'Annotations trend as readers open their originals and respond.' : 'Capture the first source-backed moment and it will appear here.';
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
        <h1 class="sr-only">Timeline</h1>
        <div class="tabs" role="tablist" aria-label="Timeline filter">
          <button class="tab ${!state.feedFollowing && state.feedSort !== 'trending' ? 'is-active' : ''}" data-action="feed-filter" data-following="false" data-sort="recent" role="tab" aria-selected="${!state.feedFollowing && state.feedSort !== 'trending'}">Recent</button>
          <button class="tab ${!state.feedFollowing && state.feedSort === 'trending' ? 'is-active' : ''}" data-action="feed-filter" data-following="false" data-sort="trending" role="tab" aria-selected="${!state.feedFollowing && state.feedSort === 'trending'}">Trending</button>
          <button class="tab ${state.feedFollowing ? 'is-active' : ''}" data-action="feed-filter" data-following="true" data-sort="recent" role="tab" aria-selected="${state.feedFollowing}">Following</button>
        </div>
      </div>
      ${!state.feedFollowing && state.feedSort === 'trending' && state.feedTopics.length ? `
      <div class="topic-chips" role="group" aria-label="Filter trending by topic">
        <button class="topic-chip ${!state.feedTopic ? 'is-active' : ''}" data-action="feed-topic" data-topic="">All</button>
        ${state.feedTopics.map((entry) => `<button class="topic-chip ${state.feedTopic === entry.slug ? 'is-active' : ''}" data-action="feed-topic" data-topic="${escapeHTML(entry.slug)}">${escapeHTML(entry.label)} <span class="n">${entry.count}</span></button>`).join('')}
      </div>` : ''}
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
  const badgeText = annotation.sourceType === 'video' ? formatTime(clipSeconds) : `${formatTime(clipSeconds)} · audio`;
  const status = state.mediaStatus === 'failed' ? 'The clip could not be prepared.'
    : state.mediaStatus === 'cancelled' ? 'Clip processing was cancelled.'
    : state.mediaStatus === 'processing' ? 'Preparing the clip…'
    : 'Clip queued for processing…';
  const recovery = state.mediaStatus === 'failed' ? `<div class="media-recovery"><span>${escapeHTML(state.mediaError || 'The source could not be prepared.')}</span><button data-action="retry-media" ${state.isRetryingMedia ? 'disabled' : ''}>${state.isRetryingMedia ? 'Retrying…' : 'Retry clip'}</button></div>` : '';
  if (annotation.sourceType === 'video') {
    const inner = media.kind === 'video' && media.src && media.status === 'ready'
      ? `<video controls preload="metadata" ${annotation.posterUrl ? `poster="${escapeHTML(annotation.posterUrl)}" ` : ''}src="${escapeHTML(media.src)}"></video><span class="cliptag">CLIP</span><span class="badge">${escapeHTML(badgeText)}</span>`
      : `<span class="cliptag">CLIP</span><div class="media-status"><span>${escapeHTML(status)}</span>${recovery}</div><span class="badge">${escapeHTML(badgeText)}</span>`;
    return `<div class="player ${media.status === 'ready' ? 'is-live' : ''}">${inner}</div>`;
  }
  const audioInner = media.kind === 'audio' && media.src && media.status === 'ready'
    ? `<span class="cliptag">CLIP</span><div class="srcmedia-audio-main">${waveform(annotation.clipPeaks)}<audio controls preload="metadata" src="${escapeHTML(media.src)}"></audio></div><span class="badge">${escapeHTML(badgeText)}</span>`
    : `<span class="cliptag">CLIP</span><div class="media-status"><span>${escapeHTML(status)}</span>${recovery}</div>`;
  return `<div class="audiobar">${audioInner}</div>`;
};

const permalinkView = () => {
  if (state.publishedLoading) {
    return `<div class="page single"><div class="permacard">${skeletonPost()}${skeletonPost()}</div></div>`;
  }
  if (state.publishedRemoved) {
    return `<div class="page single"><div class="perma-empty"><h2>This annotation was removed after a rights claim.</h2><p>The source owner asked for it to come down, and the hosted media has been deleted. The claim trail is retained for accountability.</p><button class="ghost" data-action="set-view" data-view="feed">${icon('back')} Back to the timeline</button></div></div>`;
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
    ? `<div class="commentary-audio"><span>${icon('mic')} Their take</span><div class="srcaudio-main">${waveform(annotation.audioPeaks)}<audio controls preload="metadata" src="${escapeHTML(annotation.audioUrl)}"></audio></div></div>`
    : '';
  const note = state.editingNote && isMine
    ? `<div class="note-edit"><textarea class="cap-note" data-action="edit-note-draft" maxlength="280" aria-label="Edit your note">${escapeHTML(state.editNoteDraft)}</textarea><div class="note-edit-foot"><button class="btn" data-action="save-note">Save</button><button class="ghost" data-action="cancel-note">Cancel</button><span class="count">${state.editNoteDraft.length}/280</span></div></div>`
    : annotation.commentary
      ? `<p class="note">${escapeHTML(annotation.commentary)}</p>`
      : commentaryAudio ? '' : '<p class="note empty-note">An audio annotation of this moment.</p>';
  const srcstrip = `<div class="srcstrip">${item.type !== 'article' ? `<span class="chip">${escapeHTML(chipFor(item))}</span>` : ''}<span class="srcname">${escapeHTML(item.sourceTitle)}</span><span>· ${escapeHTML(sourceLabels[item.type] || 'source')}${item.host ? ' · ' : ''}</span>${hubLink(item.host)}<a class="open" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug)}">${escapeHTML(openOriginalLabel(item))} ↗</a></div>`;
  const screenshot = item.screenshotUrl && !isMedia
    ? `<a class="shot" href="${escapeHTML(openOriginalHref(item))}" target="_blank" rel="noreferrer" data-action="open-original" data-slug="${escapeHTML(item.slug)}"><img src="${escapeHTML(item.screenshotUrl)}" alt="Screenshot of ${escapeHTML(item.sourceTitle)}" loading="lazy" /></a>`
    : '';
  const clip = `<div class="clip">${isMedia ? playerBlock(annotation) : screenshot}${srcstrip}</div>`;
  const pull = item.quote ? `<blockquote class="pull">&ldquo;${escapeHTML(item.quote)}&rdquo;</blockquote>` : '';
  const respondArea = state.user || !state.authRequired
    ? `<form class="respform" data-action="comment-form"><input aria-label="Add a response" placeholder="Add a considered response…" value="${escapeHTML(state.commentDraft)}" data-action="comment-draft" maxlength="500" /><button class="btn" aria-label="Post response">Respond</button></form>`
    : `<div class="respprompt">${enabledProviders(state.authProviders).length ? '<button class="linklike" data-action="open-signin"><b>Sign in</b></button> to add a response.' : 'Sign-in is unavailable right now.'}</div>`;
  return `
  <div class="page single">
    <article class="permacard">
      <div class="byline">
        ${avatarHtml(item)}
        <div class="who">
          <a class="name" href="/u/${encodeURIComponent(item.handle)}" data-action="open-profile" data-handle="${escapeHTML(item.handle)}">@${escapeHTML(item.handle)}</a>
          <span class="meta">${escapeHTML(item.time)}${item.editedAt ? ' · edited' : ''} · ${isMine
            ? `<span class="type-select"><select data-action="permalink-visibility" aria-label="Who can see this annotation">${VISIBILITIES.map((option) => `<option value="${option}" ${item.visibility === option ? 'selected' : ''}>${option}</option>`).join('')}</select></span>`
            : `${escapeHTML(item.visibility)}`}${item.visibility === 'private' ? ' · only you can see this' : ''}${isMine && withinEditWindow(annotation)
            ? ` · <span class="type-select"><select data-action="permalink-topic" aria-label="Topic">${`<option value="">no topic</option>${TOPICS.map((option) => `<option value="${option.slug}" ${item.topic === option.slug ? 'selected' : ''}>${option.label}</option>`).join('')}`}</select></span>`
            : item.topic ? ` <button class="topic-tag" data-action="feed-topic" data-topic="${escapeHTML(item.topic)}" title="See what's trending in ${escapeHTML(topicLabel(item.topic))}">${escapeHTML(topicLabel(item.topic))}</button>` : ''}</span>
        </div>
        ${!isMine && item.authorId ? `<button class="follow" data-action="toggle-follow" data-user-id="${escapeHTML(item.authorId)}">${state.followingIds[item.authorId] ? 'Following' : 'Follow'}</button>` : ''}
      </div>
      ${note}
      ${clip}
      ${pull}
      ${commentaryAudio}
      <div class="actions">
        <button class="act" data-action="focus-comment">${icon('respond')}Respond${comments.length ? ` <span class="n">· ${comments.length}</span>` : ''}</button>
        <button class="act ${item.likedByMe ? 'is-liked' : ''}" data-action="toggle-like" data-slug="${escapeHTML(item.slug || '')}" aria-label="${item.likedByMe ? 'Unlike' : 'Like'} this annotation">${icon('heart')}${item.likes ? `<span class="n">${item.likes}</span>` : 'Like'}</button>
        <button class="act" data-action="share" data-share-url="${escapeHTML(publicAnnotationUrl(annotation, window.location.origin))}">${icon('share')}Share</button>
        ${item.visibility !== 'private' ? `<a class="act" href="/og/${encodeURIComponent(item.slug)}.png?download=1" download="annotated-${escapeHTML(item.slug)}.png" title="Download this annotation's share card as an image">Save card</a>` : ''}
        ${isMine && annotation.commentaryMode === 'text' && withinEditWindow(annotation) && !state.editingNote ? `<button class="act" data-action="edit-note">Edit note</button>` : ''}
        ${isMine ? `<button class="act" data-action="delete-annotation" data-slug="${escapeHTML(item.slug)}">Delete</button>` : ''}
        ${openOriginalAction(item)}
        <button class="act claim" data-action="toggle-claim" data-claim-slug="${escapeHTML(item.slug)}" data-claim-title="${escapeHTML(item.sourceTitle)}" title="Dispute a fair-use breach on this annotation">${icon('claim')}Dispute fair use</button>
      </div>
    </article>
    <section class="responses">
      <h2>Responses</h2>
      ${comments.length ? comments.map((comment) => `<div class="resp">${avatarHtml(comment.author || {})}<div class="resp-body"><b>@${escapeHTML(comment.author?.handle || comment.authorId)}</b> <span class="meta">· ${escapeHTML(relTime(comment.createdAt))}</span><br>${escapeHTML(comment.body)}</div></div>`).join('') : '<div class="resp"><span class="meta">No responses yet. Add the first considered response.</span></div>'}
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
      <div class="passage-head"><span>Selected passage</span><button class="passage-clear" data-action="clear-passage" aria-label="Clear the selected passage">${icon('close')}</button></div>
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
        ${navigator.clipboard?.readText && !state.customSource ? `<button class="ghost" type="button" data-action="paste-link" title="Read a copied link from the clipboard">Paste link</button>` : ''}
      </form>
      ${state.sourceError ? `<div class="cap-error" role="alert">${escapeHTML(state.sourceError)}</div>` : ''}
      ${sourceLine}
      ${selection}
      ${noteArea}
      <div class="cap-foot">
        <button class="btn" data-action="publish" ${blocker || state.isPublishing ? 'disabled' : ''}>${state.isPublishing ? 'Publishing…' : 'Publish'}</button>
        ${state.commentaryMode === 'text' ? `<span class="count" data-note-count>${state.commentary.length}/280</span>` : ''}
        <span class="type-select"><select data-action="visibility" aria-label="Who can see this annotation">${VISIBILITIES.map((option) => `<option value="${option}" ${state.visibility === option ? 'selected' : ''}>${option}</option>`).join('')}</select></span>
        <span class="type-select"><select data-action="capture-topic" aria-label="Topic (optional)"><option value="">no topic</option>${TOPICS.map((option) => `<option value="${option.slug}" ${state.topic === option.slug ? 'selected' : ''}>${option.label}</option>`).join('')}</select></span>
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
    return `<div class="page single"><div class="perma-empty"><img class="empty-symbol" src="/brand/app-icon-light-128.png" alt="" aria-hidden="true" /><h2>Your library is waiting.</h2><p>Sign in to see everything you have published, with per-annotation stats.</p><button class="btn" data-action="open-signin">Sign in</button></div></div>`;
  }
  if (state.libraryLoading) return `<div class="page single">${skeletonPost()}${skeletonPost()}</div>`;
  const profile = state.libraryData;
  const annotations = (profile?.annotations || []).map(annotationToFeedItem);
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
        <button class="ghost" data-action="delete-annotation" data-slug="${escapeHTML(item.slug)}">Delete</button>
      </div>`).join('')
    : `<div class="librow"><div class="librow-main"><div class="librow-title">Nothing published yet.</div><div class="librow-note">Your source-backed moments will live here.</div></div><button class="ghost" data-action="set-view" data-view="capture">Capture</button></div>`;
  const shareUrl = `${window.location.origin}/u/${encodeURIComponent(state.user.handle || '')}`;
  return `
  <div class="page single">
    <div class="libhead">
      ${avatarHtml(state.user)}
      <div><h1>Library</h1><div class="lib-meta">@${escapeHTML(state.user.handle || '')} · ${escapeHTML(state.user.displayName || '')}</div></div>
      <div class="lib-counts"><span><strong>${Number(profile?.annotationCount) || annotations.length}</strong> published</span><span><strong>${Number(profile?.followers) || 0}</strong> followers</span><span><strong>${Number(profile?.following) || 0}</strong> following</span></div>
      ${SHELL_MODE ? `<button class="ghost" data-action="logout">Sign out</button>` : ''}
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
      ${state.hubData.nextCursor ? `<button class="feed-more" data-action="hub-more">${state.hubLoading ? 'Loading…' : 'Load more'}</button>` : ''}
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
      ${avatarHtml(profile)}
      <div><h1>${escapeHTML(profile.displayName || profile.handle)}</h1><div class="lib-meta">@${escapeHTML(profile.handle)}${profile.bio ? ` · ${escapeHTML(profile.bio)}` : ''}</div></div>
      <div class="lib-counts"><span><strong>${Number(profile.annotationCount) || items.length}</strong> annotations</span><span><strong>${Number(profile.followers) || 0}</strong> followers</span></div>
      ${!isCurrentUser ? `<button class="ghost ${following ? 'is-on' : ''}" data-action="toggle-follow" data-user-id="${escapeHTML(profile.id)}">${following ? 'Following' : 'Follow'}</button>` : ''}
    </div>
    <main class="feed">
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
        <div class="mod-meta"><span>Reported by ${escapeHTML(claim.reporter?.displayName || claim.reporter?.handle || claim.reporterContact || claim.reporterId || 'unknown')}${claim.via === 'form' ? ' · via form' : ''}</span><a href="${escapeHTML(annotation.sourceUrl || '#')}" target="_blank" rel="noreferrer">Open source ${icon('open')}</a></div>
        <div class="mod-actions">${statuses.map((status) => `<button class="${current === status ? 'is-current' : ''}" data-action="moderate-claim" data-claim-id="${escapeHTML(claim.id)}" data-status="${status}" ${current === status ? 'disabled' : ''}>${status.replace('_', ' ')}</button>`).join('')}${annotation.id && annotation.status !== 'removed' && current !== 'resolved' ? `<button class="is-takedown" data-action="moderate-claim" data-claim-id="${escapeHTML(claim.id)}" data-status="resolved" data-takedown="true">Resolve &amp; take down</button>` : ''}${annotation.status === 'removed' ? '<span class="vis-tag">taken down</span>' : ''}</div>
        ${claim.resolutionNote ? `<p class="mod-note">${escapeHTML(claim.resolutionNote)}</p>` : ''}
      </article>`;
    }).join('') : `<div class="perma-empty"><h2>${state.moderationLoading ? 'Loading claims…' : 'The queue is clear.'}</h2><p>New rights reports appear here with their source and reporter attached.</p></div>`}
  </div>`;
};

// A screenshot enlarged in place — the moment at full size, the original one
// click away. Backdrop or Esc closes.
const lightboxView = () => state.lightbox ? `<div class="lightbox" data-action="close-lightbox" role="dialog" aria-modal="true" aria-label="${escapeHTML(state.lightbox.alt || 'Enlarged screenshot')}">
  <button class="modal-close" data-action="close-lightbox" aria-label="Close enlarged screenshot">${icon('close')}</button>
  <img src="${escapeHTML(state.lightbox.src)}" alt="${escapeHTML(state.lightbox.alt || '')}" data-action="stop-modal" data-stop-click="true" />
  ${state.lightbox.href ? `<a class="lightbox-open" href="${escapeHTML(state.lightbox.href)}" target="_blank" rel="noreferrer">${icon('open')} Open original</a>` : ''}
</div>` : '';

const claimModal = () => `<div class="modal-backdrop" data-action="close-claim">
  <div class="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title" aria-describedby="claim-description" data-action="stop-modal" data-stop-click="true">
    <button class="modal-close" data-action="close-claim" aria-label="Close claim form">${icon('close')}</button>
    <h3 id="claim-title">${state.claimSubmitted ? 'Dispute received' : 'Dispute fair use'}</h3>
    ${state.claimTitle ? `<p class="claim-context">About: ${escapeHTML(state.claimTitle)}</p>` : ''}
    ${state.claimSubmitted
      ? `<div class="claim-success" role="status"><strong>Thank you for flagging this.</strong><p id="claim-description">The report is attached to this annotation for review.</p></div><button class="btn full-button" data-action="close-claim">Done</button>`
      : `<p id="claim-description">Use this if the annotation misuses your work or breaches fair use. The report stays attached to the source page.</p><label>What should we review?<textarea placeholder="Describe the issue…" data-action="claim-text" aria-describedby="claim-error">${escapeHTML(state.claimReason)}</textarea></label>${state.claimError ? `<p class="claim-error" id="claim-error" role="alert">${escapeHTML(state.claimError)}</p>` : '<span id="claim-error" hidden></span>'}<button class="btn full-button" data-action="submit-claim">Send dispute</button>`}
  </div>
</div>`;

const toast = () => state.toast
  ? `<div class="toast" role="status">${icon('check')}<span>${escapeHTML(state.toast)}</span>${state.toastLink ? `<a href="${escapeHTML(state.toastLink.href)}" data-action="toast-link">${escapeHTML(state.toastLink.label)}</a>` : ''}</div>`
  : '';

/* ── public doc pages ──────────────────────────────────────────────── */

const docPage = (title, lead, body) => `
  <div class="page single">
    <div class="libhead doc-head"><div><h1>${title}</h1><div class="lib-meta">${lead}</div></div></div>
    <div class="docbody">${body}</div>
  </div>`;

const aboutView = () => docPage('What this is', 'source-first notes', `
  <div class="card"><h2>The rule</h2>
    <p class="rulequote">&ldquo;A clip without its source is just a rumour.&rdquo;</p>
    <p>annotated keeps a specific moment from the web — a passage, a bounded clip, a screenshot — with your context and a live link back to the original. Every public page points at its source. Context travels with the moment.</p>
  </div>
  <div class="card"><h2>What makes this different</h2>
    <ul class="doc-list">
      <li><strong>Real clip artifacts.</strong> The excerpt is transcoded and hosted here — at most 90 seconds, probe-verified before it can publish — and it plays right in the feed. Not an embed, not a link that rots.</li>
      <li><strong>Four capture modes, one panel.</strong> Passage, video clip, podcast clip, or a snip of the page — captured beside the page you are reading, with the player&rsquo;s own timestamps.</li>
      <li><strong>A public margin, not a private vault.</strong> Follow, respond, like. The social reading loop the read-later apps deleted is the point here, not an afterthought.</li>
      <li><strong>Round-trip receipts.</strong> The prominent action on every page is <em>Open original</em>, deep-linked to the exact second or sentence — and opens of the original are the number we rank by.</li>
      <li><strong>Rights as a surface, one identity everywhere.</strong> Dispute fair use on every annotation page, public takedown tombstones, a transparency report — with the same account across the extension, the web app, and the native mobile app.</li>
    </ul>
  </div>
  <div class="card"><h2>How it works</h2>
    <ol class="doc-steps">
      <li><strong>Clip the moment.</strong> Select a passage, mark in/out on the page&rsquo;s own player, or capture the visible tab — from the Chrome side panel or the web capture desk.</li>
      <li><strong>Say why it matters.</strong> A written note or a recorded audio note, up to 90 seconds.</li>
      <li><strong>Publish with the source attached.</strong> The annotation gets its own landing page, a share card, and a deep link that lands on the exact moment — <code>&amp;t=</code> for media, <code>#:~:text=</code> for passages.</li>
    </ol>
  </div>
  <div class="card"><h2>What gets hosted</h2>
    <p>Media clips are transcoded and hosted as bounded excerpts: at most 90 seconds, video at 240p, verified server-side before they can publish. Screenshots are stored as captured. The full work never leaves its home — the prominent action on every page is <em>Open original</em>, and we count those opens as the measure that matters.</p>
  </div>
  <div class="card"><h2>Visibility</h2>
    <p><strong>Public</strong> annotations appear in the timeline, hubs, and profiles. <strong>Unlisted</strong> pages unfurl for anyone with the link but ask crawlers not to index. <strong>Private</strong> is you-only. Authors can edit the note for 30 minutes, change visibility anytime, and delete outright.</p>
  </div>
  <div class="card"><h2>On your phone</h2>
    <p>annotated installs from the browser (Add to Home Screen). On Android it joins the share sheet — share any page or video straight into capture. On iOS, copy a link and tap <em>Paste link</em> on the capture page. The sidebar stays the primary surface; your phone is for the moment that will not wait.</p>
  </div>
  <p class="doc-footnote">Questions or issues: the <a href="https://github.com/tcballard/annotated/issues" target="_blank" rel="noreferrer">public tracker</a>. Rights holders: <a href="/rights" data-action="set-view" data-view="rights">Rights &amp; claims</a>.</p>
`);

const extensionView = () => docPage('The Chrome side panel', 'the primary surface', `
  <div class="card"><h2>What it does</h2>
    <p>annotated lives in Chrome&rsquo;s side panel, docked next to the page you are reading. Four full-height modes — <strong>Capture &middot; Recent &middot; Following &middot; This page</strong> — with Capture first on open.</p>
    <ul class="doc-list">
      <li>Mark in/out read the page&rsquo;s own player — YouTube and HTML5 media — with typed <span class="kbd-mono">mm:ss</span> fallback when no player is reachable.</li>
      <li>Selected passages carry a &para; anchor and text-quote context, so the deep link lands on the exact words.</li>
      <li>Screenshot capture keeps the visible tab as the moment.</li>
      <li>Notes are text or recorded audio; drafts persist per tab; captures made offline queue and publish when the backend returns.</li>
    </ul>
  </div>
  <div class="card"><h2>Keyboard</h2>
    <table class="doc-table"><tbody>
      <tr><td><kbd>I</kbd> / <kbd>O</kbd></td><td>Mark in / mark out from the player (returns you to Capture)</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Publish</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Clear the current draft</td></tr>
    </tbody></table>
  </div>
  <div class="card"><h2>Install</h2>
    <p>The Chrome Web Store listing is in review. Until it lands, load it unpacked in under a minute:</p>
    <ol class="doc-steps">
      <li>Clone or download <a href="https://github.com/tcballard/annotated" target="_blank" rel="noreferrer">the repository</a>.</li>
      <li>Open <span class="kbd-mono">chrome://extensions</span> and turn on <strong>Developer mode</strong>.</li>
      <li>Choose <strong>Load unpacked</strong> and select the <span class="kbd-mono">extension/</span> folder.</li>
      <li>Open any page, click the annotated icon, and pin the side panel.</li>
    </ol>
    <p>The panel talks to this deployment by default; point it elsewhere from its options page.</p>
  </div>
`);

const auditRows = [
  ['Chrome sidebar is the primary surface', 'A Manifest V3 side panel with four full-height modes; capture is the default state, not a pop-up.'],
  ['Clip text, screenshots, and media from the page', 'Passage selection with paragraph and text-quote anchors, visible-tab screenshots, and in/out marks read from the page&rsquo;s own player.'],
  ['Hosted 240p clips — not third-party embeds', 'The bounded excerpt is transcoded (<span class="kbd-mono">scale=-2:240</span>) and hosted here. Output is probe-verified &le;240p before it can publish; a failed probe fails the clip, never relaxes it.'],
  ['90-second maximum, enforced server-side', 'A 91-second range is rejected with 422 at the API; the transcoder clamps; the probe re-verifies the artifact. Recorded audio commentary is held to the same ceiling.'],
  ['Text and recorded audio commentary', 'A Text &middot; Audio toggle in the panel and the capture desk; audio is staged in the browser and uploaded on publish.'],
  ['Every annotation links its original', 'Deep links land on the moment — <span class="kbd-mono">&amp;t=</span> for media, <span class="kbd-mono">#:~:text=</span> for passages — and opens of the original are counted and ranked.'],
  ['A landing page per clip', 'Every annotation gets <span class="kbd-mono">/a/:slug</span> with server-injected social meta and a rendered share card at <span class="kbd-mono">/og/:slug.png</span>.'],
  ['Public feed, follow, comment', 'A public timeline with Recent and Following, responses on every page, profiles, per-source hubs, and curators ranked by opens driven back to sources.'],
  ['Sign in with X or Google only', 'Both providers ship enabled; production refuses to boot unless both credential pairs are configured.'],
  ['Dispute fair use on every annotation page', 'A clearly visible button on every page, plus a no-JS form for rights holders without an account. Disputes persist, deduplicate, and feed a moderation queue that can resolve into a real takedown — a public tombstone with the hosted media deleted.'],
  ['YouTube, podcasts, and articles', 'YouTube via the extractor pipeline, podcasts from RSS enclosures and direct audio, articles through a bounded resolver — one annotation model across all three.'],
];

const auditView = () => docPage('The brief, enforced', `${auditRows.length} requirements &middot; enforced in code, not policy`, `
  <div class="card"><h2>Where we stand</h2>
    <p>Every requirement below is live in this build and enforced at the server boundary — the UI is polite about limits, but the API is the law. The one deliberate reading: &ldquo;hosted clips&rdquo; means <em>hosted</em>. annotated transcodes the bounded excerpt and serves it from its own storage with a required link back, rather than embedding third-party players and calling it a clip.</p>
  </div>
  <table class="doc-table audit-table"><tbody>
    ${auditRows.map(([requirement, enforcement]) => `<tr><td class="audit-req">${requirement}</td><td>${enforcement}</td></tr>`).join('')}
  </tbody></table>
  <div class="card"><h2>Open items, honestly</h2>
    <p>The Chrome Web Store listing is awaiting review (the panel loads unpacked today — see <a href="/extension" data-action="set-view" data-view="extension">the extension page</a>). Provider egress for YouTube transcodes is configured per deployment. Both are deployment gates, not code gaps; the enforcement above ships either way.</p>
  </div>
  <p class="doc-footnote">The dated engineering record behind this page lives in the repository: acceptance evidence, staging smokes, and the failure modes we chose to keep visible.</p>
`);

const rightsView = () => docPage('Rights &amp; claims', 'for source owners', `
  <div class="card"><h2>Our posture</h2>
    <p>annotated hosts bounded excerpts — at most 90 seconds, video at 240p — with a required, prominent link to the original on every page. The point of the product is to send readers back to the source; opens of the original are the number we rank by.</p>
  </div>
  <div class="card"><h2>Filing a claim</h2>
    <p>Every annotation page has a <strong>Dispute fair use</strong> button, clearly visible in the page's action bar — and a <a href="/rights" data-action="set-view" data-view="rights">no-JS form</a> at <code>/a/&lt;slug&gt;/claim</code> for rights holders without an account. A dispute is persisted, attached to the annotation, deduplicated while active, and lands in a moderation queue with the source and reporter attached.</p>
  </div>
  <div class="card"><h2>What a takedown looks like</h2>
    <p>A claim resolved with a takedown removes the annotation for real: the hosted media is deleted and the page becomes a public tombstone stating that the source owner asked for it to come down. The claim trail is retained for accountability — takedowns are visible, not silent, and every one is listed on the public <a href="/transparency" data-action="set-view" data-view="transparency">transparency report</a>.</p>
  </div>
  <div class="card"><h2>Author removals</h2>
    <p>Authors can delete their own annotations at any time; those pages return a plain not-found. Only rights takedowns leave a tombstone.</p>
  </div>
  <p class="doc-footnote">To reach a person about a rights issue, use the <a href="https://github.com/tcballard/annotated/issues" target="_blank" rel="noreferrer">public tracker</a> without posting personal data. The publisher is Tom Ballard.</p>
`);

// The public record of enforcement: claim counts and every takedown, each
// linking to its tombstone. What was removed stays minimal — host and type,
// never the title — matching what the tombstone itself discloses.
const transparencyView = () => {
  const data = state.transparencyData;
  const counts = data?.claims || { total: 0, open: 0, in_review: 0, resolved: 0, rejected: 0 };
  const takedowns = data?.takedowns || [];
  const countsRow = `
    <div class="card"><h2>Claims received</h2>
      <div class="trans-counts">
        <span><strong>${Number(counts.total) || 0}</strong> total</span>
        <span><strong>${Number(counts.open) || 0}</strong> open</span>
        <span><strong>${Number(counts.in_review) || 0}</strong> in review</span>
        <span><strong>${Number(counts.resolved) || 0}</strong> resolved</span>
        <span><strong>${Number(counts.rejected) || 0}</strong> rejected</span>
      </div>
      <p>Every claim is filed from an annotation page, deduplicated while active, and reviewed in a moderation queue with an audit trail.</p>
    </div>`;
  const takedownRows = takedowns.length
    ? `<table class="doc-table audit-table"><tbody>${takedowns.map((item) => `<tr>
        <td class="audit-req">${escapeHTML(item.removedAt ? new Date(item.removedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date unknown')}</td>
        <td>${item.sourceType === 'article' ? 'An' : 'A'} ${escapeHTML(item.sourceType)} annotation${item.sourceHost ? ` of <strong>${escapeHTML(item.sourceHost)}</strong>` : ''} was taken down (${escapeHTML(String(item.reason).replace(/-/g, ' '))}). <a href="/a/${encodeURIComponent(item.slug)}" data-action="open-annotation" data-slug="${escapeHTML(item.slug)}">View the tombstone</a></td>
      </tr>`).join('')}</tbody></table>`
    : `<div class="card"><h2>Takedowns</h2><p>${state.transparencyLoading ? 'Loading the public record…' : 'No annotations have been taken down. When one is, it will be listed here permanently with a link to its tombstone.'}</p></div>`;
  return docPage('Transparency', 'the public record of enforcement', `
    ${countsRow}
    ${takedowns.length ? '<div class="lib-section">Takedown log</div>' : ''}
    ${takedownRows}
    <div class="card"><h2>How removal works here</h2>
      <p>A claim upheld by moderation removes the annotation for real: hosted media is deleted and the page becomes a permanent public tombstone — takedowns are visible, never silent. Authors can also delete their own work at any time; those pages simply cease to exist and are not listed here.</p>
    </div>
    <p class="doc-footnote">To report a rights issue, use <strong>Dispute fair use</strong> on the annotation page — see <a href="/rights" data-action="set-view" data-view="rights">Rights &amp; claims</a>.</p>
  `);
};

const termsView = () => docPage('Terms', 'short and honest', `
  <div class="card"><h2>The service</h2>
    <p>annotated is an early-stage service operated from the UK by Tom Ballard. It is provided as-is while in active development: no uptime promise, and features may change. If we ever retire it, public pages will be given a wind-down notice first.</p>
  </div>
  <div class="card"><h2>Your content</h2>
    <p>Your annotations remain yours. By publishing you grant annotated the right to host and display the note and the bounded excerpt you captured, at the visibility you chose. You are responsible for having the right to post what you capture; the 90-second and 240p ceilings are enforced by the service and are not yours to waive.</p>
  </div>
  <div class="card"><h2>Sources and claims</h2>
    <p>Rights holders can file a claim on any annotation page. Upheld claims result in a public takedown — see <a href="/rights" data-action="set-view" data-view="rights">Rights &amp; claims</a>. Do not use annotated to republish works wholesale; it is built to excerpt and point back.</p>
  </div>
  <div class="card"><h2>Accounts and conduct</h2>
    <p>Sign-in is via X or Google only; we store the minimum identity needed to attribute your work (see the <a href="/privacy.html">privacy policy</a>). We may remove content or accounts that abuse the service, impersonate others, or ignore upheld claims.</p>
  </div>
  <p class="doc-footnote">Questions about these terms: the <a href="https://github.com/tcballard/annotated/issues" target="_blank" rel="noreferrer">public tracker</a>.</p>
`);

// Notifications — the same derived feed the app's bell shows: responses,
// likes, and follows aimed at you. Opening the view moves the server-side
// seen watermark, which is what clears the badge everywhere.
const loadNotifications = async () => {
  if (state.serverStatus !== 'online' || !state.user) return;
  state.notificationsLoading = true;
  try {
    const result = await api.notifications();
    state.notifications = result.notifications || [];
    state.unseenNotifications = 0;
    api.notificationsSeen().catch(() => {});
  } catch { /* the empty state below covers it */ }
  state.notificationsLoading = false;
};

const notificationSentence = (item) => {
  const name = escapeHTML(item.actor?.displayName || `@${item.actor?.handle || 'someone'}`);
  const title = escapeHTML(item.annotation?.sourceTitle || 'your annotation');
  if (item.type === 'response') return `${name} responded to your annotation of <b>${title}</b>`;
  if (item.type === 'like') return `${name} liked your annotation of <b>${title}</b>`;
  return `${name} followed you`;
};

const notificationIcon = (type) => type === 'response' ? 'respond' : type === 'like' ? 'heart' : 'follow';

const notificationsView = () => {
  if (!state.user) {
    return `<div class="page single"><div class="perma-empty"><img class="empty-symbol" src="/brand/app-icon-light-128.png" alt="" aria-hidden="true" /><h2>Nothing to ring about yet.</h2><p>Sign in to see responses, likes, and new followers.</p><button class="btn" data-action="open-signin">Sign in</button></div></div>`;
  }
  if (state.notificationsLoading) return `<div class="page single">${skeletonPost()}${skeletonPost()}</div>`;
  const rows = state.notifications.length
    ? state.notifications.map((item) => `
      <button class="notif-row" data-action="${item.annotation?.slug ? 'open-annotation' : 'open-profile'}" ${item.annotation?.slug ? `data-slug="${escapeHTML(item.annotation.slug)}"` : `data-handle="${escapeHTML(item.actor?.handle || '')}"`}>
        ${icon(notificationIcon(item.type), 'notif-kind')}
        ${avatarHtml(item.actor || {})}
        <span class="notif-main">
          <span class="notif-text">${notificationSentence(item)} <span class="meta">· ${escapeHTML(relTime(item.createdAt))}</span></span>
          ${item.body ? `<span class="notif-quote">&ldquo;${escapeHTML(item.body)}&rdquo;</span>` : ''}
        </span>
      </button>`).join('')
    : `<div class="card"><h2>All quiet.</h2><p>When readers respond, like your annotations, or follow you, it lands here.</p></div>`;
  return `
  <div class="page single">
    <h1 class="sr-only">Notifications</h1>
    <div class="notif-rows">${rows}</div>
  </div>`;
};

let publishMomentTimer;
const dismissPublishMoment = () => {
  if (!state.publishMoment) return;
  clearTimeout(publishMomentTimer);
  state.publishMoment = null;
  render();
};

const publishMomentView = () => `
  <div class="pub-moment" role="status" data-action="dismiss-publish-moment" title="Continue">
    <svg class="pub-check" viewBox="0 0 80 80" aria-hidden="true"><circle class="ring" cx="40" cy="40" r="37"/><path class="tick" d="m25 42 10 11 21-25"/></svg>
    <h2>Published<span class="dot">.</span></h2>
    <div class="pub-title">${escapeHTML(state.publishMoment?.title || '')}</div>
    <div class="pub-hint">This moment now has a page — with the source attached.</div>
  </div>`;

const footerView = () => `
  <footer>
    <a href="/about" data-action="set-view" data-view="about">About</a>
    <a href="/extension" data-action="set-view" data-view="extension">Extension</a>
    <a href="/audit" data-action="set-view" data-view="audit">Brief audit</a>
    <a href="/rights" data-action="set-view" data-view="rights">Rights &amp; claims</a>
    <a href="/transparency" data-action="set-view" data-view="transparency">Transparency</a>
    <a href="/terms" data-action="set-view" data-view="terms">Terms</a>
    <a href="/privacy.html">Privacy</a>
    <span class="footer-note">annotated © 2026 · source-first notes</span>
  </footer>`;

const render = () => {
  const view = state.activeView === 'capture' ? captureView()
    : state.activeView === 'published' ? permalinkView()
    : state.activeView === 'library' ? libraryView()
    : state.activeView === 'profile' ? profileView()
    : state.activeView === 'hub' ? hubView()
    : state.activeView === 'moderation' ? moderationView()
    : state.activeView === 'about' ? aboutView()
    : state.activeView === 'extension' ? extensionView()
    : state.activeView === 'audit' ? auditView()
    : state.activeView === 'rights' ? rightsView()
    : state.activeView === 'terms' ? termsView()
    : state.activeView === 'transparency' ? transparencyView()
    : state.activeView === 'notifications' ? notificationsView()
    : feedView();
  const offline = state.serverStatus === 'offline' ? `<div class="offline-note" role="alert">The annotated backend is unreachable. Reading and drafting still work; publishing will resume when it returns.</div>` : '';
  app.innerHTML = `${SHELL_MODE ? '' : chromeBar()}${offline}${authStateView()}${view}${SHELL_MODE ? '' : footerView()}${state.claimOpen ? claimModal() : ''}${state.signinOpen ? signinModal() : ''}${lightboxView()}${state.publishMoment ? publishMomentView() : ''}${toast()}`;
  const overlayOpen = state.claimOpen || state.signinOpen || Boolean(state.lightbox);
  for (const element of app.querySelectorAll('.chrome, .auth-notice, .auth-prompt, .page, footer, .offline-note')) {
    element.inert = overlayOpen;
    if (overlayOpen) element.setAttribute('aria-hidden', 'true');
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

const loadHub = async ({ append = false } = {}) => {
  if (!state.hubHost || state.serverStatus !== 'online') return;
  if (append && !state.hubData?.nextCursor) return;
  state.hubLoading = true;
  try {
    const result = await api.sourceHub(state.hubHost, append ? state.hubData.nextCursor : undefined);
    state.hubData = append
      ? { ...state.hubData, annotations: [...(state.hubData.annotations || []), ...(result.annotations || [])], nextCursor: result.nextCursor || null }
      : result;
    for (const person of result.annotators || []) {
      if (person.id && !(person.id in state.followingIds)) state.followingIds[person.id] = Boolean(person.isFollowing);
    }
  } catch {
    if (!append) state.hubData = null;
  } finally {
    state.hubLoading = false;
  }
};

const loadTransparency = async () => {
  if (state.serverStatus !== 'online') return;
  state.transparencyLoading = true;
  try {
    state.transparencyData = await api.transparency();
  } catch {
    state.transparencyData = null;
  } finally {
    state.transparencyLoading = false;
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
  try {
    state.trendingSources = (await api.trendingSources()).sources || [];
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
    if (state.feedSort === 'trending' && !state.feedFollowing) {
      params.set('sort', 'trending');
      if (state.feedTopic) params.set('topic', state.feedTopic);
    }
    if (state.feedFollowing) params.set('following', 'true');
    if (state.feedQuery.trim()) params.set('q', state.feedQuery.trim());
    if (append && state.feedCursor) params.set('cursor', state.feedCursor);
    const result = await api.feed(params.toString());
    state.feedAnnotations = append ? [...state.feedAnnotations, ...(result.annotations || [])] : (result.annotations || []);
    state.feedCursor = result.nextCursor || null;
    if (Array.isArray(result.topics)) state.feedTopics = result.topics;
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
      topic: isTopic(state.topic) ? state.topic : undefined,
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
    // The post-tweet beat: the permalink is already underneath; a terracotta
    // check draws over it — publishing IS the moment — then gets out of the
    // way. Reduced motion keeps the quiet toast instead.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      render();
      notify('Published', { href: annotation.url, label: 'View page' });
    } else {
      // Nothing shares the stage: any lingering toast clears first.
      clearTimeout(toastTimer);
      state.toast = '';
      state.toastLink = null;
      state.publishMoment = { title: annotation.sourceTitle || currentSource.title || 'This moment' };
      render();
      clearTimeout(publishMomentTimer);
      publishMomentTimer = setTimeout(dismissPublishMoment, 1600);
    }
    window.scrollTo(0, 0);
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
  state.publishedRemoved = '';
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
  } catch (error) {
    if (error?.status === 410) {
      state.publishedRemoved = error.body?.reason || 'rights-claim';
      state.publishedAnnotation = null;
      render();
    }
    /* otherwise rendered from feed data; a fetch miss keeps that view */
  }
};

const openProfile = (handle) => {
  if (!handle) return;
  state.profileHandle = handle;
  state.profileData = null;
  navigate('profile');
  loadProfile().then(render);
};

// One switch used by the tab rail and the mobile swipe gesture alike.
const FEED_PANES = [{ sort: 'recent', following: false }, { sort: 'trending', following: false }, { sort: 'recent', following: true }];

const applyFeedFilter = (sort, following) => {
  if (following && requestSignIn('see the people you follow')) return;
  state.feedFollowing = following;
  state.feedSort = sort === 'trending' ? 'trending' : 'recent';
  if (state.feedSort !== 'trending' || state.feedFollowing) state.feedTopic = null;
  state.feedCursor = null;
  loadFeed().then(render);
};

const currentFeedPane = () => state.feedFollowing ? 2 : state.feedSort === 'trending' ? 1 : 0;

/* ── events ────────────────────────────────────────────────────────── */

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (target.dataset.stopClick === 'true') return;
  if (action === 'open-notifications') {
    navigate('notifications');
    return;
  }
  if (action === 'dismiss-publish-moment') {
    dismissPublishMoment();
    return;
  }
  if (action === 'open-signin') {
    openSignin();
    return;
  }
  if (action === 'close-signin') {
    if (event.target.closest('.signin-modal') && !event.target.closest('[data-action="close-signin"]')) return;
    closeSignin();
    return;
  }
  if (action === 'dismiss-auth') {
    state.authNotice = '';
    render();
    document.querySelector('.nav-link.is-active')?.focus();
    return;
  }
  if (action === 'set-view') {
    if (target.tagName === 'A') event.preventDefault();
    if (target.dataset.view === 'moderation' && !canModerate()) { notify('Moderation access is required.'); return; }
    if (state.activeView !== 'profile') state.profileHandle = '';
    navigate(target.dataset.view);
    return;
  }
  if (action === 'open-annotation') {
    // Inline media is directly playable; interacting with it must not
    // navigate away from the feed.
    if (event.target.closest('a, button:not([data-action="open-annotation"]), video, audio, .srcmedia')) return;
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
    applyFeedFilter(target.dataset.sort === 'trending' ? 'trending' : 'recent', target.dataset.following === 'true');
    return;
  }
  if (action === 'feed-topic') {
    state.feedTopic = isTopic(target.dataset.topic) ? target.dataset.topic : null;
    state.feedSort = 'trending';
    state.feedFollowing = false;
    state.feedCursor = null;
    if (state.activeView !== 'feed') navigate('feed');
    loadFeed().then(render);
    return;
  }
  if (action === 'clear-feed-search') { state.feedQuery = ''; state.feedCursor = null; loadFeed().then(render); return; }
  if (action === 'feed-more') { loadFeed({ append: true }).then(render); return; }
  if (action === 'hub-more') { loadHub({ append: true }).then(render); return; }
  if (action === 'feed-retry') { loadFeed().then(render); return; }
  if (action === 'refresh-moderation') { loadModerationClaims().then(render); return; }
  if (action === 'moderate-claim') {
    if (!canModerate() || state.serverStatus !== 'online') { notify('Moderation is unavailable while the backend is offline.'); return; }
    const claimId = target.dataset.claimId;
    const status = target.dataset.status;
    const takedown = target.dataset.takedown === 'true';
    if (takedown && !window.confirm('Resolve this claim and take the annotation down? The hosted media is deleted and the page becomes a public tombstone.')) return;
    (async () => {
      try {
        await api.moderateClaim(claimId, status, '', takedown ? 'remove' : undefined);
        await loadModerationClaims();
        render();
        notify(takedown ? 'Claim resolved — annotation taken down.' : `Claim marked ${status.replace('_', ' ')}.`);
      } catch (error) { notify(error.message || 'Claim status could not be saved.'); }
    })();
    return;
  }
  if (action === 'toggle-like') {
    const slug = target.dataset.slug;
    if (!slug || state.serverStatus !== 'online') return;
    if (requestSignIn('like this annotation')) return;
    const records = [
      ...(state.feedAnnotations || []),
      ...(state.hubData?.annotations || []),
      ...(state.profileData?.annotations || []),
      ...(state.publishedAnnotation ? [state.publishedAnnotation] : []),
    ].filter((record) => record.slug === slug);
    if (!records.length) return;
    const liked = Boolean(records[0].likedByMe);
    for (const record of records) {
      record.likedByMe = !liked;
      record.likes = Math.max(0, Number(record.likes || 0) + (liked ? -1 : 1));
    }
    render();
    (async () => {
      try {
        if (liked) await api.unlike(slug); else await api.like(slug);
      } catch (error) {
        for (const record of records) {
          record.likedByMe = liked;
          record.likes = Math.max(0, Number(record.likes || 0) + (liked ? 1 : -1));
        }
        render();
        if (!recoverAuthError(error, 'Sign in to like this annotation.')) notify(error.message || 'Like could not be saved.');
      }
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
  if (action === 'edit-note') {
    state.editingNote = true;
    state.editNoteDraft = state.publishedAnnotation?.commentary || '';
    render();
    app.querySelector('[data-action="edit-note-draft"]')?.focus();
    return;
  }
  if (action === 'cancel-note') { state.editingNote = false; render(); return; }
  if (action === 'save-note') {
    const commentary = state.editNoteDraft.trim();
    if (!commentary) { notify('The note cannot be empty.'); return; }
    (async () => {
      try {
        const { annotation } = await api.updateAnnotation(state.publishedSlug, { commentary });
        hydrateAnnotation(annotation);
        render();
        notify('Note updated.');
      } catch (error) {
        if (!recoverAuthError(error, 'Sign in to edit this note.')) notify(error.message || 'The note could not be updated.');
      }
    })();
    return;
  }
  if (action === 'delete-annotation') {
    const slug = target.dataset.slug;
    if (!slug || state.serverStatus !== 'online') return;
    if (requestSignIn('delete this annotation')) return;
    if (!window.confirm('Delete this annotation? The page and any hosted media are removed permanently.')) return;
    (async () => {
      try {
        await api.deleteAnnotation(slug);
        state.feedAnnotations = state.feedAnnotations.filter((item) => item.slug !== slug);
        if (state.libraryData?.annotations) state.libraryData.annotations = state.libraryData.annotations.filter((item) => item.slug !== slug);
        if (state.publishedSlug === slug) {
          state.publishedAnnotation = null;
          state.publishedSlug = '';
          navigate('library');
        } else {
          render();
        }
        notify('Annotation deleted.');
        loadLibrary().then(render);
      } catch (error) {
        if (!recoverAuthError(error, 'Sign in to delete this annotation.')) notify(error.message || 'The annotation could not be deleted.');
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
  if (action === 'paste-link') {
    (async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        const url = sharedUrlFromParams(new URLSearchParams([['text', text]]));
        if (!url) { notify('No link found on the clipboard.'); return; }
        state.sourceUrl = url;
        await loadSource();
      } catch { notify('Clipboard access was blocked — paste into the field instead.'); }
    })();
    return;
  }
  if (action === 'wave-seek') {
    const audio = target.closest('.srcaudio-main, .srcmedia-audio-main')?.querySelector('audio');
    if (!audio || !Number.isFinite(audio.duration) || !audio.duration) { audio?.play?.(); return; }
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    if (audio.paused) audio.play().catch(() => { /* browser gesture policy */ });
    return;
  }
  if (action === 'open-lightbox') {
    state.lightbox = { src: target.dataset.src || '', alt: target.dataset.alt || '', href: target.dataset.href || '' };
    render();
    app.querySelector('.lightbox .modal-close')?.focus();
    return;
  }
  if (action === 'close-lightbox') {
    state.lightbox = null;
    render();
    return;
  }
  if (action === 'submit-claim') { submitClaim(); return; }
  if (action === 'logout') { api.logout().then(() => { state.user = null; render(); notify('Signed out.'); }).catch((error) => notify(error.message || 'Sign out failed.')); return; }
});

// The mobile flick: a horizontal swipe on the feed moves between Recent,
// Trending, and Following. Deliberately conservative — mostly-horizontal
// movement only, so vertical scrolling and taps never misfire.
let touchOrigin = null;
app.addEventListener('touchstart', (event) => {
  touchOrigin = state.activeView === 'feed' && event.touches.length === 1
    ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
    : null;
}, { passive: true });
app.addEventListener('touchend', (event) => {
  if (!touchOrigin || state.activeView !== 'feed') return;
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - touchOrigin.x;
  const deltaY = touch.clientY - touchOrigin.y;
  touchOrigin = null;
  if (Math.abs(deltaX) < 64 || Math.abs(deltaY) > 48) return;
  const next = FEED_PANES[currentFeedPane() + (deltaX < 0 ? 1 : -1)];
  if (next) applyFeedFilter(next.sort, next.following);
}, { passive: true });

// timeupdate does not bubble, so the waveform progress listens in the
// capture phase and paints the played portion in place — no re-render.
app.addEventListener('timeupdate', (event) => {
  const audio = event.target;
  if (audio.tagName !== 'AUDIO' || !Number.isFinite(audio.duration) || !audio.duration) return;
  const played = audio.closest('.srcaudio-main, .srcmedia-audio-main')?.querySelector('.wave-played');
  if (played) played.style.clipPath = `inset(0 ${Math.max(0, 100 - (audio.currentTime / audio.duration) * 100)}% 0 0)`;
}, true);

app.addEventListener('keydown', (event) => {
  if (state.lightbox && event.key === 'Escape') {
    event.preventDefault();
    state.lightbox = null;
    render();
    return;
  }
  if (state.claimOpen || state.signinOpen) {
    const dialog = app.querySelector(state.claimOpen ? '.claim-modal' : '.signin-modal');
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.claimOpen) closeClaimDialog(); else closeSignin();
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
  if (action === 'edit-note-draft') {
    state.editNoteDraft = event.target.value.slice(0, 280);
    const count = event.target.closest('.note-edit')?.querySelector('.count');
    if (count) count.textContent = `${state.editNoteDraft.length}/280`;
  }
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
  if (action === 'capture-topic') {
    state.topic = isTopic(event.target.value) ? event.target.value : '';
    persist();
    return;
  }
  if (action === 'permalink-topic') {
    const topic = isTopic(event.target.value) ? event.target.value : null;
    (async () => {
      try {
        const { annotation } = await api.updateAnnotation(state.publishedSlug, { topic });
        hydrateAnnotation(annotation);
        render();
        notify(topic ? `Filed under ${topicLabel(topic)}.` : 'Topic removed.');
      } catch (error) {
        render();
        if (!recoverAuthError(error, 'Sign in to change the topic.')) notify(error.message || 'The topic could not be changed.');
      }
    })();
    return;
  }
  if (action === 'permalink-visibility') {
    const visibility = event.target.value;
    (async () => {
      try {
        const { annotation } = await api.updateAnnotation(state.publishedSlug, { visibility });
        hydrateAnnotation(annotation);
        render();
        notify(`Now ${visibility}.`);
      } catch (error) {
        render();
        if (!recoverAuthError(error, 'Sign in to change visibility.')) notify(error.message || 'Visibility could not be changed.');
      }
    })();
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
  if (state.activeView === 'transparency') { loadTransparency().then(render); }
  render();
});

render();
bootstrap();
