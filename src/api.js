const apiRequest = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.errors?.join(' ') || body.error || `Request failed (${response.status}).`);
  return body;
};

const uploadRequest = async (path, blob) => {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.errors?.join(' ') || body.error || `Upload failed (${response.status}).`);
  return body;
};

export const api = {
  health: () => apiRequest('/api/health'),
  feed: () => apiRequest('/api/feed'),
  resolveSource: (url) => apiRequest('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
  createAnnotation: (payload) => apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) }),
  getAnnotation: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`),
  addComment: (slug, body) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  fileClaim: (slug, reason) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/claims`, { method: 'POST', body: JSON.stringify({ reason }) }),
  uploadAudio: (blob) => uploadRequest('/api/media/audio', blob),
};
