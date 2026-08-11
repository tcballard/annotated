// Render a committed, comparable load report from run artefacts.
//
//   node load/report.mjs --k6 load/out/2026-08-10-soak.summary.json \
//     [--drain load/out/2026-08-10-drain.json] \
//     [--image <sha>] [--environment "Railway disposable, 2 vCPU"] \
//     [--cause "pg_stat_statements: feed keyset query at 71% total time"]
//
// Writes docs/load-reports/<date>-<profile>.md. Reports from different days
// share one template so they diff cleanly. Loopback runs are stamped as
// development-only: the repository's evidence discipline (docs/RELEASE.md)
// forbids publishing mislabelled loopback timings.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDir } from './guards.mjs';

const args = process.argv.slice(2);
const option = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const k6Path = option('--k6');
if (!k6Path) throw new Error('--k6 <summary.json> is required (written by every k6 run via handleSummary).');
const summary = JSON.parse(readFileSync(k6Path, 'utf8'));
const drain = option('--drain') ? JSON.parse(readFileSync(option('--drain'), 'utf8')) : null;
const image = option('--image', (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })());
const environment = option('--environment', process.env.REPORT_ENVIRONMENT || 'unspecified');
const cause = option('--cause', '');

const isLoopback = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(summary.baseHost || '');
const profile = summary.profile || 'unknown';
const date = (summary.generatedAt || new Date().toISOString()).slice(0, 10);

const metric = (name) => summary.metrics?.[name] || null;
const durationRow = (label, tag) => {
  // k6 summary-export names submetrics `http_req_duration{name:feed,scenario:pass}`.
  const entries = Object.entries(summary.metrics || {}).filter(([key]) => key.startsWith('http_req_duration{') && key.includes(`name:${tag}`));
  if (!entries.length) return null;
  const rows = entries.map(([key, value]) => {
    const scenario = (key.match(/scenario:([a-z0-9_-]+)/i) || [])[1] || 'all';
    const v = value.values || value;
    const fmt = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}ms` : '—');
    return `| ${label} | ${scenario} | ${fmt(v['p(50)'] ?? v.med)} | ${fmt(v['p(95)'])} | ${fmt(v['p(99)'])} |`;
  });
  return rows.join('\n');
};

const counters = () => {
  const errors = metric('server_errors_5xx')?.values?.count ?? 0;
  const limited = metric('rate_limited_429')?.values?.count ?? 0;
  const requests = metric('http_reqs')?.values?.count ?? 0;
  return { errors, limited, requests };
};

const thresholdLines = Object.entries(summary.thresholds || {}).map(([key, value]) => `- \`${key}\`: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n');
const { errors, limited, requests } = counters();
const endpointRows = ['feed', 'permalink', 'oembed', 'search', 'like', 'publish'].map((tag) => durationRow(tag, tag)).filter(Boolean).join('\n');

const rampSection = profile === 'ramp' ? `
## Ramp ceiling

The deliverable of a ramp run is the breaking rate and its **named** cause —
one of: pg_stat_statements top query, Node event-loop saturation, connection
pool exhaustion, or platform CPU.

**Named cause:** ${cause || 'UNATTRIBUTED — re-render with --cause "<observed cause>" before publishing. A ceiling without a cause is a number, not a finding.'}
` : '';

const drainSection = drain ? `
## Media drain

| Measure | Value |
| --- | --- |
| Jobs | ${drain.jobs} |
| Workers | ${drain.workers}${drain.killOne ? ' (one killed mid-drain)' : ''} |
| Ready | ${drain.readyCount}/${drain.jobs} |
| Clips/min per worker | ${drain.clipsPerMinPerWorker} |
| Queue depth where time-to-ready exceeds ${drain.timeToReadyBudgetSec}s | ${drain.queueDepthWhereTtrExceedsBudget ?? 'not reached'} |
| Double claims | ${drain.doubleClaims?.length ?? 0} |
| Lease recoveries | ${drain.leaseRecoveries} |
| Terminal states | ${Object.entries(drain.statusCounts || {}).map(([k, v]) => `${k}: ${v}`).join(', ')} |
${Object.keys(drain.failureClasses || {}).length ? `| Failure classes | ${Object.entries(drain.failureClasses).map(([k, v]) => `${k}: ${v}`).join(', ')} |` : ''}
` : '';

const report = `# Load report — ${date} — ${profile}

${isLoopback ? '> **LOCAL DEVELOPMENT RUN — not publishable evidence.** Loopback timings\n> exclude the network path and shared-platform contention; the repository\n> evidence discipline forbids publishing them as deployed numbers.\n' : ''}
| | |
| --- | --- |
| Profile | ${profile} |
| Target host | ${summary.baseHost} |
| Image | \`${image.slice(0, 12)}\` |
| Environment | ${environment} |
| Generated | ${summary.generatedAt} |
| Total requests | ${requests} |
| 5xx responses | ${errors} |
| 429 responses | ${limited} (rate limiter working as designed; open-original is per-IP by design and excluded from throughput scenarios) |

## Stated assumptions

300 req/s sustained ≈ ~35k DAU at 10% peak concurrency × 5 req/min per active
user. The 600 req/s burst models a viral read spike. A 3,000 req/s ramp is a
10× headroom probe, not a DAU claim. If Node saturates before Postgres, the
recorded rate is the documented trigger condition for the Rust API seam in
docs/PERFORMANCE.md — "measured the Node ceiling at X" is the claim that
matters.

## Latency by endpoint

| Endpoint | Scenario | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
${endpointRows || '| (no tagged endpoint metrics in summary) | | | | |'}

## Thresholds applied

${thresholdLines || '- none (ramp profiles measure the ceiling instead of gating)'}
${rampSection}${drainSection}
---
Generated by \`load/report.mjs\` from \`${path.basename(k6Path)}\`${drain ? ` and \`${path.basename(option('--drain'))}\`` : ''}. Budgets live in docs/PERFORMANCE.md; change them there first.
`;

const outDir = path.join(loadDir, '..', 'docs', 'load-reports');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${date}-${profile}.md`);
writeFileSync(outPath, report);
console.log(`Report -> ${path.relative(process.cwd(), outPath)}`);
if (isLoopback) console.log('Stamped LOCAL DEVELOPMENT: do not publish these numbers.');
if (profile === 'ramp' && !cause) console.log('Ramp report is UNATTRIBUTED — add --cause before treating the ceiling as a finding.');
