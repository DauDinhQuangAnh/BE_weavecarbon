const tokens = require('./tokens');
const { userRepository } = require('./userRepository');
const subscriptions = require('../shared/subscriptions');
const logger = require('../shared/logger');
const {
  ensureCompaniesDomesticMarketColumn,
  normalizeCompanyMarkets
} = require('../shared/companyMarkets');

function normalizeRoles(value) {
  if (typeof value === 'string') {
    return value.replace(/[{}]/g, '').split(',').filter((role) => role && role !== 'NULL');
  }
  if (Array.isArray(value)) {
    return value.filter((role) => role !== null && role !== undefined);
  }
  return [];
}

function mapUser(row, { includeCredentials = false } = {}) {
  if (!row) return null;
  const user = {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    company_id: row.company_id,
    is_demo_user: row.is_demo_user,
    roles: normalizeRoles(row.roles),
    email_verified: row.email_verified,
    created_at: row.created_at
  };
  if (includeCredentials) {
    user.password_hash = row.password_hash;
    user.failed_login_attempts = row.failed_login_attempts || 0;
    user.locked_until = row.locked_until;
  }
  return user;
}

function createAccountProvisioningService({
  repository = userRepository,
  tokenService = tokens,
  subscriptionService = subscriptions,
  companyMarkets = { ensureCompaniesDomesticMarketColumn, normalizeCompanyMarkets },
  log = logger
} = {}) {
  const initializeTrial = async (transaction, companyId) => {
    await subscriptionService.ensureSchema(transaction);
    await repository.initializeTrial(transaction, companyId);
  };

  return {
    initializeTrial,

    async createInvitedCompanyUser({ client, email, fullName, companyId }) {
      const temporaryPassword = tokenService.generateSystemPassword();
      const passwordHash = await tokenService.hashPassword(temporaryPassword);
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedFullName = String(fullName || '').trim();

      const user = await repository.insertUser(client, {
        email: normalizedEmail,
        passwordHash,
        fullName: normalizedFullName
      });
      const profile = await repository.insertProfile(client, {
        userId: user.id,
        email: normalizedEmail,
        fullName: normalizedFullName,
        companyId
      });
      await repository.addRole(client, user.id, 'b2b');

      return { user, profile, temporaryPassword };
    },

    async createUser(email, password, fullName, role, companyData = null) {
      return repository.withTransaction(async (transaction) => {
        await companyMarkets.ensureCompaniesDomesticMarketColumn(transaction);
        const passwordHash = await tokenService.hashPassword(password);
        const user = await repository.insertUser(transaction, {
          email,
          passwordHash,
          fullName
        });
        const profile = await repository.insertProfile(transaction, {
          userId: user.id,
          email,
          fullName
        });
        await repository.addRole(transaction, user.id, role);

        let company = null;
        if (role === 'b2b' && companyData) {
          const normalizedMarkets = companyMarkets.normalizeCompanyMarkets({
            currentPlan: 'trial',
            domesticMarket: companyData.domestic_market,
            targetMarkets: companyData.target_markets
          });
          company = await repository.insertCompany(transaction, {
            name: companyData.name,
            businessType: companyData.business_type,
            currentPlan: 'trial',
            domesticMarket: normalizedMarkets.domestic_market,
            targetMarkets: normalizedMarkets.target_markets
          });
          await repository.assignProfileCompany(transaction, user.id, company.id);
          profile.company_id = company.id;
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
        return { user, profile, company };
      });
    },

    deleteUser(userId) {
      return repository.deleteUser(userId);
    },

    async getUserByEmail(email) {
      return mapUser(await repository.findUserByEmail(email), { includeCredentials: true });
    },

    async getUserById(userId) {
      return mapUser(await repository.findUserById(userId));
    },

    async getPrimaryCompanyMembership(userId, options = {}) {
      const { includeInactive = false } = options;
      return repository.withConnection(async (connection) => {
        await companyMarkets.ensureCompaniesDomesticMarketColumn(connection);
        return repository.findPrimaryCompanyMembership(connection, userId, includeInactive);
      });
    },

    async getCompanyStatus(userId) {
      const rows = await repository.findProfileRoles(userId);
      if (rows.length === 0) return { has_company: false };

      const membership = await repository.withConnection(async (connection) => {
        await companyMarkets.ensureCompaniesDomesticMarketColumn(connection);
        return repository.findPrimaryCompanyMembership(connection, userId, false);
      });
      const isB2B = rows.some((row) => row.role === 'b2b');
      const companyId = rows[0].company_id || membership?.company_id || null;
      return {
        has_company: isB2B && companyId !== null,
        is_b2b: isB2B,
        company_id: companyId
      };
    }
  };
}

module.exports = {
  normalizeRoles,
  mapUser,
  createAccountProvisioningService,
  accountProvisioningService: createAccountProvisioningService()
};
