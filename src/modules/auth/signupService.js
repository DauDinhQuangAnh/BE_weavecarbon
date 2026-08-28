const { accountProvisioningService } = require('./accountProvisioningService');
const { createAppError } = require('../shared/errors');
const logger = require('../shared/logger');

function createSignupService({
  accounts = accountProvisioningService,
  appError = createAppError,
  log = logger
} = {}) {
  return {
    async register({
      email,
      password,
      fullName,
      role,
      companyName,
      businessType,
      domesticMarket,
      targetMarkets
    }) {
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
    }
  };
}

module.exports = {
  createSignupService,
  signupService: createSignupService()
};
