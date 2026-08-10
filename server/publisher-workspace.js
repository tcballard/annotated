import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { queryDatabase, readStore, storageDescription, transactDatabase, updateStore } from './store.js';

const queryNative = () => storageDescription() === 'postgres' && process.env.ANNOTATED_RELATIONAL_READS !== 'legacy';
const normalizeDomain = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const publicWorkspace = (row) => row ? { id: row.id, domain: row.domain, displayName: row.display_name || row.displayName, verifiedAt: row.verified_at || row.verifiedAt, status: row.status } : null;

export async function createPublisherChallenge({ domain, actorId }) {
  const normalized = normalizeDomain(domain);
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) throw new Error('Enter a registrable publisher domain.');
  const token = `annotated-verify=${randomBytes(24).toString('base64url')}`;
  const challenge = { id: randomUUID(), domain: normalized, actorId, tokenHash: hash(token), method: 'dns-txt', status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
  if (!queryNative()) {
    await updateStore((store) => ({ ...store, publisherVerifications: [...(store.publisherVerifications || []), challenge] }));
  } else {
    await queryDatabase(`INSERT INTO annotated_publisher_verifications(id,domain,actor_id,token_hash,method,status,expires_at) VALUES($1,$2,$3,$4,$5,'pending',$6)`, [challenge.id, challenge.domain, actorId, challenge.tokenHash, challenge.method, challenge.expiresAt]);
  }
  return { id: challenge.id, domain: normalized, method: challenge.method, recordName: `_annotated.${normalized}`, recordValue: token, expiresAt: challenge.expiresAt };
}

const resolvedProofTokens = async (domain, resolver = resolveTxt) => (await resolver(`_annotated.${domain}`)).flat().map((value) => String(value).trim());

export async function verifyPublisherChallenge({ challengeId, actorId, resolveTxtFn = resolveTxt }) {
  if (!queryNative()) {
    let workspace;
    const current = await readStore();
    const pending = (current.publisherVerifications || []).find((item) => item.id === challengeId && item.actorId === actorId);
    if (!pending || pending.status !== 'pending' || Date.parse(pending.expiresAt) < Date.now()) throw new Error('Publisher challenge is unavailable or expired.');
    const proofs = await resolvedProofTokens(pending.domain, resolveTxtFn).catch(() => []);
    if (!proofs.some((proof) => timingSafeEqual(Buffer.from(hash(proof)), Buffer.from(pending.tokenHash)))) throw new Error('The DNS TXT proof was not found yet.');
    await updateStore((store) => {
      const challenge = (store.publisherVerifications || []).find((item) => item.id === challengeId && item.actorId === actorId);
      if (!challenge || challenge.status !== 'pending' || Date.parse(challenge.expiresAt) < Date.now()) throw new Error('Publisher challenge is unavailable or expired.');
      const now = new Date().toISOString();
      challenge.status = 'verified'; challenge.verifiedAt = now;
      workspace = { id: `pub_${hash(challenge.domain).slice(0, 20)}`, domain: challenge.domain, displayName: challenge.domain, verifiedAt: now, status: 'verified', ownerId: actorId };
      return { ...store, publisherWorkspaces: [...(store.publisherWorkspaces || []).filter((item) => item.domain !== challenge.domain), workspace], publisherVerifications: store.publisherVerifications };
    });
    return publicWorkspace(workspace);
  }
  return transactDatabase(async (client) => {
      const result = await client.query(`SELECT * FROM annotated_publisher_verifications WHERE id=$1 AND actor_id=$2 AND status='pending' AND expires_at>now() FOR UPDATE`, [challengeId, actorId]);
      const challenge = result.rows[0];
      if (!challenge) throw new Error('Publisher challenge is unavailable or expired.');
      const proofs = await resolvedProofTokens(challenge.domain, resolveTxtFn).catch(() => []);
      if (!proofs.some((proof) => timingSafeEqual(Buffer.from(hash(proof)), Buffer.from(challenge.token_hash)))) throw new Error('The DNS TXT proof was not found yet.');
      const id = `pub_${hash(challenge.domain).slice(0, 20)}`;
      await client.query(`INSERT INTO annotated_publisher_workspaces(id,domain,display_name,status,verified_at,created_by) VALUES($1,$2,$2,'verified',now(),$3) ON CONFLICT(domain) DO UPDATE SET status='verified',verified_at=now(),revoked_at=NULL RETURNING *`, [id, challenge.domain, actorId]);
      await client.query(`INSERT INTO annotated_publisher_members(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='owner'`, [id, actorId]);
      await client.query(`UPDATE annotated_publisher_verifications SET status='verified',verified_at=now() WHERE id=$1`, [challengeId]);
      await client.query(`INSERT INTO annotated_publisher_audit(id,workspace_id,actor_id,action,evidence) VALUES($1,$2,$3,'domain_verified',$4::jsonb)`, [randomUUID(), id, actorId, JSON.stringify({ challengeId, method: challenge.method })]);
      const workspace = await client.query('SELECT * FROM annotated_publisher_workspaces WHERE id=$1', [id]);
      return publicWorkspace(workspace.rows[0]);
  });
}

export async function publisherWorkspace(workspaceId, actorId, { limit = 30, cursor = '' } = {}) {
  const bounded = Math.min(100, Math.max(1, Number(limit) || 30));
  const offset = Math.max(0, Number(cursor) || 0);
  if (!queryNative()) {
    const store = await readStore();
    const workspace = (store.publisherWorkspaces || []).find((item) => item.id === workspaceId && item.ownerId === actorId && item.status === 'verified');
    if (!workspace) return null;
    const annotations = (store.annotations || []).filter((item) => item.sourceHost === workspace.domain).slice(offset, offset + bounded);
    return { workspace: publicWorkspace(workspace), annotations, claims: (store.claims || []).filter((claim) => annotations.some((item) => item.id === claim.annotationId)), analytics: { annotations: annotations.length, originalOpens: annotations.reduce((sum, item) => sum + Number(item.openCount || 0), 0), replies: (store.publisherReplies || []).filter((reply) => reply.workspaceId === workspaceId).length }, nextCursor: annotations.length === bounded ? String(offset + bounded) : null };
  }
  const access = await queryDatabase(`SELECT w.* FROM annotated_publisher_workspaces w JOIN annotated_publisher_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2 AND w.status='verified'`, [workspaceId, actorId]);
  if (!access.rows[0]) return null;
  const [annotations, summary, claims] = await Promise.all([
    queryDatabase(`SELECT a.id,a.slug,a.source_title,a.source_type,a.source_url,a.source_excerpt,a.media_status,a.open_count,a.created_at,(SELECT count(*) FROM annotated_comments c WHERE c.annotation_id=a.id)::integer replies FROM annotated_annotations a WHERE lower(a.source_host)=lower($1) ORDER BY a.created_at DESC,a.id LIMIT $2 OFFSET $3`, [access.rows[0].domain, bounded + 1, offset]),
    queryDatabase(`SELECT count(*)::integer annotations,coalesce(sum(open_count),0)::bigint original_opens,(SELECT count(*) FROM annotated_publisher_replies r WHERE r.workspace_id=$2)::integer verified_replies FROM annotated_annotations WHERE lower(source_host)=lower($1)`, [access.rows[0].domain, workspaceId]),
    queryDatabase(`SELECT c.id,c.annotation_id,c.status,c.reason,c.created_at FROM annotated_claims c JOIN annotated_annotations a ON a.id=c.annotation_id WHERE lower(a.source_host)=lower($1) ORDER BY c.created_at DESC LIMIT 100`, [access.rows[0].domain]),
  ]);
  return { workspace: publicWorkspace(access.rows[0]), annotations: annotations.rows.slice(0, bounded), claims: claims.rows, analytics: summary.rows[0], nextCursor: annotations.rows.length > bounded ? String(offset + bounded) : null };
}

export async function addPublisherReply({ workspaceId, annotationId, actorId, body }) {
  const text = String(body || '').trim();
  if (!text || text.length > 1000) throw new Error('Verified reply must be between 1 and 1,000 characters.');
  if (!queryNative()) {
    const store = await readStore();
    const workspace = (store.publisherWorkspaces || []).find((item) => item.id === workspaceId && item.ownerId === actorId && item.status === 'verified');
    const annotation = (store.annotations || []).find((item) => item.id === annotationId && item.sourceHost === workspace?.domain);
    if (!workspace || !annotation) return null;
    const reply = { id: randomUUID(), workspaceId, annotationId, actorId, body: text, createdAt: new Date().toISOString(), verified: true };
    await updateStore((current) => ({ ...current, publisherReplies: [...(current.publisherReplies || []), reply] }));
    return reply;
  }
  const result = await queryDatabase(`INSERT INTO annotated_publisher_replies(id,workspace_id,annotation_id,actor_id,body) SELECT $1,w.id,a.id,$4,$5 FROM annotated_publisher_workspaces w JOIN annotated_publisher_members m ON m.workspace_id=w.id AND m.user_id=$4 JOIN annotated_annotations a ON a.id=$3 AND lower(a.source_host)=lower(w.domain) WHERE w.id=$2 AND w.status='verified' ON CONFLICT(workspace_id,annotation_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,body=EXCLUDED.body,created_at=now() RETURNING *`, [randomUUID(), workspaceId, annotationId, actorId, text]);
  return result.rows[0] || null;
}

export async function publisherClaimIds(workspaceId, actorId, requestedIds = []) {
  const ids = [...new Set(requestedIds.map(String))].slice(0, 50);
  if (!ids.length) return [];
  if (!queryNative()) {
    const store = await readStore();
    const workspace = (store.publisherWorkspaces || []).find((item) => item.id === workspaceId && item.ownerId === actorId && item.status === 'verified');
    if (!workspace) return [];
    const annotationIds = new Set((store.annotations || []).filter((item) => item.sourceHost === workspace.domain).map((item) => item.id));
    return (store.claims || []).filter((claim) => ids.includes(claim.id) && annotationIds.has(claim.annotationId)).map((claim) => claim.id);
  }
  const result = await queryDatabase(`SELECT c.id FROM annotated_claims c JOIN annotated_annotations a ON a.id=c.annotation_id JOIN annotated_publisher_workspaces w ON lower(w.domain)=lower(a.source_host) JOIN annotated_publisher_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2 AND m.role IN ('owner','editor') AND c.id=ANY($3::text[])`, [workspaceId, actorId, ids]);
  return result.rows.map((row) => row.id);
}
