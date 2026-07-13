const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { assertSchemaCapability } = require('../config/schemaCapabilities');
const analyticsService = require('./analyticsService');
const logger = require('../utils/logger');
const planRules = require('./subscriptionService/planRules');
const subscriptionHelpers = require('./subscriptionService/helpers');
const vnpay = require('./subscriptionService/vnpay');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;
const STANDARD_BILLING_DAYS = 30;
const SCHEMA_QUERY_TIMEOUT_MS = 8000;
const PAYMENT_SESSION_EXPIRY_MINUTES = 30;
const VNPAY_QUERYDR_MIN_INTERVAL_MS = 10 * 1000;

const pushTransactionalAnalyticsEvent = async (client, eventIds, payload, scope) => {
    try {
        const event = await analyticsService.enqueueEvent(client, payload);
        if (event?.id) {
            eventIds.push(event.id);
        }
    } catch (error) {
        logger.error({ err: error }, `[subscriptionService] Failed to queue ${scope}`);
    }
};

class SubscriptionService {
    PLAN_LIMITS = planRules.PLAN_LIMITS;

    STANDARD_SKU_PACKAGES = planRules.STANDARD_SKU_PACKAGES;

    PLAN_RANK = planRules.PLAN_RANK;

    STANDARD_PLAN_IDS = planRules.STANDARD_PLAN_IDS;

    ALLOWED_TARGET_PLANS = planRules.ALLOWED_TARGET_PLANS;

    CONTACT_INFO = planRules.CONTACT_INFO;

    constructor() {
        this._schemaReady = null;
    }

    buildError(message, code, statusCode) {
        return subscriptionHelpers.buildError(message, code, statusCode);
    }

    normalizePlanId(value, fallback = 'trial') {
        return planRules.normalizePlanId(value, fallback);
    }

    resolveStandardPlanBySkuLimit(value, fallback = 'standard_20') {
        return planRules.resolveStandardPlanBySkuLimit(value, fallback);
    }

    inferLegacyStandardSkuLimit(value, fallback = 20) {
        return planRules.inferLegacyStandardSkuLimit(value, fallback);
    }

    resolveStandardPackage(value, fallback = 20) {
        return planRules.resolveStandardPackage(value, fallback);
    }

    resolveRequestedTargetPlan(targetPlan, standardSkuLimit, fallback = 'trial') {
        return planRules.resolveRequestedTargetPlan(targetPlan, standardSkuLimit, fallback);
    }

    isStandardPlan(planId) {
        return planRules.isStandardPlan(planId);
    }

    resolvePlanRank(planId) {
        return planRules.resolvePlanRank(planId);
    }

    resolvePlanDetails(planId, options = {}) {
        return planRules.resolvePlanDetails(planId, options);
    }

    async ensurePricingPlanEnumValues() {
        const typeCheck = await pool.query({
            text: "SELECT to_regtype('public.pricing_plan') IS NOT NULL AS exists",
            query_timeout: SCHEMA_QUERY_TIMEOUT_MS
        });

        if (!typeCheck.rows?.[0]?.exists) {
            return;
        }

        const enumValues = await pool.query({
            text: `
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'pricing_plan'
      `,
            query_timeout: SCHEMA_QUERY_TIMEOUT_MS
        });
        const existing = new Set(enumValues.rows.map((row) => String(row.label || '')));
        const requiredValues = ['trial', 'standard', 'standard_20', 'standard_35', 'standard_50', 'export'];

        for (const value of requiredValues) {
            if (existing.has(value)) continue;
            try {
                await pool.query({
                    text: `ALTER TYPE public.pricing_plan ADD VALUE '${value}'`,
                    query_timeout: SCHEMA_QUERY_TIMEOUT_MS
                });
                existing.add(value);
            } catch (error) {
                if (error?.code !== '42710') {
                    throw error;
                }
            }
        }
    }

    async ensureSchema(_client) {
        void _client;
        assertSchemaCapability(
            'hasSubscriptionSchema',
            'Subscription schema is incomplete. Run "npm run migrate" before starting the API.'
        );
        return true;
    }

    toIsoOrNull(value) {
        return subscriptionHelpers.toIsoOrNull(value);
    }

    calcDaysRemaining(toDate) {
        return subscriptionHelpers.calcDaysRemaining(toDate);
    }

    getBackendBaseUrl() {
        return vnpay.getBackendBaseUrl();
    }

    getVnpayMode() {
        return vnpay.getVnpayMode();
    }

    getVnpayConfig() {
        return vnpay.getVnpayConfig();
    }

    formatVnpayDate(date = new Date()) {
        return vnpay.formatVnpayDate(date);
    }

    buildVnpaySignedPayload(params) {
        return vnpay.buildVnpaySignedPayload(params);
    }

    signVnpayParams(params, hashSecret) {
        return vnpay.signVnpayParams(params, hashSecret);
    }

    signVnpayPipePayload(values, hashSecret) {
        return vnpay.signVnpayPipePayload(values, hashSecret);
    }

    normalizeMetadata(value) {
        return subscriptionHelpers.normalizeMetadata(value);
    }

    mergeMetadata(existingValue, patchValue) {
        return subscriptionHelpers.mergeMetadata(existingValue, patchValue);
    }

    toPublicPaymentStatus(status) {
        return subscriptionHelpers.toPublicPaymentStatus(status);
    }

    isPaymentSessionExpired(session) {
        return subscriptionHelpers.isPaymentSessionExpired(session);
    }

    parseVnpayTimestamp(value) {
        return vnpay.parseVnpayTimestamp(value);
    }

    createVnpayRequestId(prefix = 'QDR') {
        return vnpay.createVnpayRequestId(prefix);
    }

    isSuccessfulVnpayResult(responseCode, transactionStatus = '') {
        return vnpay.isSuccessfulVnpayResult(responseCode, transactionStatus);
    }

    isFailedVnpayResult(responseCode, transactionStatus = '') {
        return vnpay.isFailedVnpayResult(responseCode, transactionStatus);
    }

    extractClientIp(rawValue) {
        return vnpay.extractClientIp(rawValue);
    }

    buildVnpayPaymentUrl(options) {
        return vnpay.buildVnpayPaymentUrl(options);
    }

    verifyVnpayReturnQuery(query) {
        return vnpay.verifyVnpayReturnQuery(query);
    }

    buildVnpayQueryDrRequest(session, options = {}) {
        return vnpay.buildVnpayQueryDrRequest(session, options);
    }

    verifyVnpayQueryDrResponse(payload) {
        return vnpay.verifyVnpayQueryDrResponse(payload);
    }

    async getCompanyAndCycle(client, companyId, options = {}) {
        await this.ensureSchema(client);

        const forUpdate = options.forUpdate === true;
        const lockClause = forUpdate ? 'FOR UPDATE' : '';

        const companyResult = await client.query(
            `
        SELECT id, current_plan, created_at
        FROM companies
        WHERE id = $1
        ${lockClause}
      `,
            [companyId]
        );

        if (companyResult.rows.length === 0) {
            throw this.buildError('Company not found', 'COMPANY_NOT_FOUND', 404);
        }

        const company = companyResult.rows[0];
        const companyCreatedAt = new Date(company.created_at);
        const defaultTrialEnd = new Date(companyCreatedAt.getTime() + TRIAL_DAYS * DAY_MS);

        const cycleUpsert = await client.query(
            `
        INSERT INTO public.subscription_cycles (
          company_id,
          trial_started_at,
          trial_ends_at
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (company_id)
        DO UPDATE SET
          trial_started_at = COALESCE(public.subscription_cycles.trial_started_at, EXCLUDED.trial_started_at),
          trial_ends_at = COALESCE(public.subscription_cycles.trial_ends_at, EXCLUDED.trial_ends_at)
        RETURNING
          company_id,
          trial_started_at,
          trial_ends_at,
          standard_started_at,
          standard_expires_at,
          standard_sku_limit
      `,
            [companyId, companyCreatedAt.toISOString(), defaultTrialEnd.toISOString()]
        );

        return {
            company,
            cycle: cycleUpsert.rows[0]
        };
    }

    async getSubscriptionSnapshot(client, companyId, options = {}) {
        const { company, cycle } = await this.getCompanyAndCycle(client, companyId, {
            forUpdate: options.forUpdate === true
        });

        const now = Date.now();
        const rawCurrentPlan = company.current_plan;
        let currentPlan = this.normalizePlanId(rawCurrentPlan, 'trial');
        let standardSkuLimit = Math.max(
            0,
            Number(cycle.standard_sku_limit || 0)
        );

        if (currentPlan !== company.current_plan) {
            await client.query(
                `
          UPDATE companies
          SET current_plan = $2, updated_at = NOW()
          WHERE id = $1
        `,
                [companyId, currentPlan]
            );
        }

        if (this.isStandardPlan(currentPlan) && standardSkuLimit <= 0) {
            standardSkuLimit = this.inferLegacyStandardSkuLimit(rawCurrentPlan, 20);
            await client.query(
                `
          UPDATE public.subscription_cycles
          SET standard_sku_limit = $2, updated_at = NOW()
          WHERE company_id = $1
        `,
                [companyId, standardSkuLimit]
            );
        }

        const trialEndsAt = cycle.trial_ends_at;
        const trialExpired = new Date(trialEndsAt).getTime() <= now;
        const trialDaysRemaining = this.calcDaysRemaining(trialEndsAt);

        let standardStartedAt = cycle.standard_started_at;
        let standardExpiresAt = cycle.standard_expires_at;
        let standardExpired = false;
        let standardDaysRemaining = 0;

        if (this.isStandardPlan(currentPlan)) {
            if (!standardExpiresAt) {
                standardStartedAt = cycle.standard_started_at || new Date();
                standardExpiresAt = new Date(new Date(standardStartedAt).getTime() + STANDARD_BILLING_DAYS * DAY_MS);
                await client.query(
                    `
            UPDATE public.subscription_cycles
            SET
              standard_started_at = $2,
              standard_expires_at = $3,
              updated_at = NOW()
            WHERE company_id = $1
          `,
                    [companyId, standardStartedAt, standardExpiresAt]
                );
            }

            standardExpired = new Date(standardExpiresAt).getTime() <= now;
            standardDaysRemaining = this.calcDaysRemaining(standardExpiresAt);

            if (standardExpired) {
                currentPlan = 'trial';
                await client.query(
                    `
            UPDATE companies
            SET current_plan = 'trial', updated_at = NOW()
            WHERE id = $1
          `,
                    [companyId]
                );
            }
        }

        return {
            current_plan: currentPlan,
            standard_sku_limit: standardSkuLimit,
            trial_started_at: this.toIsoOrNull(cycle.trial_started_at),
            trial_ends_at: this.toIsoOrNull(cycle.trial_ends_at),
            trial_expired: trialExpired,
            trial_days_remaining: trialDaysRemaining,
            standard_started_at: this.toIsoOrNull(standardStartedAt),
            standard_expires_at: this.toIsoOrNull(standardExpiresAt),
            standard_expired: standardExpired,
            standard_days_remaining: standardDaysRemaining,
            features_locked: currentPlan === 'trial' && trialExpired
        };
    }

    async getAccessControlState(companyId) {
        const client = await pool.connect();
        try {
            return await this.getSubscriptionSnapshot(client, companyId);
        } finally {
            client.release();
        }
    }

    async getSubscription(_userId, companyId) {
        const client = await pool.connect();
        try {
            const snapshot = await this.getSubscriptionSnapshot(client, companyId, { forUpdate: true });
            const currentPlan = snapshot.current_plan;
            const planDetails = this.resolvePlanDetails(currentPlan, {
                standardSkuLimit: snapshot.standard_sku_limit
            });

            const productsResult = await client.query(
                `
        SELECT COUNT(*)::int as count
        FROM products
        WHERE company_id = $1
          AND status <> 'archived'
      `,
                [companyId]
            );

            const membersResult = await client.query(
                `
        SELECT COUNT(*)::int as count
        FROM company_members
        WHERE company_id = $1 AND status IN ('active', 'invited')
      `,
                [companyId]
            );

            const productsCount = Number(productsResult.rows[0]?.count || 0);
            const membersCount = Number(membersResult.rows[0]?.count || 0);
            const apiCallsThisMonth = 0;
            const activeWindow = currentPlan === 'trial'
                ? {
                    started_at: snapshot.trial_started_at,
                    ends_at: snapshot.trial_ends_at,
                    expired: snapshot.trial_expired,
                    days_remaining: snapshot.trial_days_remaining
                }
                : this.isStandardPlan(currentPlan)
                    ? {
                        started_at: snapshot.standard_started_at,
                        ends_at: snapshot.standard_expires_at,
                        expired: snapshot.standard_expired,
                        days_remaining: snapshot.standard_days_remaining
                    }
                    : {
                        started_at: null,
                        ends_at: null,
                        expired: false,
                        days_remaining: null
                    };
            const nextAction = currentPlan === 'trial'
                ? snapshot.trial_expired ? 'upgrade_required' : 'trial_active'
                : this.isStandardPlan(currentPlan)
                    ? snapshot.standard_expired ? 'renew_required' : 'subscription_active'
                    : 'contact_sales';

            return {
                current_plan: currentPlan,
                plan_details: planDetails,
                limits: {
                    products: planDetails.products,
                    members: planDetails.members,
                    api_calls_per_month: planDetails.api_calls_per_month
                },
                usage: {
                    products: productsCount,
                    members: membersCount,
                    api_calls_this_month: apiCallsThisMonth
                },
                trial: {
                    started_at: snapshot.trial_started_at,
                    ends_at: snapshot.trial_ends_at,
                    expired: snapshot.trial_expired,
                    days_remaining: snapshot.trial_days_remaining
                },
                standard_cycle: {
                    started_at: snapshot.standard_started_at,
                    expires_at: snapshot.standard_expires_at,
                    expired: snapshot.standard_expired,
                    days_remaining: snapshot.standard_days_remaining
                },
                trial_started_at: snapshot.trial_started_at,
                trial_ends_at: snapshot.trial_ends_at,
                trial_expired: snapshot.trial_expired,
                trial_days_remaining: snapshot.trial_days_remaining,
                standard_started_at: snapshot.standard_started_at,
                standard_expires_at: snapshot.standard_expires_at,
                standard_expired: snapshot.standard_expired,
                standard_days_remaining: snapshot.standard_days_remaining,
                standard_sku_limit: snapshot.standard_sku_limit,
                features_locked: snapshot.features_locked,
                trial_days: TRIAL_DAYS,
                standard_cycle_days: STANDARD_BILLING_DAYS,
                active_window: activeWindow,
                next_action: nextAction
            };
        } finally {
            client.release();
        }
    }

    async upgradeSubscription(userId, companyId, targetPlan, billingCycle, paymentProvider = 'vnpay', context = {}) {
        const client = await pool.connect();
        try {
            const memberResult = await client.query(
                `
        SELECT role
        FROM company_members
        WHERE company_id = $1 AND user_id = $2 AND status = 'active'
      `,
                [companyId, userId]
            );

            if (memberResult.rows.length === 0) {
                throw this.buildError('User is not a member of this company', 'FORBIDDEN', 403);
            }

            if (memberResult.rows[0].role !== 'admin') {
                throw this.buildError('Only company admin can upgrade subscription', 'FORBIDDEN', 403);
            }

            const normalizedTargetPlan = this.resolveRequestedTargetPlan(
                targetPlan,
                context.standardSkuLimit,
                ''
            );
            if (!normalizedTargetPlan || !this.ALLOWED_TARGET_PLANS.has(normalizedTargetPlan)) {
                throw this.buildError('Invalid target plan', 'INVALID_PLAN', 400);
            }

            const snapshot = await this.getSubscriptionSnapshot(client, companyId, { forUpdate: true });
            const currentPlan = this.normalizePlanId(snapshot.current_plan, 'trial');
            const currentRank = this.resolvePlanRank(currentPlan);
            const targetRank = this.resolvePlanRank(normalizedTargetPlan);
            const selectedStandardPackage = normalizedTargetPlan === 'standard'
                ? this.resolveStandardPackage(
                    context.standardSkuLimit || this.inferLegacyStandardSkuLimit(targetPlan, 20)
                )
                : null;
            const isStandardAddonPurchase =
                this.isStandardPlan(normalizedTargetPlan) &&
                (this.isStandardPlan(currentPlan) || currentPlan === 'trial');

            if (normalizedTargetPlan === currentPlan && !isStandardAddonPurchase) {
                throw this.buildError('Current plan is already active', 'PLAN_ALREADY_ACTIVE', 400);
            }

            if (targetRank < currentRank) {
                throw this.buildError(
                    'Cannot register a lower plan than the current active plan',
                    'PLAN_DOWNGRADE_NOT_ALLOWED',
                    400
                );
            }

            if (normalizedTargetPlan === 'export') {
                return {
                    mode: 'contact',
                    target_plan: 'export',
                    contact: this.CONTACT_INFO
                };
            }

            if (normalizedTargetPlan !== 'trial' && !this.isStandardPlan(normalizedTargetPlan)) {
                throw this.buildError('Unsupported upgrade target', 'UNSUPPORTED_PLAN', 400);
            }

            if (billingCycle !== 'monthly') {
                throw this.buildError('Only monthly billing cycle (30 days) is supported', 'INVALID_BILLING_CYCLE', 400);
            }

            await this.ensureSchema(client);

            const sessionId = uuidv4();
            const gatewayTransactionRef = `VNPAY_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
            const monthlyAmount = selectedStandardPackage
                ? selectedStandardPackage.price_monthly
                : this.resolvePlanDetails(normalizedTargetPlan).price_monthly;
            const amount = monthlyAmount;
            const vnpayMode = this.getVnpayMode();
            const orderInfo = `Thanh toan goi ${
                selectedStandardPackage
                    ? selectedStandardPackage.name
                    : this.resolvePlanDetails(normalizedTargetPlan).name
            } (${billingCycle})`;
            const vnpayCheckout = vnpayMode === 'mock'
                ? null
                : this.buildVnpayPaymentUrl({
                    transactionRef: gatewayTransactionRef,
                    amount,
                    ipAddr: context.ipAddr,
                    orderInfo,
                    bankCode: normalizedTargetPlan === 'standard' ? 'VNPAYQR' : ''
                });
            const paymentUrl = vnpayMode === 'mock'
                ? `${this.getBackendBaseUrl()}/api/subscription/vnpay/mock-checkout?session_id=${encodeURIComponent(sessionId)}`
                : vnpayCheckout.paymentUrl;

            await client.query(
                `
        INSERT INTO public.subscription_payment_sessions (
          id,
          company_id,
          user_id,
          target_plan,
          billing_cycle,
          payment_provider,
          amount,
          status,
          payment_url,
          gateway_transaction_ref,
          expires_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, NOW() + ($10::text || ' minutes')::interval, $11::jsonb)
      `,
                [
                    sessionId,
                    companyId,
                    userId,
                    normalizedTargetPlan,
                    billingCycle,
                    paymentProvider,
                    amount,
                    paymentUrl,
                    gatewayTransactionRef,
                    PAYMENT_SESSION_EXPIRY_MINUTES,
                    JSON.stringify({
                        mode: vnpayMode,
                        requested_plan: targetPlan,
                        requested_standard_sku_limit: context.standardSkuLimit ? Number(context.standardSkuLimit) : null,
                        standard_sku_increment: selectedStandardPackage ? selectedStandardPackage.sku_increment : null,
                        current_standard_sku_limit: snapshot.standard_sku_limit || 0,
                        ip_addr: this.extractClientIp(context.ipAddr),
                        user_agent: typeof context.userAgent === 'string' ? context.userAgent : '',
                        frontend_origin: typeof context.frontendOrigin === 'string' ? context.frontendOrigin : '',
                        order_info: orderInfo,
                        vnpay_order_info: orderInfo,
                        vnpay_bank_code: normalizedTargetPlan === 'standard' ? 'VNPAYQR' : null,
                        vnpay_payment_create_date: vnpayCheckout?.createDate || null,
                        vnpay_payment_expire_date: vnpayCheckout?.expireDate || null
                    })
                ]
            );

            return {
                mode: 'payment',
                payment_provider: paymentProvider,
                payment_url: paymentUrl,
                vnpay_url: paymentUrl,
                checkout_url: paymentUrl,
                session_id: sessionId,
                transaction_ref: gatewayTransactionRef,
                target_plan: normalizedTargetPlan,
                billing_cycle: billingCycle,
                amount
            };
        } finally {
            client.release();
        }
    }

    async getPaymentSessionByTransactionRef(transactionRef) {
        const client = await pool.connect();
        try {
            await this.ensureSchema(client);
            const result = await client.query(
                `
        SELECT
          id,
          company_id,
          user_id,
          target_plan,
          billing_cycle,
          payment_provider,
          amount,
          status,
          payment_url,
          gateway_transaction_ref,
          expires_at,
          paid_at,
          metadata,
          updated_at
        FROM public.subscription_payment_sessions
        WHERE gateway_transaction_ref = $1
      `,
                [transactionRef]
            );

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async getPaymentSession(sessionId) {
        const client = await pool.connect();
        try {
            await this.ensureSchema(client);
            const result = await client.query(
                `
        SELECT
          id,
          company_id,
          user_id,
          target_plan,
          billing_cycle,
          payment_provider,
          amount,
          status,
          payment_url,
          gateway_transaction_ref,
          expires_at,
          paid_at,
          metadata,
          updated_at
        FROM public.subscription_payment_sessions
        WHERE id = $1
      `,
                [sessionId]
            );

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async updatePaymentSessionMetadata(sessionId, metadataPatch = {}) {
        const client = await pool.connect();
        try {
            await this.ensureSchema(client);
            await client.query('BEGIN');

            const sessionResult = await client.query(
                `
        SELECT metadata
        FROM public.subscription_payment_sessions
        WHERE id = $1
        FOR UPDATE
      `,
                [sessionId]
            );

            if (sessionResult.rows.length === 0) {
                throw this.buildError('Payment session not found', 'SESSION_NOT_FOUND', 404);
            }

            const nextMetadata = this.mergeMetadata(sessionResult.rows[0].metadata, metadataPatch);
            await client.query(
                `
        UPDATE public.subscription_payment_sessions
        SET metadata = $2::jsonb, updated_at = NOW()
        WHERE id = $1
      `,
                [sessionId, JSON.stringify(nextMetadata)]
            );

            await client.query('COMMIT');
            return nextMetadata;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async reconcilePendingPaymentSession(sessionId, options = {}) {
        const session = await this.getPaymentSession(sessionId);
        if (!session) {
            throw this.buildError('Payment session not found', 'SESSION_NOT_FOUND', 404);
        }

        if (this.toPublicPaymentStatus(session.status) !== 'pending') {
            return session;
        }

        if (this.isPaymentSessionExpired(session)) {
            await this.updatePaymentSessionMetadata(session.id, {
                vnpay_last_checked_at: new Date().toISOString(),
                last_payment_resolution: {
                    source: 'querydr',
                    status: 'expired'
                }
            });
            const expiredClient = await pool.connect();
            try {
                await this.ensureSchema(expiredClient);
                await expiredClient.query(
                    `
          UPDATE public.subscription_payment_sessions
          SET status = 'expired', updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
        `,
                    [session.id]
                );
            } finally {
                expiredClient.release();
            }
            return await this.getPaymentSession(session.id);
        }

        if (this.getVnpayMode() === 'mock') {
            return session;
        }

        const metadata = this.normalizeMetadata(session.metadata);
        const lastCheckedAt = new Date(metadata.vnpay_last_checked_at || 0).getTime();
        if (lastCheckedAt && Date.now() - lastCheckedAt < VNPAY_QUERYDR_MIN_INTERVAL_MS) {
            return session;
        }

        let requestPayload;
        try {
            requestPayload = this.buildVnpayQueryDrRequest(session, options);
        } catch (error) {
            await this.updatePaymentSessionMetadata(session.id, {
                vnpay_last_checked_at: new Date().toISOString(),
                vnpay_last_querydr_error: {
                    message: error?.message || 'QueryDR payload build failed',
                    checked_at: new Date().toISOString()
                }
            });
            return session;
        }
        const config = this.getVnpayConfig();
        let responsePayload = {};
        let verifiedResponse = false;
        try {
            const response = await axios.post(config.queryDrUrl, requestPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });
            responsePayload = response?.data && typeof response.data === 'object' ? response.data : {};
            verifiedResponse = this.verifyVnpayQueryDrResponse(responsePayload);
        } catch (error) {
            await this.updatePaymentSessionMetadata(session.id, {
                vnpay_last_checked_at: new Date().toISOString(),
                vnpay_last_querydr_request_id: requestPayload.vnp_RequestId,
                vnpay_last_querydr_error: {
                    message: error?.message || 'QueryDR request failed',
                    checked_at: new Date().toISOString()
                }
            });
            return session;
        }

        const metadataPatch = {
            vnpay_last_checked_at: new Date().toISOString(),
            vnpay_last_querydr_request_id: requestPayload.vnp_RequestId,
            vnpay_last_querydr: {
                verified_signature: verifiedResponse,
                response_code: String(responsePayload.vnp_ResponseCode || ''),
                transaction_status: String(responsePayload.vnp_TransactionStatus || ''),
                transaction_no: String(responsePayload.vnp_TransactionNo || ''),
                bank_code: String(responsePayload.vnp_BankCode || ''),
                card_type: String(responsePayload.vnp_CardType || ''),
                pay_date: String(responsePayload.vnp_PayDate || ''),
                checked_at: new Date().toISOString()
            }
        };

        if (!verifiedResponse) {
            await this.updatePaymentSessionMetadata(session.id, metadataPatch);
            return session;
        }

        const gatewayAmount = Number(responsePayload.vnp_Amount || 0) || 0;
        const expectedAmount = Math.round(Number(session.amount || 0) * 100);
        if (gatewayAmount && gatewayAmount !== expectedAmount) {
            await this.updatePaymentSessionMetadata(session.id, {
                ...metadataPatch,
                last_payment_resolution: {
                    source: 'querydr',
                    status: 'amount_mismatch',
                    expected_amount: expectedAmount,
                    actual_amount: gatewayAmount
                }
            });
            return session;
        }

        const responseCode = String(responsePayload.vnp_ResponseCode || '').trim();
        const transactionStatus = String(responsePayload.vnp_TransactionStatus || '').trim();
        if (this.isSuccessfulVnpayResult(responseCode, transactionStatus)) {
            await this.completeUpgrade(session.id, responseCode, {
                source: 'querydr',
                transactionStatus,
                gatewayDetails: {
                    amount: gatewayAmount,
                    transactionNo: responsePayload.vnp_TransactionNo,
                    bankCode: responsePayload.vnp_BankCode,
                    cardType: responsePayload.vnp_CardType,
                    payDate: responsePayload.vnp_PayDate,
                    orderInfo: responsePayload.vnp_OrderInfo,
                    rawPayload: responsePayload
                }
            });
            return await this.getPaymentSession(session.id);
        }

        if (this.isFailedVnpayResult(responseCode, transactionStatus)) {
            await this.completeUpgrade(session.id, responseCode || '99', {
                source: 'querydr',
                transactionStatus,
                gatewayDetails: {
                    amount: gatewayAmount,
                    transactionNo: responsePayload.vnp_TransactionNo,
                    bankCode: responsePayload.vnp_BankCode,
                    cardType: responsePayload.vnp_CardType,
                    payDate: responsePayload.vnp_PayDate,
                    orderInfo: responsePayload.vnp_OrderInfo,
                    rawPayload: responsePayload
                }
            });
            return await this.getPaymentSession(session.id);
        }

        await this.updatePaymentSessionMetadata(session.id, metadataPatch);
        return await this.getPaymentSession(session.id);
    }

    async getPaymentStatus(sessionId, companyId, options = {}) {
        const session = await this.getPaymentSession(sessionId);
        if (!session) {
            throw this.buildError('Payment session not found', 'SESSION_NOT_FOUND', 404);
        }

        if (session.company_id !== companyId) {
            throw this.buildError('Payment session not found', 'SESSION_NOT_FOUND', 404);
        }

        let nextSession = session;
        if (this.toPublicPaymentStatus(session.status) === 'pending') {
            nextSession = await this.reconcilePendingPaymentSession(session.id, options);
        }

        const publicStatus = this.toPublicPaymentStatus(nextSession.status);
        const metadata = this.normalizeMetadata(nextSession.metadata);

        return {
            session_id: nextSession.id,
            status: publicStatus,
            target_plan: this.normalizePlanId(nextSession.target_plan, 'trial'),
            billing_cycle: nextSession.billing_cycle,
            amount: Number(nextSession.amount || 0),
            transaction_ref: nextSession.gateway_transaction_ref || null,
            paid_at: this.toIsoOrNull(nextSession.paid_at),
            expires_at: this.toIsoOrNull(nextSession.expires_at),
            standard_sku_limit: Number(
                metadata.requested_standard_sku_limit ||
                metadata.standard_sku_increment ||
                0
            ) || 0
        };
    }

    async completeUpgrade(sessionId, paymentStatusCode = '00', options = {}) {
        const client = await pool.connect();
        const analyticsEventIds = [];
        try {
            await this.ensureSchema(client);
            await client.query('BEGIN');

            const sessionResult = await client.query(
                `
        SELECT
          id,
          company_id,
          user_id,
          target_plan,
          amount,
          metadata,
          billing_cycle,
          payment_provider,
          status,
          expires_at,
          paid_at
        FROM public.subscription_payment_sessions
        WHERE id = $1
        FOR UPDATE
      `,
                [sessionId]
            );

            if (sessionResult.rows.length === 0) {
                throw this.buildError('Payment session not found', 'SESSION_NOT_FOUND', 404);
            }

            const session = sessionResult.rows[0];
            const targetPlan = this.normalizePlanId(session.target_plan, 'trial');
            const analyticsPlanFamily = targetPlan === 'export' ? 'export' : 'standard';
            const sessionMetadata = this.normalizeMetadata(session.metadata);
            const gatewayDetails = this.normalizeMetadata(options.gatewayDetails);
            const transactionStatus = String(options.transactionStatus || '').trim();
            const expectedAmount = Math.round(Number(session.amount || 0) * 100);
            const actualAmount = Number(gatewayDetails.amount || 0) || 0;
            const nextMetadata = this.mergeMetadata(sessionMetadata, {
                vnpay_last_checked_at: new Date().toISOString(),
                vnpay_transaction_no:
                    gatewayDetails.transactionNo || sessionMetadata.vnpay_transaction_no || null,
                vnpay_bank_code:
                    gatewayDetails.bankCode || sessionMetadata.vnpay_bank_code || null,
                vnpay_card_type:
                    gatewayDetails.cardType || sessionMetadata.vnpay_card_type || null,
                vnpay_pay_date:
                    gatewayDetails.payDate || sessionMetadata.vnpay_pay_date || null,
                vnpay_last_payload:
                    gatewayDetails.rawPayload || sessionMetadata.vnpay_last_payload || null,
                last_payment_resolution: {
                    source: options.source || 'system',
                    response_code: String(paymentStatusCode || ''),
                    transaction_status: transactionStatus,
                    checked_at: new Date().toISOString()
                }
            });

            if (session.status === 'success') {
                await client.query('COMMIT');
                return {
                    updated: false,
                    current_plan: targetPlan,
                    message: 'Session already completed'
                };
            }

            if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'expired') {
                await client.query('COMMIT');
                return {
                    updated: false,
                    current_plan: null,
                    message: 'Session already resolved'
                };
            }

            if (this.isPaymentSessionExpired(session)) {
                const expiredMetadata = this.mergeMetadata(nextMetadata, {
                    last_payment_resolution: {
                        source: options.source || 'system',
                        status: 'expired',
                        checked_at: new Date().toISOString()
                    }
                });
                await client.query(
                    `
          UPDATE public.subscription_payment_sessions
          SET status = 'expired', metadata = $2::jsonb, updated_at = NOW()
          WHERE id = $1
        `,
                    [
                        sessionId,
                        JSON.stringify(expiredMetadata)
                    ]
                );
                await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_payment_failed',
                    user_id: session.user_id,
                    company_id: session.company_id,
                    entity_type: 'subscription_payment_session',
                    entity_id: sessionId,
                    payload: {
                        billing_cycle: session.billing_cycle || 'monthly',
                        payment_provider: session.payment_provider || 'vnpay',
                        plan_family: analyticsPlanFamily,
                        plan_sku_limit: Number(
                            nextMetadata.requested_standard_sku_limit ||
                            nextMetadata.standard_sku_increment ||
                            0
                        ) || undefined,
                        error_code: 'session_expired'
                    }
                }, 'wc_payment_failed');
                await client.query('COMMIT');
                analyticsService.queuePendingDispatch(analyticsEventIds);
                return {
                    updated: false,
                    current_plan: null,
                    message: 'Payment session expired'
                };
            }

            if (actualAmount && actualAmount !== expectedAmount) {
                throw this.buildError('Invalid payment amount', 'INVALID_PAYMENT_AMOUNT', 400);
            }

            const paymentSuccess = this.isSuccessfulVnpayResult(paymentStatusCode, transactionStatus);
            if (!paymentSuccess) {
                await client.query(
                    `
          UPDATE public.subscription_payment_sessions
          SET status = 'failed', metadata = $2::jsonb, updated_at = NOW()
          WHERE id = $1
        `,
                    [
                        sessionId,
                        JSON.stringify(
                            this.mergeMetadata(nextMetadata, {
                                last_payment_resolution: {
                                    source: options.source || 'system',
                                    status: 'failed',
                                    response_code: String(paymentStatusCode || ''),
                                    transaction_status: transactionStatus,
                                    checked_at: new Date().toISOString()
                                }
                            })
                        )
                    ]
                );
                await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_payment_failed',
                    user_id: session.user_id,
                    company_id: session.company_id,
                    entity_type: 'subscription_payment_session',
                    entity_id: sessionId,
                    payload: {
                        billing_cycle: session.billing_cycle || 'monthly',
                        payment_provider: session.payment_provider || 'vnpay',
                        plan_family: analyticsPlanFamily,
                        plan_sku_limit: Number(
                            nextMetadata.requested_standard_sku_limit ||
                            nextMetadata.standard_sku_increment ||
                            0
                        ) || undefined,
                        error_code: String(paymentStatusCode || transactionStatus || 'payment_failed')
                    }
                }, 'wc_payment_failed');
                await client.query('COMMIT');
                analyticsService.queuePendingDispatch(analyticsEventIds);
                return {
                    updated: false,
                    current_plan: null,
                    message: 'Payment was not successful'
                };
            }

            await client.query(
                `
        UPDATE public.subscription_payment_sessions
        SET status = 'success', paid_at = $2, metadata = $3::jsonb, updated_at = NOW()
        WHERE id = $1
      `,
                [
                    sessionId,
                    this.parseVnpayTimestamp(gatewayDetails.payDate) || new Date(),
                    JSON.stringify(
                        this.mergeMetadata(nextMetadata, {
                            last_payment_resolution: {
                                source: options.source || 'system',
                                status: 'paid',
                                response_code: String(paymentStatusCode || ''),
                                transaction_status: transactionStatus,
                                checked_at: new Date().toISOString()
                            }
                        })
                    )
                ]
            );

            const cycleDays = STANDARD_BILLING_DAYS;
            let nextStandardSkuLimit = null;

            if (this.isStandardPlan(targetPlan)) {
                const metadata = nextMetadata;
                const snapshot = await this.getSubscriptionSnapshot(client, session.company_id, { forUpdate: true });
                const purchasedSkuIncrement = Math.max(
                    20,
                    Number(
                        metadata.standard_sku_increment ||
                        metadata.requested_standard_sku_limit ||
                        this.inferLegacyStandardSkuLimit(session.target_plan, 20)
                    ) || 20
                );
                const currentStandardSkuLimit =
                    this.isStandardPlan(snapshot.current_plan)
                        ? Math.max(0, Number(snapshot.standard_sku_limit || 0))
                        : 0;
                nextStandardSkuLimit = currentStandardSkuLimit + purchasedSkuIncrement;

                await client.query(
                    `
        UPDATE companies
        SET current_plan = $2, updated_at = NOW()
        WHERE id = $1
      `,
                    [session.company_id, 'standard']
                );

                await this.getCompanyAndCycle(client, session.company_id, { forUpdate: true });
                await client.query(
                    `
        UPDATE public.subscription_cycles
        SET
          standard_started_at = NOW(),
          standard_expires_at = NOW() + ($2::text || ' days')::interval,
          standard_sku_limit = $3,
          updated_at = NOW()
        WHERE company_id = $1
      `,
                    [session.company_id, cycleDays, nextStandardSkuLimit]
                );
            } else if (targetPlan === 'trial') {
                await client.query(
                    `
        UPDATE companies
        SET current_plan = 'trial', updated_at = NOW()
        WHERE id = $1
      `,
                    [session.company_id]
                );

                await this.getCompanyAndCycle(client, session.company_id, { forUpdate: true });
                await client.query(
                    `
        UPDATE public.subscription_cycles
        SET
          trial_started_at = NOW(),
          trial_ends_at = NOW() + ($2::text || ' days')::interval,
          updated_at = NOW()
        WHERE company_id = $1
      `,
                    [session.company_id, cycleDays]
                );
            } else {
                throw this.buildError('Unsupported target plan in payment session', 'UNSUPPORTED_PLAN', 400);
            }

            await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                event_name: 'purchase',
                user_id: session.user_id,
                company_id: session.company_id,
                entity_type: 'subscription_payment_session',
                entity_id: sessionId,
                value: Number(session.amount || 0),
                currency: 'VND',
                payload: {
                    billing_cycle: session.billing_cycle || 'monthly',
                    currency: 'VND',
                    payment_provider: session.payment_provider || 'vnpay',
                    plan_family: analyticsPlanFamily,
                    plan_sku_limit:
                        analyticsPlanFamily === 'standard' ?
                            Number(
                                nextStandardSkuLimit ||
                                nextMetadata.requested_standard_sku_limit ||
                                nextMetadata.standard_sku_increment ||
                                0
                            ) || undefined :
                            undefined,
                    value: Number(session.amount || 0)
                }
            }, 'purchase');

            await client.query('COMMIT');
            analyticsService.queuePendingDispatch(analyticsEventIds);

            return {
                updated: true,
                current_plan: this.isStandardPlan(targetPlan) ? 'standard' : targetPlan,
                standard_sku_limit: nextStandardSkuLimit,
                plan_expires_in_days: cycleDays
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new SubscriptionService();
