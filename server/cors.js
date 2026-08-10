const extensionIdPattern = /^[a-p]{32}$/;

const splitValues = (value = '') => String(value).split(',').map((item) => item.trim()).filter(Boolean);

export const configuredCorsOrigins = (env = process.env) => {
  const configured = splitValues(env.CORS_ORIGINS || env.CORS_ORIGIN);
  return [...new Set(configured)];
};

export const configuredExtensionIds = (env = process.env) => {
  return [...new Set(splitValues(env.CHROME_EXTENSION_IDS))];
};

export const isChromeExtensionRedirectUrl = (value, env = process.env) => {
  let parsed;
  try { parsed = value instanceof URL ? value : new URL(value); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return false;
  const suffix = '.chromiumapp.org';
  if (!parsed.hostname.endsWith(suffix)) return false;
  const extensionId = parsed.hostname.slice(0, -suffix.length);
  return extensionIdPattern.test(extensionId) && configuredExtensionIds(env).includes(extensionId);
};

export const isChromeExtensionOrigin = (origin, env = process.env) => {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  return parsed.protocol === 'chrome-extension:'
    && extensionIdPattern.test(parsed.hostname)
    && configuredExtensionIds(env).includes(parsed.hostname)
    && (!parsed.pathname || parsed.pathname === '/');
};

// The app's own origins are always allowed: browsers attach an Origin header
// to every same-origin POST, and publishing from the web app must not depend
// on the operator duplicating PUBLIC_ORIGIN into CORS_ORIGINS.
const selfOrigins = (env = process.env) => {
  const origins = [];
  for (const value of [env.PUBLIC_ORIGIN, env.APP_ORIGIN]) {
    try { origins.push(new URL(value).origin); } catch { /* unset or invalid */ }
  }
  if (env.NODE_ENV !== 'production') {
    const port = Number(env.PORT || 8787);
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
};

export const resolveCorsOrigin = (requestOrigin, env = process.env) => {
  const webOrigins = configuredCorsOrigins(env);
  if (!requestOrigin) return webOrigins[0] || '*';
  if (webOrigins.includes(requestOrigin)) return requestOrigin;
  if (selfOrigins(env).includes(requestOrigin)) return requestOrigin;
  if (isChromeExtensionOrigin(requestOrigin, env)) return requestOrigin;
  return null;
};

export const validateCorsConfiguration = (env = process.env) => {
  const origins = configuredCorsOrigins(env);
  if (!origins.length || origins.includes('*')) throw new Error('Production requires restricted CORS_ORIGINS.');
  for (const value of origins) {
    let origin;
    try { origin = new URL(value); } catch { throw new Error('Production requires every CORS_ORIGINS entry to be valid.'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Production requires every CORS_ORIGINS entry to be an origin without a path.');
    }
  }
  for (const id of configuredExtensionIds(env)) {
    if (!extensionIdPattern.test(id)) throw new Error('CHROME_EXTENSION_IDS must contain Chrome extension IDs only.');
  }
  return { origins, extensionIds: configuredExtensionIds(env) };
};
