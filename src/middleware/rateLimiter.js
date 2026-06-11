const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');

const isDev = process.env.NODE_ENV !== 'production';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const apiWindowMs = parsePositiveInt(
  process.env.API_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const apiMax = parsePositiveInt(
  process.env.API_RATE_LIMIT_MAX,
  isDev ? 10000 : 10000
);
const isApiRateLimitDisabled =
  String(process.env.API_RATE_LIMIT_DISABLED || '').toLowerCase() === 'true' ||
  process.env.API_RATE_LIMIT_DISABLED === '1';

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
};

const getAuthenticatedRateLimitKey = (req) => {
  if (req.userId) {
    return `user_${req.userId}`;
  }

  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const decoded = authService.verifyAccessToken(token);
  return decoded?.sub ? `user_${decoded.sub}` : null;
};

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: apiMax,
  skip: (req) => isApiRateLimitDisabled || req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by authenticated user when possible. This limiter runs before route auth.
  keyGenerator: (req) => {
    const authenticatedKey = getAuthenticatedRateLimitKey(req);
    if (authenticatedKey) return authenticatedKey;
    return req.ip || req.connection.remoteAddress;
  }
});

// Strict limiter for signup
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 50 : 5, // More lenient in dev
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many signup attempts, please try again later'
    }
  },
  keyGenerator: (req) => req.ip,
});

// Strict limiter for signin
const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 50 : 10, // More lenient in dev
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts, please try again later'
    }
  },
  skipSuccessfulRequests: true,
});

// Strict limiter for refresh token
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 100 : 30, // More lenient in dev
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many refresh requests'
    }
  },
});

// Dedicated limiter for Google OAuth endpoints
const googleAuthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isDev ? 120 : 30,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many Google authentication attempts'
    }
  },
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
});

// Strict limiter for email verification resend
const verifyEmailLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isDev ? 20 : 3, // More lenient in dev
  skip: (req) => req.method === 'OPTIONS',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many verification email requests'
    }
  },
  keyGenerator: (req) => req.body.email || req.ip,
});

module.exports = {
  apiLimiter,
  signupLimiter,
  signinLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  googleAuthLimiter
};
