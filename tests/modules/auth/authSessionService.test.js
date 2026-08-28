const {
  createAuthSessionService
} = require('../../../src/modules/auth/authSessionService');

function createFixture(overrides = {}) {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    password_hash: 'password-hash',
    full_name: 'User',
    roles: ['b2b'],
    email_verified: true,
    is_demo_user: false,
    company_id: 'company-1'
  };
  const tokenService = {
    verifyPassword: jest.fn().mockResolvedValue(true),
    generateAccessToken: jest.fn().mockReturnValue('access-token'),
    generateRefreshToken: jest.fn().mockReturnValue('next-refresh-token'),
    verifyRefreshToken: jest.fn().mockReturnValue({
      sub: 'user-1', type: 'refresh', remember_me: true
    }),
    verifyAccessToken: jest.fn().mockReturnValue({ sub: 'user-1', type: 'access' }),
    ...overrides.tokenService
  };
  const refreshSessions = {
    store: jest.fn().mockResolvedValue(),
    rotate: jest.fn().mockResolvedValue({ user_id: 'user-1' }),
    isActive: jest.fn().mockResolvedValue({ user_id: 'user-1' }),
    revoke: jest.fn().mockResolvedValue(1),
    revokeAll: jest.fn().mockResolvedValue(3),
    ...overrides.refreshSessions
  };
  const accounts = {
    getUserByEmail: jest.fn().mockResolvedValue(user),
    getUserById: jest.fn().mockResolvedValue(user),
    getCompanyStatus: jest.fn().mockResolvedValue({
      has_company: true, is_b2b: true, company_id: 'company-1'
    }),
    ...overrides.accounts
  };
  const sessionContext = {
    resolve: jest.fn().mockResolvedValue({
      company: { id: 'company-1' },
      companyMembership: { company_id: 'company-1', role: 'admin' },
      companyIdForToken: 'company-1'
    }),
    ...overrides.sessionContext
  };
  const verification = { markUserLoggedIn: jest.fn().mockResolvedValue() };
  const analytics = { trackEvent: jest.fn().mockResolvedValue() };
  const log = { error: jest.fn() };
  const httpSupport = {
    resolveEntryAccountType: jest.fn().mockReturnValue('b2b'),
    buildAuthResponseData: jest.fn((payload) => ({
      session: 'data', accessToken: payload.accessToken
    }))
  };
  const dependencies = {
    tokenService,
    refreshSessions,
    accounts,
    sessionContext,
    verification,
    analytics,
    log,
    httpSupport
  };
  return {
    service: createAuthSessionService(dependencies),
    user,
    ...dependencies
  };
}

describe('auth session service', () => {
  test('keeps unknown account and wrong password on the same credentials error', async () => {
    const missing = createFixture({
      accounts: { getUserByEmail: jest.fn().mockResolvedValue(null) }
    });
    await expect(missing.service.signIn({ email: 'missing@example.com', password: 'x' }))
      .resolves.toEqual({
        kind: 'error',
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      });

    const wrong = createFixture({
      tokenService: { verifyPassword: jest.fn().mockResolvedValue(false) }
    });
    await expect(wrong.service.signIn({ email: 'user@example.com', password: 'wrong' }))
      .resolves.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(wrong.refreshSessions.store).not.toHaveBeenCalled();
  });

  test('blocks unverified non-demo users before session creation', async () => {
    const fixture = createFixture({
      accounts: {
        getUserByEmail: jest.fn().mockResolvedValue({
          id: 'user-1',
          password_hash: 'hash',
          email_verified: false,
          is_demo_user: false
        })
      }
    });

    await expect(fixture.service.signIn({ email: 'user@example.com', password: 'valid' }))
      .resolves.toEqual({
        kind: 'error',
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before signing in'
      });
    expect(fixture.sessionContext.resolve).not.toHaveBeenCalled();
  });

  test('issues and persists an email/password session with analytics', async () => {
    const fixture = createFixture();
    const metadata = { ipAddress: '127.0.0.1', userAgent: 'jest' };

    await expect(fixture.service.signIn({
      email: 'user@example.com',
      password: 'valid',
      rememberMe: false,
      metadata
    })).resolves.toEqual({
      kind: 'authenticated',
      rememberMe: false,
      refreshToken: 'next-refresh-token',
      data: { session: 'data', accessToken: 'access-token' }
    });
    expect(fixture.sessionContext.resolve).toHaveBeenCalledWith(
      fixture.user,
      { updateMembershipLogin: true }
    );
    expect(fixture.verification.markUserLoggedIn).toHaveBeenCalledWith('user-1');
    expect(fixture.tokenService.generateAccessToken).toHaveBeenCalledWith(
      'user-1', 'user@example.com', ['b2b'], 'company-1', false
    );
    expect(fixture.tokenService.generateRefreshToken).toHaveBeenCalledWith('user-1', false);
    expect(fixture.refreshSessions.store)
      .toHaveBeenCalledWith('next-refresh-token', 'user-1', metadata);
    expect(fixture.analytics.trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'login', user_id: 'user-1', company_id: 'company-1'
    }));
  });

  test('rejects invalid refresh tokens with the established error contract', async () => {
    const fixture = createFixture({
      tokenService: { verifyRefreshToken: jest.fn().mockReturnValue(null) }
    });

    await expect(fixture.service.issueRefreshSession({ refreshToken: 'invalid' }))
      .resolves.toEqual({
        kind: 'expired',
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired session.',
        clearCookie: true
      });
  });

  test('rotates an active refresh session and preserves remember-me metadata', async () => {
    const fixture = createFixture();
    const metadata = { ipAddress: '127.0.0.1', userAgent: 'jest' };

    await expect(fixture.service.issueRefreshSession({
      refreshToken: 'current-refresh-token',
      rotate: true,
      metadata
    })).resolves.toEqual({
      kind: 'authenticated',
      data: { session: 'data', accessToken: 'access-token' },
      refreshToken: 'next-refresh-token',
      rememberMe: true
    });
    expect(fixture.refreshSessions.rotate).toHaveBeenCalledWith(
      'current-refresh-token',
      'next-refresh-token',
      metadata
    );
  });

  test('does not clear a cookie for an inactive non-rotating bootstrap', async () => {
    const fixture = createFixture({
      refreshSessions: { isActive: jest.fn().mockResolvedValue(null) }
    });

    await expect(fixture.service.issueRefreshSession({
      refreshToken: 'current-refresh-token',
      rotate: false
    })).resolves.toMatchObject({
      kind: 'expired',
      code: 'SESSION_EXPIRED',
      clearCookie: false
    });
  });

  test('accepts legacy access tokens without a type during session bootstrap', async () => {
    const fixture = createFixture({
      tokenService: { verifyAccessToken: jest.fn().mockReturnValue({ sub: 'user-1' }) }
    });

    await expect(fixture.service.issueAccessSession({
      accessToken: 'legacy-access',
      updateMembershipLogin: true
    })).resolves.toEqual({
      kind: 'authenticated',
      data: { session: 'data', accessToken: 'legacy-access' }
    });
    expect(fixture.sessionContext.resolve).toHaveBeenCalledWith(
      fixture.user,
      { updateMembershipLogin: true }
    );
  });

  test('revokes either all user sessions or the current refresh session', async () => {
    const all = createFixture();
    await expect(all.service.signOut({
      allDevices: true,
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    })).resolves.toEqual({ sessions_revoked: 'all', all_devices: true });
    expect(all.refreshSessions.revokeAll).toHaveBeenCalledWith('user-1');

    const current = createFixture();
    await expect(current.service.signOut({ refreshToken: 'refresh-token' }))
      .resolves.toEqual({ sessions_revoked: 1, all_devices: false });
    expect(current.refreshSessions.revoke).toHaveBeenCalledWith('refresh-token');
  });

  test('delegates company status to the account boundary', async () => {
    const fixture = createFixture();
    await expect(fixture.service.checkCompany('user-1')).resolves.toEqual({
      has_company: true, is_b2b: true, company_id: 'company-1'
    });
    expect(fixture.accounts.getCompanyStatus).toHaveBeenCalledWith('user-1');
  });
});
