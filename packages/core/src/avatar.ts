// Avatar identity, shared by every surface. Real faces come from the
// OAuth profile (X profile_image_url / Google picture) stored as
// avatarUrl; accounts without one get a deterministic colored initial —
// same handle, same color, on web, extension, and native alike.
//
// The palette is ink-adjacent and deliberately excludes the terracotta
// accent: avatars are identity, not the moment.

export const AVATAR_COLORS: readonly string[] = [
  '#5B6478', // slate
  '#61735E', // moss
  '#6E5E73', // plum
  '#587082', // steel
  '#7A6A55', // umber
  '#566B6B', // teal-gray
  '#715E5E', // rosewood
  '#5E6A52', // olive
];

export const avatarColor = (seed: unknown): string => {
  const text = String(seed || 'annotated');
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

export const avatarInitial = (person: { displayName?: string | null; handle?: string | null } = {}): string =>
  String(person.displayName || person.handle || 'A').trim().slice(0, 1).toUpperCase() || 'A';
