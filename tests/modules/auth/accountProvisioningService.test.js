const {
  createAccountProvisioningService
} = require('../../../src/modules/auth/accountProvisioningService');

function createFixture(overrides = {}) {
  const transaction = { id: 'transaction' };
  const connection = { id: 'connection' };
  const repository = {
    withTransaction: jest.fn((work) => work(transaction)),
    withConnection: jest.fn((work) => work(connection)),
    insertUser: jest.fn().mockResolvedValue({
      id: 'user-1', email: 'user@example.com', full_name: 'User', email_verified: false
    }),
    insertProfile: jest.fn().mockResolvedValue({
      id: 'profile-1', user_id: 'user-1', company_id: null
    }),
    addRole: jest.fn(),
    insertCompany: jest.fn().mockResolvedValue({
      id: 'company-1', name: 'Example Co', current_plan: 'trial'
    }),
    assignProfileCompany: jest.fn(),
    insertCompanyAdmin: jest.fn(),
    initializeTrial: jest.fn(),
    insertRewards: jest.fn(),
    deleteUser: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    findProfileRoles: jest.fn().mockResolvedValue([]),
    findPrimaryCompanyMembership: jest.fn(),
    ...overrides
  };
  const tokenService = {
    generateSystemPassword: jest.fn().mockReturnValue('Temporary1!'),
    hashPassword: jest.fn().mockResolvedValue('password-hash')
  };
  const subscriptionService = { ensureSchema: jest.fn() };
  const companyMarkets = {
    ensureCompaniesDomesticMarketColumn: jest.fn(),
    normalizeCompanyMarkets: jest.fn().mockReturnValue({
      domestic_market: 'VN', target_markets: []
    })
  };
  const log = { warn: jest.fn() };
  const service = createAccountProvisioningService({
    repository,
    tokenService,
    subscriptionService,
    companyMarkets,
    log
  });
  return {
    service,
    repository,
    tokenService,
    subscriptionService,
    companyMarkets,
    log,
    transaction,
    connection
  };
}

describe('auth account provisioning service', () => {
  test('creates an invited B2B user on the caller transaction', async () => {
    const fixture = createFixture();

    await expect(fixture.service.createInvitedCompanyUser({
      client: fixture.transaction,
      email: ' User@Example.com ',
      fullName: ' Invited User ',
      companyId: 'company-1'
    })).resolves.toMatchObject({
      user: { id: 'user-1' },
      profile: { id: 'profile-1' },
      temporaryPassword: 'Temporary1!'
    });
    expect(fixture.repository.insertUser).toHaveBeenCalledWith(fixture.transaction, {
      email: 'user@example.com',
      passwordHash: 'password-hash',
      fullName: 'Invited User'
    });
    expect(fixture.repository.insertProfile).toHaveBeenCalledWith(fixture.transaction, {
      userId: 'user-1',
      email: 'user@example.com',
      fullName: 'Invited User',
      companyId: 'company-1'
    });
    expect(fixture.repository.addRole).toHaveBeenCalledWith(
      fixture.transaction,
      'user-1',
      'b2b'
    );
  });

  test('provisions a B2B company, admin membership and trial atomically', async () => {
    const fixture = createFixture();

    const result = await fixture.service.createUser(
      'user@example.com',
      'Password1!',
      'User',
      'b2b',
      {
        name: 'Example Co',
        business_type: 'brand',
        domestic_market: 'VN',
        target_markets: ['EU']
      }
    );

    expect(result).toMatchObject({
      user: { id: 'user-1' },
      profile: { id: 'profile-1', company_id: 'company-1' },
      company: { id: 'company-1' }
    });
    expect(fixture.repository.withTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.companyMarkets.normalizeCompanyMarkets).toHaveBeenCalledWith({
      currentPlan: 'trial', domesticMarket: 'VN', targetMarkets: ['EU']
    });
    expect(fixture.repository.insertCompanyAdmin).toHaveBeenCalledWith(
      fixture.transaction,
      'company-1',
      'user-1'
    );
    expect(fixture.subscriptionService.ensureSchema).toHaveBeenCalledWith(fixture.transaction);
    expect(fixture.repository.initializeTrial).toHaveBeenCalledWith(
      fixture.transaction,
      'company-1'
    );
  });

  test('keeps account creation successful when trial initialization fails', async () => {
    const fixture = createFixture();
    fixture.subscriptionService.ensureSchema.mockRejectedValue(new Error('trial unavailable'));

    await expect(fixture.service.createUser(
      'user@example.com',
      'Password1!',
      'User',
      'b2b',
      { name: 'Example Co', business_type: 'brand' }
    )).resolves.toMatchObject({ user: { id: 'user-1' }, company: { id: 'company-1' } });
    expect(fixture.log.warn).toHaveBeenCalledWith(
      { err: 'trial unavailable' },
      '[authService] Trial init failed for company company-1'
    );
  });

  test('creates rewards for B2C without creating a company', async () => {
    const fixture = createFixture();

    await expect(fixture.service.createUser(
      'consumer@example.com',
      'Password1!',
      'Consumer',
      'b2c'
    )).resolves.toMatchObject({ company: null });
    expect(fixture.repository.insertRewards).toHaveBeenCalledWith(
      fixture.transaction,
      'user-1'
    );
    expect(fixture.repository.insertCompany).not.toHaveBeenCalled();
  });

  test('maps PostgreSQL role strings and signin credential fields', async () => {
    const fixture = createFixture({
      findUserByEmail: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        roles: '{b2b,NULL,admin}',
        failed_login_attempts: null,
        password_hash: 'password-hash',
        email_verified: true
      })
    });

    await expect(fixture.service.getUserByEmail('user@example.com')).resolves.toMatchObject({
      id: 'user-1',
      roles: ['b2b', 'admin'],
      failed_login_attempts: 0,
      password_hash: 'password-hash'
    });
  });

  test('loads membership through a released repository connection', async () => {
    const membership = { company_id: 'company-1', member_status: 'invited' };
    const fixture = createFixture({
      findPrimaryCompanyMembership: jest.fn().mockResolvedValue(membership)
    });

    await expect(fixture.service.getPrimaryCompanyMembership('user-1', {
      includeInactive: true
    })).resolves.toBe(membership);
    expect(fixture.companyMarkets.ensureCompaniesDomesticMarketColumn)
      .toHaveBeenCalledWith(fixture.connection);
    expect(fixture.repository.findPrimaryCompanyMembership).toHaveBeenCalledWith(
      fixture.connection,
      'user-1',
      true
    );
  });

  test('resolves company status from profile roles and membership fallback', async () => {
    const fixture = createFixture({
      findProfileRoles: jest.fn().mockResolvedValue([
        { company_id: null, role: 'b2b' }
      ]),
      findPrimaryCompanyMembership: jest.fn().mockResolvedValue({
        company_id: 'company-1'
      })
    });

    await expect(fixture.service.getCompanyStatus('user-1')).resolves.toEqual({
      has_company: true,
      is_b2b: true,
      company_id: 'company-1'
    });
    expect(fixture.repository.findPrimaryCompanyMembership).toHaveBeenCalledWith(
      fixture.connection,
      'user-1',
      false
    );
  });

  test('preserves the minimal check-company response when no profile exists', async () => {
    const fixture = createFixture();

    await expect(fixture.service.getCompanyStatus('missing-user')).resolves.toEqual({
      has_company: false
    });
    expect(fixture.repository.withConnection).not.toHaveBeenCalled();
  });
});
