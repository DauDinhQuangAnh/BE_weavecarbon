const { userRepository } = require('./userRepository');
const { accountProvisioningService } = require('./accountProvisioningService');
const subscriptions = require('../shared/subscriptions');
const logger = require('../shared/logger');
const {
  DEFAULT_DOMESTIC_MARKET,
  ensureCompaniesDomesticMarketColumn,
  normalizeCompanyMarkets
} = require('../shared/companyMarkets');

function createGoogleAccountService({
  repository = userRepository,
  accounts = accountProvisioningService,
  subscriptionService = subscriptions,
  companyMarkets = {
    DEFAULT_DOMESTIC_MARKET,
    ensureCompaniesDomesticMarketColumn,
    normalizeCompanyMarkets
  },
  log = logger
} = {}) {
  const initializeTrial = async (transaction, companyId) => {
    await subscriptionService.ensureSchema(transaction);
    await repository.initializeTrial(transaction, companyId);
  };

  const createOrUpdateGoogleUser = async (
    email,
    fullName,
    avatarUrl,
    role = 'b2c',
    options = {}
  ) => {
    const { skipCompanyCreation = false, markEmailVerified = false } = options;
    const userId = await repository.withTransaction(async (transaction) => {
      await companyMarkets.ensureCompaniesDomesticMarketColumn(transaction);
      const existingUser = await accounts.getUserByEmail(email);

      if (existingUser) {
        await repository.updateGoogleUser(transaction, {
          userId: existingUser.id,
          avatarUrl,
          markEmailVerified
        });
        await repository.updateProfileAvatar(transaction, existingUser.id, avatarUrl);
        return existingUser.id;
      }

      const user = await repository.insertGoogleUser(transaction, {
        email,
        fullName,
        avatarUrl,
        markEmailVerified
      });
      await repository.insertGoogleProfile(transaction, {
        userId: user.id,
        email,
        fullName,
        avatarUrl
      });
      await repository.addRole(transaction, user.id, role);

      if (role === 'b2b' && !skipCompanyCreation) {
        const normalizedMarkets = companyMarkets.normalizeCompanyMarkets({
          currentPlan: 'trial',
          domesticMarket: companyMarkets.DEFAULT_DOMESTIC_MARKET,
          targetMarkets: []
        });
        const company = await repository.insertCompany(transaction, {
          name: `${fullName}'s Company`,
          businessType: 'brand',
          currentPlan: 'trial',
          domesticMarket: normalizedMarkets.domestic_market,
          targetMarkets: normalizedMarkets.target_markets
        });
        await repository.assignProfileCompany(transaction, user.id, company.id);
        await repository.insertCompanyAdmin(transaction, company.id, user.id);
        try {
          await initializeTrial(transaction, company.id);
        } catch (trialError) {
          log.warn(
            { err: trialError.message },
            `[authService] Trial init failed for company ${company.id}`
          );
        }
      }

      if (role === 'b2c') await repository.insertRewards(transaction, user.id);
      return user.id;
    });

    return accounts.getUserById(userId);
  };

  return {
    createOrUpdateGoogleUser,

    async handleGoogleAuth({
      email,
      fullName,
      avatarUrl,
      role = 'b2c',
      intent = 'signin'
    }) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedIntent = intent === 'signup' ? 'signup' : 'signin';
      const fallbackRole = normalizedIntent === 'signup' ? 'b2b' : 'b2c';
      const effectiveRole = ['b2b', 'b2c'].includes(role) ? role : fallbackRole;

      if (!normalizedEmail) {
        const error = new Error('Missing Google email');
        error.code = 'GOOGLE_EMAIL_MISSING';
        error.statusCode = 400;
        throw error;
      }

      const existingUser = await accounts.getUserByEmail(normalizedEmail);
      const isNewUser = !existingUser;
      const user = await createOrUpdateGoogleUser(
        normalizedEmail,
        fullName,
        avatarUrl,
        effectiveRole,
        {
          skipCompanyCreation: isNewUser && effectiveRole === 'b2b',
          markEmailVerified: true
        }
      );
      const isB2B = Array.isArray(user.roles) && user.roles.includes('b2b');
      const requiresEmailVerification = !user.email_verified;

      return {
        user,
        isNewUser,
        requiresCompanySetup: isB2B && !user.company_id,
        requiresEmailVerification,
        shouldSendVerificationEmail: requiresEmailVerification,
        blockLoginUntilEmailVerified: requiresEmailVerification
      };
    }
  };
}

module.exports = {
  createGoogleAccountService,
  googleAccountService: createGoogleAccountService()
};
