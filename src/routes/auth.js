const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { signupService, verificationService } = require('../modules/auth');
const analyticsService = require('../services/analyticsService');
const emailService = require('../services/emailService');
const googleAuthService = require('../services/googleAuthService');
const validate = require('../middleware/validator');
const pool = require('../config/database');
const logger = require('../utils/logger');
const {
  clearRefreshTokenCookie,
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
const {
  GOOGLE_AUTH_ERROR_MESSAGES,
  attachAnalyticsCompany,
  resolveEntryAccountType,
  safeTrackAnalyticsEvent,
  buildFrontendAuthCallbackUrl,
  buildFrontendLoginUrl,
  resolveRequestedFrontendOrigin,
  resolvePostAuthNextStep,
  resolveRefreshTokenValue,
  extractBearerAccessToken,
  resolveRequestMetadata,
  buildTokenPayload,
  buildAuthResponseData,
  sendSessionExpired,
  prefersHtmlResponse,
  buildVerificationResultPage
} = require('./auth/helpers');

const GOOGLE_OAUTH_CODE_CACHE_TTL_MS = 5 * 60 * 1000;
const processedGoogleAuthCodes = new Map();


router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});


function cleanupProcessedGoogleAuthCodes() {
  const now = Date.now();
  for (const [code, cached] of processedGoogleAuthCodes.entries()) {
    if (now - cached.createdAt > GOOGLE_OAUTH_CODE_CACHE_TTL_MS) {
      processedGoogleAuthCodes.delete(code);
    }
  }
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


async function issueRefreshBackedSession(req, res, refreshToken, {
  rotate = true,
  updateMembershipLogin = false
} = {}) {
  const decodedRefreshToken = authService.verifyRefreshToken(refreshToken);
  if (!decodedRefreshToken || decodedRefreshToken.type !== 'refresh') {
    return sendSessionExpired(res, 'Invalid or expired session.', {
      code: 'INVALID_REFRESH_TOKEN',
      clearCookie: true
    });
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
    return sendSessionExpired(res, 'Session is no longer active.', {
      code: 'SESSION_EXPIRED',
      clearCookie: rotate
    });
  }

  const user = await authService.getUserById(activeSession.user_id || decodedRefreshToken.sub);
  if (!user) {
    return sendSessionExpired(res, 'Session user was not found.', {
      code: 'SESSION_USER_NOT_FOUND',
      clearCookie: true
    });
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

  if (rotate) {
    setRefreshTokenCookie(res, nextRefreshToken, { rememberMe });
  }

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

async function issueAccessBackedSession(req, res, accessToken, {
  updateMembershipLogin = false
} = {}) {
  const decodedAccessToken = authService.verifyAccessToken(accessToken);
  // Older access tokens did not include type; accept them until they naturally expire.
  if (!decodedAccessToken || (decodedAccessToken.type && decodedAccessToken.type !== 'access')) {
    return sendSessionExpired(res, 'Invalid or expired session.', {
      code: 'INVALID_TOKEN',
      clearCookie: false
    });
  }

  const user = await authService.getUserById(decodedAccessToken.sub);
  if (!user) {
    return sendSessionExpired(res, 'Session user was not found.', {
      code: 'SESSION_USER_NOT_FOUND',
      clearCookie: true
    });
  }

  const { company, companyMembership, companyIdForToken } = await resolveAuthSessionContext(
    user,
    { updateMembershipLogin }
  );

  return res.json({
    success: true,
    data: buildAuthResponseData({
      user,
      company,
      companyMembership,
      companyIdForToken,
      accessToken,
      includeRefreshToken: false
    })
  });
}


/**
 * @openapi
 * /auth/signup:
 *   post:
 *     summary: Register a new user (and optionally a B2B company)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, full_name, role]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               full_name: { type: string }
 *               role: { type: string, enum: [b2b, b2c] }
 *               company_name: { type: string }
 *               business_type: { type: string }
 *               domestic_market: { type: string }
 *               target_markets: { type: array, items: { type: string } }
 *               phone: { type: string }
 *     responses:
 *       201:
 *         description: Account created; verification email sent.
 *       409:
 *         description: Email already registered (and verified), or a company invite is pending.
 */
// 1. SIGNUP
router.post('/signup', signupLimiter, signupValidation, validate, async (req, res, next) => {
  try {
    const { email, password, full_name, role, company_name, business_type, domestic_market, target_markets } = req.body;

    const { user, profile, company } = await signupService.register({
      email,
      password,
      fullName: full_name,
      role,
      companyName: company_name,
      businessType: business_type,
      domesticMarket: domestic_market,
      targetMarkets: target_markets
    });

    // Generate verification token
    const verificationToken = authService.generateVerificationToken(email);

    // Send verification email (async, don't wait)
    emailService.sendVerificationEmail(email, verificationToken, full_name, null, {
      frontendOrigin: resolveRequestedFrontendOrigin(req)
    })
      .catch(err => logger.error({ err }, 'Failed to send verification email'));

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

/**
 * @openapi
 * /auth/signin:
 *   post:
 *     summary: Sign in with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               remember_me: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Signed in. Sets a refresh-token cookie and returns an access token.
 *       401:
 *         description: Invalid email or password.
 *       403:
 *         description: Email not verified.
 */
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

/**
 * @openapi
 * /auth/signout:
 *   post:
 *     summary: Sign out (revoke the current refresh token, or all sessions)
 *     tags: [Auth]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               all_devices: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Session(s) revoked and refresh-token cookie cleared.
 */
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

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Rotate the refresh token and issue a new access token
 *     tags: [Auth]
 *     security: []
 *     description: Reads the refresh token from the httpOnly cookie (or request body/header, depending on client).
 *     responses:
 *       200:
 *         description: New access token issued; refresh-token cookie rotated.
 *       401:
 *         description: No active session / invalid or expired refresh token.
 */
// 4. REFRESH TOKEN
router.post('/refresh', refreshLimiter, refreshValidation, validate, async (req, res, next) => {
  try {
    const refreshToken = resolveRefreshTokenValue(req);
    if (!refreshToken) {
      return sendSessionExpired(res, 'No active session was found.', {
        code: 'NO_ACTIVE_SESSION',
        clearCookie: false
      });
    }

    return await issueRefreshBackedSession(req, res, refreshToken, {
      rotate: true
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /auth/session:
 *   get:
 *     summary: Bootstrap the current session from a refresh-token cookie or bearer access token
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Current user/company/session data.
 *       401:
 *         description: No active session was found.
 */
// 4B. SESSION BOOTSTRAP
router.get('/session', refreshLimiter, async (req, res, next) => {
  try {
    const refreshToken = resolveRefreshTokenValue(req);
    if (!refreshToken) {
      const accessToken = extractBearerAccessToken(req);
      if (accessToken) {
        return await issueAccessBackedSession(req, res, accessToken, {
          updateMembershipLogin: true
        });
      }

      return sendSessionExpired(res, 'No active session was found.', {
        code: 'NO_ACTIVE_SESSION',
        clearCookie: false
      });
    }

    return await issueRefreshBackedSession(req, res, refreshToken, {
      rotate: false,
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

    const verification = await verificationService.verifyEmail({
      token,
      emailAddress: email,
      normalizeEmail: true,
      alreadyVerified: 'success'
    });
    const { user, companyIdForToken } = verification;

    if (verification.alreadyVerified) {
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

    clearRefreshTokenCookie(res);
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
    if (error.statusCode && error.statusCode < 500) {
      return sendVerificationError(error.statusCode, error.code, error.message);
    }
    if (wantsHtml) {
      logger.error({ err: error }, 'Email verification page error');
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

    const { user, companyIdForToken } = await verificationService.verifyEmail({
      token,
      emailAddress: email,
      normalizeEmail: false,
      alreadyVerified: 'error'
    });
    clearRefreshTokenCookie(res);
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
    const result = await verificationService.resendVerification(email, {
      frontendOrigin: resolveRequestedFrontendOrigin(req)
    });

    res.json({
      success: true,
      data: {
        message: result.hidden ?
          'If the email exists, a verification link has been sent' :
          'Verification email sent'
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
    const { companyId, user: tokenUser } = await verificationService.acceptCompanyInvite(
      token,
      { onBeforeActivation: () => clearRefreshTokenCookie(res) }
    );

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
    if (error.statusCode && error.statusCode < 500) {
      return sendInviteError(error.statusCode, error.code, error.message);
    }
    if (wantsHtml) {
      logger.error({ err: error }, 'Company invite acceptance error');
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
        logger.error({ err: sendError }, 'Failed to send Google verification email');
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
        role,
        type: role,
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
    try {
      await authService.storeRefreshToken(refreshToken, user.id, resolveRequestMetadata(req));
      setRefreshTokenCookie(res, refreshToken, { rememberMe });
    } catch (sessionError) {
      logger.error({ err: sessionError }, '[auth] Failed to issue Google cookie session');
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
      role,
      type: role,
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
    const parsedState = googleAuthService.parseState(state);
    const errorCode = error.code || 'GOOGLE_AUTH_FAILED';
    const errorDescription =
      GOOGLE_AUTH_ERROR_MESSAGES[errorCode] || GOOGLE_AUTH_ERROR_MESSAGES.GOOGLE_AUTH_FAILED;
    const errorUrl = buildFrontendAuthCallbackUrl({
      error: errorCode,
      error_description: errorDescription,
      role: parsedState.valid ? parsedState.role : undefined,
      type: parsedState.valid ? parsedState.role : undefined
    }, parsedState.frontendOrigin);

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

