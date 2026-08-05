// GENERATED from packages/core/src/api-client.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// The one API client every surface talks through. Same-origin surfaces
// (web) construct it with no origin and ride relative paths + cookies;
// the native app passes its deployed origin and rides the shared system
// cookie jar, so one sign-in serves WebViews and native fetches alike.
export const apiError = (body = {}, status, fallback) => {
    const error = new Error(body.errors?.join(' ') || body.error || fallback);
    error.status = status;
    error.body = body;
    return error;
};
export const createApiClient = ({ origin = '', fetchFn } = {}) => {
    const base = String(origin).replace(/\/$/, '');
    const call = fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    const apiRequest = async (path, options = {}) => {
        const response = await call(`${base}${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
            throw apiError(body, response.status, `Request failed (${response.status}).`);
        return body;
    };
    const uploadRequest = async (path, blob) => {
        const response = await call(`${base}${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
            throw apiError(body, response.status, `Upload failed (${response.status}).`);
        return body;
    };
    return {
        health: () => apiRequest('/api/health'),
        providers: () => apiRequest('/api/auth/providers'),
        me: () => apiRequest('/api/me'),
        logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
        feed: (query = '') => apiRequest(`/api/feed${query ? `?${query}` : ''}`),
        resolveSource: (url) => apiRequest('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
        createAnnotation: (payload) => apiRequest('/api/annotations', { method: 'POST', body: JSON.stringify(payload) }),
        getAnnotation: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`),
        updateAnnotation: (slug, patch) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
        deleteAnnotation: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
        retryMedia: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/media/retry`, { method: 'POST' }),
        addComment: (slug, body) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
        like: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/like`, { method: 'POST' }),
        unlike: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/unlike`, { method: 'POST' }),
        follow: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}/follow`, { method: 'POST' }),
        unfollow: (userId) => apiRequest(`/api/users/${encodeURIComponent(userId)}/unfollow`, { method: 'POST' }),
        recordOpen: (slug) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/open`, { method: 'POST' }),
        profile: (handle) => apiRequest(`/api/profiles/${encodeURIComponent(handle)}`),
        sourceHub: (host, cursor) => apiRequest(`/api/sources/${encodeURIComponent(host)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
        people: (q = '') => apiRequest(`/api/people${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        transparency: () => apiRequest('/api/transparency'),
        trendingSources: () => apiRequest('/api/trending/sources'),
        fileClaim: (slug, reason) => apiRequest(`/api/annotations/${encodeURIComponent(slug)}/claims`, { method: 'POST', body: JSON.stringify({ reason }) }),
        claims: () => apiRequest('/api/claims'),
        moderationClaims: () => apiRequest('/api/moderation/claims'),
        moderateClaim: (id, status, note = '', action = undefined) => apiRequest(`/api/moderation/claims/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status, note, action }) }),
        uploadAudio: (blob) => uploadRequest('/api/media/audio', blob),
    };
};
