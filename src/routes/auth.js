const express = require('express');
const router = express.Router();
const {
  signupService,
  verificationService,
  googleOAuthFlowService,
  demoAccountService,
  authSessionService,
  http: {
    GOOGLE_AUTH_ERROR_MESSAGES,
    resolveEntryAccountType,
    safeTrackAnalyticsEvent,
    buildFrontendAuthCallbackUrl,
    buildFrontendLoginUrl,
    resolveRequestedFrontendOrigin,
    resolveRefreshTokenValue,
    extractBearerAccessToken,
    resolveRequestMetadata,
    buildTokenPayload,
    sendSessionExpired,
    prefersHtmlResponse,
    buildVerificationResultPage
  },
  validation: {
    signupValidation,
    signinValidation,
    refreshValidation,
    verifyEmailValidation,
    demoValidation
  }
} = require('../modules/auth');
const validate = require('../middleware/validator');
const logger = require('../utils/logger');
const {
  clearRefreshTokenCookie,
  setRefreshTokenCookie
} = require('../utils/authCookies');
const {
  signupLimiter,
  signinLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  googleAuthLimiter
} = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});


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
    const {
      email,
      password,
      full_name,
      role,
      company_name,
      business_type,
      domestic_market,
      target_markets
    } = req.body;
    const data = await signupService.registerWithSideEffects({
      email,
      password,
      fullName: full_name,
      role,
      companyName: company_name,
      businessType: business_type,
      domesticMarket: domestic_market,
      targetMarkets: target_markets
    }, {
      frontendOrigin: resolveRequestedFrontendOrigin(req)
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return next(error);
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
    const result = await authSessionService.signIn({
      email,
      password,
      rememberMe: remember_me !== false,
      metadata: resolveRequestMetadata(req)
    });

    if (result.kind === 'error') {
      return res.status(result.statusCode).json({
        success: false,
        error: {
          code: result.code,
          message: result.message
        }
      });
    }

    setRefreshTokenCookie(res, result.refreshToken, { rememberMe: result.rememberMe });
    return res.json({ success: true, data: result.data });
  } catch (error) {
    return next(error);
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
    const data = await authSessionService.signOut({
      allDevices: Boolean(req.body?.all_devices),
      refreshToken: resolveRefreshTokenValue(req),
      accessToken: extractBearerAccessToken(req)
    });
    clearRefreshTokenCookie(res);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
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

    const result = await authSessionService.issueRefreshSession({
      refreshToken,
      rotate: true,
      metadata: resolveRequestMetadata(req)
    });
    if (result.kind === 'expired') {
      return sendSessionExpired(res, result.message, {
        code: result.code,
        clearCookie: result.clearCookie
      });
    }

    setRefreshTokenCookie(res, result.refreshToken, { rememberMe: result.rememberMe });
    return res.json({ success: true, data: result.data });
  } catch (error) {
    return next(error);
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
    let result;
    if (refreshToken) {
      result = await authSessionService.issueRefreshSession({
        refreshToken,
        rotate: false,
        updateMembershipLogin: true,
        metadata: resolveRequestMetadata(req)
      });
    } else {
      const accessToken = extractBearerAccessToken(req);
      if (!accessToken) {
        return sendSessionExpired(res, 'No active session was found.', {
          code: 'NO_ACTIVE_SESSION',
          clearCookie: false
        });
      }
      result = await authSessionService.issueAccessSession({
        accessToken,
        updateMembershipLogin: true
      });
    }

    if (result.kind === 'expired') {
      return sendSessionExpired(res, result.message, {
        code: result.code,
        clearCookie: result.clearCookie
      });
    }
    return res.json({ success: true, data: result.data });
  } catch (error) {
    return next(error);
  }
});

// 5. DEMO LOGIN
router.post('/demo', demoValidation, validate, async (req, res, next) => {
  try {
    const { role, demo_scenario = 'sample_data' } = req.body;
    const data = await demoAccountService.createDemoSession(role, demo_scenario);
    res.json({
      success: true,
      data
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
  res.set('Cache-Control', 'no-store');
  res.redirect(googleOAuthFlowService.buildAuthorizationUrl({
    intent: req.query.intent,
    flow: req.query.flow,
    mode: req.query.mode,
    role: req.query.role,
    remember_me: req.query.remember_me,
    rememberMe: req.query.rememberMe,
    frontend_origin: req.query.frontend_origin,
    frontendOrigin: req.query.frontendOrigin
  }));
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

  const cachedRedirect = googleOAuthFlowService.getCachedRedirect(code);
  if (cachedRedirect) return res.redirect(cachedRedirect);

  try {
    const {
      kind,
      user,
      isNewUser,
      requiresCompanySetup,
      requiresEmailVerification,
      verificationEmailSent,
      role,
      intent,
      frontendOrigin,
      rememberMe,
      accessToken,
      refreshToken,
      shouldSetupCompany,
      nextStep
    } = await googleOAuthFlowService.authenticate({
      code,
      state,
      requestMetadata: resolveRequestMetadata(req)
    });

    if (kind === 'verification_required') {
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
      googleOAuthFlowService.cacheRedirect(code, verificationRequiredRedirect);
      return res.redirect(verificationRequiredRedirect);
    }

    const tokenPayload = buildTokenPayload(accessToken, null, { includeRefreshToken: false });
    if (refreshToken) {
      setRefreshTokenCookie(res, refreshToken, { rememberMe });
    } else {
      clearRefreshTokenCookie(res);
    }

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
    googleOAuthFlowService.cacheRedirect(code, redirectUrl);
    return res.redirect(redirectUrl);
  } catch (error) {
    const parsedState = googleOAuthFlowService.parseState(state);
    const errorCode = error.code || 'GOOGLE_AUTH_FAILED';
    const errorDescription =
      GOOGLE_AUTH_ERROR_MESSAGES[errorCode] || GOOGLE_AUTH_ERROR_MESSAGES.GOOGLE_AUTH_FAILED;
    const errorUrl = buildFrontendAuthCallbackUrl({
      error: errorCode,
      error_description: errorDescription,
      role: parsedState.valid ? parsedState.role : undefined,
      type: parsedState.valid ? parsedState.role : undefined
    }, parsedState.frontendOrigin);
    googleOAuthFlowService.cacheRedirect(code, errorUrl);
    return res.redirect(errorUrl);
  }
});

// 10. CHECK COMPANY - Check if B2B user has company
router.get('/check-company', authenticate, async (req, res, next) => {
  try {
    const data = await authSessionService.checkCompany(req.user.id);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
