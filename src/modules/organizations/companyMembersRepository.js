const pool = require('../shared/database');

function createCompanyMembersRepository(database = pool) {
  return {
    async withConnection(work) {
      const client = await database.connect();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    },

    async withTransaction(work) {
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listMembers(client, companyId, filters = {}) {
      let query = `
        SELECT
          cm.id,
          cm.user_id,
          u.full_name,
          u.email,
          cm.role,
          cm.status,
          cm.last_login,
          cm.created_at
        FROM company_members cm
        INNER JOIN users u ON u.id = cm.user_id
        WHERE cm.company_id = $1
      `;
      const params = [companyId];
      let paramIndex = 2;

      if (filters.status) {
        query += ` AND cm.status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }
      if (filters.role) {
        query += ` AND cm.role = $${paramIndex}`;
        params.push(filters.role);
      }
      query += ' ORDER BY cm.created_at DESC';

      const result = await client.query(query, params);
      return result.rows;
    },

    async getMemberMeta(client, companyId) {
      const result = await client.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'active') as active,
           COUNT(*) FILTER (WHERE status = 'invited') as invited,
           COUNT(*) FILTER (WHERE status = 'disabled') as disabled
         FROM company_members
         WHERE company_id = $1`,
        [companyId]
      );
      return result.rows[0];
    },

    async findCompany(client, companyId) {
      const result = await client.query('SELECT name FROM companies WHERE id = $1', [companyId]);
      return result.rows[0] || null;
    },

    async findMembershipByEmail(client, companyId, email) {
      const result = await client.query(
        `SELECT cm.id
         FROM company_members cm
         INNER JOIN users u ON u.id = cm.user_id
         WHERE cm.company_id = $1 AND u.email = $2`,
        [companyId, email]
      );
      return result.rows[0] || null;
    },

    async attachProfileToCompany(client, companyId, userId) {
      await client.query(
        'UPDATE profiles SET company_id = $1 WHERE user_id = $2 AND company_id IS NULL',
        [companyId, userId]
      );
    },

    async hasB2BRole(client, userId) {
      const result = await client.query(
        'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
        [userId, 'b2b']
      );
      return result.rows.length > 0;
    },

    async addB2BRole(client, userId) {
      await client.query(
        'INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, $2, NOW())',
        [userId, 'b2b']
      );
    },

    async insertMember(client, { companyId, userId, role, invitedBy }) {
      const result = await client.query(
        `INSERT INTO company_members (
           company_id, user_id, role, status, invited_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'invited', $4, NOW(), NOW())
         RETURNING id, user_id, role, status, created_at`,
        [companyId, userId, role, invitedBy]
      );
      return result.rows[0];
    },

    async findInvite(client, companyId, memberId) {
      const result = await client.query(
        `SELECT
           cm.id,
           cm.user_id,
           cm.role,
           cm.status,
           u.email,
           u.full_name,
           c.name AS company_name
         FROM company_members cm
         JOIN users u ON u.id = cm.user_id
         JOIN companies c ON c.id = cm.company_id
         WHERE cm.company_id = $1 AND cm.id = $2
         LIMIT 1`,
        [companyId, memberId]
      );
      return result.rows[0] || null;
    },

    async findMemberForMutation(client, companyId, memberId) {
      const result = await client.query(
        `SELECT user_id, role
         FROM company_members
         WHERE id = $1 AND company_id = $2`,
        [memberId, companyId]
      );
      return result.rows[0] || null;
    },

    async updateMember(client, companyId, memberId, updateData) {
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (updateData.role) {
        updates.push(`role = $${paramIndex}`);
        params.push(updateData.role);
        paramIndex++;
      }
      if (updateData.status) {
        updates.push(`status = $${paramIndex}`);
        params.push(updateData.status);
        paramIndex++;
      }
      updates.push('updated_at = NOW()');
      params.push(memberId, companyId);

      const result = await client.query(
        `UPDATE company_members
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
         RETURNING id, role, status, updated_at`,
        params
      );
      return result.rows[0] || null;
    },

    async deleteMember(client, companyId, memberId) {
      const result = await client.query(
        `DELETE FROM company_members
         WHERE id = $1 AND company_id = $2
         RETURNING id`,
        [memberId, companyId]
      );
      return result.rows[0] || null;
    },

    async findActiveRole(client, companyId, userId) {
      const result = await client.query(
        `SELECT role
         FROM company_members
         WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
        [companyId, userId]
      );
      return result.rows[0]?.role || null;
    },

    async hasActiveMembership(client, companyId, userId) {
      const result = await client.query(
        `SELECT id
         FROM company_members
         WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
        [companyId, userId]
      );
      return result.rows.length > 0;
    }
  };
}

module.exports = {
  createCompanyMembersRepository,
  companyMembersRepository: createCompanyMembersRepository()
};
