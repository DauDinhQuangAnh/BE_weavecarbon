const { googleOAuthClient } = require('./googleOAuthClient');
const { googleAccountService } = require('./googleAccountService');
const { sessionContextService } = require('./sessionContextService');
const { verificationService } = require('./verificationService');
const { refreshSessionService } = require('./refreshSessionService');
const tokens = require('./tokens');
const analyticsService = require('../shared/analytics');
const emailService = require('../shared/email');
const logger = require('../shared/logger');

const GOOGLE_OAUTH_CODE_CACHE_TTL_MS = 5 * 60 * 1000;

function createGoogleOAuthFlowService({
  client = googleOAuthClient,
  googleAccounts = googleAccountService,
  sessionContext = sessionContextService,
  verification = verificationService,
  refreshSessions = refreshSessionService,
  tokenService = tokens,
  analytics = analyticsService,
  email = emailService,
  log = logger,
  codeCache = new Map(),
  codeCacheTtlMs = GOOGLE_OAUTH_CODE_CACHE_TTL_MS,
  now = () => Date.now()
} = {}) {
  const safeTrack = async (payload) => {
    try {
      await analytics.trackEvent(payload);
    } catch (error) {
      log.error({ err: error }, '[auth] Failed to track analytics event');
    }
  };

  const resolveEntryAccountType = ({ role = null, roles = [], companyId = null } = {}) => {
    if (role === 'b2c') return 'b2c';
    if (role === 'b2b') return 'b2b';
    if (roles.includes('b2c')) return 'b2c';
    if (roles.includes('b2b') || roles.includes('admin')) return 'b2b';
    return companyId ? 'b2b' : 'b2c';
  };

  const cleanupCodeCache = () => {
    const currentTime = now();
    for (const [code, cached] of codeCache.entries()) {
      if (currentTime - cached.createdAt > codeCacheTtlMs) codeCache.delete(code);
    }
  };

  return {
    buildAuthorizationUrl(query = {}) {
      const intent = client.normalizeIntent(query.intent || query.flow || query.mode || 'signin');
      const role = client.normalizeRole(query.role || (intent === 'signup' ? 'b2b' : 'b2c'));
      const rememberMe = client.normalizeRememberMe(
        query.remember_me || query.rememberMe || true
      );
      return client.getGoogleAuthUrl({
        role,
        intent,
        frontendOrigin: query.frontend_origin || query.frontendOrigin || null,
        rememberMe
      });
    },

    parseState(state) {
      return client.parseState(state);
    },

    getCachedRedirect(code) {
      cleanupCodeCache();
      return codeCache.get(code)?.redirectUrl || null;
    },

    cacheRedirect(code, redirectUrl) {
      codeCache.set(code, { redirectUrl, createdAt: now() });
    },

    async authenticate({ code, state, requestMetadata = {} }) {
      const parsedState = client.parseState(state);
      if (!parsedState.valid) {
        const error = new Error('Invalid OAuth state');
        error.code = 'INVALID_OAUTH_STATE';
        throw error;
      }

      const { role, intent, frontendOrigin, rememberMe } = parsedState;
      const googleTokens = await client.getGoogleTokens(code);
      const googleUser = await client.getGoogleUserInfo(googleTokens.access_token);
      const account = await googleAccounts.handleGoogleAuth({
        email: googleUser.email,
        fullName: googleUser.name,
        avatarUrl: googleUser.picture,
        role,
        intent
      });
      const {
        user,
        isNewUser,
        requiresCompanySetup,
        requiresEmailVerification,
        shouldSendVerificationEmail,
        blockLoginUntilEmailVerified
      } = account;

      let verificationEmailSent = false;
      if (shouldSendVerificationEmail) {
        try {
          verificationEmailSent = await email.sendVerificationEmail(
            user.email,
            tokenService.generateVerificationToken(user.email),
            user.full_name,
            null,
            { frontendOrigin }
          );
        } catch (error) {
          log.error({ err: error }, 'Failed to send Google verification email');
        }
      }

      if (isNewUser) {
        await safeTrack({
          event_name: 'sign_up',
          user_id: user.id,
          company_id: user.company_id || null,
          payload: {
            method: 'google',
            intent: 'signup',
            entry_account_type: resolveEntryAccountType({
              role,
              companyId: user.company_id || null
            })
          }
        });
      }

      const common = {
        role,
        intent,
        frontendOrigin,
        rememberMe,
        user,
        isNewUser,
        requiresCompanySetup,
        requiresEmailVerification,
        verificationEmailSent
      };
      if (blockLoginUntilEmailVerified) {
        return { kind: 'verification_required', ...common };
      }

      const { companyIdForToken } = await sessionContext.resolve(user, {
        updateMembershipLogin: true
      });
      const shouldSetupCompany =
        Array.isArray(user.roles) && user.roles.includes('b2b') && !companyIdForToken;
      const nextStep = shouldSetupCompany ? 'company_onboarding' : 'dashboard';

      await verification.markUserLoggedIn(user.id);
      await safeTrack({
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

      const accessToken = tokenService.generateAccessToken(
        user.id,
        user.email,
        user.roles,
        companyIdForToken,
        user.is_demo_user || false
      );
      const refreshToken = tokenService.generateRefreshToken(user.id, rememberMe);
      let persistedRefreshToken = refreshToken;
      try {
        await refreshSessions.store(refreshToken, user.id, requestMetadata);
      } catch (error) {
        persistedRefreshToken = null;
        log.error({ err: error }, '[auth] Failed to issue Google cookie session');
      }

      return {
        kind: 'authenticated',
        ...common,
        companyIdForToken,
        shouldSetupCompany,
        nextStep,
        accessToken,
        refreshToken: persistedRefreshToken
      };
    }
  };
}

module.exports = {
  GOOGLE_OAUTH_CODE_CACHE_TTL_MS,
  createGoogleOAuthFlowService,
  googleOAuthFlowService: createGoogleOAuthFlowService()
};
