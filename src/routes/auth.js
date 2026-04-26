const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const analyticsService = require('../services/analyticsService');
const emailService = require('../services/emailService');
const googleAuthService = require('../services/googleAuthService');
const validate = require('../middleware/validator');
const pool = require('../config/database');
const { resolveFrontendBaseUrl } = require('../config/urls');
const {
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
  setRefreshTokenCookie
} = require('../utils/authCookies');
const {
  signupValidation,
  signinValidation,
  refreshValidation,
  verifyEmailValidation,
  demoValidation
} = require('../validators/authValidators');
const {
  signupLimiter,
  signinLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  googleAuthLimiter
} = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

const GOOGLE_OAUTH_CODE_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 8 * 60 * 60;
const SESSION_PERSISTENCE_DISABLED_ERROR = {
  code: 'SESSION_PERSISTENCE_DISABLED',
  message: 'Persistent login is disabled. Please sign in again.'
};
const processedGoogleAuthCodes = new Map();

const GOOGLE_AUTH_ERROR_MESSAGES = {
  MISSING_CODE: 'Google callback is missing authorization code.',
  INVALID_OAUTH_STATE: 'Google authentication session is invalid or expired. Please retry.',
  GOOGLE_ACCOUNT_NOT_FOUND: 'Google account has not been registered. Please sign up first.',
  GOOGLE_EMAIL_ALREADY_REGISTERED: 'Email already exists. Please use Google sign in instead.',
  GOOGLE_TOKEN_EXCHANGE_FAILED: 'Unable to complete Google authentication. Please retry.',
  GOOGLE_USERINFO_FAILED: 'Unable to fetch Google profile. Please retry.',
  GOOGLE_AUTH_FAILED: 'Google authentication failed. Please retry.'
};

const attachAnalyticsCompany = (company) => {
  if (!company) {
    return null;
  }

  const companyId = company.id || company.company_id || null;
  return {
    ...company,
    analytics_company_key: analyticsService.buildAnalyticsCompanyKey(companyId)
  };
};

const resolveEntryAccountType = ({ role = null, roles = [], companyId = null } = {}) => {
  if (role === 'b2c') return 'b2c';
  if (role === 'b2b') return 'b2b';

  if (Array.isArray(roles)) {
    if (roles.includes('b2c')) return 'b2c';
    if (roles.includes('b2b') || roles.includes('admin')) return 'b2b';
  }

  return companyId ? 'b2b' : 'b2c';
};

const safeTrackAnalyticsEvent = async (payload) => {
  try {
    await analyticsService.trackEvent(payload);
  } catch (error) {
    console.error('[auth] Failed to track analytics event:', error);
  }
};

function cleanupProcessedGoogleAuthCodes() {
  const now = Date.now();
  for (const [code, cached] of processedGoogleAuthCodes.entries()) {
    if (now - cached.createdAt > GOOGLE_OAUTH_CODE_CACHE_TTL_MS) {
      processedGoogleAuthCodes.delete(code);
    }
  }
}

function buildFrontendAuthCallbackUrl(params = {}, preferredFrontendOrigin = null) {
  const frontendUrl = resolveFrontendBaseUrl(preferredFrontendOrigin);
  const callbackPath = `${frontendUrl}/auth/callback`;
  const hash = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return hash ? `${callbackPath}#${hash}` : callbackPath;
}

function buildFrontendLoginUrl(preferredFrontendOrigin = null, options = {}) {
  const frontendUrl = resolveFrontendBaseUrl(preferredFrontendOrigin);
  const url = new URL('/auth', frontendUrl);

  if (options.accountType) {
    url.searchParams.set('type', options.accountType);
  }

  if (options.email) {
    url.searchParams.set('email', options.email);
  }

  return url.toString();
}

function resolveRequestedFrontendOrigin(req) {
  return (
    req.query?.frontend_origin ||
    req.query?.frontendOrigin ||
    req.body?.frontend_origin ||
    req.body?.frontendOrigin ||
    req.get('origin') ||
    null
  );
}

function resolvePostAuthNextStep(user, companyIdForToken) {
  const isB2B = Array.isArray(user?.roles) && user.roles.includes('b2b');
  const requiresCompanySetup = isB2B && !companyIdForToken;
  return {
    requiresCompanySetup,
    nextStep: requiresCompanySetup ? 'company_onboarding' : 'dashboard'
  };
}

function normalizeRefreshTokenValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveRefreshTokenValue(req) {
  return (
    normalizeRefreshTokenValue(getRefreshTokenFromRequest(req)) ||
    normalizeRefreshTokenValue(req.body?.refresh_token)
  );
}

function extractBearerAccessToken(req) {
  const authorization = String(req.get('authorization') || '');
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return normalizeRefreshTokenValue(authorization.slice(7));
}

function resolveRequestMetadata(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ipAddress = String(forwardedIp || req.ip || req.socket?.remoteAddress || '').trim() || null;
  const userAgent = String(req.get('user-agent') || '').trim() || null;

  return {
    ipAddress,
    userAgent
  };
}

function buildTokenPayload(accessToken, refreshToken, { includeRefreshToken = true } = {}) {
  const decodedExpiry = authService.decodeJwtExpiry(accessToken);
  const expiresAtDate =
    decodedExpiry instanceof Date && !Number.isNaN(decodedExpiry.getTime()) ?
      decodedExpiry :
      new Date(Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000);
  const expiresIn = Math.max(
    0,
    Math.floor((expiresAtDate.getTime() - Date.now()) / 1000)
  );
  const tokens = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    expires_at: expiresAtDate.toISOString()
  };

  if (includeRefreshToken && refreshToken) {
    tokens.refresh_token = refreshToken;
  }

  return tokens;
}

async function resolveAuthSessionContext(user, { updateMembershipLogin = false } = {}) {
  let company = null;
  let companyMembership = null;
  let companyIdForToken = user.company_id;

  const membership = await authService.getPrimaryCompanyMembership(user.id);
  if (membership) {
    company = {
      id: membership.company_id,
      name: membership.company_name,
      business_type: membership.business_type,
      current_plan: membership.current_plan,
      domestic_market: membership.domestic_market,
      target_markets: membership.target_markets
    };

    companyMembership = {
      company_id: membership.company_id,
      role: membership.company_role,
      status: membership.member_status,
      is_root: membership.company_role === 'admin',
      membership_inferred: false
    };

    companyIdForToken = membership.company_id;

    if (updateMembershipLogin && membership.member_status === 'active') {
      await pool.query(
        `UPDATE company_members
         SET last_login = NOW(), updated_at = NOW()
         WHERE company_id = $1 AND user_id = $2`,
        [membership.company_id, user.id]
      );
    }
  } else if (user.company_id) {
    const companyResult = await pool.query(
      'SELECT id, name, business_type, current_plan, domestic_market, target_markets FROM companies WHERE id = $1',
      [user.company_id]
    );
    company = companyResult.rows[0] || null;

    if (company) {
      companyMembership = {
        company_id: company.id,
        role: 'admin',
        status: 'active',
        is_root: true,
        membership_inferred: true
      };
      companyIdForToken = company.id;
    }
  }

  return {
    company,
    companyMembership,
    companyIdForToken
  };
}

function buildAuthResponseData({
  user,
  company,
  companyMembership,
  companyIdForToken,
  accessToken,
  refreshToken,
  includeRefreshToken = false
}) {
  const analyticsIdentity = analyticsService.getAnalyticsIdentity({
    userId: user.id,
    companyId: companyIdForToken
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      email_verified: user.email_verified,
      avatar_url: user.avatar_url || null
    },
    profile: {
      id: user.profile_id,
      company_id: user.company_id,
      is_demo_user: user.is_demo_user
    },
    roles: user.roles,
    company: attachAnalyticsCompany(company),
    company_membership: companyMembership,
    analytics_user_key: analyticsIdentity.analytics_user_key,
    tokens: buildTokenPayload(accessToken, refreshToken, { includeRefreshToken })
  };
}

function sendSessionExpired(res, message = 'Session expired. Please sign in again.') {
  clearRefreshTokenCookie(res);
  return res.status(401).json({
    success: false,
    error: {
      code: 'SESSION_EXPIRED',
      message
    }
  });
}

async function issueRefreshBackedSession(req, res, refreshToken, {
  rotate = true,
  updateMembershipLogin = false
} = {}) {
  const decodedRefreshToken = authService.verifyRefreshToken(refreshToken);
  if (!decodedRefreshToken || decodedRefreshToken.type !== 'refresh') {
    return sendSessionExpired(res, 'Invalid or expired session.');
  }

  let activeSession = null;
  let nextRefreshToken = refreshToken;
  const rememberMe = decodedRefreshToken.remember_me !== false;
  const metadata = resolveRequestMetadata(req);

  if (rotate) {
    nextRefreshToken = authService.generateRefreshToken(decodedRefreshToken.sub, rememberMe);
    activeSession = await authService.rotateRefreshToken(
      refreshToken,
      nextRefreshToken,
      metadata
    );
  } else {
    activeSession = await authService.isRefreshTokenActive(refreshToken);
  }

  if (!activeSession) {
    return sendSessionExpired(res, 'Session is no longer active.');
  }

  const user = await authService.getUserById(activeSession.user_id || decodedRefreshToken.sub);
  if (!user) {
    return sendSessionExpired(res, 'Session user was not found.');
  }

  const { company, companyMembership, companyIdForToken } = await resolveAuthSessionContext(
    user,
    { updateMembershipLogin }
  );

  const accessToken = authService.generateAccessToken(
    user.id,
    user.email,
    user.roles,
    companyIdForToken,
    user.is_demo_user
  );

  setRefreshTokenCookie(res, nextRefreshToken, { rememberMe });

  return res.json({
    success: true,
    data: buildAuthResponseData({
      user,
      company,
      companyMembership,
      companyIdForToken,
      accessToken
    })
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prefersHtmlResponse(req) {
  const accept = String(req.get('accept') || '').toLowerCase();
  const view = String(req.query.view || '').toLowerCase();
  return view === 'html' || view === 'page' || accept.includes('text/html');
}

function buildVerificationResultPage({
  status = 'success',
  title,
  message,
  details,
  actionUrl,
  actionLabel
}) {
  const isSuccess = status === 'success';
  const accent = isSuccess ? '#16a34a' : '#dc2626';
  const pillBackground = isSuccess ? '#dcfce7' : '#fee2e2';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetails = escapeHtml(details);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeActionLabel = escapeHtml(actionLabel);
  const statusLabel = isSuccess ? 'Verification completed' : 'Verification failed';
  const iconPath = isSuccess
    ? '<path d="M8 20L14 26L28 12" stroke="#16a34a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />'
    : '<path d="M11 11L25 25M25 11L11 25" stroke="#dc2626" stroke-width="3.2" stroke-linecap="round" />';

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
        <style>
          :root {
            color-scheme: light;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background: radial-gradient(circle at 15% 20%, #e0f2fe 0%, #f8fafc 45%, #dcfce7 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #0f172a;
          }
          .card {
            width: min(560px, 100%);
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            padding: 32px 28px;
            box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
            text-align: center;
          }
          .status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 18px;
            padding: 8px 14px;
            border-radius: 999px;
            background: ${pillBackground};
            color: ${accent};
            font-size: 13px;
            font-weight: 700;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 30px;
            line-height: 1.2;
            letter-spacing: -0.02em;
          }
          p {
            margin: 0;
            font-size: 16px;
            line-height: 1.7;
            color: #334155;
          }
          .details {
            margin-top: 12px;
            font-size: 14px;
            color: #64748b;
          }
          .button {
            display: inline-block;
            margin-top: 24px;
            text-decoration: none;
            background: ${accent};
            color: #ffffff;
            border-radius: 12px;
            padding: 12px 24px;
            font-size: 15px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="status">
            <svg width="18" height="18" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <circle cx="18" cy="18" r="17" fill="#ffffff" stroke="${accent}" stroke-width="2" />
              ${iconPath}
            </svg>
            <span>${statusLabel}</span>
          </div>
          <h1>${safeTitle}</h1>
          <p>${safeMessage}</p>
          <p class="details">${safeDetails}</p>
          ${actionUrl && actionLabel ? `<a class="button" href="${safeActionUrl}">${safeActionLabel}</a>` : ''}
        </main>
      </body>
    </html>
  `;
}

// 1. SIGNUP
router.post('/signup', signupLimiter, signupValidation, validate, async (req, res, next) => {
  try {
    const { email, password, full_name, role, company_name, business_type, domestic_market, target_markets, phone } = req.body;

    // Check if email exists
    const existingUser = await authService.getUserByEmail(email);
    if (existingUser) {
      // If email exists but NOT verified, allow re-registration (delete old account)
      if (!existingUser.email_verified) {
        const pendingMembership = await authService.getPrimaryCompanyMembership(existingUser.id);
        if (pendingMembership?.member_status === 'invited') {
          return res.status(409).json({
            success: false,
            error: {
              code: 'INVITED_ACCOUNT_PENDING_ACTIVATION',
              message: 'This email already has a pending company invite. Please use the invite email to continue.'
            }
          });
        }

        console.log(`[auth] Email ${email} exists but is not verified. Deleting old account for re-registration...`);

        // Delete old unverified account
        await pool.query('DELETE FROM users WHERE id = $1', [existingUser.id]);

        console.log('[auth] Old unverified account deleted. Proceeding with new registration.');
      } else {
        // Email verified - cannot re-register
        return res.status(409).json({
          success: false,
          error: {
            code: 'EMAIL_EXISTS',
            message: 'Email already registered and verified. Please login instead.'
          }
        });
      }
    }

    // Create user
    const hasCompanyInfo =
      role === 'b2b' &&
      typeof company_name === 'string' &&
      company_name.trim().length > 0 &&
      typeof business_type === 'string' &&
      business_type.trim().length > 0;

    const companyData = hasCompanyInfo
      ? {
          name: company_name.trim(),
          business_type,
          domestic_market,
          target_markets
        }
      : null;

    const { user, profile, company } = await authService.createUser(
      email,
      password,
      full_name,
      role,
      companyData
    );

    // Generate verification token
    const verificationToken = authService.generateVerificationToken(email);

    // Send verification email (async, don't wait)
    emailService.sendVerificationEmail(email, verificationToken, full_name, null, {
      frontendOrigin: resolveRequestedFrontendOrigin(req)
    })
      .catch(err => console.error('Failed to send verification email:', err));

    await safeTrackAnalyticsEvent({
      event_name: 'sign_up',
      user_id: user.id,
      company_id: company?.id || profile.company_id || null,
      payload: {
        method: 'email',
        intent: 'signup',
        entry_account_type: resolveEntryAccountType({ role })
      }
    });

    const analyticsIdentity = analyticsService.getAnalyticsIdentity({
      userId: user.id,
      companyId: company?.id || profile.company_id || null
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          full_name: full_name,
          email_verified: false
        },
        profile: {
          id: profile.id,
          user_id: user.id,
          company_id: profile.company_id
        },
        role,
        company: attachAnalyticsCompany(company),
        analytics_user_key: analyticsIdentity.analytics_user_key,
        requires_email_verification: true
      }
    });
  } catch (error) {
    next(error);
  }
});

// 2. SIGNIN
router.post('/signin', signinLimiter, signinValidation, validate, async (req, res, next) => {
  try {
    const { email, password, remember_me } = req.body;
    const rememberMe = remember_me !== false;

    // Get user
    const user = await authService.getUserByEmail(email);

    if (!user || !user.password_hash) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    // Verify password
    const isValidPassword = await authService.verifyPassword(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    // Check email verification
    if (!user.email_verified && !user.is_demo_user) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email before signing in'
        }
      });
    }

    const { company, companyMembership, companyIdForToken } = await resolveAuthSessionContext(
      user,
      { updateMembershipLogin: true }
    );

    // Update user last_login
    await authService.markUserLoggedIn(user.id);

    // Generate tokens
    const accessToken = authService.generateAccessToken(
      user.id,
      user.email,
      user.roles,
      companyIdForToken,
      user.is_demo_user
    );
    const refreshToken = authService.generateRefreshToken(user.id, rememberMe);
    await authService.storeRefreshToken(refreshToken, user.id, resolveRequestMetadata(req));

    await safeTrackAnalyticsEvent({
      event_name: 'login',
      user_id: user.id,
      company_id: companyIdForToken,
      payload: {
        method: 'email',
        intent: 'signin',
        entry_account_type: resolveEntryAccountType({
          roles: user.roles,
          companyId: companyIdForToken
        })
      }
    });

    setRefreshTokenCookie(res, refreshToken, { rememberMe });
    res.json({
      success: true,
      data: buildAuthResponseData({
        user,
        company,
        companyMembership,
        companyIdForToken,
        accessToken
      })
    });
  } catch (error) {
    next(error);
  }
});

// 3. SIGNOUT
router.post('/signout', async (req, res, next) => {
  try {
    const { all_devices } = req.body || {};
    const refreshToken = resolveRefreshTokenValue(req);
    const accessToken = extractBearerAccessToken(req);
    const decodedAccessToken = accessToken ? authService.verifyAccessToken(accessToken) : null;
    const decodedRefreshToken = refreshToken ? authService.verifyRefreshToken(refreshToken) : null;
    const userId = decodedAccessToken?.sub || decodedRefreshToken?.sub || null;

    let revokedCount = 0;

    if (all_devices && userId) {
      revokedCount = await authService.revokeAllRefreshTokens(userId);
    } else if (refreshToken) {
      revokedCount = await authService.revokeRefreshToken(refreshToken);
    }

    clearRefreshTokenCookie(res);

    res.json({
      success: true,
      data: {
        sessions_revoked: all_devices ? 'all' : revokedCount,
        all_devices: Boolean(all_devices)
      }
    });
  } catch (error) {
    next(error);
  }
});

// 4. REFRESH TOKEN
router.post('/refresh', refreshLimiter, refreshValidation, validate, async (req, res, next) => {
  try {
    const refreshToken = resolveRefreshTokenValue(req);
    if (!refreshToken) {
      return sendSessionExpired(res, 'No active session was found.');
    }

    return await issueRefreshBackedSession(req, res, refreshToken, {
      rotate: true
    });
  } catch (error) {
    next(error);
  }
});

// 4B. SESSION BOOTSTRAP
router.get('/session', refreshLimiter, async (req, res, next) => {
  try {
    const refreshToken = resolveRefreshTokenValue(req);
    if (!refreshToken) {
      return sendSessionExpired(res, 'No active session was found.');
    }

    return await issueRefreshBackedSession(req, res, refreshToken, {
      rotate: true,
      updateMembershipLogin: true
    });
  } catch (error) {
    next(error);
  }
});

// 5. DEMO LOGIN
router.post('/demo', demoValidation, validate, async (req, res, next) => {
  try {
    const { role, demo_scenario = 'sample_data' } = req.body;

    const { user, profile, company, company_membership } = await authService.createDemoUser(role, demo_scenario);

    // Generate tokens
    const accessToken = authService.generateAccessToken(
      user.id,
      user.email,
      [role],
      company?.id,
      true
    );
    const refreshToken = authService.generateRefreshToken(user.id);

    const expiresIn = 900;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const analyticsIdentity = analyticsService.getAnalyticsIdentity({
      userId: user.id,
      companyId: company?.id || profile?.company_id || null
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          email_verified: true,
          is_demo: true,
          demo_expires_at: user.demo_expires_at
        },
        profile: profile || null,
        roles: [role],
        company: attachAnalyticsCompany(company),
        company_membership: company_membership || null,
        analytics_user_key: analyticsIdentity.analytics_user_key,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: expiresIn,
          expires_at: expiresAt
        },
        limitations: {
          max_products: role === 'b2b' ? 20 : 0,
          max_calculations: role === 'b2b' ? 100000 : 50,
          export_disabled: role !== 'b2b',
          session_duration_hours: 24
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// 6. VERIFY EMAIL (GET - for clicking link in email)
router.get('/verify-email', async (req, res, next) => {
  const wantsHtml = prefersHtmlResponse(req);
  const frontendOrigin = resolveRequestedFrontendOrigin(req);
  const loginUrl = buildFrontendLoginUrl(frontendOrigin);

  const sendVerificationError = (statusCode, code, message, details) => {
    if (wantsHtml) {
      return res.status(statusCode).type('html').send(buildVerificationResultPage({
        status: 'error',
        title: 'Email verification failed',
        message,
        details: details || 'Please request a new verification email and try again.',
        actionUrl: loginUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message
      }
    });
  };

  try {
    const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
    const email = Array.isArray(req.query.email) ? req.query.email[0] : req.query.email;

    if (!token || !email) {
      return sendVerificationError(
        400,
        'MISSING_PARAMETERS',
        'Token and email are required'
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const decoded = authService.verifyEmailToken(token);
    const tokenEmail = String(decoded?.email || '').toLowerCase();

    if (!decoded || decoded.type !== 'email_verification' || tokenEmail !== normalizedEmail) {
      return sendVerificationError(
        400,
        'INVALID_VERIFICATION_TOKEN',
        'Invalid or expired verification token'
      );
    }

    const user = await authService.getUserByEmail(normalizedEmail);

    if (!user) {
      return sendVerificationError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (user.email_verified) {
      if (wantsHtml) {
        return res.status(200).type('html').send(buildVerificationResultPage({
          status: 'success',
          title: 'Email already verified',
          message: 'Your email is already verified.',
          details: 'You can sign in to your account now.',
          actionUrl: loginUrl,
          actionLabel: 'Go to Sign in'
        }));
      }

      return res.json({
        success: true,
        message: 'Email already verified. You can now login.'
      });
    }

    await authService.markEmailVerified(user.id);
    clearRefreshTokenCookie(res);

    const companyIdForToken = await authService.resolveCompanyIdForToken(user.id, user.company_id);
    await safeTrackAnalyticsEvent({
      event_name: 'wc_email_verification_completed',
      user_id: user.id,
      company_id: companyIdForToken,
      payload: {
        method: 'email'
      }
    });
    const signInUrl = buildFrontendLoginUrl(frontendOrigin, {
      accountType: resolveEntryAccountType({
        roles: user.roles,
        companyId: companyIdForToken
      }),
      email: user.email
    });

    if (wantsHtml) {
      return res.status(200).type('html').send(buildVerificationResultPage({
        status: 'success',
        title: 'Email verified successfully',
        message: 'Your account is now active.',
        details: 'Click below to continue to sign in manually.',
        actionUrl: signInUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return res.json({
      success: true,
      message: 'Email verified successfully!',
      data: {
        message: 'Email verified successfully. Please sign in to continue.',
        next_step: 'signin',
        redirect_url: signInUrl
      }
    });
  } catch (error) {
    if (wantsHtml) {
      console.error('Email verification page error:', error);
      return res.status(500).type('html').send(buildVerificationResultPage({
        status: 'error',
        title: 'Unexpected verification error',
        message: 'We could not complete email verification right now.',
        details: 'Please try again in a moment or request a new verification email.',
        actionUrl: loginUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return next(error);
  }
});

// 6B. VERIFY EMAIL (POST - for API calls)
router.post('/verify-email', verifyEmailValidation, validate, async (req, res, next) => {
  try {
    const { token, email } = req.body;

    // Verify token
    const decoded = authService.verifyEmailToken(token);

    if (!decoded || decoded.type !== 'email_verification' || decoded.email !== email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_VERIFICATION_TOKEN',
          message: 'Invalid or expired verification token'
        }
      });
    }

    // Get user
    const user = await authService.getUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email already verified'
        }
      });
    }

    // Mark email as verified
    await authService.markEmailVerified(user.id);
    clearRefreshTokenCookie(res);
    const companyIdForToken = await authService.resolveCompanyIdForToken(user.id, user.company_id);
    await safeTrackAnalyticsEvent({
      event_name: 'wc_email_verification_completed',
      user_id: user.id,
      company_id: companyIdForToken,
      payload: {
        method: 'email'
      }
    });
    const signInUrl = buildFrontendLoginUrl(resolveRequestedFrontendOrigin(req), {
      accountType: resolveEntryAccountType({
        roles: user.roles,
        companyId: companyIdForToken
      }),
      email: user.email
    });

    res.json({
      success: true,
      data: {
        message: 'Email verified successfully. Please sign in to continue.',
        next_step: 'signin',
        redirect_url: signInUrl
      }
    });
  } catch (error) {
    next(error);
  }
});

// 7. RESEND VERIFICATION EMAIL
router.post('/verify-email/resend', verifyEmailLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required'
        }
      });
    }

    const user = await authService.getUserByEmail(email);

    if (!user) {
      // Don't reveal if email exists
      return res.json({
        success: true,
        data: {
          message: 'If the email exists, a verification link has been sent'
        }
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email already verified'
        }
      });
    }

    // Generate new verification token
    const verificationToken = authService.generateVerificationToken(email);

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationToken, user.full_name, null, {
      frontendOrigin: resolveRequestedFrontendOrigin(req)
    });

    res.json({
      success: true,
      data: {
        message: 'Verification email sent'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/accept-company-invite', async (req, res, next) => {
  const wantsHtml = prefersHtmlResponse(req);
  const frontendOrigin = resolveRequestedFrontendOrigin(req);
  const loginUrl = buildFrontendLoginUrl(frontendOrigin, { accountType: 'b2b' });

  res.set('Cache-Control', 'no-store');

  const sendInviteError = (statusCode, code, message, details) => {
    if (wantsHtml) {
      return res.status(statusCode).type('html').send(buildVerificationResultPage({
        status: 'error',
        title: 'Invite link is not available',
        message,
        details: details || 'Please request a new invite from your company administrator.',
        actionUrl: loginUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message
      }
    });
  };

  try {
    const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
    if (!token) {
      return sendInviteError(400, 'MISSING_PARAMETERS', 'Invite token is required');
    }

    const decoded = authService.verifyCompanyInviteToken(token);
    const normalizedEmail = String(decoded?.email || '').trim().toLowerCase();
    const companyId = String(decoded?.company_id || '').trim();

    if (!decoded || decoded.type !== 'company_invite' || !normalizedEmail || !companyId) {
      return sendInviteError(
        400,
        'INVALID_INVITE_TOKEN',
        'Invalid or expired invite token'
      );
    }

    const user = await authService.getUserByEmail(normalizedEmail);
    if (!user) {
      return sendInviteError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const membership = await authService.getCompanyMembership(companyId, user.id);
    if (!membership) {
      return sendInviteError(404, 'INVITE_NOT_FOUND', 'Invite not found');
    }

    if (membership.status === 'disabled') {
      return sendInviteError(
        403,
        'INVITE_DISABLED',
        'This invite is no longer active'
      );
    }

    if (!user.email_verified) {
      await authService.markEmailVerified(user.id);
    }
    clearRefreshTokenCookie(res);

    await authService.activateCompanyMembership(companyId, user.id);
    await pool.query(
      `UPDATE company_members
       SET last_login = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND user_id = $2`,
      [companyId, user.id]
    );
    await authService.markUserLoggedIn(user.id);

    const refreshedUser = await authService.getUserById(user.id);
    const tokenUser = refreshedUser || user;

    await safeTrackAnalyticsEvent({
      event_name: 'login',
      user_id: tokenUser.id,
      company_id: companyId,
      payload: {
        method: 'email_invite',
        intent: 'invite_accept',
        entry_account_type: 'b2b'
      }
    });

    const signInUrl = buildFrontendLoginUrl(frontendOrigin, {
      accountType: 'b2b',
      email: tokenUser.email
    });

    if (wantsHtml) {
      return res.status(200).type('html').send(buildVerificationResultPage({
        status: 'success',
        title: 'Invite accepted successfully',
        message: 'Your access is now active.',
        details: 'Continue to WeaveCarbon and sign in manually to finish setting up your account.',
        actionUrl: signInUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return res.json({
      success: true,
      data: {
        message: 'Invite accepted successfully',
        company_id: companyId,
        next_step: 'signin',
        redirect_url: signInUrl
      }
    });
  } catch (error) {
    if (wantsHtml) {
      console.error('Company invite acceptance error:', error);
      return res.status(500).type('html').send(buildVerificationResultPage({
        status: 'error',
        title: 'Unexpected invite error',
        message: 'We could not complete the invite right now.',
        details: 'Please try again in a moment or request a new invite.',
        actionUrl: loginUrl,
        actionLabel: 'Go to Sign in'
      }));
    }

    return next(error);
  }
});
// 8. GOOGLE OAUTH - Initiate
router.get('/google', googleAuthLimiter, (req, res) => {
  const selectedIntent = googleAuthService.normalizeIntent(
    req.query.intent || req.query.flow || req.query.mode || 'signin'
  );
  const defaultRole = selectedIntent === 'signup' ? 'b2b' : 'b2c';
  const selectedRole = googleAuthService.normalizeRole(req.query.role || defaultRole);
  const rememberMe = googleAuthService.normalizeRememberMe(
    req.query.remember_me || req.query.rememberMe || true
  );

  const authUrl = googleAuthService.getGoogleAuthUrl({
    role: selectedRole,
    intent: selectedIntent,
    frontendOrigin: req.query.frontend_origin || req.query.frontendOrigin || null,
    rememberMe
  });

  res.set('Cache-Control', 'no-store');
  res.redirect(authUrl);
});

// 9. GOOGLE OAUTH - Callback
router.get('/google/callback', googleAuthLimiter, async (req, res) => {
  const { code, state } = req.query;

  res.set('Cache-Control', 'no-store');

  if (!code) {
    const missingCodeRedirect = buildFrontendAuthCallbackUrl({
      error: 'MISSING_CODE',
      error_description: GOOGLE_AUTH_ERROR_MESSAGES.MISSING_CODE
    });
    return res.redirect(missingCodeRedirect);
  }

  cleanupProcessedGoogleAuthCodes();
  const cachedEntry = processedGoogleAuthCodes.get(code);
  if (cachedEntry) {
    return res.redirect(cachedEntry.redirectUrl);
  }

  try {
    const parsedState = googleAuthService.parseState(state);
    if (!parsedState.valid) {
      const err = new Error('Invalid OAuth state');
      err.code = 'INVALID_OAUTH_STATE';
      throw err;
    }

    const { role, intent, frontendOrigin, rememberMe } = parsedState;

    // Exchange code for tokens
    const googleTokens = await googleAuthService.getGoogleTokens(code);

    // Get user info from Google
    const googleUser = await googleAuthService.getGoogleUserInfo(googleTokens.access_token);

    const {
      user,
      isNewUser,
      requiresCompanySetup,
      requiresEmailVerification,
      shouldSendVerificationEmail,
      blockLoginUntilEmailVerified
    } = await authService.handleGoogleAuth({
      email: googleUser.email,
      fullName: googleUser.name,
      avatarUrl: googleUser.picture,
      role,
      intent
    });

    let verificationEmailSent = false;
    if (shouldSendVerificationEmail) {
      try {
        const verificationToken = authService.generateVerificationToken(user.email);
        verificationEmailSent = await emailService.sendVerificationEmail(
          user.email,
          verificationToken,
          user.full_name,
          null,
          { frontendOrigin }
        );
      } catch (sendError) {
        console.error('Failed to send Google verification email:', sendError);
      }
    }

    if (isNewUser) {
      await safeTrackAnalyticsEvent({
        event_name: 'sign_up',
        user_id: user.id,
        company_id: user.company_id || null,
        payload: {
          method: 'google',
          intent: 'signup',
          entry_account_type: resolveEntryAccountType({ role, companyId: user.company_id || null })
        }
      });
    }

    if (blockLoginUntilEmailVerified) {
      clearRefreshTokenCookie(res);
      const verificationRequiredRedirect = buildFrontendAuthCallbackUrl({
        provider: 'google',
        auth_intent: intent,
        is_new_user: isNewUser ? 1 : 0,
        email: user.email,
        requires_email_verification: 1,
        verification_email_sent: verificationEmailSent ? 1 : 0,
        requires_company_setup: requiresCompanySetup ? 1 : 0,
        next_step: 'email_verification'
      }, frontendOrigin);

      processedGoogleAuthCodes.set(code, {
        redirectUrl: verificationRequiredRedirect,
        createdAt: Date.now()
      });

      return res.redirect(verificationRequiredRedirect);
    }

    const { companyIdForToken } = await resolveAuthSessionContext(user, {
      updateMembershipLogin: true
    });
    const { requiresCompanySetup: shouldSetupCompany, nextStep } = resolvePostAuthNextStep(user, companyIdForToken);

    await authService.markUserLoggedIn(user.id);
    await safeTrackAnalyticsEvent({
      event_name: 'login',
      user_id: user.id,
      company_id: companyIdForToken,
      payload: {
        method: 'google',
        intent: 'signin',
        entry_account_type: resolveEntryAccountType({
          role,
          roles: user.roles,
          companyId: companyIdForToken
        })
      }
    });

    // Generate app tokens
    const accessToken = authService.generateAccessToken(
      user.id,
      user.email,
      user.roles,
      companyIdForToken,
      user.is_demo_user || false
    );
    const tokenPayload = buildTokenPayload(accessToken, null, { includeRefreshToken: false });
    const refreshToken = authService.generateRefreshToken(user.id, rememberMe);
    let cookieSessionIssued = false;
    try {
      await authService.storeRefreshToken(refreshToken, user.id, resolveRequestMetadata(req));
      setRefreshTokenCookie(res, refreshToken, { rememberMe });
      cookieSessionIssued = true;
    } catch (sessionError) {
      console.error('[auth] Failed to issue Google cookie session:', sessionError);
      clearRefreshTokenCookie(res);
    }

    // Redirect to frontend with public callback metadata only. Session is carried by httpOnly cookie.
    const redirectUrl = buildFrontendAuthCallbackUrl({
      access_token: accessToken,
      token_type: tokenPayload.token_type,
      expires_in: tokenPayload.expires_in,
      expires_at: tokenPayload.expires_at,
      provider: 'google',
      auth_intent: intent,
      is_new_user: isNewUser ? 1 : 0,
      requires_company_setup: shouldSetupCompany ? 1 : 0,
      requires_email_verification: requiresEmailVerification ? 1 : 0,
      verification_email_sent: verificationEmailSent ? 1 : 0,
      email_verified: user.email_verified ? 1 : 0,
      next_step: nextStep
    }, frontendOrigin);

    processedGoogleAuthCodes.set(code, {
      redirectUrl,
      createdAt: Date.now()
    });

    res.redirect(redirectUrl);
  } catch (error) {
    const errorCode = error.code || 'GOOGLE_AUTH_FAILED';
    const errorDescription =
      GOOGLE_AUTH_ERROR_MESSAGES[errorCode] || GOOGLE_AUTH_ERROR_MESSAGES.GOOGLE_AUTH_FAILED;
    const errorUrl = buildFrontendAuthCallbackUrl({
      error: errorCode,
      error_description: errorDescription
    }, googleAuthService.parseState(state).frontendOrigin);

    processedGoogleAuthCodes.set(code, {
      redirectUrl: errorUrl,
      createdAt: Date.now()
    });

    res.redirect(errorUrl);
  }
});

// 10. CHECK COMPANY - Check if B2B user has company
router.get('/check-company', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user profile with company info
    const result = await pool.query(
      `SELECT p.company_id, ur.role
       FROM profiles p
       LEFT JOIN user_roles ur ON ur.user_id = p.user_id
       WHERE p.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          has_company: false
        }
      });
    }

    const profile = result.rows[0];
    const isB2B = result.rows.some(row => row.role === 'b2b');
    const membership = await authService.getPrimaryCompanyMembership(userId);
    const companyId = profile.company_id || membership?.company_id || null;

    // If B2B and has company_id -> true
    // Otherwise -> false
    const hasCompany = isB2B && companyId !== null;

    res.json({
      success: true,
      data: {
        has_company: hasCompany,
        is_b2b: isB2B,
        company_id: companyId
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

