import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { latestMigrationVersion } from '../server/migration-version.js';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
if (outputIndex >= 0 && !outputPath) throw new Error('--output requires a path.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the relational integrity check.');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: process.env.PGSSL === 'disable' ? false : undefined });
const collectionChecks = [
  ['users', 'annotated_users'],
  ['media', 'annotated_media_artifacts'],
  ['annotations', 'annotated_annotations'],
  ['comments', 'annotated_comments'],
  ['follows', 'annotated_follows'],
  ['likes', 'annotated_likes'],
  ['claims', 'annotated_claims'],
  ['sessions', 'annotated_sessions'],
  ['extensionTickets', 'annotated_extension_tickets'],
  ['moderationAudit', 'annotated_moderation_audit'],
  ['mediaJobs', 'annotated_media_jobs'],
];

const mismatchQueries = {
  users: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_users u ON r.collection='users' AND u.id=r.record_id
    WHERE (r.collection='users' OR r.collection IS NULL) AND (r.record_id IS NULL OR u.id IS NULL OR
      u.handle IS DISTINCT FROM coalesce(nullif(r.payload->>'handle',''),r.record_id) OR
      u.display_name IS DISTINCT FROM coalesce(nullif(r.payload->>'displayName',''),nullif(r.payload->>'handle',''),r.record_id) OR
      u.provider IS DISTINCT FROM nullif(r.payload->>'provider','') OR u.provider_id IS DISTINCT FROM nullif(r.payload->>'providerId',''))`,
  media: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_media_artifacts m ON r.collection='media' AND m.id=r.record_id
    WHERE (r.collection='media' OR r.collection IS NULL) AND (r.record_id IS NULL OR m.id IS NULL OR
      m.object_key IS DISTINCT FROM coalesce(nullif(r.payload->>'key',''),r.payload->>'fileName') OR m.mime_type IS DISTINCT FROM r.payload->>'mimeType')`,
  annotations: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_annotations a ON r.collection='annotations' AND a.id=r.record_id
    WHERE (r.collection='annotations' OR r.collection IS NULL) AND (r.record_id IS NULL OR a.id IS NULL OR
      a.slug IS DISTINCT FROM r.payload->>'slug' OR a.author_id IS DISTINCT FROM r.payload->>'authorId' OR
      a.source_url IS DISTINCT FROM r.payload->>'sourceUrl' OR a.status IS DISTINCT FROM coalesce(nullif(r.payload->>'status',''),'published') OR
      a.visibility IS DISTINCT FROM coalesce(nullif(r.payload->>'visibility',''),'public') OR a.open_count IS DISTINCT FROM coalesce((r.payload->>'openCount')::bigint,0))`,
  comments: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_comments c ON r.collection='comments' AND c.id=r.record_id
    WHERE (r.collection='comments' OR r.collection IS NULL) AND (r.record_id IS NULL OR c.id IS NULL OR
      c.annotation_id IS DISTINCT FROM r.payload->>'annotationId' OR c.author_id IS DISTINCT FROM r.payload->>'authorId' OR c.body IS DISTINCT FROM r.payload->>'body')`,
  follows: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_follows f
      ON r.collection='follows' AND f.follower_id=r.payload->>'followerId' AND f.following_id=r.payload->>'followingId'
    WHERE (r.collection='follows' OR r.collection IS NULL) AND (r.record_id IS NULL OR f.follower_id IS NULL)`,
  likes: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_likes l
      ON r.collection='likes' AND l.annotation_id=r.payload->>'annotationId' AND l.user_id=r.payload->>'userId'
    WHERE (r.collection='likes' OR r.collection IS NULL) AND (r.record_id IS NULL OR l.annotation_id IS NULL)`,
  claims: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_claims c ON r.collection='claims' AND c.id=r.record_id
    WHERE (r.collection='claims' OR r.collection IS NULL) AND (r.record_id IS NULL OR c.id IS NULL OR
      c.annotation_id IS DISTINCT FROM nullif(r.payload->>'annotationId','') OR c.status IS DISTINCT FROM r.payload->>'status' OR c.reason IS DISTINCT FROM r.payload->>'reason')`,
  sessions: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_sessions s ON r.collection='sessions' AND s.id=r.record_id
    WHERE (r.collection='sessions' OR r.collection IS NULL) AND (r.record_id IS NULL OR s.id IS NULL OR
      s.token_hash IS DISTINCT FROM r.payload->>'tokenHash' OR s.user_id IS DISTINCT FROM r.payload->>'userId')`,
  extensionTickets: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_extension_tickets t ON r.collection='extensionTickets' AND t.token_hash=r.payload->>'tokenHash'
    WHERE (r.collection='extensionTickets' OR r.collection IS NULL) AND (r.record_id IS NULL OR t.token_hash IS NULL OR t.user_id IS DISTINCT FROM r.payload->>'userId')`,
  moderationAudit: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_moderation_audit a ON r.collection='moderationAudit' AND a.id=r.record_id
    WHERE (r.collection='moderationAudit' OR r.collection IS NULL) AND (r.record_id IS NULL OR a.id IS NULL OR a.claim_id IS DISTINCT FROM r.payload->>'claimId' OR a.to_status IS DISTINCT FROM r.payload->>'to')`,
  mediaJobs: `SELECT count(*)::integer mismatches FROM annotated_records r FULL JOIN annotated_media_jobs j ON r.collection='mediaJobs' AND j.id=r.record_id
    WHERE (r.collection='mediaJobs' OR r.collection IS NULL) AND (r.record_id IS NULL OR j.id IS NULL OR
      j.annotation_id IS DISTINCT FROM r.payload->>'annotationId' OR j.status IS DISTINCT FROM r.payload->>'status' OR j.attempts IS DISTINCT FROM coalesce((r.payload->>'attempts')::integer,0))`,
};

let report;
try {
  const migration = await pool.query('SELECT version FROM annotated_schema_migrations ORDER BY version DESC LIMIT 1');
  if (migration.rows[0]?.version !== latestMigrationVersion) throw new Error(`Migrations are not current (expected ${latestMigrationVersion}).`);
  const collections = {};
  for (const [collection, table] of collectionChecks) {
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM annotated_records WHERE collection=$1)::bigint legacy,
      (SELECT count(*) FROM ${table})::bigint relational`, [collection]);
    const mismatches = await pool.query(mismatchQueries[collection]);
    collections[collection] = {
      legacy: Number(counts.rows[0].legacy),
      relational: Number(counts.rows[0].relational),
      mismatches: Number(mismatches.rows[0].mismatches),
    };
  }
  const failures = Object.entries(collections).flatMap(([collection, value]) => value.legacy !== value.relational || value.mismatches
    ? [{ collection, ...value }]
    : []);
  report = { schemaVersion: 1, kind: 'annotated.relational-integrity', checkedAt: new Date().toISOString(), migration: latestMigrationVersion, status: failures.length ? 'failed' : 'passed', collections, failures };
} catch (error) {
  report = { schemaVersion: 1, kind: 'annotated.relational-integrity', checkedAt: new Date().toISOString(), migration: latestMigrationVersion, status: 'failed', collections: {}, failures: [{ error: error.message }] };
} finally {
  await pool.end();
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
process.stdout.write(serialized);
if (report.status !== 'passed') process.exitCode = 1;
