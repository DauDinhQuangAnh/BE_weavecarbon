const jwtConfig = require('../config/jwt');

const REFRESH_TOKEN_COOKIE_NAME = 'weavecarbon_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

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
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: REFRESH_COOKIE_PATH
  };

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
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: REFRESH_COOKIE_PATH
  });
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
