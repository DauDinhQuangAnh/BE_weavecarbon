const {
  createRefreshSessionService
} = require('../../../src/modules/auth/refreshSessionService');

function createFixture(overrides = {}) {
  const defaultClient = { id: 'pool' };
  const transaction = { id: 'transaction' };
  const rollback = jest.fn().mockResolvedValue(undefined);
  const repository = {
    defaultClient,
    ensureSchema: jest.fn().mockResolvedValue(undefined),
    createSchema: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    findByHash: jest.fn(),
    findActiveByHash: jest.fn(),
    findRotatableByHash: jest.fn(),
    revokeByHash: jest.fn(),
    revokeById: jest.fn(),
    revokeAllForUser: jest.fn(),
    withTransaction: jest.fn((work) => work(transaction, { rollback })),
    ...overrides
  };
  const expiry = new Date('2030-01-01T00:00:00.000Z');
  const tokenService = {
    hashRefreshToken: jest.fn((token) => `hash:${token}`),
    decodeJwtExpiry: jest.fn().mockReturnValue(expiry)
  };
  const service = createRefreshSessionService({
    repository,
    tokenService,
    rotationGraceSeconds: 45
  });
  return { service, repository, tokenService, defaultClient, transaction, rollback, expiry };
}

describe('auth refresh session service', () => {
  test('stores only a token hash plus expiry and request metadata', async () => {
    const fixture = createFixture();

    await expect(fixture.service.store('raw-token', 'user-1', {
      ipAddress: '127.0.0.1', userAgent: 'test-agent'
    })).resolves.toEqual({ token_hash: 'hash:raw-token', expires_at: fixture.expiry });
    expect(fixture.repository.ensureSchema).toHaveBeenCalledWith();
    expect(fixture.repository.insert).toHaveBeenCalledWith(fixture.defaultClient, {
      userId: 'user-1',
      tokenHash: 'hash:raw-token',
      expiresAt: fixture.expiry,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    });
  });

  test('rejects a refresh token without a decodable expiry', async () => {
    const fixture = createFixture();
    fixture.tokenService.decodeJwtExpiry.mockReturnValue(null);

    await expect(fixture.service.store('bad-token', 'user-1'))
      .rejects.toThrow('Refresh token expiry could not be decoded');
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });

  test('rotates an active session atomically', async () => {
    const fixture = createFixture({
      findRotatableByHash: jest.fn().mockResolvedValue({
        id: 'session-1', user_id: 'user-1', is_revoked: false
      })
    });

    await expect(fixture.service.rotate('current', 'next', {
      ipAddress: '127.0.0.1', userAgent: 'test-agent'
    })).resolves.toEqual({ user_id: 'user-1', expires_at: fixture.expiry });
    expect(fixture.repository.findRotatableByHash).toHaveBeenCalledWith(
      fixture.transaction,
      'hash:current',
      45
    );
    expect(fixture.repository.revokeById).toHaveBeenCalledWith(
      fixture.transaction,
      'session-1'
    );
    expect(fixture.repository.insert).toHaveBeenCalledWith(fixture.transaction, {
      userId: 'user-1',
      tokenHash: 'hash:next',
      expiresAt: fixture.expiry,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    });
  });

  test('allows grace-period reuse without revoking the session twice', async () => {
    const fixture = createFixture({
      findRotatableByHash: jest.fn().mockResolvedValue({
        id: 'session-1', user_id: 'user-1', is_revoked: true
      })
    });

    await expect(fixture.service.rotate('current', 'next')).resolves.toMatchObject({
      user_id: 'user-1'
    });
    expect(fixture.repository.revokeById).not.toHaveBeenCalled();
    expect(fixture.repository.insert).toHaveBeenCalledTimes(1);
  });

  test('rolls back and returns null when the current session is unavailable', async () => {
    const fixture = createFixture({ findRotatableByHash: jest.fn().mockResolvedValue(null) });

    await expect(fixture.service.rotate('missing', 'next')).resolves.toBeNull();
    expect(fixture.rollback).toHaveBeenCalledTimes(1);
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });

  test('uses an explicitly supplied transaction for lookup and revocation', async () => {
    const fixture = createFixture({
      findByHash: jest.fn().mockResolvedValue({ id: 'session-1' }),
      revokeByHash: jest.fn().mockResolvedValue(1)
    });
    const externalClient = { id: 'external' };

    await expect(fixture.service.getRecord('raw-token', externalClient))
      .resolves.toEqual({ id: 'session-1' });
    await expect(fixture.service.revoke('raw-token', externalClient)).resolves.toBe(1);
    expect(fixture.repository.ensureSchema).toHaveBeenCalledWith(externalClient);
    expect(fixture.repository.findByHash).toHaveBeenCalledWith(externalClient, 'hash:raw-token');
    expect(fixture.repository.revokeByHash).toHaveBeenCalledWith(
      externalClient,
      'hash:raw-token'
    );
  });
});
