// k6 load script for the annotated HTTP API.
//
//   k6 run load/k6-annotated.js -e BASE_URL=http://127.0.0.1:8788 -e PROFILE=smoke
//
// Arrival-rate executors throughout: the request rate is held even when the
// server slows, so a degrading server cannot throttle its own test. Traffic
// mix, stages, and thresholds come from load/config.json; thresholds default
// to the budgets in docs/PERFORMANCE.md — change them there first.
//
// Safety rail: refuses the canonical staging host. Staging is the evidence
// environment (docs/RELEASE.md) and is never load-tested.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const CANONICAL_STAGING_HOST = 'annotated-staging.up.railway.app';
const config = JSON.parse(open('./config.json'));

const BASE_URL = __ENV.BASE_URL || '';
if (!BASE_URL) throw new Error('BASE_URL is required (-e BASE_URL=...). Never point it at canonical staging.');
const baseHost = BASE_URL.replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase();
if (baseHost === CANONICAL_STAGING_HOST) {
  throw new Error(`Refusing to run: ${CANONICAL_STAGING_HOST} is the evidence environment and is never load-tested (see load/RUNBOOK.md).`);
}

const profileName = __ENV.PROFILE || 'smoke';
const profile = config.profiles[profileName];
if (!profile) throw new Error(`Unknown PROFILE "${profileName}". Available: ${Object.keys(config.profiles).join(', ')}`);

const mix = config.mix;
const mixTotal = Object.values(mix).reduce((sum, value) => sum + value, 0);
const needsActors = (mix.like || 0) + (mix.publish || 0) > 0;

const actors = new SharedArray('actors', () => {
  try {
    return JSON.parse(open('./actors.json')).actors || [];
  } catch (error) {
    return [];
  }
});

const rateLimited = new Counter('rate_limited_429');
const serverErrors = new Counter('server_errors_5xx');

// One scenario per config stage-block; the automatic `scenario` tag scopes
// thresholds so the warm-up never gates the run.
const scenarios = {};
const thresholds = {};
const maxRate = Math.max(...Object.values(config.profiles).flatMap((p) => p.scenarios.flatMap((s) => s.stages.map((stage) => stage.target))));
for (const scenario of profile.scenarios) {
  scenarios[scenario.name] = {
    executor: 'ramping-arrival-rate',
    exec: 'traffic',
    startTime: scenario.startTime,
    startRate: scenario.stages[0].target,
    timeUnit: '1s',
    stages: scenario.stages,
    preAllocatedVUs: Math.min(500, Math.max(20, Math.ceil(scenario.stages.at(-1).target / 2))),
    maxVUs: Math.min(3000, Math.max(100, scenario.stages.at(-1).target * 2)),
  };
  if (scenario.enforceThresholds) {
    const t = config.thresholds;
    thresholds[`http_req_duration{name:feed,scenario:${scenario.name}}`] = [`p(95)<${t.feed_p95_ms}`];
    thresholds[`http_req_duration{name:permalink,scenario:${scenario.name}}`] = [`p(95)<${t.permalink_p95_ms}`];
    thresholds[`http_req_duration{name:oembed,scenario:${scenario.name}}`] = [`p(95)<${t.oembed_p95_ms}`];
    thresholds[`http_req_duration{name:search,scenario:${scenario.name}}`] = [`p(95)<${t.search_p95_ms}`];
    if (mix.like) thresholds[`http_req_duration{name:like,scenario:${scenario.name}}`] = [`p(95)<${t.like_p95_ms}`];
    if (mix.publish) thresholds[`http_req_duration{name:publish,scenario:${scenario.name}}`] = [`p(95)<${t.publish_p95_ms}`];
    thresholds['server_errors_5xx'] = [`count<=${t.max_5xx}`];
  }
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: false,
  // The report renders p50/p95/p99; k6 only exports the stats named here.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
};

const jsonHeaders = { 'content-type': 'application/json' };
const bearer = (actor) => ({ headers: { ...jsonHeaders, authorization: `Bearer ${actor.token}` } });

export function setup() {
  if (needsActors && actors.length === 0) {
    fail('actors.json is missing or empty but the traffic mix includes mutations. Run: npm run load:actors (against the same database the target API uses).');
  }
  // Collect a real corpus from the deployed feed. Thin corpus means the test
  // would measure cold caches and empty indexes, not the product.
  const corpus = [];
  let cursor = '';
  for (let page = 0; page < 5 && corpus.length < 200; page += 1) {
    const url = `${BASE_URL}/api/feed?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = http.get(url, { tags: { name: 'setup' } });
    if (response.status !== 200) fail(`Feed unreachable during setup: ${response.status} ${url}`);
    const body = response.json();
    for (const annotation of body.annotations || []) corpus.push({ id: annotation.id, slug: annotation.slug });
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  if (corpus.length < 10) {
    fail(`Corpus too thin (${corpus.length} annotations). Seed the load database first: LOAD_DATABASE_URL=... ALLOW_DESTRUCTIVE_LOAD=true npm run load:relational`);
  }
  return { corpus };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const record = (response) => {
  if (response.status === 429) rateLimited.add(1);
  if (response.status >= 500) serverErrors.add(1);
  return response;
};

// Per-VU keyset walk state. Every iteration performs exactly ONE HTTP
// request, so the scheduled arrival rate IS the request rate — the first
// harness version looped whole walks inside one iteration and quietly
// delivered ~2.6× the configured rate. A VU mid-walk continues its cursor
// chain; walks end at a random depth of 1–8 pages. The cursor is pulled with
// a cheap regex rather than a full JSON parse of a 30KB+ body.
let feedCursor = '';
let feedDepthLeft = 0;
const feedPage = () => {
  const url = `${BASE_URL}/api/feed?limit=${config.feedWalk.pageLimit}${feedCursor ? `&cursor=${encodeURIComponent(feedCursor)}` : ''}`;
  const response = record(http.get(url, { tags: { name: 'feed' } }));
  if (response.status !== 200) { feedCursor = ''; feedDepthLeft = 0; return; }
  if (feedDepthLeft <= 0) feedDepthLeft = config.feedWalk.minDepth + Math.floor(Math.random() * (config.feedWalk.maxDepth - config.feedWalk.minDepth + 1));
  feedDepthLeft -= 1;
  const match = String(response.body).match(/"nextCursor":"([^"]+)"/);
  feedCursor = feedDepthLeft > 0 && match ? match[1] : '';
};

const visitPermalink = (corpus) => {
  record(http.get(`${BASE_URL}/a/${pick(corpus).slug}`, { tags: { name: 'permalink' } }));
};

const visitOembed = (corpus) => {
  record(http.get(`${BASE_URL}/api/oembed?url=${encodeURIComponent(`${BASE_URL}/a/${pick(corpus).slug}`)}`, { tags: { name: 'oembed' } }));
};

const searchFeed = () => {
  record(http.get(`${BASE_URL}/api/feed?q=${encodeURIComponent(pick(config.searchTerms))}`, { tags: { name: 'search' } }));
};

const toggleLike = (corpus) => {
  const actor = actors[exec.vu.idInTest % actors.length];
  const target = pick(corpus);
  const action = exec.scenario.iterationInTest % 2 === 0 ? 'like' : 'unlike';
  const response = record(http.post(`${BASE_URL}/api/annotations/${target.id}/${action}`, '{}', { ...bearer(actor), tags: { name: 'like' } }));
  check(response, { 'like acknowledged': (r) => r.status === 200 || r.status === 429 });
};

const publishArticle = (corpus) => {
  const actor = actors[(exec.vu.idInTest * 7 + exec.scenario.iterationInTest) % actors.length];
  const unique = `${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`;
  const payload = JSON.stringify({
    sourceUrl: `https://example.com/load-articles/${unique}`,
    sourceType: 'article',
    sourceTitle: `Load article ${unique}`,
    sourceExcerpt: 'A bounded passage kept by the load harness so article validation passes.',
    commentaryMode: 'text',
    commentary: `Load-harness publish ${unique}.`,
    clientRequestId: `k6-${unique}`,
    visibility: 'public',
  });
  const response = record(http.post(`${BASE_URL}/api/annotations`, payload, { ...bearer(actor), tags: { name: 'publish' } }));
  // 201 created; 200 is the idempotent replay contract; 429 is the publish
  // bucket doing its job at high actor reuse — visible, never fatal.
  check(response, { 'publish acknowledged': (r) => r.status === 201 || r.status === 200 || r.status === 429 });
};

export function traffic(data) {
  const roll = Math.random() * mixTotal;
  let cumulative = 0;
  for (const [action, weight] of Object.entries(mix)) {
    cumulative += weight;
    if (roll < cumulative) {
      if (action === 'feed') return feedPage();
      if (action === 'permalink') return visitPermalink(data.corpus);
      if (action === 'oembed') return visitOembed(data.corpus);
      if (action === 'search') return searchFeed();
      if (action === 'like') return toggleLike(data.corpus);
      if (action === 'publish') return publishArticle(data.corpus);
    }
  }
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().slice(0, 10);
  const path = __ENV.SUMMARY_PATH || `load/out/${stamp}-${profileName}.summary.json`;
  return { [path]: JSON.stringify({ profile: profileName, baseHost, generatedAt: new Date().toISOString(), metrics: data.metrics, thresholds: options.thresholds }, null, 2), stdout: `\nSummary written to ${path}\n` };
}
