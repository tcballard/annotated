const extensionIdPattern = /^[a-p]{32}$/;

const splitValues = (value = '') => String(value).split(',').map((item) => item.trim()).filter(Boolean);

export const configuredCorsOrigins = (env = process.env) => {
  const configured = splitValues(env.CORS_ORIGINS || env.CORS_ORIGIN);
  return [...new Set(configured)];
};

export const configuredExtensionIds = (env = process.env) => {
  return [...new Set(splitValues(env.CHROME_EXTENSION_IDS))];
};

export const isChromeExtensionOrigin = (origin, env = process.env) => {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  return parsed.protocol === 'chrome-extension:'
    && extensionIdPattern.test(parsed.hostname)
    && configuredExtensionIds(env).includes(parsed.hostname)
    && (!parsed.pathname || parsed.pathname === '/');
};

export const resolveCorsOrigin = (requestOrigin, env = process.env) => {
  const webOrigins = configuredCorsOrigins(env);
  if (!requestOrigin) return webOrigins[0] || '*';
  if (webOrigins.includes(requestOrigin)) return requestOrigin;
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
