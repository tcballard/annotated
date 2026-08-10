import { createHash, randomUUID } from 'node:crypto';
import { queryDatabase, readStore, storageDescription, updateStore } from './store.js';

export const PRODUCT_EVENT_NAMES = Object.freeze([
  'extension_opened', 'source_resolved', 'draft_created', 'auth_started',
  'auth_completed', 'auth_cancelled', 'published', 'shared',
  'annotation_opened', 'original_opened', 'publisher_inbox_opened',
]);

const queryNative = () => storageDescription() === 'postgres' && process.env.ANNOTATED_RELATIONAL_READS !== 'legacy';
const safeToken = (value, max = 80) => String(value || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, max);
const permittedMetadata = new Set(['surface', 'sourceType', 'shareType', 'authProvider', 'workspaceId', 'result', 'durationBucket']);

export const sanitizeProductEvent = (input = {}) => {
  const eventName = String(input.eventName || '');
  if (!PRODUCT_EVENT_NAMES.includes(eventName)) throw new Error('Unknown product event.');
  if (input.isDemo || input.isTest || input.isBot) return null;
  const metadata = Object.fromEntries(Object.entries(input.metadata || {})
    .filter(([key, value]) => permittedMetadata.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 80) : value]));
  return {
    id: randomUUID(),
    eventName,
    actorId: safeToken(input.actorId),
    anonymousId: safeToken(input.anonymousId),
    annotationId: safeToken(input.annotationId),
    sourceId: safeToken(input.sourceId),
    sessionId: safeToken(input.sessionId),
    idempotencyKey: safeToken(input.idempotencyKey) || createHash('sha256').update(JSON.stringify([eventName, input.anonymousId, input.annotationId, input.sessionId, metadata])).digest('hex'),
    occurredAt: new Date().toISOString(),
    metadata,
  };
};

export async function recordProductEvent(input) {
  if (process.env.PRODUCT_ANALYTICS_DISABLED === 'true') return { accepted: false, reason: 'disabled' };
  const event = sanitizeProductEvent(input);
  if (!event) return { accepted: false, reason: 'excluded' };
  if (!queryNative()) {
    await updateStore((store) => ({ ...store, productEvents: [...(store.productEvents || []), event].slice(-10_000) }));
    return { accepted: true, id: event.id };
  }
  const result = await queryDatabase(
    `WITH expired AS (DELETE FROM annotated_product_events WHERE occurred_at < now()-interval '90 days')
     INSERT INTO annotated_product_events
      (id,event_name,actor_id,annotation_id,trace_id,occurred_at,evidence_metadata,anonymous_id,source_id,session_id,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [event.id, event.eventName, event.actorId || null, event.annotationId || null, event.sessionId || event.id, event.occurredAt, JSON.stringify(event.metadata), event.anonymousId || null, event.sourceId || null, event.sessionId || null, event.idempotencyKey],
  );
  return { accepted: Boolean(result.rowCount), id: result.rows[0]?.id || null };
}

export async function productFunnel({ workspaceId = '' } = {}) {
  if (!queryNative()) {
    const store = await readStore();
    const events = (store.productEvents || []).filter((event) => !workspaceId || event.metadata?.workspaceId === workspaceId);
    const counts = Object.fromEntries(PRODUCT_EVENT_NAMES.map((name) => [name, new Set(events.filter((event) => event.eventName === name).map((event) => event.actorId || event.anonymousId)).size]));
    return { counts, privacy: 'aggregate-only', retentionDays: 90 };
  }
  const result = await queryDatabase(
    `SELECT event_name,count(DISTINCT coalesce(actor_id,anonymous_id))::integer actors
       FROM annotated_product_events
      WHERE occurred_at >= now()-interval '90 days'
        AND ($1='' OR evidence_metadata->>'workspaceId'=$1)
      GROUP BY event_name`, [workspaceId],
  );
  return { counts: Object.fromEntries(result.rows.map((row) => [row.event_name, Number(row.actors)])), privacy: 'aggregate-only', retentionDays: 90 };
}
