const { createAppError } = require('../../../src/utils/appError');
const { createSignupService } = require('../../../src/modules/auth/signupService');

function createFixture(overrides = {}) {
  const created = {
    user: { id: 'user-1' },
    profile: { id: 'profile-1', company_id: null },
    company: null
  };
  const accounts = {
    getUserByEmail: jest.fn().mockResolvedValue(null),
    getPrimaryCompanyMembership: jest.fn(),
    deleteUser: jest.fn(),
    createUser: jest.fn().mockResolvedValue(created),
    ...overrides
  };
  const log = { info: jest.fn() };
  return {
    service: createSignupService({ accounts, appError: createAppError, log }),
    accounts,
    log,
    created
  };
}

const signup = {
  email: 'user@example.com',
  password: 'Password1!',
  fullName: 'User',
  role: 'b2b',
  companyName: ' Example Co ',
  businessType: 'brand',
  domesticMarket: 'VN',
  targetMarkets: ['EU']
};

describe('auth signup service', () => {
  test('builds company data only for a complete B2B signup', async () => {
    const fixture = createFixture();

    await expect(fixture.service.register(signup)).resolves.toBe(fixture.created);
    expect(fixture.accounts.createUser).toHaveBeenCalledWith(
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
  });

  test('rejects an already verified email with the existing contract', async () => {
    const fixture = createFixture({
      getUserByEmail: jest.fn().mockResolvedValue({ id: 'old-user', email_verified: true })
    });

    await expect(fixture.service.register(signup)).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_EXISTS',
      message: 'Email already registered and verified. Please login instead.'
    });
    expect(fixture.accounts.createUser).not.toHaveBeenCalled();
  });

  test('protects an invited account from re-registration', async () => {
    const fixture = createFixture({
      getUserByEmail: jest.fn().mockResolvedValue({ id: 'old-user', email_verified: false }),
      getPrimaryCompanyMembership: jest.fn().mockResolvedValue({ member_status: 'invited' })
    });

    await expect(fixture.service.register(signup)).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVITED_ACCOUNT_PENDING_ACTIVATION'
    });
    expect(fixture.accounts.deleteUser).not.toHaveBeenCalled();
  });

  test('replaces an unverified non-invited account before creating the new one', async () => {
    const fixture = createFixture({
      getUserByEmail: jest.fn().mockResolvedValue({ id: 'old-user', email_verified: false }),
      getPrimaryCompanyMembership: jest.fn().mockResolvedValue(null)
    });

    await expect(fixture.service.register(signup)).resolves.toBe(fixture.created);
    expect(fixture.accounts.deleteUser).toHaveBeenCalledWith('old-user');
    expect(fixture.accounts.deleteUser.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.accounts.createUser.mock.invocationCallOrder[0]);
    expect(fixture.log.info).toHaveBeenCalledTimes(2);
  });

  test('does not create company data for B2C even when company fields are supplied', async () => {
    const fixture = createFixture();

    await fixture.service.register({ ...signup, role: 'b2c' });
    expect(fixture.accounts.createUser).toHaveBeenCalledWith(
      'user@example.com',
      'Password1!',
      'User',
      'b2c',
      null
    );
  });
});
