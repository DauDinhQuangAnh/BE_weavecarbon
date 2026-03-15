function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(':')
  );
}

function buildOriginVariant(origin, transformHostname) {
  try {
    const url = new URL(origin);
    if (isLocalHostname(url.hostname) || !url.hostname.includes('.')) {
      return null;
    }

    const nextHostname = transformHostname(url.hostname);
    if (!nextHostname || nextHostname === url.hostname) {
      return null;
    }

    url.hostname = nextHostname;
    return url.origin;
  } catch {
    return null;
  }
}

function getRelatedOrigins(origin) {
  const variants = [origin];
  const wwwVariant = buildOriginVariant(origin, (hostname) => (
    hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`
  ));

  if (wwwVariant) {
    variants.push(wwwVariant);
  }

  return variants;
}

function parseOriginList(value) {
  return String(value || '')
    .split(/[,\n;]/)
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
}

function resolveAllowedFrontendOrigins() {
  const origins = new Set();

  for (const origin of parseOriginList(process.env.FRONTEND_URL)) {
    for (const relatedOrigin of getRelatedOrigins(origin)) {
      origins.add(relatedOrigin);
    }
  }

  for (const origin of parseOriginList(process.env.CORS_ORIGIN)) {
    for (const relatedOrigin of getRelatedOrigins(origin)) {
      origins.add(relatedOrigin);
    }
  }

  for (const origin of parseOriginList(process.env.FRONTEND_URLS)) {
    for (const relatedOrigin of getRelatedOrigins(origin)) {
      origins.add(relatedOrigin);
    }
  }

  origins.add('http://localhost:3000');
  origins.add('http://127.0.0.1:3000');

  return Array.from(origins);
}

function resolveFrontendBaseUrl(preferredOrigin) {
  const allowedOrigins = resolveAllowedFrontendOrigins();
  const normalizedPreferred = normalizeOrigin(preferredOrigin);

  if (normalizedPreferred && allowedOrigins.includes(normalizedPreferred)) {
    return normalizedPreferred;
  }

  const configuredOrigin =
    normalizeOrigin(process.env.FRONTEND_URL) ||
    parseOriginList(process.env.CORS_ORIGIN)[0] ||
    allowedOrigins[0] ||
    'http://localhost:3000';

  return stripTrailingSlash(configuredOrigin);
}

function resolveBackendBaseUrl() {
  const fallbackPort = process.env.PORT || 4000;
  return stripTrailingSlash(
    process.env.AUTH_PUBLIC_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.BACKEND_URL ||
    `http://localhost:${fallbackPort}`
  );
}

module.exports = {
  resolveFrontendBaseUrl,
  resolveBackendBaseUrl,
  resolveAllowedFrontendOrigins,
  normalizeOrigin
};
