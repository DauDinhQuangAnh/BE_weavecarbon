const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const subscriptionService = require('./subscriptionService');
const b2cDefaultsService = require('./b2cDefaultsService');
const logger = require('../utils/logger');
const { seedDemoB2BData } = require('./demoB2BSeeder');
const authTokens = require('./authService/tokens');
const {
  DEFAULT_DOMESTIC_MARKET,
  ensureCompaniesDomesticMarketColumn,
  normalizeCompanyMarkets
} = require('../utils/companyMarkets');
const TRIAL_QUERY_TIMEOUT_MS = 8000;
const REFRESH_TOKEN_ROTATION_GRACE_SECONDS = Math.max(
  0,
  Number.parseInt(process.env.REFRESH_TOKEN_ROTATION_GRACE_SECONDS || '30', 10) || 30
);
let refreshTokenSchemaPromise = null;

class AuthService {
  async ensureRefreshTokenSchema(client = pool) {
    if (client !== pool) {
      await this.createRefreshTokenSchema(client);
      return;
    }

    if (!refreshTokenSchemaPromise) {
      refreshTokenSchemaPromise = this.createRefreshTokenSchema(pool).catch((error) => {
        refreshTokenSchemaPromise = null;
        throw error;
      });
    }

    await refreshTokenSchemaPromise;
  }

  async createRefreshTokenSchema(client) {
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

  hashRefreshToken(token) {
    return authTokens.hashRefreshToken(token);
  }

  decodeJwtExpiry(token) {
    return authTokens.decodeJwtExpiry(token);
  }

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
    return authTokens.hashPassword(password);
  }

  async verifyPassword(password, hashedPassword) {
    return authTokens.verifyPassword(password, hashedPassword);
  }

  generateSystemPassword(length = 20) {
    return authTokens.generateSystemPassword(length);
  }

  generateAccessToken(userId, email, roles, companyId = null, isDemo = false) {
    return authTokens.generateAccessToken(userId, email, roles, companyId, isDemo);
  }

  generateRefreshToken(userId, rememberMe = true) {
    return authTokens.generateRefreshToken(userId, rememberMe);
  }

  generateCompanyInviteToken({ email, companyId }) {
    return authTokens.generateCompanyInviteToken({ email, companyId });
  }

  verifyAccessToken(token) {
    return authTokens.verifyAccessToken(token);
  }

  verifyRefreshToken(token) {
    return authTokens.verifyRefreshToken(token);
  }

  verifyCompanyInviteToken(token) {
    return authTokens.verifyCompanyInviteToken(token);
  }

  async storeRefreshToken(refreshToken, userId, metadata = {}) {
    await this.ensureRefreshTokenSchema();
    const expiresAt = this.decodeJwtExpiry(refreshToken);
    if (!expiresAt) {
      throw new Error('Refresh token expiry could not be decoded');
    }

    const tokenHash = this.hashRefreshToken(refreshToken);

    await pool.query(
      `INSERT INTO refresh_tokens (
         user_id,
         token_hash,
         expires_at,
         ip_address,
         user_agent
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        tokenHash,
        expiresAt,
        metadata.ipAddress || null,
        metadata.userAgent || null
      ]
    );

    return {
      token_hash: tokenHash,
      expires_at: expiresAt
    };
  }

  async getRefreshTokenRecord(refreshToken, client = pool) {
    await this.ensureRefreshTokenSchema(client);
    const tokenHash = this.hashRefreshToken(refreshToken);
    const result = await client.query(
      `SELECT id, user_id, token_hash, expires_at, is_revoked, revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    return result.rows[0] || null;
  }

  async isRefreshTokenActive(refreshToken, client = pool) {
    await this.ensureRefreshTokenSchema(client);
    const tokenHash = this.hashRefreshToken(refreshToken);
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
  }

  async revokeRefreshToken(refreshToken, client = pool) {
    await this.ensureRefreshTokenSchema(client);
    const tokenHash = this.hashRefreshToken(refreshToken);
    const result = await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = true,
           revoked_at = NOW()
       WHERE token_hash = $1
         AND is_revoked = false`,
      [tokenHash]
    );

    return result.rowCount || 0;
  }

  async revokeAllRefreshTokens(userId, client = pool) {
    await this.ensureRefreshTokenSchema(client);
    const result = await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = true,
           revoked_at = NOW()
       WHERE user_id = $1
         AND is_revoked = false`,
      [userId]
    );

    return result.rowCount || 0;
  }

  async rotateRefreshToken(currentRefreshToken, nextRefreshToken, metadata = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureRefreshTokenSchema(client);

      const currentTokenHash = this.hashRefreshToken(currentRefreshToken);
      const currentSessionResult = await client.query(
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
        [currentTokenHash, REFRESH_TOKEN_ROTATION_GRACE_SECONDS]
      );
      const currentSession = currentSessionResult.rows[0] || null;
      if (!currentSession) {
        await client.query('ROLLBACK');
        return null;
      }

      if (!currentSession.is_revoked) {
        await client.query(
          `UPDATE refresh_tokens
           SET is_revoked = true,
               revoked_at = NOW()
           WHERE id = $1`,
          [currentSession.id]
        );
      }

      const expiresAt = this.decodeJwtExpiry(nextRefreshToken);
      if (!expiresAt) {
        throw new Error('Rotated refresh token expiry could not be decoded');
      }

      await client.query(
        `INSERT INTO refresh_tokens (
           user_id,
           token_hash,
           expires_at,
           ip_address,
           user_agent
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          currentSession.user_id,
          this.hashRefreshToken(nextRefreshToken),
          expiresAt,
          metadata.ipAddress || null,
          metadata.userAgent || null
        ]
      );

      await client.query('COMMIT');
      return {
        user_id: currentSession.user_id,
        expires_at: expiresAt
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  generateVerificationToken(email) {
    return authTokens.generateVerificationToken(email);
  }

  verifyEmailToken(token) {
    return authTokens.verifyEmailToken(token);
  }

  async createInvitedCompanyUser({ client, email, fullName, companyId }) {
    const temporaryPassword = this.generateSystemPassword();
    const hashedPassword = await this.hashPassword(temporaryPassword);
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedFullName = String(fullName || '').trim();

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, false, NOW(), NOW())
       RETURNING id, email, full_name, email_verified, created_at`,
      [normalizedEmail, hashedPassword, normalizedFullName]
    );
    const user = userResult.rows[0];

    const profileResult = await client.query(
      `INSERT INTO profiles (user_id, email, full_name, company_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, user_id, email, full_name, company_id`,
      [user.id, normalizedEmail, normalizedFullName, companyId]
    );

    await client.query(
      `INSERT INTO user_roles (user_id, role, created_at)
       VALUES ($1, 'b2b', NOW())`,
      [user.id]
    );

    return {
      user,
      profile: profileResult.rows[0],
      temporaryPassword
    };
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
          logger.warn(
            { err: trialError.message },
            `[authService] Trial init failed for company ${company.id}`
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
          logger.warn(
            { err: trialError.message },
            `[authService] Trial init failed for company ${company.id}`
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

  async handleGoogleAuth({
    email,
    fullName,
    avatarUrl,
    role = 'b2c',
    intent = 'signin'
  }) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedIntent = intent === 'signup' ? 'signup' : 'signin';
    const fallbackRole = normalizedIntent === 'signup' ? 'b2b' : 'b2c';
    const normalizedRole = ['b2b', 'b2c'].includes(role) ? role : fallbackRole;
    const effectiveRole = normalizedRole;

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
        markEmailVerified: true
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

  async getCompanyMembership(companyId, userId, client = pool) {
    const result = await client.query(
      `SELECT company_id, user_id, role, status, invited_by, created_at, updated_at
       FROM company_members
       WHERE company_id = $1 AND user_id = $2
       LIMIT 1`,
      [companyId, userId]
    );

    return result.rows[0] || null;
  }

  async activateCompanyMembership(companyId, userId, client = pool) {
    const result = await client.query(
      `UPDATE company_members
       SET status = 'active', updated_at = NOW()
       WHERE company_id = $1 AND user_id = $2 AND status = 'invited'
       RETURNING company_id, user_id, role, status, invited_by, created_at, updated_at`,
      [companyId, userId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    return this.getCompanyMembership(companyId, userId, client);
  }

  _getDemoB2CLevel(totalPoints) {
    if (totalPoints >= 2000) return 'Champion';
    if (totalPoints >= 1000) return 'Advocate';
    if (totalPoints >= 400) return 'Explorer';
    return 'Beginner';
  }

  _buildDemoB2CItem(material, itemName, itemType, condition, weightKg) {
    const pointsEarned = Math.round(Number(material.points_per_kg || 0) * weightKg);
    const co2Saved = Number((Number(material.co2_saved_per_kg || 0) * weightKg).toFixed(4));

    return {
      item_name: itemName,
      item_type: itemType,
      condition,
      material_id: material.id,
      weight_kg: weightKg,
      points_earned: pointsEarned,
      co2_saved: co2Saved
    };
  }

  async seedDemoB2CData(client, userId) {
    await b2cDefaultsService.ensureSeedData(client);

    const materialResult = await client.query(
      `
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
      `
    );

    if (materialResult.rows.length < 2) {
      await client.query(
        `INSERT INTO public.user_rewards (user_id, total_points, created_at, updated_at)
         VALUES ($1, 100, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      return;
    }

    const collectionPointResult = await client.query(
      `
        SELECT id
        FROM public.collection_points
        WHERE is_active = true
          AND accepts_charity = true
          AND accepts_recycle = true
        ORDER BY name ASC
        LIMIT 1
      `
    );

    const collectionPointId = collectionPointResult.rows[0]?.id || null;
    const [cotton, polyester, linen = materialResult.rows[1]] = materialResult.rows;
    const donationSpecs = [
      {
        category: 'charity',
        status: 'received',
        daysAgo: 3,
        description: 'Demo donation: cotton shirts and recycled fabric',
        items: [
          this._buildDemoB2CItem(cotton, 'Cotton shirts', 'shirt', 'good', 5.0),
          this._buildDemoB2CItem(polyester, 'Reusable tote bags', 'bag', 'good', 3.0)
        ]
      },
      {
        category: 'recycle',
        status: 'processed',
        daysAgo: 1,
        description: 'Demo recycling: mixed textile batch',
        items: [
          this._buildDemoB2CItem(polyester, 'Polyester jackets', 'jacket', 'worn', 4.0),
          this._buildDemoB2CItem(linen, 'Linen scraps', 'fabric', 'worn', 2.0)
        ]
      }
    ];

    let totalPoints = 0;
    let totalItems = 0;
    let totalWeightKg = 0;
    let totalCo2Saved = 0;

    for (const donation of donationSpecs) {
      const basePoints = donation.items.reduce((sum, item) => sum + item.points_earned, 0);
      const bonusPoints = donation.category === 'charity' ? Math.round(basePoints * 0.5) : 0;
      const donationPoints = basePoints + bonusPoints;
      const donationWeight = Number(
        donation.items.reduce((sum, item) => sum + item.weight_kg, 0).toFixed(4)
      );
      const donationCo2Saved = Number(
        donation.items.reduce((sum, item) => sum + item.co2_saved, 0).toFixed(4)
      );
      const createdAt = new Date(Date.now() - donation.daysAgo * 24 * 60 * 60 * 1000);

      const donationResult = await client.query(
        `
          INSERT INTO public.donations (
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
          RETURNING id
        `,
        [
          userId,
          donation.category,
          donation.status,
          donation.description,
          donation.items.length === 1 ? donation.items[0].material_id : null,
          donationWeight,
          collectionPointId,
          basePoints,
          bonusPoints,
          donationPoints,
          donationCo2Saved,
          createdAt,
          donation.status === 'processed' ? createdAt : null,
          createdAt
        ]
      );

      const donationId = donationResult.rows[0].id;

      for (const item of donation.items) {
        await client.query(
          `
            INSERT INTO public.donation_items (
              donation_id,
              item_name,
              item_type,
              condition,
              material_id,
              weight_kg,
              points_earned,
              co2_saved,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
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
      }

      await client.query(
        `
          INSERT INTO public.reward_transactions (
            user_id,
            donation_id,
            transaction_type,
            points,
            description,
            created_at
          ) VALUES ($1, $2, 'earn', $3, $4, $5)
        `,
        [
          userId,
          donationId,
          donationPoints,
          donation.category === 'charity'
            ? 'Demo charity donation reward'
            : 'Demo textile recycling reward',
          createdAt
        ]
      );

      totalPoints += donationPoints;
      totalItems += donation.items.length;
      totalWeightKg += donationWeight;
      totalCo2Saved += donationCo2Saved;
    }

    await client.query(
      `
        INSERT INTO public.user_rewards (
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
          updated_at = NOW()
      `,
      [
        userId,
        totalPoints,
        donationSpecs.length,
        totalItems,
        Number(totalWeightKg.toFixed(4)),
        Number(totalCo2Saved.toFixed(4)),
        this._getDemoB2CLevel(totalPoints)
      ]
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
        `INSERT INTO users (email, password_hash, full_name, email_verified, is_demo_user, demo_expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, true, true, $4, NOW(), NOW())
         RETURNING id, email, full_name, created_at`,
        [demoEmail, passwordHash, 'Demo User', demoExpiresAt]
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
          logger.warn(
            { err: trialError.message },
            `[authService] Demo standard init failed for company ${company.id}`
          );
        }

        await client.query('SAVEPOINT demo_b2b_seed');
        try {
          await seedDemoB2BData(client, company.id, user.id);
          await client.query('RELEASE SAVEPOINT demo_b2b_seed');
        } catch (seedError) {
          await client.query('ROLLBACK TO SAVEPOINT demo_b2b_seed');
          await client.query('RELEASE SAVEPOINT demo_b2b_seed');
          logger.warn(
            { err: seedError.message },
            `[authService] Demo B2B seed failed for company ${company.id}`
          );
        }
      }

      if (role === 'b2c') {
        await this.seedDemoB2CData(client, user.id);
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

  async getPrimaryCompanyMembership(userId, options = {}) {
    const { includeInactive = false } = options;
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
         AND ($2::boolean OR cm.status = 'active')
       ORDER BY
         CASE WHEN cm.status = 'active' THEN 0 ELSE 1 END,
         CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END,
         cm.created_at DESC
       LIMIT 1`,
        [userId, includeInactive]
      );

      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }
}

module.exports = new AuthService();
