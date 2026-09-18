const tokens = require('./tokens');
const http = require('./http');
const { refreshSessionService } = require('./refreshSessionService');
const { accountProvisioningService } = require('./accountProvisioningService');
const { sessionContextService } = require('./sessionContextService');
const { verificationService } = require('./verificationService');
const { mfaService } = require('./mfaService');
const analyticsService = require('../shared/analytics');
const logger = require('../shared/logger');

function createAuthSessionService({
  tokenService = tokens,
  refreshSessions = refreshSessionService,
  accounts = accountProvisioningService,
  sessionContext = sessionContextService,
  verification = verificationService,
  mfa = mfaService,
  analytics = analyticsService,
  log = logger,
  httpSupport = http
} = {}) {
  const expired = (code, message, clearCookie) => ({
    kind: 'expired',
    statusCode: 401,
    code,
    message,
    clearCookie
  });

  const safeTrack = async (payload) => {
    try {
      await analytics.trackEvent(payload);
    } catch (error) {
      log.error({ err: error }, '[auth] Failed to track analytics event');
    }
  };

  const buildSession = async (user, accessToken, { updateMembershipLogin = false } = {}) => {
    const { company, companyMembership, companyIdForToken } =
      await sessionContext.resolve(user, { updateMembershipLogin });
    return {
      company,
      companyMembership,
      companyIdForToken,
      data: httpSupport.buildAuthResponseData({
        user,
        company,
        companyMembership,
        companyIdForToken,
        accessToken
      })
    };
  };

  return {
    async signIn({ email, password, totpCode = null, rememberMe = true, metadata = {} }) {
      const user = await accounts.getUserByEmail(email);
      if (!user || !user.password_hash) {
        return {
          kind: 'error',
          statusCode: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        };
      }

      if (!await tokenService.verifyPassword(password, user.password_hash)) {
        return {
          kind: 'error',
          statusCode: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        };
      }

      if (!user.email_verified && !user.is_demo_user) {
        return {
          kind: 'error',
          statusCode: 403,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email before signing in'
        };
      }

      const mfaState = await mfa.getChallengeState(user.id);
      if (mfaState.enabled && !totpCode) {
        return {
          kind: 'error',
          statusCode: 401,
          code: 'MFA_REQUIRED',
          message: 'A multi-factor authentication code is required.'
        };
      }
      if (mfaState.enabled && !await mfa.verifyChallenge(user.id, totpCode)) {
        return {
          kind: 'error',
          statusCode: 401,
          code: 'MFA_CODE_INVALID',
          message: 'The multi-factor authentication code is invalid.'
        };
      }
      const mfaVerified = mfaState.enabled;

      const { company, companyMembership, companyIdForToken } =
        await sessionContext.resolve(user, { updateMembershipLogin: true });
      await verification.markUserLoggedIn(user.id);

      const accessToken = tokenService.generateAccessToken(
        user.id,
        user.email,
        user.roles,
        companyIdForToken,
        user.is_demo_user,
        { mfaVerified }
      );
      const refreshToken = tokenService.generateRefreshToken(user.id, rememberMe, { mfaVerified });
      await refreshSessions.store(refreshToken, user.id, metadata);
      await safeTrack({
        event_name: 'login',
        user_id: user.id,
        company_id: companyIdForToken,
        payload: {
          method: 'email',
          intent: 'signin',
          entry_account_type: httpSupport.resolveEntryAccountType({
            roles: user.roles,
            companyId: companyIdForToken
          })
        }
      });

      return {
        kind: 'authenticated',
        rememberMe,
        refreshToken,
        data: httpSupport.buildAuthResponseData({
          user,
          company,
          companyMembership,
          companyIdForToken,
          accessToken
        })
      };
    },

    async issueRefreshSession({
      refreshToken,
      rotate = true,
      updateMembershipLogin = false,
      metadata = {}
    }) {
      const decoded = tokenService.verifyRefreshToken(refreshToken);
      if (!decoded || decoded.type !== 'refresh') {
        return expired('INVALID_REFRESH_TOKEN', 'Invalid or expired session.', true);
      }

      const rememberMe = decoded.remember_me !== false;
      const mfaState = await mfa.getChallengeState(decoded.sub);
      if (mfaState.enabled && decoded.mfa_verified !== true) {
        await refreshSessions.revoke(refreshToken);
        return expired('MFA_REAUTH_REQUIRED', 'Multi-factor authentication is required. Please sign in again.', true);
      }
      let activeSession;
      let nextRefreshToken = refreshToken;
      if (rotate) {
        nextRefreshToken = tokenService.generateRefreshToken(decoded.sub, rememberMe, {
          mfaVerified: decoded.mfa_verified === true
        });
        activeSession = await refreshSessions.rotate(
          refreshToken,
          nextRefreshToken,
          metadata
        );
      } else {
        activeSession = await refreshSessions.isActive(refreshToken);
      }

      if (!activeSession) {
        return expired('SESSION_EXPIRED', 'Session is no longer active.', rotate);
      }

      const user = await accounts.getUserById(activeSession.user_id || decoded.sub);
      if (!user) {
        return expired('SESSION_USER_NOT_FOUND', 'Session user was not found.', true);
      }

      const { company, companyMembership, companyIdForToken } =
        await sessionContext.resolve(user, { updateMembershipLogin });
      const accessToken = tokenService.generateAccessToken(
        user.id,
        user.email,
        user.roles,
        companyIdForToken,
        user.is_demo_user,
        { mfaVerified: decoded.mfa_verified === true }
      );

      return {
        kind: 'authenticated',
        data: httpSupport.buildAuthResponseData({
          user,
          company,
          companyMembership,
          companyIdForToken,
          accessToken
        }),
        refreshToken: rotate ? nextRefreshToken : null,
        rememberMe
      };
    },

    async issueAccessSession({ accessToken, updateMembershipLogin = false }) {
      const decoded = tokenService.verifyAccessToken(accessToken);
      if (!decoded || (decoded.type && decoded.type !== 'access')) {
        return expired('INVALID_TOKEN', 'Invalid or expired session.', false);
      }

      const user = await accounts.getUserById(decoded.sub);
      if (!user) {
        return expired('SESSION_USER_NOT_FOUND', 'Session user was not found.', true);
      }

      const mfaState = await mfa.getChallengeState(decoded.sub);
      if (mfaState.enabled && decoded.mfa_verified !== true) {
        return expired('MFA_REAUTH_REQUIRED', 'Multi-factor authentication is required. Please sign in again.', false);
      }

      const session = await buildSession(user, accessToken, { updateMembershipLogin });
      return { kind: 'authenticated', data: session.data };
    },

    async signOut({ allDevices = false, refreshToken = null, accessToken = null }) {
      const decodedAccessToken = accessToken
        ? tokenService.verifyAccessToken(accessToken)
        : null;
      const decodedRefreshToken = refreshToken
        ? tokenService.verifyRefreshToken(refreshToken)
        : null;
      const userId = decodedAccessToken?.sub || decodedRefreshToken?.sub || null;

      let revokedCount = 0;
      if (allDevices && userId) {
        revokedCount = await refreshSessions.revokeAll(userId);
      } else if (refreshToken) {
        revokedCount = await refreshSessions.revoke(refreshToken);
      }

      return {
        sessions_revoked: allDevices ? 'all' : revokedCount,
        all_devices: Boolean(allDevices)
      };
    },

    checkCompany(userId) {
      return accounts.getCompanyStatus(userId);
    }
  };
}

module.exports = {
  createAuthSessionService,
  authSessionService: createAuthSessionService()
};
