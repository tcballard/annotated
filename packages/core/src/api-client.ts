// The one API client every surface talks through. Same-origin surfaces
// (web) construct it with no origin and ride relative paths + cookies;
// the native app passes its deployed origin and rides the shared system
// cookie jar, so one sign-in serves WebViews and native fetches alike.

export type ApiError = Error & { status: number; body: Record<string, any> };

export const apiError = (body: Record<string, any> = {}, status: number, fallback: string): ApiError => {
  const error = new Error(body.errors?.join(' ') || body.error || fallback) as ApiError;
  error.status = status;
  error.body = body;
  return error;
};

export type FetchLike = (input: string, init?: Record<string, any>) => Promise<any>;

export type ApiClientOptions = {
  origin?: string;
  fetchFn?: FetchLike;
};

export const createApiClient = ({ origin = '', fetchFn }: ApiClientOptions = {}) => {
  const base = String(origin).replace(/\/$/, '');
  const call: FetchLike = fetchFn ?? ((input, init) => globalThis.fetch(input, init));

  const apiRequest = async (path: string, options: Record<string, any> = {}) => {
    const response = await call(`${base}${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(body, response.status, `Request failed (${response.status}).`);
    return body;
  };

  const uploadRequest = async (path: string, blob: Blob) => {
    const response = await call(`${base}${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(body, response.status, `Upload failed (${response.status}).`);
    return body;
  };

  return {
    health: () => apiRequest('/api/health'),
    capabilities: () => apiRequest('/api/capabilities'),
    providers: () => apiRequest('/api/auth/providers'),
    me: () => apiRequest('/api/me'),
    logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
    feed: (query = '') => apiRequest(`/api/feed${query ? `?${query}` : ''}`),
    resolveSource: (url: string) => apiRequest('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
    createAnnotation: (payload: Record<string, any>) => apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) }),
    getAnnotation: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`),
    updateAnnotation: (slug: string, patch: Record<string, any>) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteAnnotation: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    retryMedia: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/media/retry`, { method: 'POST' }),
    addComment: (slug: string, body: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
    like: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/like`, { method: 'POST' }),
    unlike: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/unlike`, { method: 'POST' }),
    follow: (userId: string) => apiRequest(`/api/users/${encodeURIComponent(userId)}/follow`, { method: 'POST' }),
    unfollow: (userId: string) => apiRequest(`/api/users/${encodeURIComponent(userId)}/unfollow`, { method: 'POST' }),
    recordOpen: (slug: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/open`, { method: 'POST' }),
    notifications: () => apiRequest('/api/notifications'),
    notificationsSeen: () => apiRequest('/api/notifications/seen', { method: 'POST' }),
    profile: (handle: string) => apiRequest(`/api/profiles/${encodeURIComponent(handle)}`),
    sourceHub: (host: string, cursor?: string) => apiRequest(`/api/sources/${encodeURIComponent(host)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    people: (q = '') => apiRequest(`/api/people${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    transparency: () => apiRequest('/api/transparency'),
    trendingSources: () => apiRequest('/api/trending/sources'),
    fileClaim: (slug: string, reason: string) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/claims`, { method: 'POST', body: JSON.stringify({ reason }) }),
    claims: () => apiRequest('/api/claims'),
    moderationClaims: () => apiRequest('/api/moderation/claims'),
    moderateClaim: (id: string, status: string, note = '', action: string | undefined = undefined) => apiRequest(`/api/moderation/claims/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status, note, action }) }),
    uploadAudio: (blob: Blob) => uploadRequest('/api/media/audio', blob),
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
