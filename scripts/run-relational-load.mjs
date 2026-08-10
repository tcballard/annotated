import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { latestMigrationVersion } from '../server/migration-version.js';
import { atomicClaimSql } from '../server/media-job-repository.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const annotations = Number(option('--annotations', 100_000));
const interactions = Number(option('--interactions', 1_000_000));
const samples = Number(option('--samples', 30));
const output = option('--output', 'relational-load-report.json');
const url = process.env.LOAD_DATABASE_URL || '';
if (!url) throw new Error('LOAD_DATABASE_URL is required.');
const database = new URL(url).pathname.slice(1);
if (process.env.ALLOW_DESTRUCTIVE_LOAD !== 'true' || !/(?:load|bench|perf)/i.test(database)) throw new Error('Refusing destructive load: use an isolated database named with load, bench, or perf and set ALLOW_DESTRUCTIVE_LOAD=true.');
if (![annotations, interactions, samples].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Load sizes and samples must be positive integers.');

const pool = new pg.Pool({ connectionString: url, max: 12, ssl: process.env.PGSSL === 'disable' ? false : undefined });
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
const measure = async (name, work) => {
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await work(index);
    durations.push(performance.now() - started);
  }
  return { name, samples: durations.length, p50Ms: Number([...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)].toFixed(2)), p95Ms: Number(p95(durations).toFixed(2)), maxMs: Number(Math.max(...durations).toFixed(2)) };
};

let report;
try {
  const migration = await pool.query('SELECT version FROM annotated_schema_migrations ORDER BY version DESC LIMIT 1');
  if (migration.rows[0]?.version !== latestMigrationVersion) throw new Error(`Apply ${latestMigrationVersion} before the load run.`);
  await pool.query('TRUNCATE annotated_records,annotated_sources,annotated_users CASCADE');
  await pool.query(`INSERT INTO annotated_users(id,handle,display_name)
    SELECT 'load-user-'||n,'load-user-'||n,'Load user '||n FROM generate_series(1,1000) n`);
  await pool.query(`INSERT INTO annotated_sources(canonical_url,source_url,source_url_key,host,source_type,title)
    SELECT 'https://load-'||n||'.example/story','https://load-'||n||'.example/story','load-'||n||'.example/story','load-'||n||'.example','article','Load source '||n FROM generate_series(1,100) n`);
  await pool.query(`INSERT INTO annotated_annotations(id,slug,author_id,source_id,source_url,source_url_key,canonical_url,source_host,source_type,source_title,source_excerpt,commentary_mode,commentary,visibility,status,created_at)
    SELECT 'load-a-'||n,'load-a-'||n,'load-user-'||(((n-1)%1000)+1),
      'https://load-'||(((n-1)%100)+1)||'.example/story','https://load-'||(((n-1)%100)+1)||'.example/story','load-'||(((n-1)%100)+1)||'.example/story',
      'https://load-'||(((n-1)%100)+1)||'.example/story','load-'||(((n-1)%100)+1)||'.example','article','Indexed evidence '||n,'bounded source '||n,'text','query native '||n,'public','published',
      now()-(n||' milliseconds')::interval FROM generate_series(1,$1) n`, [annotations]);
  const likeCount = Math.floor(interactions * 0.7);
  const commentCount = Math.floor(interactions * 0.2);
  const followCount = Math.min(interactions - likeCount - commentCount, 100_000);
  await pool.query(`INSERT INTO annotated_likes(annotation_id,user_id,created_at)
    SELECT 'load-a-'||(((n-1)%$1)+1),'load-user-'||((((n-1)/$1)::integer%1000)+1),now() FROM generate_series(1,$2) n ON CONFLICT DO NOTHING`, [annotations, likeCount]);
  await pool.query(`INSERT INTO annotated_comments(id,annotation_id,author_id,body,created_at)
    SELECT 'load-c-'||n,'load-a-'||(((n-1)%$1)+1),'load-user-'||(((n-1)%1000)+1),'bounded response',now() FROM generate_series(1,$2) n`, [annotations, commentCount]);
  await pool.query(`INSERT INTO annotated_follows(follower_id,following_id,created_at)
    SELECT 'load-user-'||(((n-1)%1000)+1),'load-user-'||(((((n-1)%1000)+1+((n-1)/1000)::integer)%1000)+1),now()
    FROM generate_series(1,$1) n ON CONFLICT DO NOTHING`, [followCount]);
  await pool.query('ANALYZE');

  const metrics = [];
  metrics.push(await measure('feed_recent', () => pool.query("SELECT id FROM annotated_annotations WHERE status='published' AND visibility='public' ORDER BY created_at DESC,id DESC LIMIT 20")));
  metrics.push(await measure('source_hub', (index) => pool.query("SELECT id FROM annotated_annotations WHERE status='published' AND visibility='public' AND source_host=$1 ORDER BY created_at DESC,id DESC LIMIT 20", [`load-${(index % 100) + 1}.example`])));
  metrics.push(await measure('search', (index) => pool.query("SELECT id FROM annotated_annotations WHERE search_document @@ websearch_to_tsquery('simple',$1) ORDER BY created_at DESC,id DESC LIMIT 20", [`evidence ${(index % annotations) + 1}`])));
  metrics.push(await measure('comment_insert', (index) => pool.query('INSERT INTO annotated_comments(id,annotation_id,author_id,body) VALUES($1,$2,$3,$4)', [`measured-c-${index}`, `load-a-${(index % annotations) + 1}`, `load-user-${(index % 1000) + 1}`, 'measured'])));
  metrics.push(await measure('claim_insert', (index) => pool.query("INSERT INTO annotated_claims(id,annotation_id,reporter_id,reason,status) VALUES($1,$2,$3,'measured','open')", [`measured-claim-${index}`, `load-a-${(index % annotations) + 1}`, `load-user-${(index % 1000) + 1}`])));
  for (let index = 0; index < samples; index += 1) await pool.query("INSERT INTO annotated_media_jobs(id,annotation_id,owner_id,source_url,source_type,clip_start,clip_end,status,trace_id) VALUES($1,$2,'load-user-1','https://media.example/source.mp4','video',0,10,'queued',$3)", [`measured-job-${index}`, `load-a-${index + 1}`, `measured-trace-${index}`]);
  metrics.push(await measure('job_claim', (index) => pool.query(atomicClaimSql, [`measured-job-${index}`, `load-worker-${index}`, 60_000, 3])));
  const budgets = { feed_recent: 100, source_hub: 100, search: 250, comment_insert: 100, claim_insert: 100, job_claim: 100 };
  const failures = metrics.filter((metric) => metric.p95Ms > budgets[metric.name]).map((metric) => ({ metric: metric.name, p95Ms: metric.p95Ms, budgetMs: budgets[metric.name] }));
  report = { schemaVersion: 1, kind: 'annotated.relational-load', checkedAt: new Date().toISOString(), database, scale: { annotations, interactions, likes: likeCount, comments: commentCount, follows: followCount }, metrics, budgets, status: failures.length ? 'failed' : 'passed', failures };
} catch (error) {
  report = { schemaVersion: 1, kind: 'annotated.relational-load', checkedAt: new Date().toISOString(), database, scale: { annotations, interactions }, metrics: [], status: 'failed', failures: [{ error: error.message }] };
} finally {
  await pool.end();
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'passed') process.exitCode = 1;
