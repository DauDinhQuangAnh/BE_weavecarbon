const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');
const { assertSchemaCapability } = require('../config/schemaCapabilities');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;
const STANDARD_BILLING_DAYS = 30;
const SCHEMA_QUERY_TIMEOUT_MS = 8000;
const PAYMENT_SESSION_EXPIRY_MINUTES = 30;
const VNPAY_PAYMENT_URL_EXPIRY_MINUTES = 15;
const VNPAY_QUERYDR_MIN_INTERVAL_MS = 10 * 1000;
const VNPAY_SUCCESS_CODE = '00';

class SubscriptionService {
    PLAN_LIMITS = {
        trial: {
            name: 'Trial',
            price_monthly: 149000,
            products: 100,
            members: 5,
            api_calls_per_month: 10000
        },
        standard: {
            name: 'Standard',
            price_monthly: 0,
            products: 20,
            members: 20,
            api_calls_per_month: 100000
        },
        export: {
            name: 'Export',
            price_monthly: 3000000,
            products: -1,
            members: 50,
            api_calls_per_month: -1
        }
    };

    STANDARD_SKU_PACKAGES = {
        20: {
            sku_increment: 20,
            name: 'Standard +20 SKU',
            price_monthly: 899000
        },
        35: {
            sku_increment: 35,
            name: 'Standard +35 SKU',
            price_monthly: 1199000
        },
        50: {
            sku_increment: 50,
            name: 'Standard +50 SKU',
            price_monthly: 1499000
        }
    };

    PLAN_RANK = {
        trial: 1,
        standard: 2,
        standard_20: 2,
        standard_35: 2,
        standard_50: 2,
        export: 3
    };

    STANDARD_PLAN_IDS = new Set(['standard', 'standard_20', 'standard_35', 'standard_50']);

    ALLOWED_TARGET_PLANS = new Set([
        'trial',
        'standard',
        'standard_20',
        'standard_35',
        'standard_50',
        'export'
    ]);

    CONTACT_INFO = {
        name: 'Nguyen Van A',
        phone: '123456789'
    };

    constructor() {
        this._schemaReady = null;
    }

    buildError(message, code, statusCode) {
        const error = new Error(message);
        error.code = code;
        error.statusCode = statusCode;
        return error;
    }

    normalizePlanId(value, fallback = 'trial') {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');

        if (!normalized) return fallback;
        if (normalized === 'trial') return 'trial';
        if (normalized === 'export') return 'export';
        if (normalized === 'standard') return 'standard';
        if (normalized.includes('standard_50')) return 'standard';
        if (normalized.includes('standard_35')) return 'standard';
        if (normalized.includes('standard_20')) return 'standard';
        if (normalized.includes('standard50')) return 'standard';
        if (normalized.includes('standard35')) return 'standard';
        if (normalized.includes('standard20')) return 'standard';
        if (normalized.includes('standard')) return 'standard';
        return fallback;
    }

    resolveStandardPlanBySkuLimit(value, fallback = 'standard_20') {
        const numericValue = Number(value);
        if (numericValue >= 50) return 'standard_50';
        if (numericValue >= 35) return 'standard_35';
        if (numericValue >= 20) return 'standard_20';
        return fallback;
    }

    inferLegacyStandardSkuLimit(value, fallback = 20) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');

        if (!normalized) return fallback;
        if (normalized.includes('standard_50') || normalized.includes('standard50')) return 50;
        if (normalized.includes('standard_35') || normalized.includes('standard35')) return 35;
        if (normalized.includes('standard_20') || normalized.includes('standard20')) return 20;
        if (normalized.includes('standard')) return 20;
        return fallback;
    }

    resolveStandardPackage(value, fallback = 20) {
        const numericValue = Number(value);
        if (numericValue >= 50) return this.STANDARD_SKU_PACKAGES[50];
        if (numericValue >= 35) return this.STANDARD_SKU_PACKAGES[35];
        if (numericValue >= 20) return this.STANDARD_SKU_PACKAGES[20];
        return this.STANDARD_SKU_PACKAGES[fallback] || this.STANDARD_SKU_PACKAGES[20];
    }

    resolveRequestedTargetPlan(targetPlan, standardSkuLimit, fallback = 'trial') {
        const normalizedToken = String(targetPlan || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');

        if (normalizedToken === 'standard') {
            return 'standard';
        }

        if (normalizedToken.includes('standard')) {
            return 'standard';
        }

        return this.normalizePlanId(targetPlan, fallback);
    }

    isStandardPlan(planId) {
        const normalized = this.normalizePlanId(planId, 'trial');
        return this.STANDARD_PLAN_IDS.has(normalized);
    }

    resolvePlanRank(planId) {
        const normalized = this.normalizePlanId(planId, 'trial');
        return this.PLAN_RANK[normalized] || 0;
    }

    resolvePlanDetails(planId, options = {}) {
        const normalized = this.normalizePlanId(planId, 'trial');
        if (normalized === 'standard') {
            const standardSkuLimit = Math.max(0, Number(options.standardSkuLimit || 0)) || 20;
            return {
                ...this.PLAN_LIMITS.standard,
                products: standardSkuLimit
            };
        }
        return this.PLAN_LIMITS[normalized] || this.PLAN_LIMITS.trial;
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
        if (!value) return null;
        const parsed = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
    }

    calcDaysRemaining(toDate) {
        if (!toDate) return 0;
        const end = new Date(toDate).getTime();
        return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
    }

    getBackendBaseUrl() {
        return (process.env.AUTH_PUBLIC_BASE_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');
    }

    getVnpayMode() {
        return (process.env.VNPAY_MODE || 'sandbox').trim().toLowerCase();
    }

    getVnpayConfig() {
        const mode = this.getVnpayMode();
        const backendBaseUrl = this.getBackendBaseUrl();
        const payUrl = (process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html').trim();
        const queryDrUrl = (process.env.VNPAY_QUERYDR_URL || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction').trim();
        const returnUrl = (process.env.VNPAY_RETURN_URL || `${backendBaseUrl}/api/subscription/vnpay/return`).trim();
        const ipnUrl = (process.env.VNPAY_IPN_URL || `${backendBaseUrl}/api/subscription/vnpay/ipn`).trim();
        const tmnCode = (process.env.VNPAY_TMN_CODE || '').trim();
        const hashSecret = (process.env.VNPAY_HASH_SECRET || '').trim();

        return { mode, backendBaseUrl, payUrl, queryDrUrl, returnUrl, ipnUrl, tmnCode, hashSecret };
    }

    formatVnpayDate(date = new Date()) {
        const offsetMs = 7 * 60 * 60 * 1000;
        const local = new Date(date.getTime() + offsetMs);
        const yyyy = local.getUTCFullYear();
        const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(local.getUTCDate()).padStart(2, '0');
        const HH = String(local.getUTCHours()).padStart(2, '0');
        const mm = String(local.getUTCMinutes()).padStart(2, '0');
        const ss = String(local.getUTCSeconds()).padStart(2, '0');
        return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
    }

    buildVnpaySignedPayload(params) {
        const orderedKeys = Object.keys(params).sort();
        return orderedKeys
            .map((key) => {
                const value = params[key];
                const normalizedValue = value === null || typeof value === 'undefined' ? '' : String(value);
                return `${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue).replace(/%20/g, '+')}`;
            })
            .join('&');
    }

    signVnpayParams(params, hashSecret) {
        const payload = this.buildVnpaySignedPayload(params);
        return crypto.createHmac('sha512', hashSecret).update(Buffer.from(payload, 'utf-8')).digest('hex');
    }

    signVnpayPipePayload(values, hashSecret) {
        const payload = values
            .map((value) => (value === null || typeof value === 'undefined' ? '' : String(value)))
            .join('|');
        return crypto.createHmac('sha512', hashSecret).update(Buffer.from(payload, 'utf-8')).digest('hex');
    }

    normalizeMetadata(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    mergeMetadata(existingValue, patchValue) {
        const existing = this.normalizeMetadata(existingValue);
        const patch = this.normalizeMetadata(patchValue);
        const next = { ...existing };

        for (const [key, value] of Object.entries(patch)) {
            if (typeof value !== 'undefined') {
                next[key] = value;
            }
        }

        return next;
    }

    toPublicPaymentStatus(status) {
        if (status === 'success') return 'paid';
        if (status === 'expired') return 'expired';
        if (status === 'failed' || status === 'cancelled') return 'failed';
        return 'pending';
    }

    isPaymentSessionExpired(session) {
        if (!session?.expires_at) return false;
        return new Date(session.expires_at).getTime() < Date.now();
    }

    parseVnpayTimestamp(value) {
        const raw = String(value || '').trim();
        if (!/^\d{14}$/.test(raw)) return null;

        const year = Number(raw.slice(0, 4));
        const month = Number(raw.slice(4, 6)) - 1;
        const day = Number(raw.slice(6, 8));
        const hour = Number(raw.slice(8, 10));
        const minute = Number(raw.slice(10, 12));
        const second = Number(raw.slice(12, 14));
        const parsed = new Date(Date.UTC(year, month, day, hour - 7, minute, second));

        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    createVnpayRequestId(prefix = 'QDR') {
        const random = Math.floor(Math.random() * 1_000_000)
            .toString()
            .padStart(6, '0');
        return `${prefix}${Date.now()}${random}`.slice(0, 32);
    }

    isSuccessfulVnpayResult(responseCode, transactionStatus = '') {
        const normalizedResponseCode = String(responseCode || '').trim();
        const normalizedTransactionStatus = String(transactionStatus || '').trim();
        return (
            normalizedResponseCode === VNPAY_SUCCESS_CODE &&
            (!normalizedTransactionStatus || normalizedTransactionStatus === VNPAY_SUCCESS_CODE)
        );
    }

    isFailedVnpayResult(responseCode, transactionStatus = '') {
        const normalizedResponseCode = String(responseCode || '').trim();
        const normalizedTransactionStatus = String(transactionStatus || '').trim();

        if (!normalizedResponseCode && !normalizedTransactionStatus) {
            return false;
        }

        return (
            (normalizedResponseCode && normalizedResponseCode !== VNPAY_SUCCESS_CODE) ||
            (normalizedTransactionStatus && normalizedTransactionStatus !== VNPAY_SUCCESS_CODE)
        );
    }

    extractClientIp(rawValue) {
        if (!rawValue) return '127.0.0.1';
        if (Array.isArray(rawValue)) {
            return this.extractClientIp(rawValue[0]);
        }
        const normalized = String(rawValue).split(',')[0].trim();
        if (!normalized) return '127.0.0.1';
        if (normalized === '::1') return '127.0.0.1';
        return normalized.replace('::ffff:', '');
    }

    buildVnpayPaymentUrl(options) {
        const config = this.getVnpayConfig();
        if (!config.tmnCode || !config.hashSecret) {
            throw this.buildError(
                'VNPay is not configured. Missing VNPAY_TMN_CODE or VNPAY_HASH_SECRET.',
                'PAYMENT_CONFIG_MISSING',
                500
            );
        }

        const createDate = this.formatVnpayDate(new Date());
        const expireDate = this.formatVnpayDate(
            new Date(Date.now() + VNPAY_PAYMENT_URL_EXPIRY_MINUTES * 60 * 1000)
        );

        const params = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: config.tmnCode,
            vnp_Locale: 'vn',
            vnp_CurrCode: 'VND',
            vnp_TxnRef: options.transactionRef,
            vnp_OrderInfo: options.orderInfo,
            vnp_OrderType: 'other',
            vnp_Amount: Math.round(Number(options.amount) * 100),
            vnp_ReturnUrl: config.returnUrl,
            vnp_IpAddr: this.extractClientIp(options.ipAddr),
            vnp_CreateDate: createDate,
            vnp_ExpireDate: expireDate
        };
        if (options.bankCode) {
            params.vnp_BankCode = String(options.bankCode).trim();
        }

        const secureHash = this.signVnpayParams(params, config.hashSecret);
        const query = `${this.buildVnpaySignedPayload(params)}&vnp_SecureHash=${secureHash}`;
        return {
            paymentUrl: `${config.payUrl}?${query}`,
            createDate,
            expireDate,
            bankCode: options.bankCode ? String(options.bankCode).trim() : '',
            orderInfo: String(options.orderInfo || ''),
            amount: Math.round(Number(options.amount) || 0),
            transactionRef: String(options.transactionRef || '')
        };
    }

    verifyVnpayReturnQuery(query) {
        const config = this.getVnpayConfig();
        const secureHash = String(query.vnp_SecureHash || '').trim();
        const secureHashType = String(query.vnp_SecureHashType || '').trim();

        if (!secureHash || !config.hashSecret) {
            return {
                isValidSignature: false,
                responseCode: String(query.vnp_ResponseCode || ''),
                transactionStatus: String(query.vnp_TransactionStatus || ''),
                transactionRef: String(query.vnp_TxnRef || ''),
                amount: Number(query.vnp_Amount || 0) || 0,
                transactionNo: String(query.vnp_TransactionNo || ''),
                bankCode: String(query.vnp_BankCode || ''),
                cardType: String(query.vnp_CardType || ''),
                payDate: String(query.vnp_PayDate || ''),
                orderInfo: String(query.vnp_OrderInfo || ''),
                rawPayload: {},
                secureHashType
            };
        }

        const payload = {};
        for (const [key, value] of Object.entries(query)) {
            if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
            payload[key] = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : String(value || '');
        }

        const calculatedHash = this.signVnpayParams(payload, config.hashSecret);
        return {
            isValidSignature: calculatedHash.toLowerCase() === secureHash.toLowerCase(),
            responseCode: String(payload.vnp_ResponseCode || ''),
            transactionStatus: String(payload.vnp_TransactionStatus || ''),
            transactionRef: String(payload.vnp_TxnRef || ''),
            amount: Number(payload.vnp_Amount || 0) || 0,
            transactionNo: String(payload.vnp_TransactionNo || ''),
            bankCode: String(payload.vnp_BankCode || ''),
            cardType: String(payload.vnp_CardType || ''),
            payDate: String(payload.vnp_PayDate || ''),
            orderInfo: String(payload.vnp_OrderInfo || ''),
            rawPayload: payload,
            secureHashType
        };
    }

    buildVnpayQueryDrRequest(session, options = {}) {
        const config = this.getVnpayConfig();
        if (!config.tmnCode || !config.hashSecret) {
            throw this.buildError(
                'VNPay is not configured. Missing VNPAY_TMN_CODE or VNPAY_HASH_SECRET.',
                'PAYMENT_CONFIG_MISSING',
                500
            );
        }

        const metadata = this.normalizeMetadata(session?.metadata);
        const transactionDate = String(metadata.vnpay_payment_create_date || '').trim();
        if (!transactionDate) {
            throw this.buildError(
                'Payment session is missing VNPAY create date for QueryDR.',
                'VNPAY_QUERYDR_MISSING_CREATE_DATE',
                400
            );
        }

        const requestId = this.createVnpayRequestId();
        const createDate = this.formatVnpayDate(new Date());
        const ipAddr = this.extractClientIp(options.ipAddr);
        const orderInfo = String(
            metadata.vnpay_order_info ||
            metadata.order_info ||
            `Thanh toan goi ${session.target_plan}`
        );
        const requestPayload = {
            vnp_RequestId: requestId,
            vnp_Version: '2.1.0',
            vnp_Command: 'querydr',
            vnp_TmnCode: config.tmnCode,
            vnp_TxnRef: String(session.gateway_transaction_ref || ''),
            vnp_OrderInfo: orderInfo,
            vnp_TransactionDate: transactionDate,
            vnp_CreateDate: createDate,
            vnp_IpAddr: ipAddr
        };

        requestPayload.vnp_SecureHash = this.signVnpayPipePayload(
            [
                requestPayload.vnp_RequestId,
                requestPayload.vnp_Version,
                requestPayload.vnp_Command,
                requestPayload.vnp_TmnCode,
                requestPayload.vnp_TxnRef,
                requestPayload.vnp_TransactionDate,
                requestPayload.vnp_CreateDate,
                requestPayload.vnp_IpAddr,
                requestPayload.vnp_OrderInfo
            ],
            config.hashSecret
        );

        return requestPayload;
    }

    verifyVnpayQueryDrResponse(payload) {
        const config = this.getVnpayConfig();
        const secureHash = String(payload?.vnp_SecureHash || '').trim();
        if (!secureHash || !config.hashSecret) {
            return false;
        }

        const calculatedHash = this.signVnpayPipePayload(
            [
                payload.vnp_RequestId,
                payload.vnp_Version,
                payload.vnp_Command,
                payload.vnp_TmnCode,
                payload.vnp_ResponseCode,
                payload.vnp_Message,
                payload.vnp_TxnRef,
                payload.vnp_Amount,
                payload.vnp_BankCode,
                payload.vnp_PayDate,
                payload.vnp_TransactionNo,
                payload.vnp_TransactionStatus,
                payload.vnp_OrderInfo,
                payload.vnp_PromotionCode,
                payload.vnp_PromotionAmount
            ],
            config.hashSecret
        );

        return calculatedHash.toLowerCase() === secureHash.toLowerCase();
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
        try {
            await this.ensureSchema(client);
            await client.query('BEGIN');

            const sessionResult = await client.query(
                `
        SELECT
          id,
          company_id,
          target_plan,
          amount,
          metadata,
          billing_cycle,
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
                await client.query('COMMIT');
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
                await client.query('COMMIT');
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

            await client.query('COMMIT');

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
