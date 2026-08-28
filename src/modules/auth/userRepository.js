const database = require('../shared/database');

const TRIAL_QUERY_TIMEOUT_MS = 8000;

function createUserRepository(pool = database) {
  return {
    defaultClient: pool,

    async withConnection(work) {
      const client = await pool.connect();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    },

    async withTransaction(work) {
      const client = await pool.connect();
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

    async insertUser(client, { email, passwordHash, fullName }) {
      const result = await client.query(
        `INSERT INTO users (email, password_hash, full_name, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, NOW(), NOW())
         RETURNING id, email, full_name, email_verified, created_at`,
        [email, passwordHash, fullName]
      );
      return result.rows[0];
    },

    async updateGoogleUser(client, { userId, avatarUrl, markEmailVerified }) {
      await client.query(
        `UPDATE users
         SET avatar_url = $1,
             email_verified = CASE WHEN $2 THEN true ELSE email_verified END,
             email_verified_at = CASE
                                   WHEN $2 THEN COALESCE(email_verified_at, NOW())
                                   ELSE email_verified_at
                                 END,
             updated_at = NOW()
         WHERE id = $3`,
        [avatarUrl, markEmailVerified, userId]
      );
    },

    async insertGoogleUser(client, {
      email,
      fullName,
      avatarUrl,
      markEmailVerified
    }) {
      const result = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, avatar_url,
           email_verified, email_verified_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW(), NOW())
         RETURNING id, email, full_name, avatar_url, created_at`,
        [email, '', fullName, avatarUrl, markEmailVerified]
      );
      return result.rows[0];
    },

    async insertProfile(client, { userId, email, fullName, companyId }) {
      const columns = ['user_id', 'email', 'full_name'];
      const values = [userId, email, fullName];
      if (companyId !== undefined) {
        columns.push('company_id');
        values.push(companyId);
      }
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const result = await client.query(
        `INSERT INTO profiles (${columns.join(', ')}, created_at, updated_at)
         VALUES (${placeholders.join(', ')}, NOW(), NOW())
         RETURNING id, user_id, email, full_name, company_id`,
        values
      );
      return result.rows[0];
    },

    async insertGoogleProfile(client, { userId, email, fullName, avatarUrl }) {
      const result = await client.query(
        `INSERT INTO profiles (user_id, email, full_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id, user_id, company_id`,
        [userId, email, fullName, avatarUrl]
      );
      return result.rows[0];
    },

    async updateProfileAvatar(client, userId, avatarUrl) {
      await client.query(
        'UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2',
        [avatarUrl, userId]
      );
    },

    async addRole(client, userId, role) {
      await client.query(
        `INSERT INTO user_roles (user_id, role, created_at)
         VALUES ($1, $2, NOW())`,
        [userId, role]
      );
    },

    async insertCompany(client, companyData) {
      const result = await client.query(
        `INSERT INTO companies (
           name, business_type, current_plan, domestic_market, target_markets, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id, name, business_type, current_plan, domestic_market, target_markets`,
        [
          companyData.name,
          companyData.businessType,
          companyData.currentPlan,
          companyData.domesticMarket,
          companyData.targetMarkets
        ]
      );
      return result.rows[0];
    },

    async assignProfileCompany(client, userId, companyId) {
      await client.query(
        'UPDATE profiles SET company_id = $1, updated_at = NOW() WHERE user_id = $2',
        [companyId, userId]
      );
    },

    async insertCompanyAdmin(client, companyId, userId) {
      await client.query(
        `INSERT INTO company_members (
           company_id, user_id, role, status, invited_by, created_at, updated_at
         )
         VALUES ($1, $2, 'admin', 'active', $2, NOW(), NOW())`,
        [companyId, userId]
      );
    },

    async initializeTrial(client, companyId) {
      await client.query({
        text: `
          INSERT INTO public.subscription_cycles (
            company_id,
            trial_started_at,
            trial_ends_at
          )
          VALUES ($1, NOW(), NOW() + INTERVAL '14 days')
          ON CONFLICT (company_id)
          DO UPDATE SET
            trial_started_at = COALESCE(
              public.subscription_cycles.trial_started_at,
              EXCLUDED.trial_started_at
            ),
            trial_ends_at = COALESCE(
              public.subscription_cycles.trial_ends_at,
              EXCLUDED.trial_ends_at
            ),
            updated_at = NOW()
        `,
        values: [companyId],
        query_timeout: TRIAL_QUERY_TIMEOUT_MS
      });
    },

    async insertRewards(client, userId) {
      await client.query(
        `INSERT INTO user_rewards (user_id, total_points, total_donations, created_at, updated_at)
         VALUES ($1, 0, 0, NOW(), NOW())`,
        [userId]
      );
    },

    async deleteUser(userId, client = pool) {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    },

    async findUserByEmail(email, client = pool) {
      const result = await client.query(
        `SELECT u.id, u.email, u.password_hash, u.full_name, u.avatar_url,
                u.email_verified, u.failed_login_attempts, u.locked_until,
                u.is_demo_user, u.created_at,
                p.id as profile_id, p.company_id,
                array_agg(DISTINCT ur.role) as roles
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         WHERE u.email = $1
         GROUP BY u.id, p.id`,
        [email]
      );
      return result.rows[0] || null;
    },

    async findUserById(userId, client = pool) {
      const result = await client.query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url,
                u.email_verified, u.is_demo_user, u.created_at,
                p.id as profile_id, p.company_id,
                array_agg(DISTINCT ur.role) as roles
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id, p.id`,
        [userId]
      );
      return result.rows[0] || null;
    },

    async findCompanyById(companyId, client = pool) {
      const result = await client.query(
        `SELECT id, name, business_type, current_plan, domestic_market, target_markets
         FROM companies
         WHERE id = $1`,
        [companyId]
      );
      return result.rows[0] || null;
    },

    async findProfileRoles(userId, client = pool) {
      const result = await client.query(
        `SELECT p.company_id, ur.role
         FROM profiles p
         LEFT JOIN user_roles ur ON ur.user_id = p.user_id
         WHERE p.user_id = $1`,
        [userId]
      );
      return result.rows;
    },

    async findPrimaryCompanyMembership(client, userId, includeInactive) {
      const result = await client.query(
        `SELECT
           cm.company_id,
           cm.role as company_role,
           cm.status as member_status,
           cm.invited_by,
           cm.last_login,
           cm.created_at as member_created_at,
           cm.updated_at as member_updated_at,
           c.name as company_name,
           c.business_type,
           c.current_plan,
           c.domestic_market,
           c.target_markets
         FROM company_members cm
         JOIN companies c ON c.id = cm.company_id
         WHERE cm.user_id = $1
           AND ($2::boolean OR cm.status = 'active')
         ORDER BY
           CASE WHEN cm.status = 'active' THEN 0 ELSE 1 END,
           CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END,
           cm.created_at DESC
         LIMIT 1`,
        [userId, includeInactive]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = {
  TRIAL_QUERY_TIMEOUT_MS,
  createUserRepository,
  userRepository: createUserRepository()
};
