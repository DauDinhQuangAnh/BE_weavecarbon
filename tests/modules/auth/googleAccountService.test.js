const {
  createGoogleAccountService
} = require('../../../src/modules/auth/googleAccountService');

function createFixture(overrides = {}) {
  const transaction = { id: 'transaction' };
  const repository = {
    withTransaction: jest.fn((work) => work(transaction)),
    updateGoogleUser: jest.fn(),
    updateProfileAvatar: jest.fn(),
    insertGoogleUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    insertGoogleProfile: jest.fn(),
    addRole: jest.fn(),
    insertCompany: jest.fn().mockResolvedValue({ id: 'company-1' }),
    assignProfileCompany: jest.fn(),
    insertCompanyAdmin: jest.fn(),
    initializeTrial: jest.fn(),
    insertRewards: jest.fn(),
    ...overrides.repository
  };
  const accounts = {
    getUserByEmail: jest.fn().mockResolvedValue(null),
    getUserById: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: ['b2c'],
      email_verified: true,
      company_id: null
    }),
    ...overrides.accounts
  };
  const subscriptionService = { ensureSchema: jest.fn() };
  const companyMarkets = {
    DEFAULT_DOMESTIC_MARKET: 'VN',
    ensureCompaniesDomesticMarketColumn: jest.fn(),
    normalizeCompanyMarkets: jest.fn().mockReturnValue({
      domestic_market: 'VN', target_markets: []
    })
  };
  const log = { warn: jest.fn() };
  const service = createGoogleAccountService({
    repository,
    accounts,
    subscriptionService,
    companyMarkets,
    log
  });
  return { service, repository, accounts, subscriptionService, companyMarkets, log, transaction };
}

describe('auth Google account service', () => {
  test('updates an existing account avatar and verification state transactionally', async () => {
    const fixture = createFixture({
      accounts: {
        getUserByEmail: jest.fn().mockResolvedValue({ id: 'existing-user' }),
        getUserById: jest.fn().mockResolvedValue({ id: 'existing-user', email_verified: true })
      }
    });

    await expect(fixture.service.createOrUpdateGoogleUser(
      'user@example.com', 'User', 'https://avatar.example.com', 'b2c', {
        markEmailVerified: true
      }
    )).resolves.toMatchObject({ id: 'existing-user' });
    expect(fixture.repository.updateGoogleUser).toHaveBeenCalledWith(fixture.transaction, {
      userId: 'existing-user',
      avatarUrl: 'https://avatar.example.com',
      markEmailVerified: true
    });
    expect(fixture.repository.updateProfileAvatar).toHaveBeenCalledWith(
      fixture.transaction,
      'existing-user',
      'https://avatar.example.com'
    );
    expect(fixture.repository.insertGoogleUser).not.toHaveBeenCalled();
  });

  test('creates rewards for a new B2C Google account', async () => {
    const fixture = createFixture();

    await fixture.service.createOrUpdateGoogleUser(
      'user@example.com', 'User', 'avatar', 'b2c', { markEmailVerified: true }
    );
    expect(fixture.repository.insertGoogleUser).toHaveBeenCalledWith(fixture.transaction, {
      email: 'user@example.com',
      fullName: 'User',
      avatarUrl: 'avatar',
      markEmailVerified: true
    });
    expect(fixture.repository.addRole).toHaveBeenCalledWith(
      fixture.transaction,
      'user-1',
      'b2c'
    );
    expect(fixture.repository.insertRewards).toHaveBeenCalledWith(fixture.transaction, 'user-1');
  });

  test('creates a default B2B company only when not explicitly skipped', async () => {
    const fixture = createFixture({
      accounts: { getUserById: jest.fn().mockResolvedValue({ id: 'user-1', roles: ['b2b'] }) }
    });

    await fixture.service.createOrUpdateGoogleUser(
      'user@example.com', 'User', 'avatar', 'b2b', { skipCompanyCreation: false }
    );
    expect(fixture.repository.insertCompany).toHaveBeenCalledWith(fixture.transaction, {
      name: "User's Company",
      businessType: 'brand',
      currentPlan: 'trial',
      domesticMarket: 'VN',
      targetMarkets: []
    });
    expect(fixture.repository.insertCompanyAdmin).toHaveBeenCalledWith(
      fixture.transaction,
      'company-1',
      'user-1'
    );
  });

  test('keeps new B2B Google signup pending company onboarding', async () => {
    const fixture = createFixture({
      accounts: {
        getUserById: jest.fn().mockResolvedValue({
          id: 'user-1', roles: ['b2b'], email_verified: true, company_id: null
        })
      }
    });

    await expect(fixture.service.handleGoogleAuth({
      email: ' User@Example.com ',
      fullName: 'User',
      avatarUrl: 'avatar',
      role: 'b2b',
      intent: 'signup'
    })).resolves.toMatchObject({
      isNewUser: true,
      requiresCompanySetup: true,
      requiresEmailVerification: false
    });
    expect(fixture.repository.insertCompany).not.toHaveBeenCalled();
    expect(fixture.repository.insertGoogleUser).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ email: 'user@example.com' })
    );
  });

  test('rejects Google identity without an email', async () => {
    const fixture = createFixture();
    await expect(fixture.service.handleGoogleAuth({ email: ' ' })).rejects.toMatchObject({
      code: 'GOOGLE_EMAIL_MISSING', statusCode: 400
    });
    expect(fixture.repository.withTransaction).not.toHaveBeenCalled();
  });
});
