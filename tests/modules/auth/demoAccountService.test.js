const {
  DEMO_PASSWORD,
  createDemoAccountService
} = require('../../../src/modules/auth/demoAccountService');

function createFixture(overrides = {}) {
  const transaction = { id: 'transaction' };
  const repository = {
    withTransaction: jest.fn(async (work, options) => {
      await options.beforeTransaction(transaction);
      return work(transaction);
    }),
    insertUser: jest.fn().mockResolvedValue({
      id: 'user-1', email: 'demo_12345678@weavecarbon.demo'
    }),
    insertProfile: jest.fn().mockResolvedValue({
      id: 'profile-1', user_id: 'user-1', company_id: null
    }),
    addRole: jest.fn().mockResolvedValue(),
    insertCompany: jest.fn().mockResolvedValue({
      id: 'company-1', name: 'Demo Company', current_plan: 'standard'
    }),
    assignProfileCompany: jest.fn().mockResolvedValue(),
    insertCompanyAdmin: jest.fn().mockResolvedValue(),
    initializeStandard: jest.fn().mockResolvedValue(),
    withB2BSeedSavepoint: jest.fn((_client, work) => work()),
    ...overrides.repository
  };
  const b2cSeeder = { seed: jest.fn().mockResolvedValue(), ...overrides.b2cSeeder };
  const seedDemoB2BData = jest.fn().mockResolvedValue();
  const subscriptionService = { ensureSchema: jest.fn().mockResolvedValue() };
  const companyMarkets = {
    DEFAULT_DOMESTIC_MARKET: 'VN',
    ensureCompaniesDomesticMarketColumn: jest.fn().mockResolvedValue()
  };
  const tokenService = {
    hashPassword: jest.fn().mockResolvedValue('password-hash'),
    generateAccessToken: jest.fn().mockReturnValue('access-token'),
    generateRefreshToken: jest.fn().mockReturnValue('refresh-token')
  };
  const analyticsService = {
    getAnalyticsIdentity: jest.fn().mockReturnValue({ analytics_user_key: 'user-key' }),
    buildAnalyticsCompanyKey: jest.fn().mockReturnValue('company-key')
  };
  const log = { warn: jest.fn() };
  const dependencies = {
    repository,
    b2cSeeder,
    seedDemoB2BData,
    subscriptionService,
    companyMarkets,
    tokenService,
    analyticsService,
    log,
    createUuid: jest.fn().mockReturnValue('12345678-abcd-efgh-ijkl-123456789012'),
    now: jest.fn().mockReturnValue(Date.parse('2026-08-28T00:00:00.000Z'))
  };
  return {
    service: createDemoAccountService(dependencies),
    transaction,
    ...dependencies
  };
}

describe('auth demo account service', () => {
  test('creates B2B account, membership, standard access and optional sample data', async () => {
    const fixture = createFixture();

    await expect(fixture.service.createDemoUser('b2b', 'sample_data')).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'demo_12345678@weavecarbon.demo',
        full_name: 'Demo User',
        is_demo: true,
        demo_expires_at: new Date('2026-08-29T00:00:00.000Z'),
        password: DEMO_PASSWORD
      },
      profile: { id: 'profile-1', user_id: 'user-1', company_id: 'company-1' },
      company: { id: 'company-1', name: 'Demo Company', current_plan: 'standard' },
      company_membership: {
        company_id: 'company-1', role: 'admin', status: 'active', is_root: true
      }
    });
    expect(fixture.subscriptionService.ensureSchema).toHaveBeenCalledWith(fixture.transaction);
    expect(fixture.companyMarkets.ensureCompaniesDomesticMarketColumn)
      .toHaveBeenCalledWith(fixture.transaction);
    expect(fixture.tokenService.hashPassword).toHaveBeenCalledWith(DEMO_PASSWORD);
    expect(fixture.repository.insertCompany).toHaveBeenCalledWith(fixture.transaction, 'VN');
    expect(fixture.repository.initializeStandard)
      .toHaveBeenCalledWith(fixture.transaction, 'company-1', 20);
    expect(fixture.seedDemoB2BData)
      .toHaveBeenCalledWith(fixture.transaction, 'company-1', 'user-1');
    expect(fixture.b2cSeeder.seed).not.toHaveBeenCalled();
  });

  test('keeps optional B2B subscription and sample seed failures non-fatal', async () => {
    const standardFailure = new Error('subscription unavailable');
    const seedFailure = new Error('optional tables unavailable');
    const fixture = createFixture({
      repository: {
        initializeStandard: jest.fn().mockRejectedValue(standardFailure),
        withB2BSeedSavepoint: jest.fn().mockRejectedValue(seedFailure)
      }
    });

    await expect(fixture.service.createDemoUser('b2b')).resolves.toMatchObject({
      user: { id: 'user-1' },
      company: { id: 'company-1' }
    });
    expect(fixture.log.warn).toHaveBeenCalledWith(
      { err: standardFailure.message },
      '[authService] Demo standard init failed for company company-1'
    );
    expect(fixture.log.warn).toHaveBeenCalledWith(
      { err: seedFailure.message },
      '[authService] Demo B2B seed failed for company company-1'
    );
  });

  test('creates B2C rewards without company provisioning', async () => {
    const fixture = createFixture();

    await expect(fixture.service.createDemoUser('b2c')).resolves.toMatchObject({
      company: null,
      company_membership: null,
      profile: { company_id: null }
    });
    expect(fixture.b2cSeeder.seed).toHaveBeenCalledWith(fixture.transaction, 'user-1');
    expect(fixture.repository.insertCompany).not.toHaveBeenCalled();
    expect(fixture.seedDemoB2BData).not.toHaveBeenCalled();
  });

  test('builds the established token, analytics and limitation response contract', async () => {
    const provisioned = {
      user: {
        id: 'user-1',
        email: 'demo_12345678@weavecarbon.demo',
        full_name: 'Demo User',
        is_demo: true,
        demo_expires_at: new Date('2026-08-29T00:00:00.000Z')
      },
      profile: { id: 'profile-1', company_id: 'company-1' },
      company: { id: 'company-1', name: 'Demo Company' },
      company_membership: { company_id: 'company-1', role: 'admin' }
    };
    const fixture = createFixture({
      repository: { withTransaction: jest.fn().mockResolvedValue(provisioned) }
    });

    await expect(fixture.service.createDemoSession('b2b', 'sample_data')).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'demo_12345678@weavecarbon.demo',
        full_name: 'Demo User',
        email_verified: true,
        is_demo: true,
        demo_expires_at: new Date('2026-08-29T00:00:00.000Z')
      },
      profile: { id: 'profile-1', company_id: 'company-1' },
      roles: ['b2b'],
      company: {
        id: 'company-1',
        name: 'Demo Company',
        analytics_company_key: 'company-key'
      },
      company_membership: { company_id: 'company-1', role: 'admin' },
      analytics_user_key: 'user-key',
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 900,
        expires_at: '2026-08-28T00:15:00.000Z'
      },
      limitations: {
        max_products: 20,
        max_calculations: 100000,
        export_disabled: false,
        session_duration_hours: 24
      }
    });
    expect(fixture.tokenService.generateAccessToken).toHaveBeenCalledWith(
      'user-1',
      'demo_12345678@weavecarbon.demo',
      ['b2b'],
      'company-1',
      true
    );
    expect(fixture.tokenService.generateRefreshToken).toHaveBeenCalledWith('user-1');
  });
});
