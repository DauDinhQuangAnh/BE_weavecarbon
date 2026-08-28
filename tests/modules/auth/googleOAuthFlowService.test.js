const {
  createGoogleOAuthFlowService
} = require('../../../src/modules/auth/googleOAuthFlowService');

describe('auth Google OAuth flow service', () => {
  function createFixture(overrides = {}) {
    const client = {
      normalizeIntent: jest.fn((value) => value),
      normalizeRole: jest.fn((value) => value),
      normalizeRememberMe: jest.fn((value) => value === true || value === 'true'),
      getGoogleAuthUrl: jest.fn().mockReturnValue('https://accounts.google.test/oauth'),
      parseState: jest.fn().mockReturnValue({
        valid: true,
        role: 'b2b',
        intent: 'signin',
        frontendOrigin: 'https://app.example.com',
        rememberMe: true
      }),
      getGoogleTokens: jest.fn().mockResolvedValue({ access_token: 'google-access' }),
      getGoogleUserInfo: jest.fn().mockResolvedValue({
        email: 'user@example.com',
        name: 'User',
        picture: 'https://example.com/avatar.png'
      })
    };
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      full_name: 'User',
      email_verified: true,
      company_id: 'company-1',
      roles: ['b2b'],
      is_demo_user: false
    };
    const googleAccounts = {
      handleGoogleAuth: jest.fn().mockResolvedValue({
        user,
        isNewUser: false,
        requiresCompanySetup: false,
        requiresEmailVerification: false,
        shouldSendVerificationEmail: false,
        blockLoginUntilEmailVerified: false
      })
    };
    const sessionContext = {
      resolve: jest.fn().mockResolvedValue({ companyIdForToken: 'company-1' })
    };
    const verification = { markUserLoggedIn: jest.fn().mockResolvedValue() };
    const refreshSessions = { store: jest.fn().mockResolvedValue() };
    const tokenService = {
      generateVerificationToken: jest.fn().mockReturnValue('verify-token'),
      generateAccessToken: jest.fn().mockReturnValue('access-token'),
      generateRefreshToken: jest.fn().mockReturnValue('refresh-token')
    };
    const analytics = { trackEvent: jest.fn().mockResolvedValue() };
    const email = { sendVerificationEmail: jest.fn().mockResolvedValue(true) };
    const log = { error: jest.fn() };
    const codeCache = new Map();
    const dependencies = {
      client,
      googleAccounts,
      sessionContext,
      verification,
      refreshSessions,
      tokenService,
      analytics,
      email,
      log,
      codeCache,
      now: jest.fn().mockReturnValue(1000),
      ...overrides
    };
    return {
      service: createGoogleOAuthFlowService(dependencies),
      user,
      ...dependencies
    };
  }

  test('normalizes authorization query aliases before delegating to the protocol client', () => {
    const { service, client } = createFixture();

    expect(service.buildAuthorizationUrl({
      flow: 'signup',
      role: 'b2c',
      frontendOrigin: 'https://app.example.com',
      rememberMe: 'false'
    })).toBe('https://accounts.google.test/oauth');
    expect(client.getGoogleAuthUrl).toHaveBeenCalledWith({
      role: 'b2c',
      intent: 'signup',
      frontendOrigin: 'https://app.example.com',
      rememberMe: false
    });
  });

  test('rejects an invalid signed state before calling Google', async () => {
    const { service, client } = createFixture();
    client.parseState.mockReturnValue({ valid: false });

    await expect(service.authenticate({ code: 'oauth-code', state: 'bad-state' }))
      .rejects.toMatchObject({ code: 'INVALID_OAUTH_STATE' });
    expect(client.getGoogleTokens).not.toHaveBeenCalled();
  });

  test('creates a refresh-backed session and preserves request metadata', async () => {
    const { service, client, googleAccounts, sessionContext, verification,
      refreshSessions, tokenService, analytics } = createFixture();
    const requestMetadata = { ipAddress: '127.0.0.1', userAgent: 'jest' };

    await expect(service.authenticate({
      code: 'oauth-code',
      state: 'signed-state',
      requestMetadata
    })).resolves.toMatchObject({
      kind: 'authenticated',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      companyIdForToken: 'company-1',
      nextStep: 'dashboard'
    });
    expect(client.getGoogleTokens).toHaveBeenCalledWith('oauth-code');
    expect(client.getGoogleUserInfo).toHaveBeenCalledWith('google-access');
    expect(googleAccounts.handleGoogleAuth).toHaveBeenCalledWith({
      email: 'user@example.com',
      fullName: 'User',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'b2b',
      intent: 'signin'
    });
    expect(sessionContext.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      { updateMembershipLogin: true }
    );
    expect(verification.markUserLoggedIn).toHaveBeenCalledWith('user-1');
    expect(refreshSessions.store)
      .toHaveBeenCalledWith('refresh-token', 'user-1', requestMetadata);
    expect(tokenService.generateAccessToken)
      .toHaveBeenCalledWith('user-1', 'user@example.com', ['b2b'], 'company-1', false);
    expect(analytics.trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'login',
      user_id: 'user-1',
      company_id: 'company-1'
    }));
  });

  test('keeps access-token login available when refresh persistence fails', async () => {
    const failure = new Error('database unavailable');
    const { service, refreshSessions, log } = createFixture();
    refreshSessions.store.mockRejectedValue(failure);

    await expect(service.authenticate({ code: 'oauth-code', state: 'signed-state' }))
      .resolves.toMatchObject({
        kind: 'authenticated',
        accessToken: 'access-token',
        refreshToken: null
      });
    expect(log.error).toHaveBeenCalledWith(
      { err: failure },
      '[auth] Failed to issue Google cookie session'
    );
  });

  test('sends verification and stops before issuing session tokens when required', async () => {
    const { service, googleAccounts, user, email, tokenService,
      sessionContext, verification, analytics } = createFixture();
    googleAccounts.handleGoogleAuth.mockResolvedValue({
      user: { ...user, email_verified: false },
      isNewUser: true,
      requiresCompanySetup: true,
      requiresEmailVerification: true,
      shouldSendVerificationEmail: true,
      blockLoginUntilEmailVerified: true
    });

    await expect(service.authenticate({ code: 'oauth-code', state: 'signed-state' }))
      .resolves.toMatchObject({
        kind: 'verification_required',
        isNewUser: true,
        requiresEmailVerification: true,
        verificationEmailSent: true
      });
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'verify-token',
      'User',
      null,
      { frontendOrigin: 'https://app.example.com' }
    );
    expect(analytics.trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'sign_up'
    }));
    expect(sessionContext.resolve).not.toHaveBeenCalled();
    expect(verification.markUserLoggedIn).not.toHaveBeenCalled();
    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  test('returns cached redirects and evicts entries after the replay window', () => {
    const now = jest.fn().mockReturnValue(1000);
    const { service } = createFixture({ now, codeCacheTtlMs: 500 });
    service.cacheRedirect('oauth-code', 'https://app.example.com/callback');

    expect(service.getCachedRedirect('oauth-code'))
      .toBe('https://app.example.com/callback');
    now.mockReturnValue(1501);
    expect(service.getCachedRedirect('oauth-code')).toBeNull();
  });
});
