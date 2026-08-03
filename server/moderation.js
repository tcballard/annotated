const transitions = {
  open: new Set(['open', 'in_review', 'resolved', 'rejected']),
  in_review: new Set(['open', 'in_review', 'resolved', 'rejected']),
  resolved: new Set(['open', 'resolved']),
  rejected: new Set(['open', 'rejected']),
};

export const claimStatuses = Object.freeze(['open', 'in_review', 'resolved', 'rejected']);

export const validateClaimTransition = (from, to) => {
  if (!claimStatuses.includes(to)) return 'Claim status must be open, in_review, resolved, or rejected.';
  if (!transitions[from]?.has(to)) return `A ${from || 'unknown'} claim cannot move to ${to}.`;
  return null;
};

export const findActiveClaim = (claims, annotationId, reporterId) => (claims || []).find((claim) => claim.annotationId === annotationId && claim.reporterId === reporterId && ['open', 'in_review'].includes(claim.status)) || null;
