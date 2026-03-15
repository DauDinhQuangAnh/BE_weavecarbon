const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 1000 : 100, // Much higher limit in dev
  skip: (req) => req.method === 'OPTIONS', // Skip OPTIONS requests
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by user_id if authenticated, otherwise IP
  keyGenerator: (req) => {
    if (req.userId) {
      return `user_${req.userId}`;
    }
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
