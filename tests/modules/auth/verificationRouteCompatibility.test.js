const { createAppError } = require('../../../src/utils/appError');
const { verificationService } = require('../../../src/modules/auth');
const router = require('../../../src/routes/auth');

function createResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.type = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

function routeHandler(path, method) {
  const layer = router.stack.find((candidate) => (
    candidate.route?.path === path && candidate.route.methods[method]
  ));
  return layer.route.stack.at(-1).handle;
}

describe('auth verification route compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  test('keeps GET verification errors on the existing JSON contract', async () => {
    jest.spyOn(verificationService, 'verifyEmail').mockRejectedValue(
      createAppError('Token and email are required', {
        statusCode: 400,
        code: 'MISSING_PARAMETERS'
      })
    );
    const req = { query: {}, body: {}, get: jest.fn().mockReturnValue('') };
    const res = createResponse();

    await routeHandler('/verify-email', 'get')(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'MISSING_PARAMETERS', message: 'Token and email are required' }
    });
  });

  test('passes POST verification errors to the shared error handler', async () => {
    const failure = createAppError('Email already verified', {
      statusCode: 400,
      code: 'ALREADY_VERIFIED'
    });
    jest.spyOn(verificationService, 'verifyEmail').mockRejectedValue(failure);
    const req = {
      query: {},
      body: { token: 'token', email: 'user@example.com' },
      get: jest.fn().mockReturnValue('')
    };
    const next = jest.fn();

    await routeHandler('/verify-email', 'post')(req, createResponse(), next);
    expect(next).toHaveBeenCalledWith(failure);
  });

  test('keeps resend privacy wording for an unknown email', async () => {
    jest.spyOn(verificationService, 'resendVerification').mockResolvedValue({
      sent: false,
      hidden: true
    });
    const req = {
      query: {},
      body: { email: 'missing@example.com' },
      get: jest.fn().mockReturnValue('')
    };
    const res = createResponse();

    await routeHandler('/verify-email/resend', 'post')(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { message: 'If the email exists, a verification link has been sent' }
    });
  });

  test('keeps invite errors and no-store response behavior', async () => {
    jest.spyOn(verificationService, 'acceptCompanyInvite').mockRejectedValue(
      createAppError('This invite is no longer active', {
        statusCode: 403,
        code: 'INVITE_DISABLED'
      })
    );
    const req = {
      query: { token: 'invite-token' },
      body: {},
      get: jest.fn().mockReturnValue('')
    };
    const res = createResponse();

    await routeHandler('/accept-company-invite', 'get')(req, res, jest.fn());
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVITE_DISABLED', message: 'This invite is no longer active' }
    });
  });
});
