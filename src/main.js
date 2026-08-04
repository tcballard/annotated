import './styles.css';
import { api } from './api.js';
import { deleteMediaDraft, readMediaDraft, stageMediaDraft } from './media-draft-store.js';
import { publicAnnotationUrl } from './share-links.js';
import { authNoticeFromSearch, enabledProviders, oauthStartUrl, providerLabel } from './auth-ui.js';
import { MAX_CLIP_SECONDS, moveClipBoundary, normalizeClipRange } from './clip-range.js';

const app = document.querySelector('#app');

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.3 4.3L19 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7V5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>',
  playSmall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 7 5-7 5V7Z"/></svg>',
  message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 17H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.8 2.5Z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v13M8 19h8"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>',
  article: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>',
  podcast: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="10" r="3"/><path d="M7 10a5 5 0 0 0 10 0M4 10a8 8 0 0 0 16 0M12 13v8"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>'
};

const escapeHTML = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.round(seconds % 60)).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const parseTime = (value) => {
  const parts = String(value || '').trim().split(':');
  if (parts.length !== 2 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const minutes = Number(parts[0]);
  const seconds = Number(parts[1]);
  if (seconds > 59) return null;
  return minutes * 60 + seconds;
};

const sourceData = {
  video: {
    label: 'Video',
    host: 'youtube.com',
    url: 'https://www.youtube.com/watch?v=9u-MhC2x7kA',
    title: 'The future is built by people who keep asking why',
    author: 'J-Cal Conversations',
    date: 'Yesterday',
    duration: 368,
    caption: 'A conversation about curiosity, leverage, and building in public.',
  },
  article: {
    label: 'Article',
    host: 'theverge.com',
    url: 'https://www.theverge.com/ai-artificial-intelligence/annotated',
    title: 'The internet is becoming a place you can’t search',
    author: 'The Verge · David Pierce',
    date: '2h ago',
    duration: 0,
    excerpt: 'The most valuable part of a link is often the part that doesn’t fit in the answer.',
    caption: 'A considered argument about what gets lost when every answer arrives pre-packaged.',
  },
  podcast: {
    label: 'Podcast',
    host: 'overcast.fm',
    url: 'https://overcast.fm/+annotated-demo',
    title: 'The quiet advantage of paying attention',
    author: 'Decoder Ring · Episode 142',
    date: 'Today',
    duration: 2764,
    caption: 'A small moment from a long conversation, pulled out because it stayed with you.',
  },
};

const sourceLabels = { video: 'Video', article: 'Article', podcast: 'Podcast' };
const canModerate = () => Boolean(state.user && ['owner', 'admin', 'moderator'].includes(state.user.role));

const normalizeSource = (item = {}) => {
  const type = item.sourceType || item.type || 'article';
  const url = item.sourceUrl || item.url || '';
  const sourceAuthor = typeof item.author === 'string'
    ? item.author
    : item.sourceAuthor || item.sourceChannel || '';
  let host = item.host || item.sourceHost || '';
  if (!host && url) {
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
  }
  return {
    label: sourceLabels[type] || 'Source',
    host,
    url,
    canonicalUrl: item.canonicalUrl || url,
    title: item.title || item.sourceTitle || 'Untitled source',
    author: sourceAuthor || host || 'Unknown source',
    date: item.date || 'Just now',
    duration: Number(item.sourceDuration ?? item.duration) || 0,
    caption: item.description || item.excerpt || 'A source ready to annotate.',
    excerpt: item.excerpt || item.sourceExcerpt || '',
    imageUrl: item.imageUrl || item.thumbnailUrl || null,
    mediaUrl: item.mediaUrl || item.sourceMediaUrl || '',
    provider: item.provider || '',
  };
};

const initialState = {
  activeView: 'feed',
  profileHandle: '',
  profileData: null,
  profileLoading: false,
  sourceType: 'video',
  sourceUrl: sourceData.video.url,
  clipStart: 14,
  clipEnd: 62,
  articleExcerpt: sourceData.article.excerpt,
  commentary: '',
  commentaryMode: 'text',
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
  liked: false,
  following: false,
  followingIds: {},
  commentDraft: '',
  comments: 12,
  claimOpen: false,
  claimSlug: '',
  claimTitle: '',
  claimReason: '',
  claimError: '',
  claimSubmitted: false,
  toast: '',
  showSourceInput: false,
  showMobileSourcePreview: false,
  customSource: null,
  publishedSlug: '',
  publishedAnnotation: null,
  feedAnnotations: [],
  feedFollowing: false,
  feedCursor: null,
  feedQuery: '',
  showFeedSearch: false,
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
const draftFields = ['sourceType', 'sourceUrl', 'clipStart', 'clipEnd', 'articleExcerpt', 'commentary', 'commentaryMode', 'customSource', 'audioAssetId', 'audioUrl', 'audioDuration', 'audioDraftId', 'clientRequestId'];

const saved = (() => {
  try {
    const raw = localStorage.getItem(draftStorageKey) || localStorage.getItem('annotated-demo');
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(draftFields.filter((field) => field in parsed).map((field) => [field, parsed[field]]));
  } catch { return {}; }
})();

const state = { ...initialState, ...saved };
state.clientRequestId ||= globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`;
if (state.sourceType !== 'article') {
  Object.assign(state, normalizeClipRange(state.clipStart, state.clipEnd, { max: Math.max(MAX_CLIP_SECONDS, Number(state.clipStart) || 0, Number(state.clipEnd) || 0) }));
}
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

const persist = () => {
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 1,
      sourceType: state.sourceType,
      sourceUrl: state.sourceUrl,
      clipStart: state.clipStart,
      clipEnd: state.clipEnd,
      articleExcerpt: state.articleExcerpt,
      commentary: state.commentary,
      commentaryMode: state.commentaryMode,
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
  try {
    localStorage.removeItem(draftStorageKey);
    localStorage.removeItem('annotated-demo');
  } catch { /* private mode or blocked storage; the app remains usable */ }
};

const notify = (message) => {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 2800);
};

const authLinks = (className = 'auth-link') => enabledProviders(state.authProviders).map((provider) => `<a class="${className}" href="${escapeHTML(oauthStartUrl(provider))}">${providerLabel(provider)}</a>`).join('');

const authStateView = () => {
  const noticeCopy = {
    success: 'Signed in. Your identity is connected to this workspace.',
    error: 'Sign-in did not complete. Nothing was published or changed.',
    cancelled: 'Sign-in was cancelled. Your draft is still here.',
  }[state.authNotice];
  const notice = noticeCopy ? `<div class="auth-notice ${state.authNotice === 'success' ? 'is-success' : 'is-error'}" role="status"><span>${escapeHTML(noticeCopy)}</span><button class="auth-notice-dismiss" data-action="dismiss-auth" aria-label="Dismiss sign-in message">${icon('close')}</button></div>` : '';
  const promptLinks = authLinks('auth-prompt-link') || '<span class="auth-prompt-unavailable">No sign-in provider is available.</span>';
  const prompt = state.authPrompt && !state.user ? `<div class="auth-prompt" role="alert"><div><span class="eyebrow">Sign-in required</span><strong>${escapeHTML(state.authPrompt)}</strong><span>Your draft and current page will be kept while you sign in.</span></div><div class="auth-prompt-actions">${promptLinks}<button class="auth-prompt-dismiss" data-action="dismiss-auth">Not now</button></div></div>` : '';
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

const setSource = (type) => {
  state.sourceType = type;
  state.sourceUrl = sourceData[type].url;
  state.customSource = null;
  state.clientRequestId = globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}`;
  state.sourceError = '';
  if (type === 'video') { state.clipStart = 14; state.clipEnd = 62; }
  if (type === 'podcast') { state.clipStart = 10; state.clipEnd = 64; }
  if (type === 'article') { state.clipStart = 0; state.clipEnd = 0; state.articleExcerpt = sourceData.article.excerpt; }
  state.showSourceInput = false;
  persist();
  renderCapture();
};

const source = () => state.customSource || sourceData[state.sourceType];

const annotationToFeedItem = (annotation) => {
  const type = sourceLabels[annotation.sourceType] || 'Source';
  const comments = Array.isArray(annotation.comments) ? annotation.comments.length : 0;
  return {
    type,
    label: type,
    initials: (annotation.author?.displayName || annotation.author?.handle || 'A').slice(0, 2).toUpperCase(),
    author: annotation.author?.displayName || 'Annotated user',
    handle: `@${annotation.author?.handle || annotation.authorId || 'user'}`,
    time: 'just now',
    host: annotation.sourceHost || (() => { try { return new URL(annotation.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'source'; } })(),
    sourceUrl: annotation.sourceUrl,
    slug: annotation.slug,
    url: annotation.url,
    clipUrl: annotation.clipUrl || '',
    audioUrl: annotation.audioUrl || '',
    mediaStatus: annotation.mediaStatus || 'not-applicable',
    duration: formatTime(Math.max(0, Number(annotation.clipEnd) - Number(annotation.clipStart))),
    quote: annotation.sourceExcerpt || annotation.commentary || 'A moment kept with its context.',
    title: annotation.sourceTitle,
    commentary: annotation.commentary || 'An audio annotation attached to this moment.',
    likes: Number(annotation.likes) || 0,
    comments,
    authorId: annotation.author?.id || annotation.authorId || '',
    authorHandle: annotation.author?.handle || '',
    likedByMe: Boolean(annotation.likedByMe),
  };
};

const hydrateAnnotation = (annotation) => {
  state.publishedAnnotation = annotation;
  state.published = true;
  state.publishedSlug = annotation.slug;
  state.sourceType = annotation.sourceType;
  state.sourceUrl = annotation.sourceUrl;
  state.customSource = normalizeSource({
    ...annotation,
    title: annotation.sourceTitle,
    host: annotation.sourceHost,
    excerpt: annotation.sourceExcerpt,
  });
  state.articleExcerpt = annotation.sourceExcerpt || '';
  state.clipStart = Number(annotation.clipStart) || 0;
  state.clipEnd = Number(annotation.clipEnd) || 0;
  state.commentary = annotation.commentary || '';
  state.commentaryMode = annotation.commentaryMode || 'text';
  state.recordedAudio = state.commentaryMode === 'audio';
  state.audioAssetId = annotation.audioAssetId || '';
  state.audioUrl = annotation.audioUrl || '';
  state.audioDuration = Number(annotation.audioDuration) || 0;
  state.audioDraftId = '';
  state.clipUrl = annotation.clipUrl || '';
  state.mediaStatus = annotation.mediaStatus || 'not-applicable';
  state.mediaError = String(annotation.mediaError || '').slice(0, 280);
  state.isRetryingMedia = false;
};

const bootstrap = async () => {
  state.authNotice = authNoticeFromSearch(window.location.search);
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (['capture', 'feed', 'published'].includes(requestedView)) state.activeView = requestedView;
  if (state.authNotice) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('auth');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
  const routeMatch = window.location.pathname.match(/^\/a\/([^/]+)/);
  const profileMatch = window.location.pathname.match(/^\/u\/([^/]+)/);
  if (routeMatch) {
    state.publishedSlug = decodeURIComponent(routeMatch[1]);
    state.activeView = 'permalink';
  }
  if (profileMatch) {
    state.profileHandle = decodeURIComponent(profileMatch[1]);
    state.activeView = 'profile';
  }
  try {
    await api.health();
    state.serverStatus = 'online';
    const providers = await api.providers().catch(() => ({ providers: {}, required: false }));
    state.authProviders = providers.providers || {};
    state.authRequired = Boolean(providers.required);
    state.user = await api.me().then((result) => result.user).catch(() => null);
    if (state.activeView === 'published' && !state.user) state.activeView = 'feed';
    if (canModerate()) await loadModerationClaims();
    if (state.publishedSlug) {
      const { annotation } = await api.getAnnotation(state.publishedSlug);
      hydrateAnnotation(annotation);
      watchMediaProcessing();
    }
    if (state.profileHandle) await loadProfile();
    await loadFeed();
  } catch (error) {
    state.serverStatus = 'offline';
    state.serverError = error.message;
  }
  await resumeStagedAudio();
  render();
};

const icon = (name, className = '') => `<span class="icon ${className}">${icons[name] || ''}</span>`;

const button = (label, action, className = '', extra = '') => `<button class="${className}" data-action="${action}" ${extra}>${label}</button>`;

const sourceTypeButton = (type) => {
  const item = sourceData[type];
  return `<button class="source-type ${state.sourceType === type ? 'is-active' : ''}" data-action="source-type" data-type="${type}" aria-pressed="${state.sourceType === type}">${icon(type)}<span>${item.label}</span></button>`;
};

const authControls = () => state.user
  ? `<span class="auth-user">${escapeHTML(state.user.displayName || state.user.handle || 'Signed in')}</span><button class="avatar" data-action="logout" aria-label="Sign out">${escapeHTML((state.user.displayName || state.user.handle || 'A').slice(0, 2).toUpperCase())}</button>`
  : `<span class="auth-label">${state.authRequired ? 'Sign in' : 'Local account'}</span>${authLinks()}`;

const appHeader = () => `
  <header class="app-header">
    <button class="brand-lockup" data-action="set-view" data-view="feed" aria-label="Go to timeline"><span class="brand-name">annotated<span class="brand-dot">.</span></span></button>
    <nav class="primary-nav" aria-label="Primary navigation">
      ${button('Timeline', 'set-view', `nav-link ${state.activeView === 'feed' ? 'is-active' : ''}`, 'data-view="feed"')}
      ${button('Capture', 'set-view', `nav-link ${state.activeView === 'capture' ? 'is-active' : ''}`, 'data-view="capture"')}
      ${button('Published', 'set-view', `nav-link ${state.activeView === 'published' ? 'is-active' : ''}`, 'data-view="published"')}
      ${canModerate() ? button('Moderation', 'set-view', `nav-link ${state.activeView === 'moderation' ? 'is-active' : ''}`, 'data-view="moderation"') : ''}
    </nav>
    <div class="header-actions">
      <input class="chrome-search" aria-label="Search annotations" placeholder="Search annotations" />
      <span class="chrome-auth">${state.user ? `Signed in as <b>@${escapeHTML(state.user.handle || state.user.displayName || 'member')}</b> <button class="link-button" data-action="logout">Sign out</button>` : authLinks('chrome-sign-in') || 'Sign in unavailable'}</span>
    </div>
  </header>`;

const appRail = () => `
  <aside class="leftnav" aria-label="Workspace navigation">
    <nav><button class="${state.activeView === 'feed' ? 'on' : ''}" data-action="set-view" data-view="feed">Timeline</button><button class="${state.activeView === 'capture' ? 'on' : ''}" data-action="set-view" data-view="capture">Capture a moment</button><button class="${state.activeView === 'published' ? 'on' : ''}" data-action="set-view" data-view="published">My library</button>${state.user ? '<button data-action="feed-filter" data-following="true">Following</button>' : ''}<a href="/" data-action="open-original">Get the sidebar</a></nav>
    <p class="hint">${state.activeView === 'capture' ? 'Max 90 seconds. The source link is retained on every clip.' : 'Every clip keeps a live link to where it came from.'}</p>
  </aside>`;

const appFooter = () => `<footer class="app-footer"><span><a href="/">About</a><a href="/privacy.html">Privacy</a><button class="link-button" data-action="toggle-claim">Rights &amp; claims</button><a href="/">Terms</a></span><span>annotated © 2026 · source-first notes</span></footer>`;

const sourceCanvas = () => {
  const current = source();
  const duration = current.duration ? formatTime(current.duration) : 'article';
  return `<tr><td class="lbl"><label for="source-url">Source</label></td><td>
    <div class="source-input-wrap"><input id="source-url" data-action="source-url" value="${escapeHTML(state.sourceUrl)}" aria-label="Source URL" /><button class="btn" data-action="load-source" ${state.isResolvingSource ? 'disabled' : ''}>${state.isResolvingSource ? 'Resolving…' : 'Resolve'}</button></div>
    <div class="srcprev"><div class="source-thumb">${escapeHTML(current.label.toUpperCase())}</div><div><strong>${escapeHTML(current.title)}</strong><p>${escapeHTML(current.host)} · ${escapeHTML(current.author)} · ${duration} · published ${escapeHTML(current.date)}</p><a href="${escapeHTML(current.url)}" target="_blank" rel="noreferrer">Open original</a><span> · </span><button class="link-button" data-action="toggle-source-input">Change source</button></div></div>
    ${state.sourceError ? `<p class="source-error" role="alert">${escapeHTML(state.sourceError)}</p>` : ''}
  </td></tr>`;
};

const articleExcerpt = () => String(state.articleExcerpt ?? source().excerpt ?? '').trim();
const sourceRangeMax = () => Math.max(MAX_CLIP_SECONDS, Math.ceil(Number(source().duration) || 0), Math.ceil(Number(state.clipStart) || 0), Math.ceil(Number(state.clipEnd) || 0));

const timeRange = () => {
  const excerpt = articleExcerpt();
  const max = sourceRangeMax();
  const length = Math.max(0, state.clipEnd - state.clipStart);
  return state.sourceType === 'article'
    ? `<div class="highlight-preview"><label for="article-excerpt">Selected passage</label><textarea id="article-excerpt" data-action="article-excerpt" maxlength="2000" aria-describedby="article-excerpt-hint">${escapeHTML(excerpt)}</textarea><span id="article-excerpt-hint">Highlight selected · ${excerpt.length} characters · edit before publishing</span></div>`
    : `<div class="clip-editor"><div class="moment-track"><span class="moment-fill" style="left:${(state.clipStart / max) * 100}%;width:${((state.clipEnd - state.clipStart) / max) * 100}%"></span><span class="moment-handle" style="left:${(state.clipStart / max) * 100}%"></span><span class="moment-handle" style="left:${(state.clipEnd / max) * 100}%"></span><input aria-label="Clip start" aria-valuetext="${formatTime(state.clipStart)}" type="range" min="0" max="${max}" value="${state.clipStart}" data-action="clip-start" /><input aria-label="Clip end" aria-valuetext="${formatTime(state.clipEnd)}" type="range" min="0" max="${max}" value="${state.clipEnd}" data-action="clip-end" /></div><div class="ticks" aria-hidden="true"><span>0:00</span><span>${formatTime(max / 4)}</span><span>${formatTime(max / 2)}</span><span>${formatTime(max * .75)}</span><span>${formatTime(max)}</span></div><div class="moment-fields"><label>IN <input type="text" inputmode="numeric" value="${formatTime(state.clipStart)}" data-action="clip-start-time" aria-label="Clip start, minutes and seconds" /></label><span>to</span><label>OUT <input type="text" inputmode="numeric" value="${formatTime(state.clipEnd)}" data-action="clip-end-time" aria-label="Clip end, minutes and seconds" /></label><strong class="chip" data-range-duration>${formatTime(length)} selected</strong><span class="formnote">1:30 max</span></div><p class="formnote">Open the original to confirm exact timing before you publish.</p></div>`;
};

const commentaryEditor = () => `
  <div class="commentary-editor">
    <div class="modetoggle" role="group" aria-label="Commentary type">${button('Text', 'commentary-mode', state.commentaryMode === 'text' ? 'link-button is-active' : 'link-button', 'data-mode="text"')}<span> · </span>${button('Audio', 'commentary-mode', state.commentaryMode === 'audio' ? 'link-button is-active' : 'link-button', 'data-mode="audio"')}</div>
    ${state.commentaryMode === 'text' ? `<textarea data-action="commentary" aria-label="Your annotation" placeholder="What did you notice?">${escapeHTML(state.commentary)}</textarea><div class="editor-foot"><span>${state.commentary.length}/280</span><span>Public after publish</span></div>` : `<div class="audio-recorder ${state.isRecording ? 'is-recording' : ''} ${state.isUploadingAudio ? 'is-uploading' : ''}"><button class="record-button" data-action="toggle-record" aria-label="${state.isRecording ? 'Stop recording' : 'Start recording'}" ${state.isUploadingAudio ? 'disabled' : ''}>${icon(state.isRecording ? 'pause' : 'mic')}</button><div><strong>${state.isRecording ? 'Recording your take…' : state.isUploadingAudio ? 'Uploading your take…' : state.recordedAudio ? 'Audio note ready' : state.audioDraftId ? 'Audio note saved locally' : 'Record a 90-second take'}</strong><span>${state.isRecording ? 'Tap to stop · max 1:30' : state.isUploadingAudio ? 'The browser is sending your note' : state.recordedAudio ? 'You can replace it before publishing' : state.audioDraftId ? 'It will retry when the backend is available' : 'Say the thing you want to remember'}</span></div><span class="audio-duration">${formatTime(state.isRecording ? state.recordingSeconds : state.audioDuration)}</span>${state.audioDraftId && !state.recordedAudio && !state.isUploadingAudio ? `<button class="audio-retry" data-action="retry-audio">Retry upload</button>` : ''}</div>`}
  </div>`;

const sidebar = () => `
  <div class="module capture-module"><h2>Capture a moment</h2><div class="tabstrip" role="group" aria-label="Source type">${sourceTypeButton('video')}${sourceTypeButton('article')}${sourceTypeButton('podcast')}</div><div class="module-body"><table class="formtable"><tbody>${sourceCanvas()}<tr><td class="lbl">Moment</td><td>${timeRange()}</td></tr><tr><td class="lbl">Your note</td><td>${commentaryEditor()}</td></tr><tr><td class="lbl"></td><td><button class="btn publish-button" data-action="publish" ${state.isPublishing ? 'disabled' : ''}>${state.isPublishing ? 'Publishing…' : 'Publish annotation'}</button><p class="formnote">Nothing is published until you choose to publish.</p></td></tr></tbody></table></div></div>`;

const captureView = () => `
  <div class="capture-layout">${sidebar()}<aside class="rail"><div class="module"><h2>How capture works</h2><div class="module-body"><ol class="steps"><li>Paste a source URL, or start from the page you are reading with the sidebar.</li><li>Set the moment — up to 90 seconds of it.</li><li>Leave your context, then publish when you are ready.</li></ol></div></div><div class="module"><h2>The annotated rule</h2><div class="module-body"><p class="rule">A clip without its source is just a rumour.</p><p class="small">Every public page points back to the original. Context travels with the moment.</p></div></div><div class="module"><h2>Sidebar-first</h2><div class="module-body"><p class="small">Capturing from the page you are on is faster in the Chrome sidebar.</p><a href="/" data-action="open-original">Get the extension →</a></div></div></aside></div>`;

const feedCard = (item, index) => {
  const sourceHref = escapeHTML(item.sourceUrl || '#');
  const moment = item.type === 'Article' ? '¶' : item.duration;
  return `
  <article class="post">
    <div class="post-avatar">${escapeHTML(item.initials)}</div><div class="post-content">
      <p class="post-byline"><a href="/u/${encodeURIComponent(item.authorHandle || '')}"><b>${escapeHTML(item.handle)}</b></a> <span>annotated</span> <a href="${sourceHref}" target="_blank" rel="noreferrer">${escapeHTML(item.title)}</a> <span>· ${escapeHTML(item.type.toLowerCase())} · ${escapeHTML(item.time)}</span></p>
      <blockquote class="post-quote">“${escapeHTML(item.quote)}”</blockquote>
      <p class="post-note"><span class="chip">${escapeHTML(moment)}</span>${escapeHTML(item.commentary)}</p>
      <p class="post-actions"><a href="${sourceHref}" target="_blank" rel="noreferrer" data-action="open-original">Open original</a> · <button class="link-button" data-action="focus-comment">Comment${item.comments ? ` (${item.comments})` : ''}</button>${item.authorId && item.authorId !== state.user?.id ? ` · <button class="link-button" data-action="toggle-follow" data-user-id="${escapeHTML(item.authorId)}">${state.followingIds[item.authorId] ? 'Following' : `Follow ${escapeHTML(item.handle)}`}</button>` : ''}</p>
    </div>
  </article>`;
};

const feedView = () => {
  const visibleItems = state.feedAnnotations.map(annotationToFeedItem);
  const emptyMessage = state.feedQuery ? `No annotations match “${escapeHTML(state.feedQuery)}”.` : state.feedFollowing ? 'No annotations from followed users yet.' : 'No public annotations yet.';
  const emptyDescription = state.feedQuery ? 'Try a different source, author, or phrase.' : state.feedFollowing ? 'Follow someone whose context you want to keep up with.' : 'Publish the first source-backed moment and it will appear here.';
  return `
  <div class="module feed-head"><div class="module-body"><h1>What people kept</h1><span class="feed-controls"><button class="link-button ${state.feedFollowing ? '' : 'is-active'}" data-action="feed-filter" data-following="false">Recent</button>${state.user ? `<button class="link-button ${state.feedFollowing ? 'is-active' : ''}" data-action="feed-filter" data-following="true">Following</button>` : ''}<button class="link-button" data-action="search" aria-label="Search timeline" aria-expanded="${state.showFeedSearch}">Search</button></span></div></div>
  ${state.showFeedSearch ? `<form class="feed-search-row" data-action="feed-search-form"><label for="feed-search">Search annotations</label><div><input id="feed-search" data-action="feed-search" value="${escapeHTML(state.feedQuery)}" placeholder="Try a source, author, or idea" maxlength="80" /><button class="dark-button" type="submit">Search ${icon('arrow')}</button>${state.feedQuery ? '<button class="ghost-button" type="button" data-action="clear-feed-search">Clear</button>' : ''}</div></form>` : ''}
  <div class="feed-layout"><main class="module timeline-module"><h2>Timeline</h2>${visibleItems.length ? visibleItems.map(feedCard).join('') : `<div class="module-body feed-empty"><h3>${emptyMessage}</h3><p>${emptyDescription}</p><button class="btn" data-action="set-view" data-view="capture">Capture a moment</button></div>`}${state.feedCursor ? '<button class="link-button module-body" data-action="feed-more">Load more</button>' : ''}</main><aside class="rail">${state.user ? `<div class="module"><h2>Your library</h2><div class="module-body"><p>Capture a moment, then keep its public source attached.</p><button class="btn" data-action="set-view" data-view="published">My library</button></div></div>` : `<div class="module"><h2>Build your public library</h2><div class="module-body"><p>Capture now. Sign in with X when you are ready to publish, follow, or respond.</p>${authLinks('btn') || ''}</div></div>`}<div class="module"><h2>The annotated rule</h2><div class="module-body"><p class="rule">A clip without its source is just a rumour.</p><p class="small">Every public page points back to the original. Context travels with the moment.</p></div></div><div class="module"><h2>Sidebar-first</h2><div class="module-body"><p class="small">Start with the page you are already reading. The Chrome sidebar does the rest.</p></div></div></aside></div>`;
};

const annotationHero = () => {
  const clipUrl = state.publishedAnnotation?.clipUrl || state.clipUrl;
  const audioUrl = state.publishedAnnotation?.audioUrl || state.audioUrl;
  const status = state.mediaStatus === 'failed' ? 'Clip unavailable.' : state.mediaStatus === 'cancelled' ? 'Clip processing was cancelled.' : state.mediaStatus === 'processing' ? 'Preparing a 240p clip…' : 'Clip queued for processing…';
  const mediaRecovery = state.mediaStatus === 'failed' ? `<div class="media-recovery"><span>${escapeHTML(state.mediaError || 'The source could not be prepared.')}</span><button data-action="retry-media" ${state.isRetryingMedia ? 'disabled' : ''}>${state.isRetryingMedia ? 'Retrying…' : 'Retry clip'}</button></div>` : '';
  if (state.sourceType === 'article') return `<div class="annotation-article-text"><span class="quote-mark">“</span><p>${escapeHTML(articleExcerpt() || sourceData.article.excerpt)}</p><span>Highlighted passage</span></div>`;
  if (state.sourceType === 'video') return clipUrl
    ? `<video class="annotation-video-player" controls preload="metadata" src="${escapeHTML(clipUrl)}"></video>`
    : `<div class="annotation-video-bg"><div class="video-silhouette small"></div><span class="media-status">${status}</span>${mediaRecovery}</div><span class="annotation-clip-time">${formatTime(state.clipStart)} — ${formatTime(state.clipEnd)}</span>`;
  return `<div class="annotation-audio"><div class="podcast-orbit small"><span></span><span></span><span></span></div>${clipUrl ? `<audio class="annotation-audio-player" controls preload="metadata" src="${escapeHTML(clipUrl)}"></audio>` : audioUrl ? `<audio class="annotation-audio-player" controls preload="metadata" src="${escapeHTML(audioUrl)}"></audio>` : icon('podcast')}<div class="mini-wave large">${Array.from({ length: 34 }, (_, i) => `<i style="height:${16 + ((i * 19) % 58)}%"></i>`).join('')}</div>${clipUrl && audioUrl ? `<audio class="commentary-audio" controls preload="metadata" src="${escapeHTML(audioUrl)}"></audio>` : !clipUrl ? `<span class="media-status">${status}</span>${mediaRecovery}` : ''}</div>`;
};

const moderationView = () => {
  if (!canModerate()) return `<div class="feed-empty"><span class="eyebrow">Restricted</span><h3>Moderation access is required.</h3><p>Sign in with an owner, admin, or moderator account to review claims.</p></div>`;
  const statuses = ['open', 'in_review', 'resolved', 'rejected'];
  const claims = state.moderationClaims || [];
  return `
    <div class="view-head moderation-head"><div><span class="eyebrow">Source & rights</span><h2>Review claims.</h2><p>Keep every report attached to the annotation, record the decision, and leave an audit trail.</p></div><button class="ghost-button" data-action="refresh-moderation">${state.moderationLoading ? 'Refreshing…' : 'Refresh queue'} ${icon('arrow')}</button></div>
    <main class="moderation-list">${claims.length ? claims.map((claim) => {
      const annotation = claim.annotation || {};
      const sourceUrl = annotation.sourceUrl || '#';
      const current = claim.status || 'open';
      return `<article class="moderation-card"><div class="moderation-card-head"><span class="claim-status status-${escapeHTML(current)}">${escapeHTML(current.replace('_', ' '))}</span><span class="moderation-date">${escapeHTML(claim.createdAt ? new Date(claim.createdAt).toLocaleString() : 'Recently')}</span></div><h3>${escapeHTML(annotation.sourceTitle || 'Untitled annotation')}</h3><p class="moderation-reason">${escapeHTML(claim.reason || 'No reason supplied.')}</p><div class="moderation-source"><span>${escapeHTML(annotation.sourceHost || 'source')}</span><a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noreferrer">Open source ${icon('external')}</a></div><div class="moderation-meta">Reported by ${escapeHTML(claim.reporter?.displayName || claim.reporter?.handle || claim.reporterId || 'unknown reporter')}</div><div class="moderation-actions">${statuses.map((status) => `<button class="moderation-status ${current === status ? 'is-current' : ''}" data-action="moderate-claim" data-claim-id="${escapeHTML(claim.id)}" data-status="${status}" ${current === status ? 'disabled' : ''}>${status.replace('_', ' ')}</button>`).join('')}</div>${claim.resolutionNote ? `<p class="moderation-note">${escapeHTML(claim.resolutionNote)}</p>` : ''}</article>`;
    }).join('') : `<div class="feed-empty"><span class="eyebrow">Queue clear</span><h3>${state.moderationLoading ? 'Loading claims…' : 'No claims need review.'}</h3><p>New rights reports will appear here with their source and reporter attached.</p></div>`}</main>`;
};

const profileView = () => {
  if (state.profileLoading) return `<div class="profile-page"><div class="feed-empty"><span class="eyebrow">Profile</span><h3>Loading profile…</h3><p>Fetching the public annotations and follow state.</p></div></div>`;
  if (!state.profileData) return `<div class="profile-page"><div class="feed-empty"><span class="eyebrow">Profile unavailable</span><h3>We could not load this profile.</h3><p>${escapeHTML(state.serverError || 'Check the handle and try again.')}</p><button class="ghost-button" data-action="set-view" data-view="feed">Back to discover ${icon('arrow')}</button></div></div>`;
  const profile = state.profileData;
  const annotations = (profile.annotations || []).map(annotationToFeedItem);
  const initials = (profile.displayName || profile.handle || 'A').slice(0, 2).toUpperCase();
  const isCurrentUser = state.user?.id === profile.id;
  const following = Boolean(state.followingIds[profile.id] ?? profile.isFollowing);
  return `<div class="profile-page"><div class="view-head profile-page-head"><div><span class="eyebrow">Public profile</span><h2>${escapeHTML(profile.displayName || profile.handle)}</h2><p>@${escapeHTML(profile.handle)} · ${escapeHTML(profile.bio || 'Keeping the moments worth returning to.')}</p></div><button class="ghost-button" data-action="set-view" data-view="feed">${icon('back')} Discover</button></div><section class="profile-hero"><div class="profile-avatar-large">${escapeHTML(initials)}</div><div class="profile-identity"><span class="eyebrow">Annotated member</span><h3>${escapeHTML(profile.displayName || profile.handle)}</h3><p>@${escapeHTML(profile.handle)}</p></div>${!isCurrentUser ? `<button class="follow-button profile-follow ${following ? 'is-following' : ''}" data-action="toggle-follow" data-user-id="${escapeHTML(profile.id)}">${following ? 'Following' : 'Follow'}</button>` : '<span class="profile-self">You</span>'}<div class="profile-metrics"><span><strong>${Number(profile.annotationCount) || annotations.length}</strong> annotations</span><span><strong>${Number(profile.followers) || 0}</strong> followers</span><span><strong>${Number(profile.following) || 0}</strong> following</span></div></section><div class="profile-section-head"><div><span class="eyebrow">Their annotations</span><h3>What they kept.</h3></div></div><main class="profile-annotations">${annotations.length ? annotations.map(feedCard).join('') : `<div class="feed-empty"><span class="eyebrow">No annotations yet</span><h3>This profile is just getting started.</h3><p>Published moments will appear here with their original sources attached.</p></div>`}</main></div>`;
};

const publishedView = () => {
  const currentUser = state.user || {};
  const ownItems = [state.publishedAnnotation, ...state.feedAnnotations.filter((item) => item.author?.id === currentUser.id)].filter(Boolean);
  const uniqueItems = [...new Map(ownItems.map((item) => [item.slug || item.id, item])).values()];
  const handle = currentUser.handle || currentUser.displayName || 'member';
  const initials = handle.slice(0, 1).toUpperCase();
  const libraryRow = (annotation) => {
    const item = annotationToFeedItem(annotation);
    const moment = item.type === 'Article' ? '¶' : `${formatTime(Number(annotation.clipStart) || 0)}–${formatTime(Number(annotation.clipEnd) || 0)}`;
    const pageUrl = publicAnnotationUrl(annotation, window.location.origin);
    return `<article class="library-row"><p><span class="chip">${escapeHTML(moment)}</span><a href="${escapeHTML(pageUrl)}"><b>${escapeHTML(item.title)}</b></a><span> · ${escapeHTML(item.type.toLowerCase())} · published ${escapeHTML(item.time)}</span></p><blockquote>${escapeHTML(item.quote)}</blockquote><p class="library-note">${escapeHTML(item.commentary)}</p><p class="library-stats">${item.comments || 'No'} comments · ${item.likes || 0} opens of the original</p><p class="library-actions"><a href="${escapeHTML(pageUrl)}">View public page</a> · <button class="link-button" data-action="set-view" data-view="capture">Edit note</button> · <button class="link-button quiet" data-action="toggle-claim" data-claim-slug="${escapeHTML(item.slug || '')}" data-claim-title="${escapeHTML(item.title)}">Unpublish</button></p></article>`;
  };
  const profileUrl = `${window.location.origin}/u/${encodeURIComponent(currentUser.handle || handle)}`;
  return `<div class="library-layout"><main><section class="module"><div class="module-body profile"><div class="profile-avatar">${escapeHTML(initials)}</div><div><h1>@${escapeHTML(handle)}</h1><p>Annotated member · signed in with X</p><a href="${escapeHTML(profileUrl)}">View public profile</a> · <button class="link-button" data-action="set-view" data-view="capture">Capture a moment</button></div></div></section><section class="module"><h2>Published <span>(${uniqueItems.length})</span></h2>${uniqueItems.length ? uniqueItems.map(libraryRow).join('') : '<div class="module-body"><p>No published annotations yet. Capture a moment when you are ready.</p><button class="btn" data-action="set-view" data-view="capture">Capture a moment</button></div>'}</section></main><aside class="rail"><section class="module"><h2>Your library</h2><div class="module-body"><table class="info-table"><tbody><tr><td>Published</td><td>${uniqueItems.length}</td></tr><tr><td>Sources</td><td>${new Set(uniqueItems.map((item) => item.sourceHost)).size}</td></tr><tr><td>Followers</td><td>—</td></tr><tr><td>Comments received</td><td>${uniqueItems.reduce((total, item) => total + (item.comments?.length || 0), 0)}</td></tr><tr><td>Opens of originals</td><td>—</td></tr></tbody></table></div></section><section class="module"><h2>Share your library</h2><div class="module-body"><p class="small">Your public profile shows everything here, each moment linked to its original.</p><code class="urlbox">${escapeHTML(profileUrl.replace(/^https?:\/\//, ''))}</code><button class="btn" data-action="copy-profile-link" data-copy-url="${escapeHTML(profileUrl)}">Copy link</button></div></section><section class="module"><h2>Rights &amp; claims</h2><div class="module-body"><p class="small">Own a source and want a moment reviewed? <button class="link-button" data-action="toggle-claim">File a claim</button>.</p></div></section></aside></div>`;
};

const deepLink = (url, start) => {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/u.test(parsed.hostname)) parsed.searchParams.set('t', `${Math.max(0, Number(start) || 0)}s`);
    return parsed.href;
  } catch { return url || '#'; }
};

const permalinkView = () => {
  const annotation = state.publishedAnnotation;
  if (!annotation) return '<section class="module"><h2>Annotation</h2><div class="module-body"><p>Loading this annotation…</p></div></section>';
  const item = annotationToFeedItem(annotation);
  const sourceInfo = normalizeSource({ ...annotation, title: annotation.sourceTitle, host: annotation.sourceHost, excerpt: annotation.sourceExcerpt });
  const start = Number(annotation.clipStart) || 0;
  const end = Number(annotation.clipEnd) || start;
  const moment = sourceInfo.label === 'Article' ? '¶' : `${formatTime(start)}–${formatTime(end)}`;
  const original = deepLink(sourceInfo.url, start);
  const originalMoment = sourceInfo.label === 'Article' ? '' : ` <span>at ${formatTime(start)}</span>`;
  const originalHint = sourceInfo.label === 'Article'
    ? `Opens ${sourceInfo.host} at the selected passage.`
    : `Opens ${sourceInfo.host} at the selected moment.`;
  const comments = annotation.comments || [];
  const author = annotation.author || {};
  const authorHandle = author.handle || annotation.authorId || 'user';
  const more = state.feedAnnotations.filter((entry) => entry.author?.id === author.id && entry.slug !== annotation.slug).slice(0, 2).map(annotationToFeedItem);
  return `<div class="permalink-grid"><main><section class="module permalink-hero"><h2>Annotation <span>${escapeHTML(sourceInfo.host)} · ${escapeHTML(sourceInfo.label.toLowerCase())}${sourceInfo.duration ? ` · ${formatTime(sourceInfo.duration)}` : ''}</span></h2><div class="module-body"><div class="permalink-byline"><div class="post-avatar">${escapeHTML((author.displayName || authorHandle).slice(0, 1).toUpperCase())}</div><p><a href="/u/${encodeURIComponent(authorHandle)}"><b>@${escapeHTML(authorHandle)}</b></a> annotated <a href="${escapeHTML(sourceInfo.url)}" target="_blank" rel="noreferrer">${escapeHTML(sourceInfo.title)}</a><br><span>public</span></p>${author.id && author.id !== state.user?.id ? `<button class="link-button" data-action="toggle-follow" data-user-id="${escapeHTML(author.id)}">Follow @${escapeHTML(authorHandle)}</button>` : ''}</div><blockquote class="permalink-quote">“${escapeHTML(annotation.sourceExcerpt || item.quote)}”<small>— ${escapeHTML(sourceInfo.author)} · ${escapeHTML(sourceInfo.label.toLowerCase())}${sourceInfo.label === 'Article' ? '' : ` · at ${formatTime(start)}`}</small></blockquote><div class="permalink-note"><p><span class="chip">${escapeHTML(moment)}</span><b>@${escapeHTML(authorHandle)}:</b></p><p>${escapeHTML(annotation.commentary || 'An audio annotation attached to this moment.')}</p></div><div class="permalink-cta"><a class="btn" href="${escapeHTML(original)}" target="_blank" rel="noreferrer">Open the original${originalMoment}</a><small>${escapeHTML(originalHint)}</small><span><button class="link-button" data-action="share">Share this page</button> · <button class="link-button" data-action="copy-link">Copy link</button></span></div></div></section><section class="module"><h2>Responses <span>(${comments.length})</span></h2>${comments.map((comment) => `<div class="response-row"><div class="post-avatar">${escapeHTML((comment.author?.handle || comment.authorId || 'A').slice(0, 1).toUpperCase())}</div><p><b>@${escapeHTML(comment.author?.handle || comment.authorId || 'user')}</b><br>${escapeHTML(comment.body)}</p></div>`).join('') || '<div class="module-body"><p>No responses yet.</p></div>'}<div class="response-prompt">${state.user ? `<form data-action="comment-form"><input aria-label="Add a response" data-action="comment-draft" value="${escapeHTML(state.commentDraft)}" placeholder="Add a considered response…" /><button class="btn">Respond</button></form>` : `${authLinks('chrome-sign-in') || 'Sign in'} to add a considered response.`}</div></section><section class="module"><h2>More from @${escapeHTML(authorHandle)}</h2>${more.length ? more.map((entry) => `<div class="more-row"><span class="chip">${escapeHTML(entry.type === 'Article' ? '¶' : entry.duration)}</span><b>${escapeHTML(entry.title)}</b> <span>· ${escapeHTML(entry.type.toLowerCase())}</span><p>“${escapeHTML(entry.quote)}”</p></div>`).join('') : '<div class="module-body"><p>More annotations will appear here.</p></div>'}</section></main><aside class="rail"><section class="module"><h2>Where this comes from</h2><div class="module-body"><table class="provenance-table"><tbody><tr><td>Source</td><td><a href="${escapeHTML(sourceInfo.url)}">${escapeHTML(sourceInfo.host)}</a></td></tr><tr><td>Channel</td><td><b>${escapeHTML(sourceInfo.author)}</b></td></tr><tr><td>Type</td><td>${escapeHTML(sourceInfo.label)}${sourceInfo.duration ? ` · ${formatTime(sourceInfo.duration)}` : ''}</td></tr><tr><td>Moment</td><td><b>${escapeHTML(moment)}</b></td></tr><tr><td>Captured</td><td>Recently</td></tr></tbody></table><p class="small">${sourceInfo.label === 'Article' ? 'This page links to the original selected passage.' : 'The clip is not re-hosted. This page links to the original at the selected moment.'}</p></div></section><section class="module"><h2>Annotated by</h2><div class="module-body"><div class="annotated-by"><div class="post-avatar">${escapeHTML((author.displayName || authorHandle).slice(0, 1).toUpperCase())}</div><p><b>@${escapeHTML(authorHandle)}</b><br><span>Annotated member</span></p></div>${author.id && author.id !== state.user?.id ? `<button class="btn" data-action="toggle-follow" data-user-id="${escapeHTML(author.id)}">Follow on annotated</button>` : ''}<p class="small"><a href="/u/${encodeURIComponent(authorHandle)}">View public library →</a></p></div></section><section class="module"><h2>The annotated rule</h2><div class="module-body"><p class="rule">A clip without its source is just a rumour.</p><p class="small">Every public page points back to the original. Context travels with the moment.</p></div></section><section class="module"><h2>Rights</h2><div class="module-body"><p class="small">Own this source? <button class="link-button" data-action="toggle-claim" data-claim-slug="${escapeHTML(annotation.slug || '')}" data-claim-title="${escapeHTML(sourceInfo.title)}">File a claim</button>.</p></div></section></aside></div>`;
};

const claimModal = () => `<div class="modal-backdrop" data-action="close-claim">
  <div class="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title" aria-describedby="claim-description" data-action="stop-modal" data-stop-click="true">
    <button class="icon-button modal-close" data-action="close-claim" aria-label="Close claim form">${icon('close')}</button>
    <span class="eyebrow">Source & rights</span>
    <h3 id="claim-title">${state.claimSubmitted ? 'Claim received' : 'File a claim'}</h3>
    ${state.claimTitle ? `<p class="claim-context">About: ${escapeHTML(state.claimTitle)}</p>` : ''}
    ${state.claimSubmitted
      ? `<div class="claim-success" role="status"><strong>Thank you for flagging the source.</strong><p id="claim-description">The report is attached to this annotation for review.</p></div><button class="dark-button full-button" data-action="close-claim">Done ${icon('check')}</button>`
      : `<p id="claim-description">Tell us what is wrong with this annotation. We’ll keep your report attached to the source page.</p><label>What should we review?<textarea placeholder="Describe the issue…" data-action="claim-text" aria-describedby="claim-error">${escapeHTML(state.claimReason)}</textarea></label>${state.claimError ? `<p class="claim-error" id="claim-error" role="alert">${escapeHTML(state.claimError)}</p>` : '<span id="claim-error" hidden></span>'}<button class="dark-button full-button" data-action="submit-claim">Send claim ${icon('arrow')}</button>`}
  </div>
</div>`;

const toast = () => state.toast ? `<div class="toast" role="status"><span class="toast-icon">${icon('check')}</span>${escapeHTML(state.toast)}</div>` : '';

const render = () => {
  const isPermalink = state.activeView === 'permalink';
  const content = state.activeView === 'capture' ? captureView() : state.activeView === 'feed' ? feedView() : state.activeView === 'moderation' ? moderationView() : state.activeView === 'profile' ? profileView() : isPermalink ? permalinkView() : publishedView();
  app.innerHTML = `${appHeader()}${authStateView()}<div class="app-body ${isPermalink ? 'permalink-body' : ''}">${isPermalink ? '' : appRail()}<main class="main-content">${content}</main></div>${appFooter()}${state.claimOpen ? claimModal() : ''}${toast()}`;
  for (const element of app.querySelectorAll('.app-header, .auth-notice, .auth-prompt, .app-body')) {
    element.inert = state.claimOpen;
    if (state.claimOpen) element.setAttribute('aria-hidden', 'true');
  }
};

const renderCapture = () => {
  render();
};

const setClipBoundary = (boundary, value) => {
  const range = moveClipBoundary(state.clipStart, state.clipEnd, boundary, value, { max: Math.max(sourceRangeMax(), Number(value) || 0) });
  state.clipStart = range.start;
  state.clipEnd = range.end;
};

const refreshClipControls = () => {
  const editor = app.querySelector('.clip-editor');
  if (!editor) return;
  const startRange = editor.querySelector('[data-action="clip-start"]');
  const endRange = editor.querySelector('[data-action="clip-end"]');
  const startInput = editor.querySelector('[data-action="clip-start-time"]');
  const endInput = editor.querySelector('[data-action="clip-end-time"]');
  if (!startRange || !endRange || !startInput || !endInput) return;
  startRange.value = String(state.clipStart);
  endRange.value = String(state.clipEnd);
  startRange.setAttribute('aria-valuetext', formatTime(state.clipStart));
  endRange.setAttribute('aria-valuetext', formatTime(state.clipEnd));
  startInput.value = formatTime(state.clipStart);
  endInput.value = formatTime(state.clipEnd);
  const fill = editor.querySelector('.moment-fill');
  const max = sourceRangeMax();
  if (fill) {
    fill.style.left = `${(state.clipStart / max) * 100}%`;
    fill.style.width = `${((state.clipEnd - state.clipStart) / max) * 100}%`;
  }
  const selectedDuration = editor.querySelector('[data-range-duration]');
  if (selectedDuration) selectedDuration.textContent = `${formatTime(state.clipEnd - state.clipStart)} selected`;
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

const refreshFeed = async () => {
  if (state.serverStatus !== 'online') return;
  await loadFeed();
};

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

const loadFeed = async ({ append = false } = {}) => {
  if (state.serverStatus !== 'online') return;
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (state.feedFollowing) params.set('following', 'true');
    if (state.feedQuery.trim()) params.set('q', state.feedQuery.trim());
    if (append && state.feedCursor) params.set('cursor', state.feedCursor);
    const result = await api.feed(params.toString());
    state.feedAnnotations = append ? [...state.feedAnnotations, ...(result.annotations || [])] : (result.annotations || []);
    state.feedCursor = result.nextCursor || null;
  } catch (error) {
    if (state.feedFollowing && error?.status === 401) {
      state.feedFollowing = false;
      state.feedCursor = null;
      recoverAuthError(error, 'Sign in to see the people you follow.');
    }
    /* the capture flow should remain usable when feed loading fails */
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
  if (!url) { notify('Paste a source URL first.'); return; }
  if (state.serverStatus !== 'online') { notify('Backend unavailable — source resolution is not connected.'); return; }
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
      state.clipEnd = 60;
    }
    state.showSourceInput = false;
    state.sourceError = '';
    state.isResolvingSource = false;
    persist();
    notify(`Resolved ${state.customSource.host || 'source'} — ready to annotate.`);
  } catch (error) {
    state.isResolvingSource = false;
    state.sourceError = error.message || 'Source could not be resolved.';
    render();
    notify(`Source could not be resolved: ${state.sourceError}`);
  }
};

const publishAnnotation = async () => {
  if (state.published) {
    state.activeView = 'published';
    render();
    return;
  }
  if (requestSignIn('publish this annotation')) return;
  if (state.sourceType !== 'article' && state.clipEnd - state.clipStart > 90) { notify('Keep the clip under 90 seconds.'); return; }
  if (state.sourceType === 'article' && !articleExcerpt()) { notify('Select a passage before publishing.'); return; }
  if (state.commentaryMode === 'text' && !state.commentary.trim()) { notify('Add a note before publishing.'); return; }
  if (state.commentaryMode === 'audio' && !state.audioAssetId) { notify('Finish uploading the audio note before publishing.'); return; }
  if (state.serverStatus !== 'online') { notify('Backend unavailable — this draft has not been published.'); return; }

  const currentSource = source();
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
      commentary: state.commentary,
      commentaryMode: state.commentaryMode,
      audioAssetId: state.audioAssetId || undefined,
      audioDuration: state.audioDuration || undefined,
      mediaUrl: currentSource.mediaUrl || undefined,
      provider: currentSource.provider || undefined,
      clientRequestId: state.clientRequestId,
    });
    hydrateAnnotation(annotation);
    state.activeView = 'published';
    state.isPublishing = false;
    watchMediaProcessing();
    await refreshFeed();
    if (state.audioDraftId) await deleteMediaDraft(state.audioDraftId).catch(() => {});
    state.audioDraftId = '';
    clearDraft();
    notify('Published with a permanent source link.');
  } catch (error) {
    if (recoverAuthError(error, 'Sign in to publish this annotation.')) return;
    state.isPublishing = false;
    render();
    notify(error.message || 'Annotation could not be published.');
  }
};

const copyPublicLink = async (requestedLink = '') => {
  const link = requestedLink || publicAnnotationUrl(state.publishedAnnotation, window.location.origin) || (state.publishedSlug ? `${window.location.origin}/a/${encodeURIComponent(state.publishedSlug)}` : '');
  if (!link) { notify('Publish an annotation before copying its link.'); return; }
  try {
    await navigator.clipboard.writeText(link);
    notify('Public annotation link copied.');
  } catch {
    notify(link);
  }
};

const submitComment = async () => {
  const body = state.commentDraft.trim();
  if (!body) { notify('Write something before posting.'); return; }
  if (state.publishedSlug) {
    if (requestSignIn('post a comment')) return;
    if (state.serverStatus !== 'online') { notify('Backend unavailable — comment not posted.'); return; }
    try {
      const { annotation } = await api.addComment(state.publishedSlug, body);
      state.publishedAnnotation = annotation;
      state.commentDraft = '';
      notify('Comment added to the conversation.');
    } catch (error) {
      if (recoverAuthError(error, 'Sign in to post a comment.')) return;
      notify(error.message || 'Comment could not be posted.');
    }
    return;
  }
  state.comments += 1;
  state.commentDraft = '';
  notify('Comment added to the conversation.');
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
    : document.querySelector('.claim-button');
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
    if (target.dataset.view === 'published' && !state.user) {
      state.activeView = 'feed';
      state.authPrompt = '';
      render();
      return;
    }
    state.authPrompt = '';
    state.activeView = target.dataset.view;
    if (state.activeView !== 'profile') {
      state.profileHandle = '';
      state.profileData = null;
    }
    if (state.activeView === 'moderation') loadModerationClaims().then(render);
    persist();
    render();
    return;
  }
  if (action === 'source-type') { setSource(target.dataset.type); return; }
  if (action === 'toggle-source-input') { state.showSourceInput = !state.showSourceInput; if (!state.showSourceInput) state.sourceError = ''; render(); return; }
  if (action === 'toggle-mobile-source') { state.showMobileSourcePreview = !state.showMobileSourcePreview; render(); return; }
  if (action === 'load-source') { loadSource(); return; }
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
  if (action === 'search') { state.showFeedSearch = !state.showFeedSearch; render(); if (state.showFeedSearch) document.querySelector('#feed-search')?.focus(); return; }
  if (action === 'clear-feed-search') { state.feedQuery = ''; state.feedCursor = null; loadFeed().then(() => { render(); document.querySelector('#feed-search')?.focus(); }); return; }
  if (action === 'feed-more') { loadFeed({ append: true }).then(render); return; }
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
  if (action === 'toggle-like') {
    const slug = target.dataset.slug;
    if (slug && state.serverStatus === 'online') {
      if (requestSignIn('save a like')) return;
      const existing = state.publishedSlug === slug ? state.publishedAnnotation : state.feedAnnotations.find((item) => item.slug === slug);
      const liked = Boolean(existing?.likedByMe || state.liked);
      (async () => {
        try {
          const result = liked ? await api.unlike(slug) : await api.like(slug);
          if (state.publishedSlug === slug) state.publishedAnnotation = result.annotation;
          const item = state.feedAnnotations.find((entry) => entry.slug === slug);
          if (item) { item.likedByMe = result.annotation.likedByMe; item.likes = result.annotation.likes; }
          state.liked = result.annotation.likedByMe;
          render();
        } catch (error) {
          if (!recoverAuthError(error, 'Sign in to save a like.')) notify(error.message || 'Like could not be saved.');
        }
      })();
    } else { state.liked = !state.liked; render(); }
    return;
  }
  if (action === 'toggle-follow') {
    const userId = target.dataset.userId;
    if (userId && state.serverStatus === 'online') {
      if (requestSignIn('follow this member')) return;
      const following = Boolean(state.followingIds[userId]);
      (async () => {
        try {
          const result = following ? await api.unfollow(userId) : await api.follow(userId);
          state.followingIds[userId] = result.following;
          state.following = result.following;
          if (state.profileData?.id === userId) {
            state.profileData.isFollowing = result.following;
            state.profileData.followers = Math.max(0, Number(state.profileData.followers || 0) + (result.following ? 1 : -1));
          }
          render();
        } catch (error) {
          if (!recoverAuthError(error, 'Sign in to follow this member.')) notify(error.message || 'Follow could not be saved.');
        }
      })();
    } else { state.following = !state.following; render(); }
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
  if (action === 'copy-link') { copyPublicLink(); return; }
  if (action === 'copy-profile-link') { copyPublicLink(target.dataset.copyUrl || ''); return; }
  if (action === 'open-original') { if (target.getAttribute('href') === '#') { event.preventDefault(); notify('Original source link preserved.'); } return; }
  if (action === 'toggle-claim') {
    claimReturnFocus = { slug: target.dataset.claimSlug || '', view: state.activeView };
    if (target.dataset.claimSlug) {
      state.claimSlug = target.dataset.claimSlug;
      state.claimTitle = target.dataset.claimTitle || '';
      state.claimOpen = true;
    } else {
      state.claimOpen = true;
    }
    state.claimError = '';
    state.claimSubmitted = false;
    render();
    if (state.claimOpen) document.querySelector('[data-action="claim-text"]')?.focus();
    return;
  }
  if (action === 'close-claim') { closeClaimDialog(); return; }
  if (action === 'submit-claim') { submitClaim(); return; }
  if (action === 'logout') { api.logout().then(() => { state.user = null; if (state.activeView === 'published') state.activeView = 'feed'; notify('Signed out.'); }).catch((error) => notify(error.message || 'Sign out failed.')); return; }
  if (action === 'sidebar-help') { notify('Annotated keeps a source link on every public page.'); return; }
});

app.addEventListener('keydown', (event) => {
  if (!state.claimOpen) return;
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
});

app.addEventListener('input', (event) => {
  const action = event.target.dataset.action;
  if (action === 'commentary') {
    state.commentary = event.target.value.slice(0, 280);
    const count = event.target.parentElement?.querySelector('.editor-foot span');
    if (count) count.textContent = `${state.commentary.length}/280`;
  }
  if (action === 'comment-draft') state.commentDraft = event.target.value;
  if (action === 'claim-text') {
    state.claimReason = event.target.value;
    state.claimError = '';
  }
  if (action === 'source-url') { state.sourceUrl = event.target.value; state.customSource = null; state.sourceError = ''; }
  if (action === 'article-excerpt') {
    state.articleExcerpt = event.target.value.slice(0, 2000);
    const hint = event.target.closest('.highlight-preview')?.querySelector('#article-excerpt-hint');
    if (hint) hint.textContent = `Highlight selected · ${state.articleExcerpt.trim().length} characters · edit before publishing`;
    persist();
  }
  if (action === 'clip-start') { setClipBoundary('start', event.target.value); persist(); refreshClipControls(); }
  if (action === 'clip-end') { setClipBoundary('end', event.target.value); persist(); refreshClipControls(); }
});

app.addEventListener('change', (event) => {
  const action = event.target.dataset.action;
  if (action === 'clip-start-time' || action === 'clip-end-time') {
    const seconds = parseTime(event.target.value);
    if (seconds === null) { notify('Use mm:ss, for example 1:02.'); refreshClipControls(); return; }
    setClipBoundary(action === 'clip-start-time' ? 'start' : 'end', seconds);
    persist();
    refreshClipControls();
  }
});

app.addEventListener('submit', (event) => {
  if (event.target.dataset.action === 'comment-form') {
    event.preventDefault();
    submitComment();
  }
  if (event.target.dataset.action === 'feed-search-form') {
    event.preventDefault();
    state.feedQuery = event.target.querySelector('[data-action="feed-search"]')?.value || '';
    state.feedCursor = null;
    loadFeed().then(() => { render(); document.querySelector('#feed-search')?.focus(); });
  }
});

bootstrap();
