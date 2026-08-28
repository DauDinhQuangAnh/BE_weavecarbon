const tokens = require('./tokens');
const { refreshTokenRepository } = require('./refreshTokenRepository');

const DEFAULT_ROTATION_GRACE_SECONDS = Math.max(
  0,
  Number.parseInt(process.env.REFRESH_TOKEN_ROTATION_GRACE_SECONDS || '30', 10) || 30
);

function createRefreshSessionService({
  repository = refreshTokenRepository,
  tokenService = tokens,
  rotationGraceSeconds = DEFAULT_ROTATION_GRACE_SECONDS
} = {}) {
  const resolveClient = (client) => client || repository.defaultClient;

  return {
    ensureSchema(client) {
      return repository.ensureSchema(resolveClient(client));
    },

    createSchema(client) {
      return repository.createSchema(resolveClient(client));
    },

    async store(refreshToken, userId, metadata = {}) {
      await repository.ensureSchema();
      const expiresAt = tokenService.decodeJwtExpiry(refreshToken);
      if (!expiresAt) throw new Error('Refresh token expiry could not be decoded');

      const tokenHash = tokenService.hashRefreshToken(refreshToken);
      await repository.insert(repository.defaultClient, {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent
      });
      return { token_hash: tokenHash, expires_at: expiresAt };
    },

    async getRecord(refreshToken, client) {
      const target = resolveClient(client);
      await repository.ensureSchema(target);
      return repository.findByHash(target, tokenService.hashRefreshToken(refreshToken));
    },

    async isActive(refreshToken, client) {
      const target = resolveClient(client);
      await repository.ensureSchema(target);
      return repository.findActiveByHash(target, tokenService.hashRefreshToken(refreshToken));
    },

    async revoke(refreshToken, client) {
      const target = resolveClient(client);
      await repository.ensureSchema(target);
      return repository.revokeByHash(target, tokenService.hashRefreshToken(refreshToken));
    },

    async revokeAll(userId, client) {
      const target = resolveClient(client);
      await repository.ensureSchema(target);
      return repository.revokeAllForUser(target, userId);
    },

    async rotate(currentRefreshToken, nextRefreshToken, metadata = {}) {
      return repository.withTransaction(async (transaction, { rollback }) => {
        await repository.ensureSchema(transaction);
        const currentSession = await repository.findRotatableByHash(
          transaction,
          tokenService.hashRefreshToken(currentRefreshToken),
          rotationGraceSeconds
        );
        if (!currentSession) {
          await rollback();
          return null;
        }

        if (!currentSession.is_revoked) {
          await repository.revokeById(transaction, currentSession.id);
        }

        const expiresAt = tokenService.decodeJwtExpiry(nextRefreshToken);
        if (!expiresAt) throw new Error('Rotated refresh token expiry could not be decoded');

        await repository.insert(transaction, {
          userId: currentSession.user_id,
          tokenHash: tokenService.hashRefreshToken(nextRefreshToken),
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        });
        return { user_id: currentSession.user_id, expires_at: expiresAt };
      });
    }
  };
}

module.exports = {
  DEFAULT_ROTATION_GRACE_SECONDS,
  createRefreshSessionService,
  refreshSessionService: createRefreshSessionService()
};
