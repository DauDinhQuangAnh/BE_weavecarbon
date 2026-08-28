const database = require('../shared/database');

function createRefreshTokenRepository(pool = database) {
  let schemaPromise = null;

  async function createSchema(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT false,
        revoked_at TIMESTAMPTZ,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON public.refresh_tokens(expires_at)'
    );
  }

  async function ensureSchema(client = pool) {
    if (client !== pool) {
      await createSchema(client);
      return;
    }

    if (!schemaPromise) {
      schemaPromise = createSchema(pool).catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
  }

  return {
    createSchema,
    ensureSchema,

    async withTransaction(work) {
      const client = await pool.connect();
      let transactionFinished = false;
      const rollback = async () => {
        await client.query('ROLLBACK');
        transactionFinished = true;
      };
      try {
        await client.query('BEGIN');
        const result = await work(client, { rollback });
        if (!transactionFinished) {
          await client.query('COMMIT');
          transactionFinished = true;
        }
        return result;
      } catch (error) {
        if (!transactionFinished) await rollback();
        throw error;
      } finally {
        client.release();
      }
    },

    async insert(client, { userId, tokenHash, expiresAt, ipAddress, userAgent }) {
      await client.query(
        `INSERT INTO refresh_tokens (
           user_id,
           token_hash,
           expires_at,
           ip_address,
           user_agent
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
      );
    },

    async findByHash(client, tokenHash) {
      const result = await client.query(
        `SELECT id, user_id, token_hash, expires_at, is_revoked, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      return result.rows[0] || null;
    },

    async findActiveByHash(client, tokenHash) {
      const result = await client.query(
        `SELECT id, user_id, token_hash, expires_at, is_revoked, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
           AND is_revoked = false
           AND expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );
      return result.rows[0] || null;
    },

    async findRotatableByHash(client, tokenHash, graceSeconds) {
      const result = await client.query(
        `SELECT id, user_id, token_hash, expires_at, is_revoked, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
           AND expires_at > NOW()
           AND (
             is_revoked = false
             OR (
               is_revoked = true
               AND revoked_at IS NOT NULL
               AND revoked_at > NOW() - ($2::int * INTERVAL '1 second')
             )
           )
         LIMIT 1
         FOR UPDATE`,
        [tokenHash, graceSeconds]
      );
      return result.rows[0] || null;
    },

    async revokeByHash(client, tokenHash) {
      const result = await client.query(
        `UPDATE refresh_tokens
         SET is_revoked = true,
             revoked_at = NOW()
         WHERE token_hash = $1
           AND is_revoked = false`,
        [tokenHash]
      );
      return result.rowCount || 0;
    },

    async revokeById(client, tokenId) {
      await client.query(
        `UPDATE refresh_tokens
         SET is_revoked = true,
             revoked_at = NOW()
         WHERE id = $1`,
        [tokenId]
      );
    },

    async revokeAllForUser(client, userId) {
      const result = await client.query(
        `UPDATE refresh_tokens
         SET is_revoked = true,
             revoked_at = NOW()
         WHERE user_id = $1
           AND is_revoked = false`,
        [userId]
      );
      return result.rowCount || 0;
    },

    defaultClient: pool
  };
}

module.exports = {
  createRefreshTokenRepository,
  refreshTokenRepository: createRefreshTokenRepository()
};
