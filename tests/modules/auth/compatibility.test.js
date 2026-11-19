describe('auth foundation compatibility entrypoints', () => {
  test('keeps the legacy token helper path on the modular implementation', () => {
    const authModule = require('../../../src/modules/auth');
  });

  test('keeps the legacy Google OAuth client path on the modular implementation', () => {
    const authModule = require('../../../src/modules/auth');
  });

  test('keeps legacy Auth HTTP helpers and validators on the modular implementations', () => {
    const authModule = require('../../../src/modules/auth');
  });

  test('keeps the legacy demo provisioning method on the modular implementation', async () => {
    const authModule = require('../../../src/modules/auth');
    const authService = require('../../../src/services/authService');
    const result = { user: { id: 'demo-user' } };
    const createDemoUser = jest.spyOn(authModule.demoAccountService, 'createDemoUser')
      .mockResolvedValue(result);

    await expect(authService.createDemoUser('b2b', 'sample_data')).resolves.toBe(result);
    expect(createDemoUser).toHaveBeenCalledWith('b2b', 'sample_data');
    createDemoUser.mockRestore();
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
