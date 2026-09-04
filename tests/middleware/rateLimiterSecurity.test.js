jest.mock('../../src/services/authService');

const authService = require('../../src/services/authService');
const {
  getAuthenticatedRateLimitKey,
  getExpensiveRateLimitKey
} = require('../../src/middleware/rateLimiter');

describe('user and tenant aware rate-limit keys', () => {
  test('uses authenticated identity rather than a shared proxy IP', () => {
    expect(getExpensiveRateLimitKey({
      userId: 'user-1', companyId: 'company-1', ip: '127.0.0.1'
    })).toBe('tenant_company-1_user_user-1');
  });

  test('derives general API identity from a verified bearer token', () => {
    authService.verifyAccessToken.mockReturnValue({ sub: 'user-2' });
    expect(getAuthenticatedRateLimitKey({
      headers: { authorization: 'Bearer token' }
    })).toBe('user_user-2');
  });
});
