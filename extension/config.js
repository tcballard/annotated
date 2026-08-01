import { extensionStorage } from './storage.js';

export const apiOrigin = () => extensionStorage.getApiOrigin();

export const authHeaders = async () => {
  const token = await extensionStorage.getAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

export const signIn = async (provider) => {
  if (!chrome.identity?.launchWebAuthFlow) throw new Error('Chrome identity is unavailable.');
  const origin = await apiOrigin();
  const returnTo = chrome.identity.getRedirectURL('annotated-auth');
  const callback = await chrome.identity.launchWebAuthFlow({ url: `${origin}/api/auth/${encodeURIComponent(provider)}/start?return_to=${encodeURIComponent(returnTo)}`, interactive: true });
  const ticket = new URL(callback).searchParams.get('ticket');
  if (!ticket) throw new Error('The sign-in callback did not include an extension ticket.');
  const response = await fetch(`${origin}/api/auth/extension/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Sign-in failed (${response.status}).`);
  await extensionStorage.saveAuthSession(body);
  return body.user;
};
