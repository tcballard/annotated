import assert from 'node:assert/strict';
import test from 'node:test';
import { apiError } from '../src/api.js';
import { authNoticeFromSearch, enabledProviders, oauthReturnUrl, oauthStartUrl, providerLabel } from '../src/auth-ui.js';

const location = {
  origin: 'https://annotated.example.com',
  pathname: '/u/reader',
  search: '?view=feed',
  hash: '#comments',
};

test('auth UI exposes only configured providers, X first per the brief surfaces', () => {
  assert.deepEqual(enabledProviders({ x: true, google: true, unknown: true }), ['x', 'google']);
  assert.deepEqual(enabledProviders({ google: true }), ['google']);
  assert.equal(providerLabel('google'), 'Google');
  assert.equal(providerLabel('x'), 'X');
  assert.equal(providerLabel('unknown'), 'sign-in provider');
});

test('OAuth links preserve the current app location through a validated return URL', () => {
  const returnTo = oauthReturnUrl(location);
  assert.equal(returnTo, 'https://annotated.example.com/u/reader?view=feed#comments');
  assert.equal(oauthStartUrl('google', location), `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
  assert.equal(oauthStartUrl('x', location).startsWith('/api/auth/x/start?return_to='), true);
  assert.equal(oauthStartUrl('github', location), '');
});

test('auth query state accepts success, error, and cancellation without trusting other values', () => {
  assert.equal(authNoticeFromSearch('?auth=success'), 'success');
  assert.equal(authNoticeFromSearch('?auth=error'), 'error');
  assert.equal(authNoticeFromSearch('?auth=cancelled'), 'cancelled');
  assert.equal(authNoticeFromSearch('?auth=success&next=https%3A%2F%2Fevil.example'), 'success');
  assert.equal(authNoticeFromSearch('?auth=unknown'), '');
  assert.equal(authNoticeFromSearch(''), '');
});

test('API errors retain their HTTP status for session recovery', () => {
  const error = apiError({ error: 'Sign in is required.' }, 401, 'Request failed.');
  assert.equal(error.status, 401);
  assert.equal(error.message, 'Sign in is required.');
});
