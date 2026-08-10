import { createHash } from 'node:crypto';

const TRACKING_PARAMETERS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid',
  'ref', 'ref_src', 'source', 'campaign',
]);

const isTrackingParameter = (name) => TRACKING_PARAMETERS.has(name.toLowerCase())
  || /^utm_/i.test(name)
  || /^pk_(?:campaign|kwd|source|medium|content|cid)$/i.test(name);

export const canonicalSourceUrl = (value) => {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.username = '';
  url.password = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  for (const name of [...url.searchParams.keys()]) if (isTrackingParameter(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return url.toString();
};

export const sourceIdentity = (value) => {
  const canonicalUrl = canonicalSourceUrl(value);
  return {
    // MD5 is used only as a deterministic, non-secret identity key. PostgreSQL
    // exposes the same built-in digest, so migration backfills, compatibility
    // writes, and query-native writes cannot produce different source IDs.
    id: `src_${createHash('md5').update(canonicalUrl).digest('hex')}`,
    canonicalUrl,
    urlKey: canonicalUrl.toLowerCase(),
    host: new URL(canonicalUrl).hostname,
  };
};

export const sourceRelationTypes = Object.freeze(['response', 'supports', 'challenges', 'adds_context', 'corrects']);

export const normalizeSourceRelation = (value) => sourceRelationTypes.includes(value) ? value : 'response';
