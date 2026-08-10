export const REQUIRED_STORE_EXTERNAL_GATE_IDS = Object.freeze([
  'developer-account',
  'publisher-contact',
  'draft-item-id',
  'deployment-extension-allowlist',
  'oauth-round-trip',
  'reviewer-instructions',
]);

// A Store URL check is a point-in-time observation, not a permanent claim.
// The runtime re-evaluates this timestamp on every capabilities response and
// falls back to the checksummed ZIP when the embedded proof expires.
export const STORE_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const parsedTimestamp = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
};

export const inspectStoreReceiptFreshness = (receipt, { now = Date.now(), maxAgeMs = STORE_RECEIPT_MAX_AGE_MS } = {}) => {
  const checkedAt = parsedTimestamp(receipt?.checkedAt);
  const expiresAt = parsedTimestamp(receipt?.expiresAt);
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const issues = [];
  if (!Number.isFinite(currentTime)) issues.push('current time is invalid');
  if (checkedAt === null) issues.push('checkedAt must be a canonical ISO-8601 timestamp');
  if (expiresAt === null) issues.push('expiresAt must be a canonical ISO-8601 timestamp');
  if (checkedAt !== null && Number.isFinite(currentTime) && checkedAt > currentTime) issues.push('checkedAt is in the future');
  if (checkedAt !== null && expiresAt !== null) {
    if (expiresAt <= checkedAt) issues.push('expiresAt must be after checkedAt');
    if (expiresAt - checkedAt > maxAgeMs) issues.push(`receipt lifetime exceeds ${maxAgeMs}ms`);
  }
  if (expiresAt !== null && Number.isFinite(currentTime) && expiresAt <= currentTime) issues.push('receipt has expired');
  return {
    valid: issues.length === 0,
    issues,
    checkedAt: checkedAt === null ? null : new Date(checkedAt).toISOString(),
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
  };
};

export const assertFreshStoreReceipt = (receipt, options) => {
  const freshness = inspectStoreReceiptFreshness(receipt, options);
  if (!freshness.valid) throw new Error(`Store receipt freshness check failed (${freshness.issues.join('; ')}).`);
  return freshness;
};

const requiredExternalGateIds = new Set(REQUIRED_STORE_EXTERNAL_GATE_IDS);

export const inspectStoreExternalGateIds = (ids) => {
  if (!Array.isArray(ids)) {
    return {
      valid: false,
      missing: [...REQUIRED_STORE_EXTERNAL_GATE_IDS],
      unexpected: [],
      duplicates: [],
      invalid: ['external gate IDs must be an array'],
    };
  }

  const counts = new Map();
  const invalid = [];
  for (const [index, id] of ids.entries()) {
    if (typeof id !== 'string' || !id.trim()) {
      invalid.push(`external gate ID at index ${index} must be a non-empty string`);
      continue;
    }
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const presentIds = new Set(counts.keys());
  const missing = REQUIRED_STORE_EXTERNAL_GATE_IDS.filter((id) => !presentIds.has(id));
  const unexpected = [...presentIds].filter((id) => !requiredExternalGateIds.has(id)).sort();
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
  return {
    valid: invalid.length === 0 && missing.length === 0 && unexpected.length === 0 && duplicates.length === 0,
    missing,
    unexpected,
    duplicates,
    invalid,
  };
};

export const describeStoreExternalGateInventory = (inspection) => {
  if (inspection.valid) return `exactly ${REQUIRED_STORE_EXTERNAL_GATE_IDS.length} required external gates`;
  return [
    inspection.missing.length ? `missing: ${inspection.missing.join(', ')}` : '',
    inspection.unexpected.length ? `unexpected: ${inspection.unexpected.join(', ')}` : '',
    inspection.duplicates.length ? `duplicates: ${inspection.duplicates.join(', ')}` : '',
    ...inspection.invalid,
  ].filter(Boolean).join('; ');
};

export const assertExactStoreExternalGateIds = (ids, label = 'Store external gate IDs') => {
  const inspection = inspectStoreExternalGateIds(ids);
  if (!inspection.valid) throw new Error(`${label} do not match the required inventory (${describeStoreExternalGateInventory(inspection)}).`);
  return ids;
};
