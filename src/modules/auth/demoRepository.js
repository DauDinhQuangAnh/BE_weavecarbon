const database = require('../shared/database');

const DEMO_QUERY_TIMEOUT_MS = 8000;

function createDemoRepository(pool = database) {
  return {
    async withTransaction(work, { beforeTransaction } = {}) {
      const client = await pool.connect();
      try {
        if (beforeTransaction) await beforeTransaction(client);
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

    async insertUser(client, { email, passwordHash, expiresAt }) {
      const result = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, email_verified,
           is_demo_user, demo_expires_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, true, true, $4, NOW(), NOW())
         RETURNING id, email, full_name, created_at`,
        [email, passwordHash, 'Demo User', expiresAt]
      );
      return result.rows[0];
    },

    async insertProfile(client, { userId, email }) {
      const result = await client.query(
        `INSERT INTO profiles (
           user_id, email, full_name, is_demo_user, created_at, updated_at
         )
         VALUES ($1, $2, $3, true, NOW(), NOW())
         RETURNING id, user_id, email, full_name, company_id`,
        [userId, email, 'Demo User']
      );
      return result.rows[0];
    },

    async addRole(client, userId, role) {
      await client.query(
        `INSERT INTO user_roles (user_id, role, created_at)
         VALUES ($1, $2, NOW())`,
        [userId, role]
      );
    },

    async insertCompany(client, domesticMarket) {
      const result = await client.query(
        `INSERT INTO companies (
           name, business_type, current_plan, domestic_market,
           target_markets, created_at, updated_at
         )
         VALUES ('Demo Company', 'brand', 'standard', $1, $2, NOW(), NOW())
         RETURNING id, name, business_type, current_plan, domestic_market, target_markets`,
        [domesticMarket, []]
      );
      return result.rows[0];
    },

    async assignProfileCompany(client, userId, companyId) {
      await client.query(
        'UPDATE profiles SET company_id = $1 WHERE user_id = $2',
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

    async initializeStandard(client, companyId, standardSkuLimit = 20) {
      await client.query({
        text: `
          INSERT INTO public.subscription_cycles (
            company_id,
            trial_started_at,
            trial_ends_at,
            standard_started_at,
            standard_expires_at,
            standard_sku_limit
          )
          VALUES (
            $1,
            NOW(),
            NOW() + INTERVAL '14 days',
            NOW(),
            NOW() + INTERVAL '30 days',
            $2
          )
          ON CONFLICT (company_id)
          DO UPDATE SET
            standard_started_at = COALESCE(
              public.subscription_cycles.standard_started_at,
              EXCLUDED.standard_started_at
            ),
            standard_expires_at = COALESCE(
              public.subscription_cycles.standard_expires_at,
              EXCLUDED.standard_expires_at
            ),
            standard_sku_limit = GREATEST(
              public.subscription_cycles.standard_sku_limit,
              EXCLUDED.standard_sku_limit
            ),
            updated_at = NOW()
        `,
        values: [companyId, standardSkuLimit],
        query_timeout: DEMO_QUERY_TIMEOUT_MS
      });
    },

    async withB2BSeedSavepoint(client, work) {
      await client.query('SAVEPOINT demo_b2b_seed');
      try {
        const result = await work();
        await client.query('RELEASE SAVEPOINT demo_b2b_seed');
        return result;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT demo_b2b_seed');
        await client.query('RELEASE SAVEPOINT demo_b2b_seed');
        throw error;
      }
    },

    async findActiveRewardMaterials(client) {
      const result = await client.query(`
        SELECT id, material_name, material_category, points_per_kg, co2_saved_per_kg
        FROM public.material_rewards
        WHERE is_active = true
        ORDER BY
          CASE
            WHEN material_name ILIKE '%cotton%' THEN 1
            WHEN material_name ILIKE '%polyester%' THEN 2
            WHEN material_name ILIKE '%linen%' THEN 3
            ELSE 4
          END,
          material_name ASC
        LIMIT 6
      `);
      return result.rows;
    },

    async insertFallbackRewards(client, userId) {
      await client.query(
        `INSERT INTO public.user_rewards (user_id, total_points, created_at, updated_at)
         VALUES ($1, 100, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    },

    async findCollectionPoint(client) {
      const result = await client.query(`
        SELECT id
        FROM public.collection_points
        WHERE is_active = true
          AND accepts_charity = true
          AND accepts_recycle = true
        ORDER BY name ASC
        LIMIT 1
      `);
      return result.rows[0] || null;
    },

    async insertDonation(client, donation) {
      const result = await client.query(
        `INSERT INTO public.donations (
           user_id,
           category,
           delivery_method,
           status,
           item_description,
           material_id,
           estimated_weight_kg,
           actual_weight_kg,
           collection_point_id,
           base_points,
           bonus_points,
           total_points,
           co2_saved,
           confirmed_at,
           confirmation_method,
           completed_at,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, 'drop_off', $3, $4, $5, $6, $6, $7, $8, $9, $10, $11,
           $12, 'staff', $13, $14, $14
         )
         RETURNING id`,
        [
          donation.userId,
          donation.category,
          donation.status,
          donation.description,
          donation.materialId,
          donation.weightKg,
          donation.collectionPointId,
          donation.basePoints,
          donation.bonusPoints,
          donation.totalPoints,
          donation.co2Saved,
          donation.createdAt,
          donation.completedAt,
          donation.createdAt
        ]
      );
      return result.rows[0];
    },

    async insertDonationItem(client, donationId, item, createdAt) {
      await client.query(
        `INSERT INTO public.donation_items (
           donation_id,
           item_name,
           item_type,
           condition,
           material_id,
           weight_kg,
           points_earned,
           co2_saved,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          donationId,
          item.item_name,
          item.item_type,
          item.condition,
          item.material_id,
          item.weight_kg,
          item.points_earned,
          item.co2_saved,
          createdAt
        ]
      );
    },

    async insertRewardTransaction(client, transaction) {
      await client.query(
        `INSERT INTO public.reward_transactions (
           user_id, donation_id, transaction_type, points, description, created_at
         ) VALUES ($1, $2, 'earn', $3, $4, $5)`,
        [
          transaction.userId,
          transaction.donationId,
          transaction.points,
          transaction.description,
          transaction.createdAt
        ]
      );
    },

    async upsertUserRewards(client, rewards) {
      await client.query(
        `INSERT INTO public.user_rewards (
           user_id,
           total_points,
           total_donations,
           total_items_donated,
           total_weight_kg,
           total_co2_saved,
           current_level,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           total_points = EXCLUDED.total_points,
           total_donations = EXCLUDED.total_donations,
           total_items_donated = EXCLUDED.total_items_donated,
           total_weight_kg = EXCLUDED.total_weight_kg,
           total_co2_saved = EXCLUDED.total_co2_saved,
           current_level = EXCLUDED.current_level,
           updated_at = NOW()`,
        [
          rewards.userId,
          rewards.totalPoints,
          rewards.totalDonations,
          rewards.totalItems,
          rewards.totalWeightKg,
          rewards.totalCo2Saved,
          rewards.currentLevel
        ]
      );
    }
  };
}

module.exports = {
  DEMO_QUERY_TIMEOUT_MS,
  createDemoRepository,
  demoRepository: createDemoRepository()
};
