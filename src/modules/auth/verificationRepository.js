const database = require('../shared/database');

function createVerificationRepository(pool = database) {
  const findCompanyMembership = async (companyId, userId, client = pool) => {
    const result = await client.query(
      `SELECT company_id, user_id, role, status, invited_by, created_at, updated_at
       FROM company_members
       WHERE company_id = $1 AND user_id = $2
       LIMIT 1`,
      [companyId, userId]
    );
    return result.rows[0] || null;
  };

  return {
    defaultClient: pool,

    async markEmailVerified(userId, client = pool) {
      await client.query(
        `UPDATE users
         SET email_verified = true, email_verified_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    },

    findCompanyMembership,

    async activateCompanyMembership(companyId, userId, client = pool) {
      const result = await client.query(
        `UPDATE company_members
         SET status = 'active', updated_at = NOW()
         WHERE company_id = $1 AND user_id = $2 AND status = 'invited'
         RETURNING company_id, user_id, role, status, invited_by, created_at, updated_at`,
        [companyId, userId]
      );
      if (result.rows.length > 0) return result.rows[0];
      return findCompanyMembership(companyId, userId, client);
    },

    async markMembershipLoggedIn(companyId, userId, client = pool) {
      await client.query(
        `UPDATE company_members
         SET last_login = NOW(), updated_at = NOW()
         WHERE company_id = $1 AND user_id = $2`,
        [companyId, userId]
      );
    },

    async markUserLoggedIn(userId, client = pool) {
      await client.query(
        `UPDATE users
         SET last_login_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    }
  };
}

module.exports = {
  createVerificationRepository,
  verificationRepository: createVerificationRepository()
};
