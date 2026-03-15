const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const subscriptionService = require('./subscriptionService');
const { createAppError } = require('../utils/appError');
const {
    ensureCompaniesDomesticMarketColumn,
    normalizeCompanyMarkets
} = require('../utils/companyMarkets');
const TRIAL_QUERY_TIMEOUT_MS = 8000;

class AccountService {
    async initializeTrial(client, companyId) {
        await subscriptionService.ensureSchema(client);
        await client.query(
            {
                text: `
        INSERT INTO public.subscription_cycles (
          company_id,
          trial_started_at,
          trial_ends_at
        )
        VALUES ($1, NOW(), NOW() + INTERVAL '14 days')
        ON CONFLICT (company_id)
        DO UPDATE SET
          trial_started_at = COALESCE(public.subscription_cycles.trial_started_at, EXCLUDED.trial_started_at),
          trial_ends_at = COALESCE(public.subscription_cycles.trial_ends_at, EXCLUDED.trial_ends_at),
          updated_at = NOW()
      `,
                values: [companyId],
                query_timeout: TRIAL_QUERY_TIMEOUT_MS
            }
        );
    }

    /**
     * Get account info (profile + company)
     */
    async getAccountInfo(userId) {
        const client = await pool.connect();
        try {
            await ensureCompaniesDomesticMarketColumn(client);

            // Get profile info with company_id
            const profileQuery = `
        SELECT 
          p.user_id,
          p.email,
          p.full_name,
          p.company_id,
          p.created_at
        FROM profiles p
        WHERE p.user_id = $1
      `;
            const profileResult = await client.query(profileQuery, [userId]);

            if (profileResult.rows.length === 0) {
                throw createAppError('Profile not found', {
                    statusCode: 404,
                    code: 'PROFILE_NOT_FOUND'
                });
            }

            const profile = profileResult.rows[0];

            let company = null;

            // Prefer active membership because legacy records may not have profile.company_id synced.
            const membershipCompanyQuery = `
        SELECT
          c.id,
          c.name,
          c.business_type,
          c.current_plan,
          c.domestic_market,
          c.target_markets,
          c.created_at
        FROM company_members cm
        JOIN companies c ON c.id = cm.company_id
        WHERE cm.user_id = $1
          AND cm.status IN ('active', 'invited')
        ORDER BY
          CASE WHEN cm.status = 'active' THEN 0 ELSE 1 END,
          CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END,
          cm.created_at DESC
        LIMIT 1
      `;
            const membershipCompanyResult = await client.query(membershipCompanyQuery, [userId]);
            if (membershipCompanyResult.rows.length > 0) {
                company = membershipCompanyResult.rows[0];
            }

            if (!company && profile.company_id) {
                const companyByProfileQuery = `
        SELECT 
          c.id,
          c.name,
          c.business_type,
          c.current_plan,
          c.domestic_market,
          c.target_markets,
          c.created_at
        FROM companies c
        WHERE c.id = $1
      `;
                const companyByProfileResult = await client.query(companyByProfileQuery, [profile.company_id]);
                if (companyByProfileResult.rows.length > 0) {
                    company = companyByProfileResult.rows[0];
                }
            }

            return {
                profile,
                company
            };
        } finally {
            client.release();
        }
    }

    /**
     * Update profile info
     */
    async updateProfile(userId, { full_name, email }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Update profile
            const profileQuery = `
        UPDATE profiles 
        SET 
          full_name = COALESCE($1, full_name),
          email = COALESCE($2, email),
          updated_at = NOW()
        WHERE user_id = $3
        RETURNING id, full_name, email, updated_at
      `;
            const profileResult = await client.query(profileQuery, [full_name, email, userId]);

            if (profileResult.rows.length === 0) {
                throw createAppError('Profile not found', {
                    statusCode: 404,
                    code: 'PROFILE_NOT_FOUND'
                });
            }

            // If email is updated, also update users table
            if (email) {
                await client.query(
                    'UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2',
                    [email, userId]
                );
            }

            await client.query('COMMIT');
            return profileResult.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update company info (only for admin)
     */
    async updateCompany(userId, companyId, { name, business_type, domestic_market, target_markets }) {
        const client = await pool.connect();
        try {
            await ensureCompaniesDomesticMarketColumn(client);

            // Check if user is admin of the company
            const memberQuery = `
        SELECT cm.role, c.current_plan, c.domestic_market, c.target_markets
        FROM company_members cm
        JOIN companies c ON c.id = cm.company_id
        WHERE cm.company_id = $1 AND cm.user_id = $2 AND cm.status = 'active'
      `;
            const memberResult = await client.query(memberQuery, [companyId, userId]);

            if (memberResult.rows.length === 0) {
                throw createAppError('User is not a member of this company', {
                    statusCode: 403,
                    code: 'NOT_COMPANY_MEMBER'
                });
            }

            if (memberResult.rows[0].role !== 'admin') {
                throw createAppError('Only company admin can update company info', {
                    statusCode: 403,
                    code: 'FORBIDDEN'
                });
            }

            const planId = subscriptionService.normalizePlanId(memberResult.rows[0].current_plan, 'trial');
            const normalizedMarkets = normalizeCompanyMarkets({
                currentPlan: planId,
                domesticMarket: domestic_market ?? memberResult.rows[0].domestic_market,
                targetMarkets: target_markets ?? memberResult.rows[0].target_markets
            });

            // Update company
            const companyQuery = `
        UPDATE companies 
        SET 
          name = COALESCE($1, name),
          business_type = COALESCE($2, business_type),
          domestic_market = $3,
          target_markets = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING id, name, business_type, domestic_market, target_markets, updated_at
      `;
            const companyResult = await client.query(companyQuery, [
                name,
                business_type,
                normalizedMarkets.domestic_market,
                normalizedMarkets.target_markets,
                companyId
            ]);

            if (companyResult.rows.length === 0) {
                throw createAppError('Company not found', {
                    statusCode: 404,
                    code: 'COMPANY_NOT_FOUND'
                });
            }

            return companyResult.rows[0];
        } finally {
            client.release();
        }
    }

    /**
     * Change password
     */
    async changePassword(userId, newPassword) {
        const client = await pool.connect();
        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            const query = `
        UPDATE users 
        SET 
          password_hash = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING id
      `;
            const result = await client.query(query, [hashedPassword, userId]);

            if (result.rows.length === 0) {
                throw createAppError('User not found', {
                    statusCode: 404,
                    code: 'USER_NOT_FOUND'
                });
            }

            return true;
        } finally {
            client.release();
        }
    }

    /**
     * Get user's company ID
     */
    async getUserCompanyId(userId) {
        const client = await pool.connect();
        try {
            const query = `
        SELECT company_id 
        FROM profiles 
        WHERE user_id = $1
      `;
            const result = await client.query(query, [userId]);

            if (result.rows.length === 0) {
                throw createAppError('Profile not found', {
                    statusCode: 404,
                    code: 'PROFILE_NOT_FOUND'
                });
            }

            return result.rows[0].company_id;
        } finally {
            client.release();
        }
    }

    /**
     * Create company for user (who doesn't have one yet)
     */
    async createCompany(userId, { name, business_type, domestic_market, target_markets = [] }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await ensureCompaniesDomesticMarketColumn(client);
            const normalizedMarkets = normalizeCompanyMarkets({
                currentPlan: 'trial',
                domesticMarket: domestic_market,
                targetMarkets: target_markets
            });

            // Check if user already has a company
            const profileCheck = await client.query(
                'SELECT company_id FROM profiles WHERE user_id = $1',
                [userId]
            );

            if (profileCheck.rows.length === 0) {
                throw createAppError('Profile not found', {
                    statusCode: 404,
                    code: 'PROFILE_NOT_FOUND'
                });
            }

            if (profileCheck.rows[0].company_id) {
                throw createAppError('User already has a company', {
                    statusCode: 400,
                    code: 'ALREADY_HAS_COMPANY'
                });
            }

            // Check if user has b2b role
            const roleCheck = await client.query(
                'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
                [userId, 'b2b']
            );

            // If not b2b, add b2b role
            if (roleCheck.rows.length === 0) {
                await client.query(
                    'INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, $2, NOW())',
                    [userId, 'b2b']
                );
            }

            // Create company
            const companyQuery = `
        INSERT INTO companies (name, business_type, current_plan, domestic_market, target_markets, created_at, updated_at)
        VALUES ($1, $2, 'trial', $3, $4, NOW(), NOW())
        RETURNING id, name, business_type, current_plan, domestic_market, target_markets, created_at
      `;
            const companyResult = await client.query(companyQuery, [
                name,
                business_type,
                normalizedMarkets.domestic_market,
                normalizedMarkets.target_markets
            ]);

            const company = companyResult.rows[0];

            // Update profile with company_id
            await client.query(
                'UPDATE profiles SET company_id = $1, updated_at = NOW() WHERE user_id = $2',
                [company.id, userId]
            );

            // Add user as company admin
            await client.query(
                `INSERT INTO company_members (company_id, user_id, role, status, invited_by, created_at, updated_at)
         VALUES ($1, $2, 'admin', 'active', $2, NOW(), NOW())`,
                [company.id, userId]
            );
            try {
                await this.initializeTrial(client, company.id);
            } catch (trialError) {
                console.warn(
                    `[accountService] Trial init failed for company ${company.id}:`,
                    trialError.message
                );
            }

            await client.query('COMMIT');
            return company;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new AccountService();
