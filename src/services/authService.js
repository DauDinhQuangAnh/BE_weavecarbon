const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const jwtConfig = require('../config/jwt');
const subscriptionService = require('./subscriptionService');
const {
  DEFAULT_DOMESTIC_MARKET,
  ensureCompaniesDomesticMarketColumn,
  normalizeCompanyMarkets
} = require('../utils/companyMarkets');
const TRIAL_QUERY_TIMEOUT_MS = 8000;

class AuthService {
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

  async initializeStandardDemo(client, companyId, standardSkuLimit = 20) {
    await client.query(
      {
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
        standard_started_at = COALESCE(public.subscription_cycles.standard_started_at, EXCLUDED.standard_started_at),
        standard_expires_at = COALESCE(public.subscription_cycles.standard_expires_at, EXCLUDED.standard_expires_at),
        standard_sku_limit = GREATEST(public.subscription_cycles.standard_sku_limit, EXCLUDED.standard_sku_limit),
        updated_at = NOW()
    `,
        values: [companyId, standardSkuLimit],
        query_timeout: TRIAL_QUERY_TIMEOUT_MS
      }
    );
  }

  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  async verifyPassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }

  generateAccessToken(userId, email, roles, companyId = null, isDemo = false) {
    return jwt.sign(
      {
        sub: userId,
        email,
        roles,
        is_demo: isDemo,
        company_id: companyId
      },
      jwtConfig.jwtSecret,
      {
        expiresIn: jwtConfig.jwtExpiresIn,
        issuer: jwtConfig.jwtIssuer,
        audience: jwtConfig.jwtAudience
      }
    );
  }

  generateRefreshToken(userId) {
    return jwt.sign(
      { sub: userId, type: 'refresh' },
      jwtConfig.jwtRefreshSecret,
      {
        expiresIn: jwtConfig.jwtRefreshExpiresIn,
        issuer: jwtConfig.jwtIssuer,
        audience: jwtConfig.jwtAudience
      }
    );
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, jwtConfig.jwtSecret, {
        issuer: jwtConfig.jwtIssuer,
        audience: jwtConfig.jwtAudience
      });
    } catch (error) {
      return null;
    }
  }

  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, jwtConfig.jwtRefreshSecret, {
        issuer: jwtConfig.jwtIssuer,
        audience: jwtConfig.jwtAudience
      });
    } catch (error) {
      return null;
    }
  }

  generateVerificationToken(email) {
    return jwt.sign(
      { email, type: 'email_verification' },
      jwtConfig.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  verifyEmailToken(token) {
    try {
      return jwt.verify(token, jwtConfig.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  async createUser(email, password, fullName, role, companyData = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureCompaniesDomesticMarketColumn(client);

      const hashedPassword = await this.hashPassword(password);

      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, full_name, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, NOW(), NOW())
         RETURNING id, email, full_name, email_verified, created_at`,
        [email, hashedPassword, fullName]
      );

      const user = userResult.rows[0];

      const profileResult = await client.query(
        `INSERT INTO profiles (user_id, email, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, user_id, email, full_name, company_id`,
        [user.id, email, fullName]
      );

      const profile = profileResult.rows[0];

      await client.query(
        `INSERT INTO user_roles (user_id, role, created_at)
         VALUES ($1, $2, NOW())`,
        [user.id, role]
      );

      let company = null;

      if (role === 'b2b' && companyData) {
        const normalizedMarkets = normalizeCompanyMarkets({
          currentPlan: 'trial',
          domesticMarket: companyData.domestic_market,
          targetMarkets: companyData.target_markets
        });
        const companyResult = await client.query(
          `INSERT INTO companies (name, business_type, current_plan, domestic_market, target_markets, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id, name, business_type, current_plan, domestic_market, target_markets`,
          [
            companyData.name,
            companyData.business_type,
            'trial',
            normalizedMarkets.domestic_market,
            normalizedMarkets.target_markets
          ]
        );

        company = companyResult.rows[0];

        await client.query(
          `UPDATE profiles SET company_id = $1, updated_at = NOW() WHERE user_id = $2`,
          [company.id, user.id]
        );

        profile.company_id = company.id;

        await client.query(
          `INSERT INTO company_members (company_id, user_id, role, status, invited_by, created_at, updated_at)
           VALUES ($1, $2, 'admin', 'active', $2, NOW(), NOW())`,
          [company.id, user.id]
        );

        try {
          await this.initializeTrial(client, company.id);
        } catch (trialError) {
          console.warn(
            `[authService] Trial init failed for company ${company.id}:`,
            trialError.message
          );
        }
      }

      if (role === 'b2c') {
        await client.query(
          `INSERT INTO user_rewards (user_id, total_points, total_donations, created_at, updated_at)
           VALUES ($1, 0, 0, NOW(), NOW())`,
          [user.id]
        );
      }

      await client.query('COMMIT');

      return { user, profile, company };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createOrUpdateGoogleUser(email, fullName, avatarUrl, role = 'b2c', options = {}) {
    const { skipCompanyCreation = false, markEmailVerified = false } = options;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureCompaniesDomesticMarketColumn(client);

      let user = await this.getUserByEmail(email);

      if (user) {
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
          [avatarUrl, markEmailVerified, user.id]
        );

        await client.query(
          `UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2`,
          [avatarUrl, user.id]
        );

        await client.query('COMMIT');

        return await this.getUserById(user.id);
      }

      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, full_name, avatar_url, email_verified, email_verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW(), NOW())
         RETURNING id, email, full_name, avatar_url, created_at`,
        [email, '', fullName, avatarUrl, markEmailVerified] // Empty password for OAuth users
      );

      user = userResult.rows[0];

      const profileResult = await client.query(
        `INSERT INTO profiles (user_id, email, full_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id, user_id, company_id`,
        [user.id, email, fullName, avatarUrl]
      );

      const profile = profileResult.rows[0];

      await client.query(
        `INSERT INTO user_roles (user_id, role, created_at)
         VALUES ($1, $2, NOW())`,
        [user.id, role]
      );

      if (role === 'b2b' && !skipCompanyCreation) {
        const normalizedMarkets = normalizeCompanyMarkets({
          currentPlan: 'trial',
          domesticMarket: DEFAULT_DOMESTIC_MARKET,
          targetMarkets: []
        });
        const companyResult = await client.query(
          `INSERT INTO companies (name, business_type, current_plan, domestic_market, target_markets, created_at, updated_at)
           VALUES ($1, 'brand', 'trial', $2, $3, NOW(), NOW())
           RETURNING id, name, business_type, current_plan, domestic_market, target_markets`,
          [`${fullName}'s Company`, normalizedMarkets.domestic_market, normalizedMarkets.target_markets]
        );

        const company = companyResult.rows[0];

        await client.query(
          `UPDATE profiles SET company_id = $1, updated_at = NOW() WHERE user_id = $2`,
          [company.id, user.id]
        );

        await client.query(
          `INSERT INTO company_members (company_id, user_id, role, status, invited_by, created_at, updated_at)
           VALUES ($1, $2, 'admin', 'active', $2, NOW(), NOW())`,
          [company.id, user.id]
        );

        try {
          await this.initializeTrial(client, company.id);
        } catch (trialError) {
          console.warn(
            `[authService] Trial init failed for company ${company.id}:`,
            trialError.message
          );
        }
      }

      if (role === 'b2c') {
        await client.query(
          `INSERT INTO user_rewards (user_id, total_points, total_donations, created_at, updated_at)
           VALUES ($1, 0, 0, NOW(), NOW())`,
          [user.id]
        );
      }

      await client.query('COMMIT');

      return await this.getUserById(user.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async handleGoogleAuth({ email, fullName, avatarUrl, role = 'b2c', intent = 'signin' }) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedRole = ['b2b', 'b2c'].includes(role) ? role : 'b2c';
    const normalizedIntent = intent === 'signup' ? 'signup' : 'signin';
    const isGoogleSignupFlow = normalizedIntent === 'signup';
    const effectiveRole = isGoogleSignupFlow ? 'b2b' : normalizedRole;

    if (!normalizedEmail) {
      const err = new Error('Missing Google email');
      err.code = 'GOOGLE_EMAIL_MISSING';
      err.statusCode = 400;
      throw err;
    }

    const existingUser = await this.getUserByEmail(normalizedEmail);

    const isNewUser = !existingUser;
    const shouldSkipCompanyCreation = isNewUser && effectiveRole === 'b2b';

    const user = await this.createOrUpdateGoogleUser(
      normalizedEmail,
      fullName,
      avatarUrl,
      effectiveRole,
      {
        skipCompanyCreation: shouldSkipCompanyCreation,
        markEmailVerified: false
      }
    );

    const isB2B = Array.isArray(user.roles) && user.roles.includes('b2b');
    const requiresEmailVerification = !user.email_verified;
    const shouldSendVerificationEmail = requiresEmailVerification;
    const blockLoginUntilEmailVerified = requiresEmailVerification;

    return {
      user,
      isNewUser,
      requiresCompanySetup: isB2B && !user.company_id,
      requiresEmailVerification,
      shouldSendVerificationEmail,
      blockLoginUntilEmailVerified
    };
  }

  async resolveCompanyIdForToken(userId, fallbackCompanyId = null) {
    const membership = await this.getPrimaryCompanyMembership(userId);
    return membership?.company_id || fallbackCompanyId || null;
  }

  async markUserLoggedIn(userId) {
    await pool.query(
      `UPDATE users
       SET last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  async getUserByEmail(email) {
    const result = await pool.query(
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

    if (result.rows.length === 0) return null;

    const user = result.rows[0];

    let roles = [];
    if (user.roles) {
      if (typeof user.roles === 'string') {
        // Remove curly braces and split
        roles = user.roles.replace(/[{}]/g, '').split(',').filter(r => r && r !== 'NULL');
      } else if (Array.isArray(user.roles)) {
        roles = user.roles.filter(r => r !== null && r !== undefined);
      }
    }

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      company_id: user.company_id,
      is_demo_user: user.is_demo_user,
      password_hash: user.password_hash,
      failed_login_attempts: user.failed_login_attempts || 0,
      locked_until: user.locked_until,
      roles: roles,
      email_verified: user.email_verified,
      created_at: user.created_at
    };
  }

  async getUserById(userId) {
    const result = await pool.query(
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

    if (result.rows.length === 0) return null;

    const user = result.rows[0];

    let roles = [];
    if (user.roles) {
      if (typeof user.roles === 'string') {
        // Remove curly braces and split
        roles = user.roles.replace(/[{}]/g, '').split(',').filter(r => r && r !== 'NULL');
      } else if (Array.isArray(user.roles)) {
        roles = user.roles.filter(r => r !== null && r !== undefined);
      }
    }

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      company_id: user.company_id,
      is_demo_user: user.is_demo_user,
      roles: roles,
      email_verified: user.email_verified,
      created_at: user.created_at
    };
  }

  async markEmailVerified(userId) {
    await pool.query(
      `UPDATE users 
       SET email_verified = true, email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  async createDemoUser(role, scenario = 'sample_data') {
    const client = await pool.connect();
    try {
      await subscriptionService.ensureSchema(client);
      await client.query('BEGIN');
      await ensureCompaniesDomesticMarketColumn(client);

      const demoEmail = `demo_${uuidv4().slice(0, 8)}@weavecarbon.demo`;
      const demoPassword = 'Demo@123456'; // Demo password
      const passwordHash = await bcrypt.hash(demoPassword, 10);
      const demoExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, full_name, email_verified, is_demo_user, created_at, updated_at)
         VALUES ($1, $2, $3, true, true, NOW(), NOW())
         RETURNING id, email, full_name, created_at`,
        [demoEmail, passwordHash, 'Demo User']
      );

      const user = userResult.rows[0];

      const profileResult = await client.query(
        `INSERT INTO profiles (user_id, email, full_name, is_demo_user, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         RETURNING id, user_id, email, full_name, company_id`,
        [user.id, demoEmail, 'Demo User']
      );
      const profile = profileResult.rows[0];

      await client.query(
        `INSERT INTO user_roles (user_id, role, created_at)
         VALUES ($1, $2, NOW())`,
        [user.id, role]
      );

      let company = null;
      let companyMembership = null;
      if (role === 'b2b') {
        const companyResult = await client.query(
          `INSERT INTO companies (name, business_type, current_plan, domestic_market, target_markets, created_at, updated_at)
           VALUES ('Demo Company', 'brand', 'standard', $1, $2, NOW(), NOW())
           RETURNING id, name, business_type, current_plan, domestic_market, target_markets`,
          [DEFAULT_DOMESTIC_MARKET, []],
        );
        company = companyResult.rows[0];

        await client.query(
          `UPDATE profiles SET company_id = $1 WHERE user_id = $2`,
          [company.id, user.id]
        );
        profile.company_id = company.id;

        await client.query(
          `INSERT INTO company_members (company_id, user_id, role, status, invited_by, created_at, updated_at)
           VALUES ($1, $2, 'admin', 'active', $2, NOW(), NOW())`,
          [company.id, user.id]
        );
        companyMembership = {
          company_id: company.id,
          role: 'admin',
          status: 'active',
          is_root: true
        };

        try {
          await this.initializeStandardDemo(client, company.id, 20);
        } catch (trialError) {
          console.warn(
            `[authService] Demo standard init failed for company ${company.id}:`,
            trialError.message
          );
        }
      }

      if (role === 'b2c') {
        await client.query(
          `INSERT INTO user_rewards (user_id, total_points, created_at, updated_at)
           VALUES ($1, 100, NOW(), NOW())`,
          [user.id]
        );
      }

      await client.query('COMMIT');

      return {
        user: {
          id: user.id,
          email: user.email,
          full_name: 'Demo User',
          is_demo: true,
          demo_expires_at: demoExpiresAt,
          password: demoPassword // Return password for demo login
        },
        profile,
        company,
        company_membership: companyMembership
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPrimaryCompanyMembership(userId) {
    const client = await pool.connect();
    try {
      await ensureCompaniesDomesticMarketColumn(client);
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
       ORDER BY
         CASE WHEN cm.status = 'active' THEN 0 ELSE 1 END,
         CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END,
         cm.created_at DESC
       LIMIT 1`,
        [userId]
      );

      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }
}

module.exports = new AuthService();
