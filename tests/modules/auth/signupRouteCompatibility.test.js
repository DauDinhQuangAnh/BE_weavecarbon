const { createAppError } = require('../../../src/utils/appError');

describe('auth signup route compatibility', () => {
  test('delegates the existing request fields to the modular signup use case', async () => {
    const { signupService } = require('../../../src/modules/auth');
    const failure = createAppError('Email already registered and verified. Please login instead.', {
      statusCode: 409,
      code: 'EMAIL_EXISTS'
    });
    const register = jest.spyOn(signupService, 'registerWithSideEffects')
      .mockRejectedValue(failure);
    const router = require('../../../src/routes/auth');
    const signupLayer = router.stack.find((layer) => layer.route?.path === '/signup');
    const handler = signupLayer.route.stack.at(-1).handle;
    const req = {
      query: {},
      get: jest.fn().mockReturnValue(null),
      body: {
        email: 'user@example.com',
        password: 'Password1!',
        full_name: 'User',
        role: 'b2b',
        company_name: 'Example Co',
        business_type: 'brand',
        domestic_market: 'VN',
        target_markets: ['EU']
      }
    };
    const next = jest.fn();

    await handler(req, {}, next);

    expect(register).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        password: 'Password1!',
        fullName: 'User',
        role: 'b2b',
        companyName: 'Example Co',
        businessType: 'brand',
        domesticMarket: 'VN',
        targetMarkets: ['EU']
      },
      { frontendOrigin: null }
    );
    expect(next).toHaveBeenCalledWith(failure);
    register.mockRestore();
  });
});
