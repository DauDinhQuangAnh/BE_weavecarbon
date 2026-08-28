const {
  createSessionContextService
} = require('../../../src/modules/auth/sessionContextService');

describe('auth session context service', () => {
  function createFixture({ membership = null, company = null } = {}) {
    const accounts = {
      getPrimaryCompanyMembership: jest.fn().mockResolvedValue(membership)
    };
    const users = { findCompanyById: jest.fn().mockResolvedValue(company) };
    const verification = { markMembershipLoggedIn: jest.fn().mockResolvedValue() };
    const service = createSessionContextService({ accounts, users, verification });
    return { service, accounts, users, verification };
  }

  test('uses the primary membership and records login for an active member', async () => {
    const membership = {
      company_id: 'company-1',
      company_name: 'Example Co',
      business_type: 'brand',
      current_plan: 'trial',
      domestic_market: 'VN',
      target_markets: ['EU'],
      company_role: 'admin',
      member_status: 'active'
    };
    const { service, users, verification } = createFixture({ membership });

    await expect(service.resolve(
      { id: 'user-1', company_id: 'legacy-company' },
      { updateMembershipLogin: true }
    )).resolves.toEqual({
      company: {
        id: 'company-1',
        name: 'Example Co',
        business_type: 'brand',
        current_plan: 'trial',
        domestic_market: 'VN',
        target_markets: ['EU']
      },
      companyMembership: {
        company_id: 'company-1',
        role: 'admin',
        status: 'active',
        is_root: true,
        membership_inferred: false
      },
      companyIdForToken: 'company-1'
    });
    expect(verification.markMembershipLoggedIn)
      .toHaveBeenCalledWith('company-1', 'user-1');
    expect(users.findCompanyById).not.toHaveBeenCalled();
  });

  test('does not record login for an inactive membership', async () => {
    const { service, verification } = createFixture({
      membership: {
        company_id: 'company-1',
        company_role: 'member',
        member_status: 'invited'
      }
    });

    await service.resolve({ id: 'user-1' }, { updateMembershipLogin: true });

    expect(verification.markMembershipLoggedIn).not.toHaveBeenCalled();
  });

  test('preserves the legacy profile-company fallback as an inferred admin membership', async () => {
    const company = {
      id: 'company-legacy',
      name: 'Legacy Co',
      business_type: 'supplier',
      current_plan: 'free',
      domestic_market: 'VN',
      target_markets: []
    };
    const { service, users } = createFixture({ company });

    await expect(service.resolve({ id: 'user-1', company_id: 'company-legacy' }))
      .resolves.toEqual({
        company,
        companyMembership: {
          company_id: 'company-legacy',
          role: 'admin',
          status: 'active',
          is_root: true,
          membership_inferred: true
        },
        companyIdForToken: 'company-legacy'
      });
    expect(users.findCompanyById).toHaveBeenCalledWith('company-legacy');
  });

  test('returns an empty company context when no membership or legacy company exists', async () => {
    const { service, users } = createFixture();

    await expect(service.resolve({ id: 'user-1', company_id: null })).resolves.toEqual({
      company: null,
      companyMembership: null,
      companyIdForToken: null
    });
    expect(users.findCompanyById).not.toHaveBeenCalled();
  });
});
