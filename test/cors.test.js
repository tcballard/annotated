import assert from 'node:assert/strict';
import test from 'node:test';
import { isChromeExtensionRedirectUrl, resolveCorsOrigin, validateCorsConfiguration } from '../server/cors.js';

const extensionId = 'omlikcdpcdhfmdojdalfdeihgjmgikkg';
const env = {
  CORS_ORIGINS: 'https://annotated.example.com,https://preview.example.com',
  CHROME_EXTENSION_IDS: extensionId,
};

test('CORS reflects only configured web and stable Chrome extension origins', () => {
  assert.equal(resolveCorsOrigin('https://preview.example.com', env), 'https://preview.example.com');
  assert.equal(resolveCorsOrigin(`chrome-extension://${extensionId}`, env), `chrome-extension://${extensionId}`);
  assert.equal(resolveCorsOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', env), null);
  assert.equal(resolveCorsOrigin('https://untrusted.example.com', env), null);
});

test('OAuth redirect accepts only a configured extension identity', () => {
  assert.equal(isChromeExtensionRedirectUrl(`https://${extensionId}.chromiumapp.org/annotated-auth`, env), true);
  assert.equal(isChromeExtensionRedirectUrl('https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/annotated-auth', env), false);
  assert.equal(isChromeExtensionRedirectUrl(`https://${extensionId}.chromiumapp.org.evil.example/annotated-auth`, env), false);
  assert.equal(isChromeExtensionRedirectUrl(`http://${extensionId}.chromiumapp.org/annotated-auth`, env), false);
});

test('production CORS rejects wildcards and malformed extension IDs', () => {
  assert.deepEqual(validateCorsConfiguration(env), { origins: ['https://annotated.example.com', 'https://preview.example.com'], extensionIds: [extensionId] });
  assert.throws(() => validateCorsConfiguration({ CORS_ORIGIN: '*' }), /restricted CORS_ORIGINS/);
  assert.throws(() => validateCorsConfiguration({ CORS_ORIGIN: 'https://annotated.example.com', CHROME_EXTENSION_IDS: 'not-an-id' }), /Chrome extension IDs/);
});
