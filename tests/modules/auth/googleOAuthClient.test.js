const { GoogleOAuthClient } = require('../../../src/modules/auth/googleOAuthClient');

function createClient(overrides = {}) {
  return new GoogleOAuthClient({
    httpClient: { post: jest.fn(), get: jest.fn() },
    clientId: 'google-client',
    clientSecret: 'google-secret',
    redirectUri: 'https://api.example.com/api/auth/google/callback',
    stateSecret: 'state-secret',
    stateTtlMs: 600000,
    now: () => 1000000,
    randomBytes: () => Buffer.from('123456789012'),
    ...overrides
  });
}

describe('auth Google OAuth client', () => {
  test('round-trips signed state with normalized metadata', () => {
    const client = createClient();
    const state = client.generateState('b2b', 'signup', 'https://app.example.com/path', false);

    expect(client.parseState(state)).toEqual({
      valid: true,
      role: 'b2b',
      intent: 'signup',
      frontendOrigin: 'https://app.example.com',
      rememberMe: false
    });
  });

  test('rejects tampered and expired state', () => {
    const client = createClient();
    const state = client.generateState();
    const [payload] = state.split('.');
    expect(client.parseState(`${payload}.tampered`)).toMatchObject({
      valid: false,
      reason: 'invalid_signature'
    });

    const expiredClient = createClient({ now: () => 2000000, stateTtlMs: 10 });
    expect(expiredClient.parseState(state)).toMatchObject({
      valid: false,
      reason: 'expired_state'
    });
  });

  test('builds the established Google authorization URL', () => {
    const client = createClient();
    const url = new URL(client.getGoogleAuthUrl({
      role: 'b2b', intent: 'signup', frontendOrigin: 'https://app.example.com', rememberMe: false
    }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('redirect_uri'))
      .toBe('https://api.example.com/api/auth/google/callback');
    expect(url.searchParams.get('scope')).toBe('email profile');
    expect(client.parseState(url.searchParams.get('state'))).toMatchObject({
      role: 'b2b', intent: 'signup', rememberMe: false
    });
  });

  test('exchanges authorization code with the existing payload', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({ data: { access_token: 'google-access' } }),
      get: jest.fn()
    };
    const client = createClient({ httpClient });

    await expect(client.getGoogleTokens('authorization-code'))
      .resolves.toEqual({ access_token: 'google-access' });
    expect(httpClient.post).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', {
      code: 'authorization-code',
      client_id: 'google-client',
      client_secret: 'google-secret',
      redirect_uri: 'https://api.example.com/api/auth/google/callback',
      grant_type: 'authorization_code'
    });
  });

  test('wraps token and userinfo provider failures with stable codes', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue({ response: { data: { error: 'invalid_grant' } } }),
      get: jest.fn().mockRejectedValue(new Error('network failed'))
    };
    const client = createClient({ httpClient });

    await expect(client.getGoogleTokens('bad-code')).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_EXCHANGE_FAILED', statusCode: 502, details: { error: 'invalid_grant' }
    });
    await expect(client.getGoogleUserInfo('bad-access')).rejects.toMatchObject({
      code: 'GOOGLE_USERINFO_FAILED', statusCode: 502, details: 'network failed'
    });
  });
});
