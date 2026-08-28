const { googleOAuthFlowService } = require('../../../src/modules/auth');
const router = require('../../../src/routes/auth');

function createResponse() {
  const res = {};
  res.set = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

function routeHandler(path) {
  const layer = router.stack.find((candidate) => (
    candidate.route?.path === path && candidate.route.methods.get
  ));
  return layer.route.stack.at(-1).handle;
}

describe('auth Google OAuth route compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  test('delegates authorization URL construction and disables response caching', () => {
    const buildAuthorizationUrl = jest.spyOn(googleOAuthFlowService, 'buildAuthorizationUrl')
      .mockReturnValue('https://accounts.google.test/oauth');
    const req = { query: { intent: 'signup', role: 'b2b' } };
    const res = createResponse();

    routeHandler('/google')(req, res);

    expect(buildAuthorizationUrl).toHaveBeenCalledWith({
      intent: 'signup',
      flow: undefined,
      mode: undefined,
      role: 'b2b',
      remember_me: undefined,
      rememberMe: undefined,
      frontend_origin: undefined,
      frontendOrigin: undefined
    });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.test/oauth');
  });

  test('preserves the missing-code redirect contract without calling the flow', async () => {
    const authenticate = jest.spyOn(googleOAuthFlowService, 'authenticate');
    const req = { query: {} };
    const res = createResponse();

    await routeHandler('/google/callback')(req, res);

    expect(authenticate).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('MISSING_CODE'));
  });

  test('reuses a cached redirect without processing an OAuth code twice', async () => {
    jest.spyOn(googleOAuthFlowService, 'getCachedRedirect')
      .mockReturnValue('https://app.example.com/auth/callback#cached');
    const authenticate = jest.spyOn(googleOAuthFlowService, 'authenticate');
    const req = { query: { code: 'oauth-code', state: 'signed-state' } };
    const res = createResponse();

    await routeHandler('/google/callback')(req, res);

    expect(authenticate).not.toHaveBeenCalled();
    expect(res.redirect)
      .toHaveBeenCalledWith('https://app.example.com/auth/callback#cached');
  });

  test('preserves the email-verification redirect for blocked signup', async () => {
    jest.spyOn(googleOAuthFlowService, 'getCachedRedirect').mockReturnValue(null);
    jest.spyOn(googleOAuthFlowService, 'authenticate').mockResolvedValue({
      kind: 'verification_required',
      user: { email: 'user@example.com' },
      isNewUser: true,
      requiresCompanySetup: true,
      requiresEmailVerification: true,
      verificationEmailSent: true,
      role: 'b2b',
      intent: 'signup',
      frontendOrigin: 'http://localhost:3000',
      rememberMe: true
    });
    const cacheRedirect = jest.spyOn(googleOAuthFlowService, 'cacheRedirect');
    const req = {
      query: { code: 'oauth-code', state: 'signed-state' },
      headers: {},
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest')
    };
    const res = createResponse();

    await routeHandler('/google/callback')(req, res);

    expect(res.clearCookie).toHaveBeenCalled();
    const redirectUrl = res.redirect.mock.calls[0][0];
    expect(redirectUrl).toContain('http://localhost:3000');
    expect(redirectUrl).toContain('next_step=email_verification');
    expect(redirectUrl).toContain('requires_email_verification=1');
    expect(cacheRedirect).toHaveBeenCalledWith('oauth-code', redirectUrl);
  });
});
