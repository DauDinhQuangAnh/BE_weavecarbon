const { accountProvisioningService } = require('./accountProvisioningService');
const tokens = require('./tokens');
const http = require('./http');
const { createAppError } = require('../shared/errors');
const emailService = require('../shared/email');
const analyticsService = require('../shared/analytics');
const logger = require('../shared/logger');

function createSignupService({
  accounts = accountProvisioningService,
  tokenService = tokens,
  mailer = emailService,
  analytics = analyticsService,
  appError = createAppError,
  log = logger,
  httpSupport = http
} = {}) {
  const register = async ({
    email,
    password,
    fullName,
    role,
    companyName,
    businessType,
    domesticMarket,
    targetMarkets
  }) => {
      const existingUser = await accounts.getUserByEmail(email);
      if (existingUser) {
        if (existingUser.email_verified) {
          throw appError('Email already registered and verified. Please login instead.', {
            statusCode: 409,
            code: 'EMAIL_EXISTS'
          });
        }

        const pendingMembership = await accounts.getPrimaryCompanyMembership(existingUser.id, {
          includeInactive: true
        });
        if (pendingMembership?.member_status === 'invited') {
          throw appError(
            'This email already has a pending company invite. Please use the invite email to continue.',
            { statusCode: 409, code: 'INVITED_ACCOUNT_PENDING_ACTIVATION' }
          );
        }

        log.info(
          { email },
          '[auth] Email exists but is not verified. Deleting old account for re-registration...'
        );
        await accounts.deleteUser(existingUser.id);
        log.info('[auth] Old unverified account deleted. Proceeding with new registration.');
      }

      const hasCompanyInfo = role === 'b2b' &&
        typeof companyName === 'string' && companyName.trim().length > 0 &&
        typeof businessType === 'string' && businessType.trim().length > 0;
      const companyData = hasCompanyInfo ? {
        name: companyName.trim(),
        business_type: businessType,
        domestic_market: domesticMarket,
        target_markets: targetMarkets
      } : null;

      return accounts.createUser(email, password, fullName, role, companyData);
  };

  return {
    register,

    async registerWithSideEffects(input, { frontendOrigin = null } = {}) {
      const { email, fullName, role } = input;
      const { user, profile, company } = await register(input);
      const verificationToken = tokenService.generateVerificationToken(email);
      mailer.sendVerificationEmail(email, verificationToken, fullName, null, {
        frontendOrigin
      }).catch((error) => log.error({ err: error }, 'Failed to send verification email'));

      try {
        await analytics.trackEvent({
          event_name: 'sign_up',
          user_id: user.id,
          company_id: company?.id || profile.company_id || null,
          payload: {
            method: 'email',
            intent: 'signup',
            entry_account_type: httpSupport.resolveEntryAccountType({ role })
          }
        });
      } catch (error) {
        log.error({ err: error }, '[auth] Failed to track analytics event');
      }

      const analyticsIdentity = analytics.getAnalyticsIdentity({
        userId: user.id,
        companyId: company?.id || profile.company_id || null
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          full_name: fullName,
          email_verified: false
        },
        profile: {
          id: profile.id,
          user_id: user.id,
          company_id: profile.company_id
        },
        role,
        company: httpSupport.attachAnalyticsCompany(company),
        analytics_user_key: analyticsIdentity.analytics_user_key,
        requires_email_verification: true
      };
    }
  };
}

module.exports = {
  createSignupService,
  signupService: createSignupService()
};
