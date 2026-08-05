import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readStore, updateStore } from './store.js';
import { rateLimitAsync } from './rate-limit.js';

const sessionTtlSeconds = Number(process.env.AUTH_SESSION_TTL_SECONDS || 2_592_000);
const oauthStateTtlSeconds = 600;
const secureCookies = process.env.NODE_ENV === 'production';
const authRequired = process.env.AUTH_REQUIRED === 'true' || process.env.NODE_ENV === 'production';
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 8787}`;

const providers = {
  google: {
    label: 'Google',
    envPrefix: 'GOOGLE',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
    profileData: (body) => body,
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: () => process.env.GOOGLE_REDIRECT_URI || `${publicOrigin}/api/auth/google/callback`,
    scope: 'openid email profile',
  },
  x: {
    label: 'X',
    envPrefix: 'X',
    authorize: 'https://twitter.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token',
    profile: 'https://api.x.com/2/users/me?user.fields=profile_image_url,name,username',
    profileData: (body) => body.data || {},
    clientId: () => process.env.X_CLIENT_ID,
    clientSecret: () => process.env.X_CLIENT_SECRET,
    redirectUri: () => process.env.X_REDIRECT_URI || `${publicOrigin}/api/auth/x/callback`,
    scope: 'users.read',
  },
};

const cookieName = 'annotated_session';
const stateCookieName = 'annotated_oauth_state';
const verifierCookieName = 'annotated_oauth_verifier';
const returnCookieName = 'annotated_oauth_return';

const base64url = (value) => Buffer.from(value).toString('base64url');
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
const codeChallenge = (verifier) => base64url(createHash('sha256').update(verifier).digest());
const cookie = (name, value, { maxAge = 0, clear = false } = {}) => `${name}=${clear ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax;${secureCookies ? ' Secure;' : ''}${maxAge ? ` Max-Age=${maxAge};` : clear ? ' Max-Age=0;' : ''}`;

export const parseCookies = (header = '') => Object.fromEntries(header.split(';').flatMap((item) => {
  const separator = item.indexOf('=');
  if (separator < 1) return [];
  try {
    const name = decodeURIComponent(item.slice(0, separator).trim());
    const value = decodeURIComponent(item.slice(separator + 1).trim());
    return name && value ? [[name, value]] : [];
  } catch {
    return [];
  }
}));

export const authIsRequired = () => authRequired;
// The brief requires X or Google sign-in; both ship enabled unless an
// operator narrows OAUTH_PROVIDERS explicitly.
export const enabledProviderNames = () => {
  const configured = String(process.env.OAUTH_PROVIDERS || 'x,google').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  const names = [...new Set(configured)];
  const unsupported = names.filter((name) => !providers[name]);
  if (!names.length || unsupported.length) throw new Error(`Unsupported OAuth provider configuration: ${[...unsupported, ...(names.length ? [] : ['none'])].join(', ')}.`);
  return names;
};
export const providerStatus = () => {
  const enabled = new Set(enabledProviderNames());
  return Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, enabled.has(name) && Boolean(provider.clientId() && provider.clientSecret())]));
};
export const assertAuthConfiguration = () => {
  if (!authRequired) return;
  const providerNames = enabledProviderNames();
  const missing = process.env.APP_ORIGIN ? [] : ['APP_ORIGIN'];
  for (const name of providerNames) {
    const prefix = providers[name].envPrefix;
    for (const suffix of ['CLIENT_ID', 'CLIENT_SECRET']) if (!process.env[`${prefix}_${suffix}`]) missing.push(`${prefix}_${suffix}`);
  }
  if (missing.length) throw new Error(`Production authentication requires ${missing.join(', ')}.`);
};

const providerFor = (name) => {
  const provider = providers[name];
  if (!provider) throw new Error('Unsupported identity provider.');
  if (!enabledProviderNames().includes(name)) throw new Error(`${provider.label} OAuth is disabled. Add ${name} to OAUTH_PROVIDERS to enable it.`);
  if (!provider.clientId() || !provider.clientSecret()) throw new Error(`${provider.label} OAuth is not configured.`);
  return provider;
};

const chromiumReturnUrl = (url) => url.protocol === 'https:' && url.hostname.endsWith('.chromiumapp.org');
// The mobile shell returns through its custom scheme; the callback carries a
// one-time ticket exactly like the extension flow.
const mobileReturnUrl = (url) => url.protocol === 'annotated:' && url.hostname === 'auth';
const configuredAppOrigin = () => {
  try { return new URL(process.env.APP_ORIGIN || publicOrigin).origin; } catch { throw new Error('OAuth app origin is invalid.'); }
};
const appReturnUrl = (url) => url.origin === configuredAppOrigin();

const validateReturnTo = (value) => {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('OAuth return URL is invalid.'); }
  const allowedExtension = chromiumReturnUrl(url);
  const allowedApp = appReturnUrl(url);
  const allowedMobile = mobileReturnUrl(url);
  if (!allowedExtension && !allowedApp && !allowedMobile) throw new Error('OAuth return URL is not allowed.');
  return url.toString();
};

const requestOrigin = (request) => request.socket?.remoteAddress || 'unknown';
const enforceRateLimit = async (request, providerName) => {
  const key = `${requestOrigin(request)}:${providerName}`;
  const result = await rateLimitAsync(key, { limit: 10, windowMs: 300_000 });
  if (!result.allowed) throw new Error(result.unavailable ? 'Sign-in rate limiting is temporarily unavailable.' : 'Too many sign-in attempts. Try again later.');
};

export const startOAuth = async (request, providerName, returnTo = '') => {
  await enforceRateLimit(request, providerName);
  const provider = providerFor(providerName);
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: provider.clientId(),
    redirect_uri: provider.redirectUri(),
    scope: provider.scope,
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const validatedReturnTo = validateReturnTo(returnTo);
  return {
    location: `${provider.authorize}?${params}`,
    cookies: [cookie(stateCookieName, state, { maxAge: oauthStateTtlSeconds }), cookie(verifierCookieName, verifier, { maxAge: oauthStateTtlSeconds }), ...(validatedReturnTo ? [cookie(returnCookieName, validatedReturnTo, { maxAge: oauthStateTtlSeconds })] : [])],
  };
};

const fetchJson = async (url, options, timeoutMs = 10_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Identity provider request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.detail || `Identity provider returned ${response.status}.`);
  return body;
};

const exchangeCode = async (provider, code, verifier) => {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: provider.redirectUri(), client_id: provider.clientId(), code_verifier: verifier });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (provider.clientSecret()) headers.authorization = `Basic ${Buffer.from(`${provider.clientId()}:${provider.clientSecret()}`).toString('base64')}`;
  return fetchJson(provider.token, { method: 'POST', headers, body });
};

const profileFromProvider = async (providerName, provider, accessToken) => {
  const profile = await fetchJson(provider.profile, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = provider.profileData(profile);
  if (!data.sub && !data.id) throw new Error('Identity provider returned no stable user id.');
  return {
    provider: providerName,
    providerId: String(data.sub || data.id),
    handle: String(data.preferred_username || data.username || data.email?.split('@')[0] || `${providerName}-${String(data.sub || data.id).slice(0, 8)}`).slice(0, 80),
    displayName: String(data.name || data.email || 'Annotated user').slice(0, 120),
    email: data.email || null,
    avatarUrl: data.picture || data.profile_image_url || null,
  };
};

const upsertUser = async (identity) => {
  let user;
  const next = await updateStore((store) => {
    const users = store.users || [];
    user = users.find((item) => item.provider === identity.provider && item.providerId === identity.providerId);
    if (user) {
      user = { ...user, ...identity, updatedAt: new Date().toISOString() };
      return { ...store, users: users.map((item) => item.id === user.id ? user : item) };
    }
    user = { id: randomUUID(), ...identity, createdAt: new Date().toISOString() };
    return { ...store, users: [...users, user] };
  });
  return next.users.find((item) => item.id === user.id);
};

const createSession = async (user) => {
  const sessionToken = base64url(randomBytes(32));
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString();
  await updateStore((store) => ({ ...store, sessions: [...(store.sessions || []).filter((session) => new Date(session.expiresAt) > new Date()), { id: randomUUID(), tokenHash: hashToken(sessionToken), userId: user.id, createdAt: new Date().toISOString(), expiresAt }] }));
  return { token: sessionToken, expiresAt };
};

const createExtensionTicket = async (user, returnTo) => {
  const ticket = base64url(randomBytes(32));
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  await updateStore((store) => ({ ...store, extensionTickets: [...(store.extensionTickets || []).filter((item) => new Date(item.expiresAt) > new Date()), { tokenHash: hashToken(ticket), userId: user.id, returnTo, expiresAt }] }));
  return { ticket, expiresAt };
};

export const finishOAuth = async (request, providerName, url) => {
  const provider = providerFor(providerName);
  const cookies = parseCookies(request.headers.cookie);
  const returnedState = url.searchParams.get('state') || '';
  const storedState = cookies[stateCookieName] || '';
  const stateMatches = returnedState.length === storedState.length && returnedState.length > 0 && timingSafeEqual(Buffer.from(returnedState), Buffer.from(storedState));
  if (!url.searchParams.get('code') || !stateMatches || !cookies[verifierCookieName]) throw new Error('OAuth state validation failed.');
  const tokens = await exchangeCode(provider, url.searchParams.get('code'), cookies[verifierCookieName]);
  if (!tokens.access_token) throw new Error('Identity provider returned no access token.');
  const user = await upsertUser(await profileFromProvider(providerName, provider, tokens.access_token));
  const session = await createSession(user);
  const returnTo = cookies[returnCookieName] || null;
  const returnUrl = returnTo ? new URL(returnTo) : null;
  const extension = returnUrl && (chromiumReturnUrl(returnUrl) || mobileReturnUrl(returnUrl)) ? await createExtensionTicket(user, returnTo) : null;
  const browserRedirect = returnUrl && appReturnUrl(returnUrl) ? (() => {
    returnUrl.searchParams.set('auth', 'success');
    return returnUrl.toString();
  })() : null;
  return { user, cookie: cookie(cookieName, session.token, { maxAge: sessionTtlSeconds }), redirectTo: extension ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(extension.ticket)}` : browserRedirect, clearCookies: [cookie(stateCookieName, '', { clear: true }), cookie(verifierCookieName, '', { clear: true }), cookie(returnCookieName, '', { clear: true })] };
};

const requestToken = (request) => {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : parseCookies(request.headers.cookie)[cookieName];
};

export const sessionUser = async (request) => {
  const token = requestToken(request);
  if (!token) return null;
  const store = await readStore();
  const session = (store.sessions || []).find((item) => item.tokenHash === hashToken(token) && new Date(item.expiresAt) > new Date());
  return session ? (store.users || []).find((user) => user.id === session.userId) || null : null;
};

export const exchangeExtensionTicket = async (ticket) => {
  if (!ticket || typeof ticket !== 'string') throw new Error('An extension auth ticket is required.');
  let userId;
  const now = new Date();
  await updateStore((store) => {
    const match = (store.extensionTickets || []).find((item) => item.tokenHash === hashToken(ticket) && new Date(item.expiresAt) > now);
    if (!match) return store;
    userId = match.userId;
    return { ...store, extensionTickets: (store.extensionTickets || []).filter((item) => item !== match) };
  });
  if (!userId) throw new Error('Extension auth ticket is invalid or expired.');
  const store = await readStore();
  const user = (store.users || []).find((item) => item.id === userId);
  if (!user) throw new Error('The extension account no longer exists.');
  const session = await createSession(user);
  return { token: session.token, expiresAt: session.expiresAt, user };
};

// The mobile shell exchanges its one-time ticket for a browser-style cookie
// session — the WebView then behaves exactly like the signed-in web app.
export const mobileTicketSession = async (ticket) => {
  const session = await exchangeExtensionTicket(ticket);
  return { sessionCookie: cookie(cookieName, session.token, { maxAge: sessionTtlSeconds }), user: session.user };
};

export const currentUser = async (request) => {
  const user = await sessionUser(request);
  if (user) return user;
  if (!authRequired) {
    const users = (await readStore()).users || [];
    return users.find((item) => item.id === 'local-tom') || users[0] || null;
  }
  return null;
};

export const logout = async (request) => {
  const token = requestToken(request);
  if (token) await updateStore((store) => ({ ...store, sessions: (store.sessions || []).filter((session) => session.tokenHash !== hashToken(token)) }));
  return cookie(cookieName, '', { clear: true });
};

export { cookieName, oauthStateTtlSeconds, providers, publicOrigin, returnCookieName, sessionTtlSeconds, stateCookieName, verifierCookieName };
