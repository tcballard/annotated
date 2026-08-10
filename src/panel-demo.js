import { captureDraftBlocker, normalizeCaptureDraft } from './capture-state.js';
import { formatTime } from './feed-item.js';

const fixtureUrl = (path) => `${globalThis.location?.origin || 'https://annotated.invalid'}${path}`;

export const PANEL_DEMO_FIXTURES = Object.freeze({
  article: {
    sourceUrl: fixtureUrl('/demo-fixtures/article.html'), sourceType: 'article', sourceTitle: 'How context changes what we remember', sourceHost: 'annotated controlled fixture',
    passage: 'A durable annotation preserves not only the note, but the exact evidence that caused it.', paragraph: 4,
  },
  video: {
    sourceUrl: fixtureUrl('/demo-fixtures/video.html'), sourceType: 'video', sourceTitle: 'Evidence, provenance, and trust', sourceHost: 'annotated controlled fixture', duration: 184,
  },
});

export const createPanelDemoState = () => ({ fixture: 'article', commentaryMode: 'text', commentary: '', relationType: 'response', clipStart: 0, clipEnd: 0, passageSelected: false, result: null, startedAt: Date.now() });

export const demoDraft = (state) => {
  const fixture = PANEL_DEMO_FIXTURES[state.fixture] || PANEL_DEMO_FIXTURES.article;
  return normalizeCaptureDraft({ ...fixture, sourceExcerpt: state.passageSelected ? fixture.passage : '', anchorParagraph: state.passageSelected ? fixture.paragraph : null, clipStart: state.clipStart, clipEnd: state.clipEnd, commentary: state.commentary, commentaryMode: state.commentaryMode, relationType: state.relationType });
};

export const applyPanelDemoAction = (state, action, value = '') => {
  const next = { ...state, result: null };
  if (action === 'demo-fixture') Object.assign(next, createPanelDemoState(), { fixture: value, startedAt: state.startedAt });
  if (action === 'demo-passage') next.passageSelected = true;
  if (action === 'demo-last30') { const duration = PANEL_DEMO_FIXTURES.video.duration; next.clipStart = duration - 30; next.clipEnd = duration; }
  if (action === 'demo-commentary-mode') next.commentaryMode = value === 'audio' ? 'audio' : 'text';
  if (action === 'demo-relation') next.relationType = value;
  if (action === 'demo-note') next.commentary = String(value).slice(0, 280);
  if (action === 'demo-reset') return createPanelDemoState();
  if (action === 'demo-publish') {
    const draft = demoDraft(next);
    const blocker = captureDraftBlocker(draft);
    if (!blocker) next.result = { ...draft, sourceTitle: PANEL_DEMO_FIXTURES[next.fixture].sourceTitle, sourceHost: PANEL_DEMO_FIXTURES[next.fixture].sourceHost, readOnly: true, elapsedSeconds: Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) };
  }
  return next;
};

export const panelDemoView = (state, escapeHTML) => {
  const fixture = PANEL_DEMO_FIXTURES[state.fixture];
  const draft = demoDraft(state);
  const blocker = captureDraftBlocker(draft);
  const selection = fixture.sourceType === 'article'
    ? `<button class="demo-source-action" data-action="demo-passage">${state.passageSelected ? '✓ Passage selected' : 'Select highlighted passage'}</button>${state.passageSelected ? `<blockquote>“${escapeHTML(fixture.passage)}”</blockquote>` : ''}`
    : `<div class="demo-timeline"><span>${formatTime(state.clipStart)}</span><div><i style="left:${state.clipStart / fixture.duration * 100}%;width:${Math.max(0, state.clipEnd - state.clipStart) / fixture.duration * 100}%"></i></div><span>${formatTime(fixture.duration)}</span></div><button class="demo-source-action" data-action="demo-last30">Last 30 seconds</button><span class="chip">${formatTime(state.clipStart)}–${formatTime(state.clipEnd)}</span>`;
  if (state.result) return `<div class="page single"><section class="panel-demo-shell"><div class="demo-kicker">Read-only demo result</div><h1>Your source-backed moment</h1><p class="note">${escapeHTML(state.result.commentary || 'Audio explanation selected')}</p><div class="demo-receipt"><b>${escapeHTML(state.result.sourceTitle)}</b><span>${escapeHTML(state.result.relationType.replace('_', ' '))} · exact ${state.result.sourceType === 'article' ? 'passage' : `${formatTime(state.result.clipStart)}–${formatTime(state.result.clipEnd)}`}</span><a href="${escapeHTML(state.result.sourceUrl)}" target="_blank" rel="noreferrer">Open controlled fixture ↗</a></div><p class="demo-disclosure">Nothing was published and no account was created. This preview uses the same capture-draft contract as the packaged extension.</p><button class="btn" data-action="demo-reset">Try another source</button><a class="ghost" href="/extension">Install when ready</a></section></div>`;
  return `<div class="page single"><section class="panel-demo-shell"><div class="demo-kicker">No install · controlled fixtures · nothing public</div><h1>Try the capture panel</h1><p class="capdek">Choose a source, mark the evidence, and add context. Sign-in only appears in the real product when you publish.</p><div class="demo-tabs" role="tablist" aria-label="Demo source"><button data-action="demo-fixture" data-value="article" aria-selected="${state.fixture === 'article'}">Article</button><button data-action="demo-fixture" data-value="video" aria-selected="${state.fixture === 'video'}">Video</button></div><article class="demo-fixture"><span class="livedot"></span><b>${escapeHTML(fixture.sourceTitle)}</b><small>${escapeHTML(fixture.sourceHost)} · controlled ${fixture.sourceType} fixture</small>${selection}</article><label class="demo-label">Relationship<select data-action="demo-relation"><option value="response">Response</option><option value="supports" ${state.relationType === 'supports' ? 'selected' : ''}>Supports</option><option value="challenges" ${state.relationType === 'challenges' ? 'selected' : ''}>Challenges</option><option value="adds_context" ${state.relationType === 'adds_context' ? 'selected' : ''}>Adds context</option><option value="corrects" ${state.relationType === 'corrects' ? 'selected' : ''}>Corrects</option></select></label><div class="mode-toggle"><button data-action="demo-commentary-mode" data-value="text" aria-pressed="${state.commentaryMode === 'text'}">Text</button><button data-action="demo-commentary-mode" data-value="audio" aria-pressed="${state.commentaryMode === 'audio'}">Audio</button></div>${state.commentaryMode === 'text' ? `<textarea class="cap-note" data-action="demo-note" maxlength="280" placeholder="What should travel with this evidence?">${escapeHTML(state.commentary)}</textarea>` : '<div class="demo-audio" role="status">Audio mode preview · microphone permission is never requested in the demo.</div>'}<button class="btn" data-action="demo-publish" ${blocker ? 'disabled' : ''}>Preview result</button><div class="cap-block" role="status">${escapeHTML(blocker || 'Ready — this creates a read-only preview.')}</div></section></div>`;
};
