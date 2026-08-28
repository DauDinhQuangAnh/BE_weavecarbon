const { createAppError } = require('../../../src/utils/appError');
const {
  createVerificationService
} = require('../../../src/modules/auth/verificationService');

function createFixture(overrides = {}) {
  const tokenService = {
    verifyEmailToken: jest.fn().mockReturnValue({
      type: 'email_verification', email: 'user@example.com'
    }),
    generateVerificationToken: jest.fn().mockReturnValue('verification-token'),
    verifyCompanyInviteToken: jest.fn().mockReturnValue({
      type: 'company_invite', email: 'user@example.com', company_id: 'company-1'
    })
  };
  const accounts = {
    getUserByEmail: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      full_name: 'User',
      email_verified: false,
      company_id: null,
      roles: ['b2b']
    }),
    getUserById: jest.fn().mockResolvedValue({
      id: 'user-1', email: 'user@example.com', email_verified: true, roles: ['b2b']
    }),
    getPrimaryCompanyMembership: jest.fn().mockResolvedValue({ company_id: 'company-1' })
  };
  const repository = {
    defaultClient: { id: 'pool' },
    markEmailVerified: jest.fn(),
    findCompanyMembership: jest.fn().mockResolvedValue({
      company_id: 'company-1', user_id: 'user-1', status: 'invited'
    }),
    activateCompanyMembership: jest.fn(),
    markMembershipLoggedIn: jest.fn(),
    markUserLoggedIn: jest.fn()
  };
  const email = { sendVerificationEmail: jest.fn().mockResolvedValue(true) };
  Object.assign(tokenService, overrides.tokenService);
  Object.assign(accounts, overrides.accounts);
  Object.assign(repository, overrides.repository);
  Object.assign(email, overrides.email);
  const service = createVerificationService({
    tokenService,
    accounts,
    repository,
    email,
    appError: createAppError
  });
  return { service, tokenService, accounts, repository, email };
}

describe('auth verification service', () => {
  test('normalizes GET verification email and marks the account verified', async () => {
    const fixture = createFixture();

    await expect(fixture.service.verifyEmail({
      token: 'token',
      emailAddress: ' User@Example.com ',
      normalizeEmail: true,
      alreadyVerified: 'success'
    })).resolves.toMatchObject({
      alreadyVerified: false,
      user: { id: 'user-1' },
      companyIdForToken: 'company-1'
    });
    expect(fixture.accounts.getUserByEmail).toHaveBeenCalledWith('user@example.com');
    expect(fixture.repository.markEmailVerified).toHaveBeenCalledWith('user-1');
  });

  test('preserves exact POST token/email comparison', async () => {
    const fixture = createFixture();

    await expect(fixture.service.verifyEmail({
      token: 'token',
      emailAddress: 'User@Example.com',
      normalizeEmail: false,
      alreadyVerified: 'error'
    })).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_TOKEN', statusCode: 400 });
    expect(fixture.accounts.getUserByEmail).not.toHaveBeenCalled();
  });

  test('returns success for an already verified GET account', async () => {
    const fixture = createFixture({
      accounts: { getUserByEmail: jest.fn().mockResolvedValue({
        id: 'user-1', email: 'user@example.com', email_verified: true
      }) }
    });

    await expect(fixture.service.verifyEmail({
      token: 'token', emailAddress: 'user@example.com', alreadyVerified: 'success'
    })).resolves.toMatchObject({ alreadyVerified: true });
    expect(fixture.repository.markEmailVerified).not.toHaveBeenCalled();
  });

  test('rejects an already verified POST account with the existing code', async () => {
    const fixture = createFixture({
      accounts: { getUserByEmail: jest.fn().mockResolvedValue({
        id: 'user-1', email: 'user@example.com', email_verified: true
      }) }
    });

    await expect(fixture.service.verifyEmail({
      token: 'token',
      emailAddress: 'user@example.com',
      normalizeEmail: false,
      alreadyVerified: 'error'
    })).rejects.toMatchObject({ code: 'ALREADY_VERIFIED', statusCode: 400 });
  });

  test('does not reveal whether an email exists during resend', async () => {
    const fixture = createFixture({
      accounts: { getUserByEmail: jest.fn().mockResolvedValue(null) }
    });

    await expect(fixture.service.resendVerification('missing@example.com'))
      .resolves.toEqual({ sent: false, hidden: true });
    expect(fixture.email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('resends a generated verification token with frontend origin', async () => {
    const fixture = createFixture();

    await expect(fixture.service.resendVerification('user@example.com', {
      frontendOrigin: 'https://app.example.com'
    })).resolves.toEqual({ sent: true, hidden: false });
    expect(fixture.email.sendVerificationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'verification-token',
      'User',
      null,
      { frontendOrigin: 'https://app.example.com' }
    );
  });

  test('rejects a disabled company invite before changing user state', async () => {
    const fixture = createFixture({
      repository: { findCompanyMembership: jest.fn().mockResolvedValue({ status: 'disabled' }) }
    });

    await expect(fixture.service.acceptCompanyInvite('invite-token'))
      .rejects.toMatchObject({ code: 'INVITE_DISABLED', statusCode: 403 });
    expect(fixture.repository.markEmailVerified).not.toHaveBeenCalled();
    expect(fixture.repository.activateCompanyMembership).not.toHaveBeenCalled();
  });

  test('accepts an invite in the established mutation order', async () => {
    const fixture = createFixture();
    const onBeforeActivation = jest.fn();

    await expect(fixture.service.acceptCompanyInvite('invite-token', {
      onBeforeActivation
    })).resolves.toMatchObject({
      companyId: 'company-1',
      user: { id: 'user-1', email_verified: true }
    });
    expect(fixture.repository.markEmailVerified).toHaveBeenCalledWith('user-1');
    expect(onBeforeActivation).toHaveBeenCalledTimes(1);
    expect(onBeforeActivation.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.repository.activateCompanyMembership.mock.invocationCallOrder[0]);
    expect(fixture.repository.markMembershipLoggedIn).toHaveBeenCalledWith(
      'company-1',
      'user-1'
    );
    expect(fixture.repository.markUserLoggedIn).toHaveBeenCalledWith('user-1');
  });
});
