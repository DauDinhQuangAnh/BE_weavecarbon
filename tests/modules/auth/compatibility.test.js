describe('auth foundation compatibility entrypoints', () => {
  test('keeps the legacy token helper path on the modular implementation', () => {
    const authModule = require('../../../src/modules/auth');
    expect(require('../../../src/services/authService/tokens')).toBe(authModule.tokens);
  });

  test('keeps the legacy auth service token API available', () => {
    const authService = require('../../../src/services/authService');
    const token = authService.generateAccessToken('user-1', 'user@example.com', ['b2b']);

    expect(authService.verifyAccessToken(token)).toMatchObject({
      sub: 'user-1',
      email: 'user@example.com',
      roles: ['b2b'],
      type: 'access'
    });
    expect(typeof authService.storeRefreshToken).toBe('function');
    expect(typeof authService.rotateRefreshToken).toBe('function');
  });
});
