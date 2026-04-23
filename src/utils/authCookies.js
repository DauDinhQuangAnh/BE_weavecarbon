const jwtConfig = require('../config/jwt');

const REFRESH_TOKEN_COOKIE_NAME = 'weavecarbon_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

const parseOriginList = (value) => String(value || '')
  .split(/[,\n;]/)
  .map((entry) => String(entry || '').trim())
  .filter(Boolean);

const normalizeCookieDomain = (value) => {
  const raw = String(value || '').trim().replace(/^\.+/, '').toLowerCase();
  if (!raw) return null;
  if (raw === 'localhost' || raw === '127.0.0.1' || raw === '::1') {
    return null;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return null;
  }
  return raw.includes('.') ? raw : null;
};

const deriveCookieDomainFromOrigin = (origin) => {
  try {
    const hostname = new URL(origin).hostname;
    const normalizedHostname = normalizeCookieDomain(hostname);
    if (!normalizedHostname) return null;
    return normalizedHostname.startsWith('www.') ?
      normalizedHostname.slice(4) :
      normalizedHostname;
  } catch {
    return null;
  }
};

const resolveCookieDomain = () => {
  const explicitDomain = normalizeCookieDomain(process.env.AUTH_COOKIE_DOMAIN);
  if (explicitDomain) {
    return explicitDomain;
  }

  const originCandidates = [
    process.env.FRONTEND_URL,
    ...parseOriginList(process.env.FRONTEND_URLS),
    process.env.AUTH_PUBLIC_BASE_URL,
    process.env.API_BASE_URL
  ];

  for (const candidate of originCandidates) {
    const derivedDomain = deriveCookieDomainFromOrigin(candidate);
    if (derivedDomain) {
      return derivedDomain;
    }
  }

  return null;
};

const parseDurationToMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1000;
  }

  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const unitMs = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * unitMs[unit];
};

const getRefreshCookieMaxAgeMs = () => parseDurationToMs(jwtConfig.jwtRefreshExpiresIn);

const isProduction = () => process.env.NODE_ENV === 'production';

const buildRefreshCookieOptions = ({ rememberMe = true } = {}) => {
  const domain = resolveCookieDomain();
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: REFRESH_COOKIE_PATH
  };

  if (domain) {
    options.domain = domain;
  }

  if (rememberMe) {
    const maxAge = getRefreshCookieMaxAgeMs();
    if (maxAge) {
      options.maxAge = maxAge;
    }
  }

  return options;
};

const parseCookies = (cookieHeader) => {
  const pairs = String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  return pairs.reduce((accumulator, pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      return accumulator;
    }

    const key = decodeURIComponent(pair.slice(0, separatorIndex).trim());
    const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    accumulator[key] = value;
    return accumulator;
  }, {});
};

const getRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers?.cookie);
  const cookieToken = cookies[REFRESH_TOKEN_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  return null;
};

const setRefreshTokenCookie = (res, refreshToken, { rememberMe = true } = {}) => {
  res.cookie(
    REFRESH_TOKEN_COOKIE_NAME,
    refreshToken,
    buildRefreshCookieOptions({ rememberMe })
  );
};

const clearRefreshTokenCookie = (res) => {
  const clearOptions = buildRefreshCookieOptions({ rememberMe: false });
  delete clearOptions.maxAge;
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, clearOptions);
};

module.exports = {
  REFRESH_TOKEN_COOKIE_NAME,
  buildRefreshCookieOptions,
  clearRefreshTokenCookie,
  getRefreshCookieMaxAgeMs,
  getRefreshTokenFromRequest,
  parseCookies,
  setRefreshTokenCookie
};
