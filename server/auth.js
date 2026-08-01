import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readStore, updateStore } from './store.js';

const sessionTtlSeconds = Number(process.env.AUTH_SESSION_TTL_SECONDS || 2_592_000);
const oauthStateTtlSeconds = 600;
const secureCookies = process.env.NODE_ENV === 'production';
const authRequired = process.env.AUTH_REQUIRED === 'true' || process.env.NODE_ENV === 'production';
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 8787}`;

const providers = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: () => process.env.GOOGLE_REDIRECT_URI || `${publicOrigin}/api/auth/google/callback`,
    scope: 'openid email profile',
  },
  x: {
    authorize: 'https://twitter.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token',
    profile: 'https://api.x.com/2/users/me?user.fields=profile_image_url,name,username',
    clientId: () => process.env.X_CLIENT_ID,
    clientSecret: () => process.env.X_CLIENT_SECRET,
    redirectUri: () => process.env.X_REDIRECT_URI || `${publicOrigin}/api/auth/x/callback`,
    scope: 'users.read tweet.read offline.access',
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

export const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([name, value]) => name && value));

export const authIsRequired = () => authRequired;
export const providerStatus = () => Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, Boolean(provider.clientId() && provider.clientSecret())]));
export const assertAuthConfiguration = () => {
  if (!authRequired) return;
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'X_CLIENT_ID', 'X_CLIENT_SECRET'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Production authentication requires ${missing.join(', ')}.`);
};

const providerFor = (name) => {
  const provider = providers[name];
  if (!provider) throw new Error('Unsupported identity provider.');
  if (!provider.clientId() || !provider.clientSecret()) throw new Error(`${name === 'x' ? 'X' : 'Google'} OAuth is not configured.`);
  return provider;
};

const validateReturnTo = (value) => {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('OAuth return URL is invalid.'); }
  const allowedExtension = url.protocol === 'https:' && url.hostname.endsWith('.chromiumapp.org');
  const allowedApp = value.startsWith(process.env.APP_ORIGIN || publicOrigin);
  if (!allowedExtension && !allowedApp) throw new Error('OAuth return URL is not allowed.');
  return url.toString();
};

const requestOrigin = (request) => request.socket?.remoteAddress || 'unknown';
const rateBuckets = new Map();
const enforceRateLimit = (request, providerName) => {
  const key = `${requestOrigin(request)}:${providerName}`;
  const now = Date.now();
  const current = rateBuckets.get(key) || { count: 0, resetAt: now + 300_000 };
  if (current.resetAt <= now) { current.count = 0; current.resetAt = now + 300_000; }
  current.count += 1;
  rateBuckets.set(key, current);
  if (current.count > 10) throw new Error('Too many sign-in attempts. Try again later.');
};

export const startOAuth = async (request, providerName, returnTo = '') => {
  enforceRateLimit(request, providerName);
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

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
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
  const data = providerName === 'x' ? profile.data || {} : profile;
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
  if (!url.searchParams.get('code') || !url.searchParams.get('state') || !cookies[stateCookieName] || !cookies[verifierCookieName] || !timingSafeEqual(Buffer.from(url.searchParams.get('state')), Buffer.from(cookies[stateCookieName]))) throw new Error('OAuth state validation failed.');
  const tokens = await exchangeCode(provider, url.searchParams.get('code'), cookies[verifierCookieName]);
  const user = await upsertUser(await profileFromProvider(providerName, provider, tokens.access_token));
  const session = await createSession(user);
  const returnTo = cookies[returnCookieName] || null;
  const extension = returnTo ? await createExtensionTicket(user, returnTo) : null;
  return { user, cookie: cookie(cookieName, session.token, { maxAge: sessionTtlSeconds }), redirectTo: extension ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(extension.ticket)}` : null, clearCookies: [cookie(stateCookieName, '', { clear: true }), cookie(verifierCookieName, '', { clear: true }), cookie(returnCookieName, '', { clear: true })] };
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

export const currentUser = async (request) => {
  const user = await sessionUser(request);
  if (user) return user;
  if (!authRequired) return (await readStore()).users[0] || null;
  return null;
};

export const logout = async (request) => {
  const token = parseCookies(request.headers.cookie)[cookieName];
  if (token) await updateStore((store) => ({ ...store, sessions: (store.sessions || []).filter((session) => session.tokenHash !== hashToken(token)) }));
  return cookie(cookieName, '', { clear: true });
};

export { cookieName, oauthStateTtlSeconds, providers, publicOrigin, returnCookieName, sessionTtlSeconds, stateCookieName, verifierCookieName };
