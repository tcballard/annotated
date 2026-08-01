import './styles.css';
import { api } from './api.js';

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

const normalizeSource = (item = {}) => {
  const type = item.sourceType || item.type || 'article';
  const url = item.sourceUrl || item.url || '';
  let host = item.host || item.sourceHost || '';
  if (!host && url) {
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
  }
  return {
    label: sourceLabels[type] || 'Source',
    host,
    url,
    title: item.title || item.sourceTitle || 'Untitled source',
    author: item.author || host || 'Unknown source',
    date: item.date || 'Just now',
    duration: Number(item.duration) || 0,
    caption: item.description || item.excerpt || 'A source ready to annotate.',
    excerpt: item.excerpt || item.sourceExcerpt || '',
    imageUrl: item.imageUrl || item.thumbnailUrl || null,
  };
};

const initialState = {
  activeView: 'capture',
  sourceType: 'video',
  sourceUrl: sourceData.video.url,
  clipStart: 14,
  clipEnd: 62,
  commentary: '',
  commentaryMode: 'text',
  isRecording: false,
  recordedAudio: false,
  published: false,
  liked: false,
  following: false,
  commentDraft: '',
  comments: 12,
  claimOpen: false,
  claimReason: '',
  toast: '',
  showSourceInput: false,
  customSource: null,
  publishedSlug: '',
  publishedAnnotation: null,
  feedAnnotations: [],
  serverStatus: 'checking',
  serverError: '',
  isResolvingSource: false,
  isPublishing: false,
};

const saved = (() => {
  try { return JSON.parse(localStorage.getItem('annotated-demo') || '{}'); } catch { return {}; }
})();

const state = { ...initialState, ...saved };
if (!state.publishedSlug) state.published = false;
let toastTimer;

const persist = () => {
  try {
    localStorage.setItem('annotated-demo', JSON.stringify({
      activeView: state.activeView,
      sourceType: state.sourceType,
      sourceUrl: state.sourceUrl,
      clipStart: state.clipStart,
      clipEnd: state.clipEnd,
      commentary: state.commentary,
      commentaryMode: state.commentaryMode,
      recordedAudio: state.recordedAudio,
      published: state.published,
      publishedSlug: state.publishedSlug,
      customSource: state.customSource,
    }));
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

const setSource = (type) => {
  state.sourceType = type;
  state.sourceUrl = sourceData[type].url;
  state.customSource = null;
  if (type === 'video') { state.clipStart = 14; state.clipEnd = 62; }
  if (type === 'podcast') { state.clipStart = 10; state.clipEnd = 64; }
  if (type === 'article') { state.clipStart = 0; state.clipEnd = 0; }
  state.showSourceInput = false;
  persist();
  render();
};

const source = () => state.customSource || sourceData[state.sourceType];

const annotationToFeedItem = (annotation) => {
  const type = sourceLabels[annotation.sourceType] || 'Source';
  const comments = Array.isArray(annotation.comments) ? annotation.comments.length : 0;
  return {
    type,
    label: type,
    initials: 'TB',
    author: 'Tom Ballard',
    handle: '@tcballard',
    time: 'just now',
    host: annotation.sourceHost || (() => { try { return new URL(annotation.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'source'; } })(),
    sourceUrl: annotation.sourceUrl,
    url: annotation.url,
    duration: formatTime(Math.max(0, Number(annotation.clipEnd) - Number(annotation.clipStart))),
    quote: annotation.sourceExcerpt || annotation.commentary || 'A moment kept with its context.',
    title: annotation.sourceTitle,
    commentary: annotation.commentary || 'An audio annotation attached to this moment.',
    likes: Number(annotation.likes) || 0,
    comments,
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
  state.clipStart = Number(annotation.clipStart) || 0;
  state.clipEnd = Number(annotation.clipEnd) || 0;
  state.commentary = annotation.commentary || '';
  state.commentaryMode = annotation.commentaryMode || 'text';
  state.recordedAudio = state.commentaryMode === 'audio';
};

const bootstrap = async () => {
  const routeMatch = window.location.pathname.match(/^\/a\/([^/]+)/);
  if (routeMatch) {
    state.publishedSlug = decodeURIComponent(routeMatch[1]);
    state.activeView = 'published';
  }
  try {
    await api.health();
    state.serverStatus = 'online';
    if (state.publishedSlug) {
      const { annotation } = await api.getAnnotation(state.publishedSlug);
      hydrateAnnotation(annotation);
    }
    const { annotations } = await api.feed();
    state.feedAnnotations = annotations || [];
  } catch (error) {
    state.serverStatus = 'offline';
    state.serverError = error.message;
  }
  render();
};

const icon = (name, className = '') => `<span class="icon ${className}">${icons[name] || ''}</span>`;

const button = (label, action, className = '', extra = '') => `<button class="${className}" data-action="${action}" ${extra}>${label}</button>`;

const sourceTypeButton = (type) => {
  const item = sourceData[type];
  return `<button class="source-type ${state.sourceType === type ? 'is-active' : ''}" data-action="source-type" data-type="${type}" aria-pressed="${state.sourceType === type}">${icon(type)}<span>${item.label}</span></button>`;
};

const appHeader = () => `
  <header class="app-header">
    <div class="brand-lockup">
      <button class="brand-mark" data-action="set-view" data-view="capture" aria-label="Go to capture"><span>a</span></button>
      <div>
        <div class="brand-name">annotated<span class="brand-dot">.</span></div>
        <div class="brand-caption">keep the moment · add the meaning</div>
      </div>
    </div>
    <nav class="primary-nav" aria-label="Primary navigation">
      ${button('Capture', 'set-view', `nav-link ${state.activeView === 'capture' ? 'is-active' : ''}`, 'data-view="capture"')}
      ${button('Discover', 'set-view', `nav-link ${state.activeView === 'feed' ? 'is-active' : ''}`, 'data-view="feed"')}
      ${button('My annotation', 'set-view', `nav-link ${state.activeView === 'published' ? 'is-active' : ''}`, 'data-view="published"')}
    </nav>
    <div class="header-actions">
      <span class="connection-status"><span class="status-dot ${state.serverStatus === 'offline' ? 'is-offline' : ''}"></span> ${state.serverStatus === 'online' ? 'Live backend' : state.serverStatus === 'checking' ? 'Connecting…' : 'Backend offline'}</span>
      <button class="avatar" data-action="profile" aria-label="Open profile">TB</button>
    </div>
  </header>`;

const appRail = () => `
  <aside class="app-rail" aria-label="Workspace summary">
    <div class="rail-kicker">Your library</div>
    <div class="rail-stat"><strong>${state.published ? '01' : '00'}</strong><span>published<br>annotations</span></div>
    <div class="rail-rule"></div>
    <div class="rail-kicker">The rule</div>
    <p class="rail-note">Every clip keeps a live link to where it came from.</p>
    <div class="rail-source"><span class="source-glyph">${icon(state.sourceType)}</span><span>${source().host}</span></div>
    <div class="rail-bottom">v0.2 local slice<br>Chrome sidebar-first</div>
  </aside>`;

const browserChrome = () => `
  <div class="browser-chrome">
    <div class="traffic-lights"><i></i><i></i><i></i></div>
    <div class="browser-tabs"><span class="browser-tab is-active"><span class="tab-favicon">${state.sourceType === 'video' ? '▶' : state.sourceType === 'article' ? 'V' : '◉'}</span>${escapeHTML(source().host)}</span><span class="browser-tab muted">new tab</span></div>
    <div class="browser-toolbar"><span>‹</span><span>›</span><span>↻</span><div class="address-bar">${escapeHTML(state.sourceUrl)}</div><span>☆</span><span>⋮</span></div>
  </div>`;

const videoCanvas = () => `
  <div class="media-canvas video-canvas">
    <div class="video-backdrop"><div class="video-silhouette"></div><div class="video-shelf shelf-one"></div><div class="video-shelf shelf-two"></div><div class="video-window"></div></div>
    <div class="media-overline"><span>${icon('video')} VIDEO ESSAY</span><span>J-CAL CONVERSATIONS</span></div>
    <button class="hero-play" data-action="toggle-preview" aria-label="Play source preview">${icon('play')}</button>
    <div class="media-caption"><span>“The future is built by people who keep asking why.”</span><small>06:08</small></div>
    <div class="media-player"><span class="player-time">${formatTime(state.clipStart)}</span><div class="player-line"><span class="player-progress" style="width: 24%"></span></div><span class="player-time">06:08</span></div>
  </div>`;

const articleCanvas = () => `
  <div class="media-canvas article-canvas">
    <div class="article-topline"><span>${icon('article')} THE VERGE</span><span>TECH · OPINION</span></div>
    <h3>The internet is becoming a place you can’t search</h3>
    <p class="article-dek">We used to browse toward a question. Now the answer arrives first, and the path disappears.</p>
    <div class="article-meta">By David Pierce <span>·</span> 2h ago</div>
    <div class="article-body-lines"><i></i><i></i><i class="short"></i><i></i><i></i><i class="short"></i></div>
    <blockquote>“The most valuable part of a link is often the part that doesn’t fit in the answer.”</blockquote>
    <div class="article-highlight">${icon('text')} Highlighted passage ready to clip</div>
  </div>`;

const podcastCanvas = () => `
  <div class="media-canvas podcast-canvas">
    <div class="podcast-orbit"><span></span><span></span><span></span></div>
    <div class="podcast-copy"><div class="media-overline"><span>${icon('podcast')} DECODER RING</span><span>EPISODE 142</span></div><h3>The quiet advantage of paying attention</h3><p>A small moment from a long conversation, pulled out because it stayed with you.</p></div>
    <div class="waveform" aria-hidden="true">${Array.from({ length: 42 }, (_, i) => `<i style="height:${18 + ((i * 17) % 54)}%"></i>`).join('')}</div>
    <div class="media-player"><span class="player-time">${formatTime(state.clipStart)}</span><div class="player-line"><span class="player-progress" style="width: 24%"></span></div><span class="player-time">46:04</span></div>
  </div>`;

const sourceCanvas = () => {
  const canvas = state.sourceType === 'video' ? videoCanvas() : state.sourceType === 'article' ? articleCanvas() : podcastCanvas();
  return `<section class="source-stage">
    <div class="stage-header"><div><span class="eyebrow">Active tab</span><h1>${escapeHTML(source().title)}</h1></div><button class="ghost-button" data-action="toggle-source-input">${icon('link')} Change source</button></div>
    ${state.showSourceInput ? `<div class="source-input-row"><label for="source-url">Paste a source URL</label><div class="source-input-wrap">${icon('link')}<input id="source-url" data-action="source-url" value="${escapeHTML(state.sourceUrl)}" /><button data-action="load-source" ${state.isResolvingSource ? 'disabled' : ''}>${state.isResolvingSource ? 'Resolving…' : 'Load'}</button></div><p>Live resolver: metadata is fetched server-side and kept attached to the original URL.</p></div>` : ''}
    <div class="browser-frame">${browserChrome()}<div class="browser-page">${canvas}</div></div>
    <div class="source-footer"><div><span class="source-pill">${icon(state.sourceType)} ${source().label}</span><span class="source-byline">${escapeHTML(source().author)} <span>·</span> ${escapeHTML(source().date)}</span></div><a href="${escapeHTML(source().url)}" target="_blank" rel="noreferrer" class="source-link">Open original ${icon('external')}</a></div>
  </section>`;
};

const timeRange = () => {
  if (state.sourceType === 'article') return `<div class="highlight-preview"><div class="highlight-mark"></div><p>“${escapeHTML(source().excerpt || 'The most valuable part of a link is often the part that doesn’t fit in the answer.') }”</p><span>Highlight selected · ${source().excerpt ? `${source().excerpt.length} characters` : '126 characters'}</span></div>`;
  const max = state.sourceType === 'podcast' ? 90 : 90;
  const length = Math.max(0, state.clipEnd - state.clipStart);
  return `<div class="clip-editor">
    <div class="clip-editor-head"><span>${icon(state.sourceType)} Select a moment</span><strong class="duration-badge ${length > 90 ? 'is-warning' : ''}">${formatTime(length)} / 1:30 max</strong></div>
    <div class="range-track"><span class="range-fill" style="left:${(state.clipStart / max) * 100}%; width:${((state.clipEnd - state.clipStart) / max) * 100}%"></span><input aria-label="Clip start" type="range" min="0" max="90" value="${state.clipStart}" data-action="clip-start" /><input aria-label="Clip end" type="range" min="0" max="90" value="${state.clipEnd}" data-action="clip-end" /></div>
    <div class="time-fields"><label>Start <input type="number" min="0" max="90" value="${state.clipStart}" data-action="clip-start-number" /></label><span>→</span><label>End <input type="number" min="0" max="90" value="${state.clipEnd}" data-action="clip-end-number" /></label></div>
  </div>`;
};

const commentaryEditor = () => `
  <div class="commentary-editor">
    <div class="commentary-head"><span>Your annotation</span><div class="mode-switch" role="group" aria-label="Commentary type">${button(`${icon('text')} Text`, 'commentary-mode', state.commentaryMode === 'text' ? 'mode-button is-active' : 'mode-button', 'data-mode="text"')}${button(`${icon('mic')} Audio`, 'commentary-mode', state.commentaryMode === 'audio' ? 'mode-button is-active' : 'mode-button', 'data-mode="audio"')}</div></div>
    ${state.commentaryMode === 'text' ? `<textarea data-action="commentary" placeholder="What stayed with you? Add the context the original clip is missing...">${escapeHTML(state.commentary)}</textarea><div class="editor-foot"><span>${state.commentary.length}/280</span><span>Visible on the public page</span></div>` : `<div class="audio-recorder ${state.isRecording ? 'is-recording' : ''}"><button class="record-button" data-action="toggle-record" aria-label="${state.isRecording ? 'Stop recording' : 'Start recording'}">${icon(state.isRecording ? 'pause' : 'mic')}</button><div><strong>${state.isRecording ? 'Recording your take…' : state.recordedAudio ? 'Audio note ready' : 'Record a 90-second take'}</strong><span>${state.isRecording ? 'Tap to stop' : state.recordedAudio ? 'You can replace it before publishing' : 'Say the thing you want to remember'}</span></div><span class="audio-duration">${state.recordedAudio ? '0:18' : '0:00'}</span></div>`}
  </div>`;

const sidebar = () => `
  <aside class="extension-sidebar" aria-label="Annotated capture sidebar">
    <div class="sidebar-brand"><div class="mini-mark">a</div><div><strong>annotated</strong><span>SIDEBAR</span></div><button class="icon-button" data-action="sidebar-help" aria-label="Sidebar help">${icon('more')}</button></div>
    <div class="sidebar-rule"></div>
    <div class="sidebar-heading"><div><span class="eyebrow">Capture from this page</span><h2>Keep the moment.</h2></div><span class="capture-number">01</span></div>
    <div class="source-type-grid" role="group" aria-label="Source type">${sourceTypeButton('video')}${sourceTypeButton('article')}${sourceTypeButton('podcast')}</div>
    <div class="sidebar-source"><div class="sidebar-source-icon">${icon(state.sourceType)}</div><div><strong>${escapeHTML(source().title)}</strong><span>${escapeHTML(source().host)} · <a href="${escapeHTML(source().url)}" target="_blank" rel="noreferrer">source link</a></span></div></div>
    ${timeRange()}
    ${commentaryEditor()}
    <button class="publish-button" data-action="publish" ${state.isPublishing ? 'disabled' : ''}>${state.isPublishing ? 'Publishing…' : state.published ? `${icon('check')} Published` : 'Publish annotation'}<span>${state.isPublishing ? '…' : state.published ? '↗' : icon('arrow')}</span></button>
    <p class="privacy-note"><span class="status-dot"></span> ${state.published ? 'Published with a permanent source link.' : 'Nothing is published until you choose to publish.'}</p>
  </aside>`;

const captureView = () => `
  <div class="view-head"><div><span class="eyebrow">The capture desk</span><h2>Turn a passing moment into a point of view.</h2></div><span class="view-index">01 / 03</span></div>
  <div class="capture-layout">${sourceCanvas()}${sidebar()}</div>
  <div class="capture-footnote"><span>Drag the handles in the sidebar to choose the exact moment.</span><span>Max 90 seconds · video downscaled to 240p</span></div>`;

const feedCard = (item, index) => {
  const sourceHref = escapeHTML(item.sourceUrl || '#');
  return `
  <article class="feed-card ${index === 0 ? 'featured-card' : ''}">
    <div class="feed-card-top"><span class="source-pill">${icon(item.type.toLowerCase())} ${item.label}</span><button class="icon-button" aria-label="More options">${icon('more')}</button></div>
    <div class="feed-source-row"><div class="feed-avatar avatar-${index}">${item.initials}</div><div><strong>${item.author}</strong><span>${item.handle} · ${item.time}</span></div><button class="follow-button ${state.following && index === 0 ? 'is-following' : ''}" data-action="toggle-follow">${state.following && index === 0 ? 'Following' : 'Follow'}</button></div>
    ${item.type === 'Video' ? `<div class="feed-media feed-video"><div class="feed-video-shade"></div><button class="feed-play" aria-label="Play clip" data-action="play-feed">${icon('play')}</button><span class="feed-duration">${item.duration}</span></div>` : item.type === 'Article' ? `<div class="feed-media feed-quote"><span>“</span><p>${item.quote}</p><small>Highlight from ${item.host}</small></div>` : `<div class="feed-media feed-audio"><div class="feed-audio-art">${icon('podcast')}</div><div class="mini-wave">${Array.from({ length: 25 }, (_, i) => `<i style="height:${16 + ((i * 23) % 50)}%"></i>`).join('')}</div><span class="feed-duration">${item.duration}</span></div>`}
    <h3>${item.title}</h3><p class="feed-commentary">${item.commentary}</p>
    <div class="feed-source-link"><span>${icon('link')} From ${escapeHTML(item.host)}</span><a href="${sourceHref}" ${item.sourceUrl ? 'target="_blank" rel="noreferrer"' : ''} data-action="open-original">Open source ${icon('external')}</a></div>
    <div class="feed-actions"><button data-action="toggle-like" class="feed-action ${state.liked && index === 0 ? 'is-liked' : ''}">${icon('heart')} <span>${item.likes + (state.liked && index === 0 ? 1 : 0)}</span></button><button data-action="focus-comment" class="feed-action">${icon('message')} <span>${item.comments + (index === 0 ? state.comments - 12 : 0)}</span></button><button class="feed-action share-action" data-action="share">${icon('link')} Share</button></div>
    ${index === 0 ? `<form class="comment-row" data-action="comment-form"><input aria-label="Add a comment" placeholder="Add a considered comment…" value="${escapeHTML(state.commentDraft)}" data-action="comment-draft" /><button aria-label="Post comment">${icon('arrow')}</button></form>` : ''}
  </article>`;
};

const feedItems = [
  { type: 'Video', label: 'Video', initials: 'RM', author: 'Rhea Morgan', handle: '@rheamorgan', time: '18m', host: 'youtube.com', duration: '0:48', title: 'The part about leverage is the part I keep replaying.', commentary: 'Everyone talks about speed. The useful distinction is knowing which decisions deserve slowness.', likes: 86, comments: 12 },
  { type: 'Article', label: 'Article', initials: 'AK', author: 'Alex Kim', handle: '@alexkim', time: '1h', host: 'theverge.com', quote: 'The most valuable part of a link is often the part that does not fit in the answer.', title: 'A good highlight leaves a trail back to the whole argument.', commentary: 'The context is the point. Without the source, this is just a nice sentence.', likes: 41, comments: 7 },
  { type: 'Podcast', label: 'Podcast', initials: 'JS', author: 'Jamie Singh', handle: '@jamiesingh', time: '3h', host: 'overcast.fm', duration: '1:02', title: 'A useful definition of attention.', commentary: 'Not concentration. More like the willingness to let something change your mind.', likes: 29, comments: 4 },
];

const feedView = () => `
  <div class="view-head feed-head"><div><span class="eyebrow">Public feed</span><h2>What people kept.</h2><p>A stream of moments with enough context to be worth opening.</p></div><div class="feed-controls"><button class="filter-button is-active">Following</button><button class="filter-button">For you</button><button class="search-button" data-action="search" aria-label="Search feed">${icon('search')}</button></div></div>
  <div class="feed-layout"><main class="feed-list">${(state.feedAnnotations.length ? state.feedAnnotations.map(annotationToFeedItem) : feedItems).map(feedCard).join('')}</main><aside class="feed-aside"><div class="aside-card profile-card"><div class="profile-top"><div class="profile-avatar">TB</div><span class="profile-stamp">LIVE</span></div><h3>Tom Ballard</h3><p>Collecting the moments that deserve a second look.</p><div class="profile-metrics"><span><strong>${state.feedAnnotations.length || (state.published ? '1' : '0')}</strong> annotations</span><span><strong>24</strong> following</span></div><button class="dark-button" data-action="set-view" data-view="published">View your page ${icon('arrow')}</button></div><div class="aside-card rule-card"><span class="eyebrow">The annotated rule</span><h3>A clip without its source is just a rumour.</h3><div class="rule-line"></div><p>Every public page points back to the original. Context travels with the moment.</p></div></aside></div>`;

const publishedView = () => {
  const publishedSource = source();
  const publishedComments = state.publishedAnnotation?.comments || [];
  const publicUrl = state.publishedAnnotation?.url || (state.publishedSlug ? `${window.location.origin}/a/${encodeURIComponent(state.publishedSlug)}` : '');
  const publicLabel = publicUrl ? publicUrl.replace(/^https?:\/\//, '') : 'annotation link unavailable';
  const hasNote = Boolean((state.publishedAnnotation?.commentary || state.commentary).trim()) || state.recordedAudio;
  return `
    <div class="view-head published-head"><div><span class="eyebrow">Your public page</span><h2>${state.published ? 'The moment, with your margin note.' : 'Your first annotation is waiting.'}</h2><p>${state.published ? 'A permanent link back to the source, with the context only you could add.' : 'Capture something from the page you are on, then publish it here.'}</p></div>${state.published ? `<button class="ghost-button" data-action="set-view" data-view="capture">${icon('back')} Capture another</button>` : ''}</div>
    ${state.published ? `<div class="annotation-layout"><article class="annotation-page"><div class="annotation-page-bar"><span class="source-pill">${icon(state.sourceType)} ${publishedSource.label}</span><span>Published just now</span></div><div class="annotation-hero ${state.sourceType}">${state.sourceType === 'video' ? `<div class="annotation-video-bg"><div class="video-silhouette small"></div></div><button class="annotation-play" data-action="toggle-preview">${icon('play')}</button><span class="annotation-clip-time">${formatTime(state.clipStart)} — ${formatTime(state.clipEnd)}</span>` : state.sourceType === 'article' ? `<div class="annotation-article-text"><span class="quote-mark">“</span><p>${escapeHTML(publishedSource.excerpt || 'The most valuable part of a link is often the part that doesn’t fit in the answer.')}</p><span>Highlighted passage</span></div>` : `<div class="annotation-audio"><div class="podcast-orbit small"><span></span><span></span><span></span></div>${icon('play')}<div class="mini-wave large">${Array.from({ length: 34 }, (_, i) => `<i style="height:${16 + ((i * 19) % 58)}%"></i>`).join('')}</div></div>`}</div><div class="annotation-body"><div class="annotation-byline"><div class="feed-avatar avatar-0">TB</div><div><strong>Tom Ballard</strong><span>@tcballard · just now</span></div><button class="icon-button" aria-label="More options">${icon('more')}</button></div><h3>${escapeHTML(publishedSource.title)}</h3>${hasNote ? `<p class="annotation-copy">${state.publishedAnnotation?.commentary ? escapeHTML(state.publishedAnnotation.commentary) : state.commentary ? escapeHTML(state.commentary) : 'An audio annotation attached to this moment.'}</p>` : '<p class="annotation-copy empty-copy">No commentary added.</p>'}<div class="source-citation"><span>${icon('link')} Source</span><a href="${escapeHTML(publishedSource.url)}" target="_blank" rel="noreferrer">${escapeHTML(publishedSource.host)} ${icon('external')}</a></div></div><div class="annotation-actions"><button data-action="toggle-like" class="feed-action ${state.liked ? 'is-liked' : ''}">${icon('heart')} ${state.liked ? 'Liked' : 'Like'}</button><button class="feed-action" data-action="focus-comment">${icon('message')} ${publishedComments.length} comments</button><button class="feed-action" data-action="share">${icon('link')} Copy link</button></div><div class="annotation-comments">${publishedComments.length ? publishedComments.map((comment) => `<div class="commenter-avatar">TB</div><p><strong>@${escapeHTML(comment.authorId === 'local-tom' ? 'tcballard' : comment.authorId)}</strong> ${escapeHTML(comment.body)}</p>`).join('') : '<p class="empty-copy">No comments yet. Add the first considered response.</p>'}</div><form class="comment-row annotation-comment-row" data-action="comment-form"><input aria-label="Add a comment" placeholder="Add a considered comment…" value="${escapeHTML(state.commentDraft)}" data-action="comment-draft" /><button aria-label="Post comment">${icon('arrow')}</button></form></article><aside class="annotation-aside"><div class="claim-card"><span class="eyebrow">Source & rights</span><h3>Something wrong with this annotation?</h3><p>Every page keeps the source visible. If this clip misuses your work, file a claim and we’ll review it.</p><button class="claim-button" data-action="toggle-claim">File a claim ${icon('arrow')}</button></div><div class="share-card"><span class="eyebrow">Share this page</span><div class="share-url"><strong>${escapeHTML(publicLabel)}</strong><button data-action="copy-link" aria-label="Copy page link">${icon('link')}</button></div><p>It opens with the clip, the source, and the note.</p></div></aside></div>` : `<div class="empty-published"><div class="empty-symbol">a<span>.</span></div><h3>Nothing published yet.</h3><p>Start with the page you are already reading. The sidebar will do the rest.</p><button class="dark-button" data-action="set-view" data-view="capture">Open capture desk ${icon('arrow')}</button></div>`}
    ${state.claimOpen ? claimModal() : ''}`;
};

const claimModal = () => `<div class="modal-backdrop" data-action="toggle-claim"><div class="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title" data-stop-click="true"><button class="icon-button modal-close" data-action="toggle-claim" aria-label="Close claim form">${icon('close')}</button><span class="eyebrow">Source & rights</span><h3 id="claim-title">File a claim</h3><p>Tell us what is wrong with this annotation. We’ll keep your report attached to the source page.</p><label>What should we review?<textarea placeholder="Describe the issue…" data-action="claim-text">${escapeHTML(state.claimReason)}</textarea></label><button class="dark-button full-button" data-action="submit-claim">Send claim ${icon('arrow')}</button></div></div>`;

const toast = () => state.toast ? `<div class="toast" role="status"><span class="toast-icon">${icon('check')}</span>${escapeHTML(state.toast)}</div>` : '';

const render = () => {
  app.innerHTML = `${appHeader()}<div class="app-body">${appRail()}<main class="main-content">${state.activeView === 'capture' ? captureView() : state.activeView === 'feed' ? feedView() : publishedView()}</main></div>${toast()}`;
};

const ensureClipBounds = () => {
  state.clipStart = Math.max(0, Math.min(90, Number(state.clipStart) || 0));
  state.clipEnd = Math.max(0, Math.min(90, Number(state.clipEnd) || 0));
  if (state.clipEnd < state.clipStart) [state.clipStart, state.clipEnd] = [state.clipEnd, state.clipStart];
};

const refreshFeed = async () => {
  if (state.serverStatus !== 'online') return;
  try {
    const { annotations } = await api.feed();
    state.feedAnnotations = annotations || [];
  } catch { /* the capture flow should remain usable when feed loading fails */ }
};

const loadSource = async () => {
  const url = state.sourceUrl.trim();
  if (!url) { notify('Paste a source URL first.'); return; }
  if (state.serverStatus !== 'online') { notify('Backend unavailable — source resolution is not connected.'); return; }
  state.isResolvingSource = true;
  render();
  try {
    const { source: resolved } = await api.resolveSource(url);
    state.customSource = normalizeSource(resolved);
    state.sourceType = resolved.sourceType;
    state.sourceUrl = resolved.sourceUrl;
    if (state.sourceType === 'article') {
      state.clipStart = 0;
      state.clipEnd = 0;
    } else {
      state.clipStart = 0;
      state.clipEnd = 60;
    }
    state.showSourceInput = false;
    state.isResolvingSource = false;
    persist();
    notify(`Resolved ${state.customSource.host || 'source'} — ready to annotate.`);
  } catch (error) {
    state.isResolvingSource = false;
    render();
    notify(error.message || 'Source could not be resolved.');
  }
};

const publishAnnotation = async () => {
  if (state.published) {
    state.activeView = 'published';
    render();
    return;
  }
  if (state.sourceType !== 'article' && state.clipEnd - state.clipStart > 90) { notify('Keep the clip under 90 seconds.'); return; }
  if (state.commentaryMode === 'audio') { notify('Audio publishing is coming with the media worker. Use a text note for this pass.'); return; }
  if (!state.commentary.trim()) { notify('Add a note before publishing.'); return; }
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
      sourceExcerpt: currentSource.excerpt || (state.sourceType === 'article' ? 'The most valuable part of a link is often the part that does not fit in the answer.' : ''),
      clipStart: state.clipStart,
      clipEnd: state.clipEnd,
      commentary: state.commentary,
      commentaryMode: 'text',
    });
    hydrateAnnotation(annotation);
    state.activeView = 'published';
    state.isPublishing = false;
    await refreshFeed();
    persist();
    notify('Published with a permanent source link.');
  } catch (error) {
    state.isPublishing = false;
    render();
    notify(error.message || 'Annotation could not be published.');
  }
};

const copyPublicLink = async () => {
  const link = state.publishedAnnotation?.url || (state.publishedSlug ? `${window.location.origin}/a/${encodeURIComponent(state.publishedSlug)}` : '');
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
    if (state.serverStatus !== 'online') { notify('Backend unavailable — comment not posted.'); return; }
    try {
      const { annotation } = await api.addComment(state.publishedSlug, body);
      state.publishedAnnotation = annotation;
      state.commentDraft = '';
      notify('Comment added to the conversation.');
    } catch (error) {
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
  if (!reason) { notify('Tell us what should be reviewed.'); return; }
  if (!state.publishedSlug || state.serverStatus !== 'online') { notify('Backend unavailable — claim not submitted.'); return; }
  try {
    await api.fileClaim(state.publishedSlug, reason);
    state.claimReason = '';
    state.claimOpen = false;
    notify('Claim received. We’ll review the source.');
  } catch (error) {
    notify(error.message || 'Claim could not be submitted.');
  }
};

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (target.dataset.stopClick === 'true') return;
  if (action === 'set-view') { state.activeView = target.dataset.view; persist(); render(); return; }
  if (action === 'source-type') { setSource(target.dataset.type); return; }
  if (action === 'toggle-source-input') { state.showSourceInput = !state.showSourceInput; render(); return; }
  if (action === 'load-source') { loadSource(); return; }
  if (action === 'commentary-mode') { state.commentaryMode = target.dataset.mode; state.isRecording = false; persist(); render(); return; }
  if (action === 'toggle-record') {
    state.isRecording = !state.isRecording;
    if (!state.isRecording) state.recordedAudio = true;
    render();
    return;
  }
  if (action === 'publish') { publishAnnotation(); return; }
  if (action === 'toggle-like') { state.liked = !state.liked; render(); return; }
  if (action === 'toggle-follow') { state.following = !state.following; render(); return; }
  if (action === 'focus-comment') { document.querySelector('[data-action="comment-draft"]')?.focus(); return; }
  if (action === 'share' || action === 'copy-link') { copyPublicLink(); return; }
  if (action === 'open-original') { if (target.getAttribute('href') === '#') { event.preventDefault(); notify('Original source link preserved.'); } return; }
  if (action === 'toggle-claim') { state.claimOpen = !state.claimOpen; render(); return; }
  if (action === 'submit-claim') { submitClaim(); return; }
  if (action === 'profile') { notify('Profile controls arrive in the next pass.'); return; }
  if (action === 'sidebar-help') { notify('Annotated keeps a source link on every public page.'); return; }
  if (action === 'toggle-preview') { notify('Preview playback is represented in this prototype.'); return; }
  if (action === 'play-feed') { notify('Clip playback is represented in this prototype.'); return; }
  if (action === 'search') { notify('Feed search is ready for the backend connection.'); return; }
});

app.addEventListener('input', (event) => {
  const action = event.target.dataset.action;
  if (action === 'commentary') {
    state.commentary = event.target.value.slice(0, 280);
    const count = event.target.parentElement?.querySelector('.editor-foot span');
    if (count) count.textContent = `${state.commentary.length}/280`;
  }
  if (action === 'comment-draft') state.commentDraft = event.target.value;
  if (action === 'claim-text') state.claimReason = event.target.value;
  if (action === 'source-url') { state.sourceUrl = event.target.value; state.customSource = null; }
  if (action === 'clip-start') { state.clipStart = Number(event.target.value); ensureClipBounds(); render(); }
  if (action === 'clip-end') { state.clipEnd = Number(event.target.value); ensureClipBounds(); render(); }
});

app.addEventListener('change', (event) => {
  const action = event.target.dataset.action;
  if (action === 'clip-start-number') { state.clipStart = Number(event.target.value); ensureClipBounds(); persist(); render(); }
  if (action === 'clip-end-number') { state.clipEnd = Number(event.target.value); ensureClipBounds(); persist(); render(); }
});

app.addEventListener('submit', (event) => {
  if (event.target.dataset.action === 'comment-form') {
    event.preventDefault();
    submitComment();
  }
});

render();
bootstrap();
