import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { atomicClaimSql } from '../server/media-job-repository.js';

const migration = await readFile(new URL('../server/migrations/006_relational_core.sql', import.meta.url), 'utf8');
const integrity = await readFile(new URL('../scripts/check-relational-integrity.mjs', import.meta.url), 'utf8');

test('relational migration creates every first-class product table and bounded-query index', () => {
  for (const table of ['users', 'sources', 'media_artifacts', 'annotations', 'comments', 'follows', 'likes', 'claims', 'sessions', 'extension_tickets', 'moderation_audit', 'media_jobs', 'product_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS annotated_${table}\\b`));
  }
  for (const index of ['annotations_recent_idx', 'annotations_author_recent_idx', 'annotations_source_recent_idx', 'annotations_url_key_idx', 'annotations_search_idx', 'media_jobs_claim_idx', 'media_jobs_lease_idx']) {
    assert.match(migration, new RegExp(index));
  }
  assert.match(migration, /search_document tsvector GENERATED ALWAYS/);
  assert.match(migration, /source_url_key text NOT NULL/);
  assert.match(migration, /annotated_annotations_url_key_idx[\s\S]*?\(source_url_key, created_at DESC\)/);
  assert.match(migration, /CREATE TRIGGER annotated_records_relational_sync/);
});

test('worker claim is one leased row selected with SKIP LOCKED', () => {
  assert.match(atomicClaimSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(atomicClaimSql, /UPDATE annotated_media_jobs job/);
  assert.match(atomicClaimSql, /lease_until=now\(\)\+\(\$3::bigint\*interval '1 millisecond'\)/);
  assert.match(atomicClaimSql, /attempts < \$4/);
});

test('integrity gate compares every compatibility collection and fails closed', () => {
  for (const collection of ['users', 'media', 'annotations', 'comments', 'follows', 'likes', 'claims', 'sessions', 'extensionTickets', 'moderationAudit', 'mediaJobs']) assert.match(integrity, new RegExp(`['\"]${collection}['\"]`));
  assert.match(integrity, /display_name IS DISTINCT FROM coalesce\(nullif\(r\.payload->>'displayName',''\),nullif\(r\.payload->>'handle',''\),r\.record_id\)/);
  assert.match(integrity, /status: failures\.length \? 'failed' : 'passed'/);
  assert.match(integrity, /process\.exitCode = 1/);
});
