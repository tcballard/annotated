export const apiError = (body = {}, status, fallback) => {
  const error = new Error(body.errors?.join(' ') || body.error || fallback);
  error.status = status;
  return error;
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(body, response.status, `Request failed (${response.status}).`);
  return body;
};

const uploadRequest = async (path, blob) => {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(body, response.status, `Upload failed (${response.status}).`);
  return body;
};

export const api = {
  health: () => apiRequest('/api/health'),
  providers: () => apiRequest('/api/auth/providers'),
  me: () => apiRequest('/api/me'),
  logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
  feed: (query = '') => apiRequest(`/api/feed${query ? `?${query}` : ''}`),
  resolveSource: (url) => apiRequest('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
  createAnnotation: (payload) => apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) }),
  getAnnotation: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`),
  addComment: (slug, body) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  like: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/like`, { method: 'POST' }),
  unlike: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/unlike`, { method: 'POST' }),
  follow: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}/follow`, { method: 'POST' }),
  unfollow: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}/unfollow`, { method: 'POST' }),
  profile: (handle) => apiRequest(`/api/profiles/${encodeURIComponent(handle)}`),
  fileClaim: (slug, reason) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/claims`, { method: 'POST', body: JSON.stringify({ reason }) }),
  claims: () => apiRequest('/api/claims'),
  moderationClaims: () => apiRequest('/api/moderation/claims'),
  moderateClaim: (id, status, note = '') => apiRequest(`/api/moderation/claims/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  uploadAudio: (blob) => uploadRequest('/api/media/audio', blob),
};
