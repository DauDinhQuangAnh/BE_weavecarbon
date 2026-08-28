const { authSessionService } = require('../../../src/modules/auth');
const router = require('../../../src/routes/auth');

function routeHandler(path, method) {
  const layer = router.stack.find((candidate) => (
    candidate.route?.path === path && candidate.route.methods[method]
  ));
  return layer.route.stack.at(-1).handle;
}

function createResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

function createRequest({ body = {}, authorization = null } = {}) {
  return {
    body,
    query: {},
    headers: {},
    socket: {},
    get: jest.fn((name) => name === 'authorization' ? authorization : null)
  };
}

describe('auth session route compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  test('maps sign-in errors and successful refresh-cookie sessions', async () => {
    const signIn = jest.spyOn(authSessionService, 'signIn').mockResolvedValueOnce({
      kind: 'error',
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'
    });
    const failureResponse = createResponse();
    await routeHandler('/signin', 'post')(
      createRequest({ body: { email: 'user@example.com', password: 'wrong' } }),
      failureResponse,
      jest.fn()
    );
    expect(failureResponse.status).toHaveBeenCalledWith(401);
    expect(failureResponse.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }
    });

    signIn.mockResolvedValueOnce({
      kind: 'authenticated',
      refreshToken: 'refresh-token',
      rememberMe: false,
      data: { user: { id: 'user-1' } }
    });
    const successResponse = createResponse();
    await routeHandler('/signin', 'post')(
      createRequest({
        body: { email: 'user@example.com', password: 'valid', remember_me: false }
      }),
      successResponse,
      jest.fn()
    );
    expect(successResponse.cookie).toHaveBeenCalledWith(
      'weavecarbon_refresh_token',
      'refresh-token',
      expect.objectContaining({ httpOnly: true })
    );
    expect(successResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { user: { id: 'user-1' } }
    });
  });

  test('maps refresh expiry and successful token rotation', async () => {
    const issue = jest.spyOn(authSessionService, 'issueRefreshSession')
      .mockResolvedValueOnce({
        kind: 'expired',
        code: 'SESSION_EXPIRED',
        message: 'Session is no longer active.',
        clearCookie: true
      });
    const expiredResponse = createResponse();
    await routeHandler('/refresh', 'post')(
      createRequest({ body: { refresh_token: 'old-token' } }),
      expiredResponse,
      jest.fn()
    );
    expect(expiredResponse.clearCookie).toHaveBeenCalled();
    expect(expiredResponse.status).toHaveBeenCalledWith(401);

    issue.mockResolvedValueOnce({
      kind: 'authenticated',
      refreshToken: 'next-token',
      rememberMe: true,
      data: { tokens: { access_token: 'access-token' } }
    });
    const successResponse = createResponse();
    await routeHandler('/refresh', 'post')(
      createRequest({ body: { refresh_token: 'old-token' } }),
      successResponse,
      jest.fn()
    );
    expect(successResponse.cookie).toHaveBeenCalled();
    expect(successResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { tokens: { access_token: 'access-token' } }
    });
  });

  test('uses bearer access as the session-bootstrap fallback', async () => {
    const issueAccess = jest.spyOn(authSessionService, 'issueAccessSession')
      .mockResolvedValue({ kind: 'authenticated', data: { user: { id: 'user-1' } } });
    const res = createResponse();

    await routeHandler('/session', 'get')(
      createRequest({ authorization: 'Bearer access-token' }),
      res,
      jest.fn()
    );

    expect(issueAccess).toHaveBeenCalledWith({
      accessToken: 'access-token',
      updateMembershipLogin: true
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user: { id: 'user-1' } }
    });
  });

  test('always clears the cookie after modular signout', async () => {
    jest.spyOn(authSessionService, 'signOut').mockResolvedValue({
      sessions_revoked: 'all', all_devices: true
    });
    const res = createResponse();

    await routeHandler('/signout', 'post')(
      createRequest({ body: { all_devices: true, refresh_token: 'refresh-token' } }),
      res,
      jest.fn()
    );

    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { sessions_revoked: 'all', all_devices: true }
    });
  });

  test('delegates check-company response without route SQL', async () => {
    const checkCompany = jest.spyOn(authSessionService, 'checkCompany').mockResolvedValue({
      has_company: true, is_b2b: true, company_id: 'company-1'
    });
    const res = createResponse();

    await routeHandler('/check-company', 'get')(
      { user: { id: 'user-1' } },
      res,
      jest.fn()
    );

    expect(checkCompany).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { has_company: true, is_b2b: true, company_id: 'company-1' }
    });
  });
});
