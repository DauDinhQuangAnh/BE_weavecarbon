const { v4: uuidv4 } = require('uuid');
const tokens = require('./tokens');
const { demoRepository } = require('./demoRepository');
const { demoB2CSeeder } = require('./demoB2CSeeder');
const subscriptions = require('../shared/subscriptions');
const b2bSeeder = require('../shared/demoB2B');
const analytics = require('../shared/analytics');
const logger = require('../shared/logger');
const {
  DEFAULT_DOMESTIC_MARKET,
  ensureCompaniesDomesticMarketColumn
} = require('../shared/companyMarkets');

const DEMO_PASSWORD = 'Demo@123456';
const DEMO_SESSION_HOURS = 24;
const DEMO_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 900;

function createDemoAccountService({
  repository = demoRepository,
  b2cSeeder = demoB2CSeeder,
  seedDemoB2BData = b2bSeeder.seedDemoB2BData,
  subscriptionService = subscriptions,
  companyMarkets = {
    DEFAULT_DOMESTIC_MARKET,
    ensureCompaniesDomesticMarketColumn
  },
  tokenService = tokens,
  analyticsService = analytics,
  log = logger,
  createUuid = uuidv4,
  now = () => Date.now()
} = {}) {
  const initializeStandardDemo = (client, companyId, standardSkuLimit = 20) => (
    repository.initializeStandard(client, companyId, standardSkuLimit)
  );

  const seedDemoB2CData = (client, userId) => b2cSeeder.seed(client, userId);

  const createDemoUser = async (role, scenario = 'sample_data') => {
    void scenario;
    return repository.withTransaction(async (transaction) => {
      await companyMarkets.ensureCompaniesDomesticMarketColumn(transaction);

      const demoEmail = `demo_${createUuid().slice(0, 8)}@weavecarbon.demo`;
      const passwordHash = await tokenService.hashPassword(DEMO_PASSWORD);
      const demoExpiresAt = new Date(
        now() + DEMO_SESSION_HOURS * 60 * 60 * 1000
      );
      const user = await repository.insertUser(transaction, {
        email: demoEmail,
        passwordHash,
        expiresAt: demoExpiresAt
      });
      const profile = await repository.insertProfile(transaction, {
        userId: user.id,
        email: demoEmail
      });
      await repository.addRole(transaction, user.id, role);

      let company = null;
      let companyMembership = null;
      if (role === 'b2b') {
        company = await repository.insertCompany(
          transaction,
          companyMarkets.DEFAULT_DOMESTIC_MARKET
        );
        await repository.assignProfileCompany(transaction, user.id, company.id);
        profile.company_id = company.id;
        await repository.insertCompanyAdmin(transaction, company.id, user.id);
        companyMembership = {
          company_id: company.id,
          role: 'admin',
          status: 'active',
          is_root: true
        };

        try {
          await initializeStandardDemo(transaction, company.id, 20);
        } catch (error) {
          log.warn(
            { err: error.message },
            `[authService] Demo standard init failed for company ${company.id}`
          );
        }

        try {
          await repository.withB2BSeedSavepoint(
            transaction,
            () => seedDemoB2BData(transaction, company.id, user.id)
          );
        } catch (error) {
          log.warn(
            { err: error.message },
            `[authService] Demo B2B seed failed for company ${company.id}`
          );
        }
      }

      if (role === 'b2c') await seedDemoB2CData(transaction, user.id);

      return {
        user: {
          id: user.id,
          email: user.email,
          full_name: 'Demo User',
          is_demo: true,
          demo_expires_at: demoExpiresAt,
          password: DEMO_PASSWORD
        },
        profile,
        company,
        company_membership: companyMembership
      };
    }, {
      beforeTransaction: (client) => subscriptionService.ensureSchema(client)
    });
  };

  return {
    initializeStandardDemo,
    seedDemoB2CData,
    createDemoUser,

    async createDemoSession(role, scenario = 'sample_data') {
      const { user, profile, company, company_membership: companyMembership } =
        await createDemoUser(role, scenario);
      const accessToken = tokenService.generateAccessToken(
        user.id,
        user.email,
        [role],
        company?.id,
        true
      );
      const refreshToken = tokenService.generateRefreshToken(user.id);
      const expiresAt = new Date(
        now() + DEMO_ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000
      ).toISOString();
      const analyticsIdentity = analyticsService.getAnalyticsIdentity({
        userId: user.id,
        companyId: company?.id || profile?.company_id || null
      });

      return {
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
        company: company
          ? {
              ...company,
              analytics_company_key: analyticsService.buildAnalyticsCompanyKey(company.id)
            }
          : null,
        company_membership: companyMembership || null,
        analytics_user_key: analyticsIdentity.analytics_user_key,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: DEMO_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
          expires_at: expiresAt
        },
        limitations: {
          max_products: role === 'b2b' ? 20 : 0,
          max_calculations: role === 'b2b' ? 100000 : 50,
          export_disabled: role !== 'b2b',
          session_duration_hours: DEMO_SESSION_HOURS
        }
      };
    }
  };
}

module.exports = {
  DEMO_PASSWORD,
  DEMO_SESSION_HOURS,
  DEMO_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  createDemoAccountService,
  demoAccountService: createDemoAccountService()
};
