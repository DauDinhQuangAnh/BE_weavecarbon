// Official price list (pitch deck, approved 2026-11-18):
//   Starter    6.000.000 VND/month  -> internal plan id "standard" (VNPAY checkout)
//   Pro        8.000.000 VND/month  -> internal plan id "export"   (sales-assisted)
//   Enterprise contact sales        -> request-upgrade flow
// Internal ids are unchanged so existing companies, DB enum values and payment
// sessions keep working.
const PLAN_LIMITS = {
    trial: {
        name: 'Trial',
        // Trial is auto-activated for free on sign-up; this amount is only used by
        // the legacy paid trial-extension path and is intentionally unchanged.
        price_monthly: 149000,
        products: 100,
        members: 5,
        api_calls_per_month: 10000
    },
    standard: {
        name: 'Starter',
        price_monthly: 6000000,
        products: 20,
        members: 20,
        api_calls_per_month: 100000
    },
    export: {
        name: 'Pro',
        price_monthly: 8000000,
        products: -1,
        members: 50,
        api_calls_per_month: -1
    }
};

// Starter is sold as one package (20 SKU, one facility). The 35/50 entries are
// kept only so legacy standard_35 / standard_50 subscriptions still resolve;
// they are no longer offered for purchase.
const STARTER_PACKAGE = {
    sku_increment: 20,
    name: 'Starter',
    price_monthly: 6000000
};

const STANDARD_SKU_PACKAGES = {
    20: STARTER_PACKAGE,
    35: {
        sku_increment: 35,
        name: 'Standard +35 SKU (legacy)',
        price_monthly: 6000000
    },
    50: {
        sku_increment: 50,
        name: 'Standard +50 SKU (legacy)',
        price_monthly: 6000000
    }
};

const PLAN_RANK = {
    trial: 1,
    standard: 2,
    standard_20: 2,
    standard_35: 2,
    standard_50: 2,
    export: 3
};

const STANDARD_PLAN_IDS = new Set(['standard', 'standard_20', 'standard_35', 'standard_50']);

const ALLOWED_TARGET_PLANS = new Set([
    'trial',
    'standard',
    'standard_20',
    'standard_35',
    'standard_50',
    'export'
]);

// Sales contact returned for the sales-assisted Pro / Enterprise plans.
// Override per environment with SALES_CONTACT_NAME / _PHONE / _EMAIL.
const CONTACT_INFO = {
    name: process.env.SALES_CONTACT_NAME || 'WeaveCarbon Sales',
    phone: process.env.SALES_CONTACT_PHONE || '0828413747',
    email: process.env.SALES_CONTACT_EMAIL || 'teamcet.st@gmail.com'
};

const normalizePlanId = (value, fallback = 'trial') => {
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
};

const resolveStandardPlanBySkuLimit = (value, fallback = 'standard_20') => {
    const numericValue = Number(value);
    if (numericValue >= 50) return 'standard_50';
    if (numericValue >= 35) return 'standard_35';
    if (numericValue >= 20) return 'standard_20';
    return fallback;
};

const inferLegacyStandardSkuLimit = (value, fallback = 20) => {
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
};

// Every Starter purchase is the single Starter package, whatever SKU tier an
// older client still sends (prevents buying 50 SKU at the Starter price).
const resolveStandardPackage = (_value, _fallback = 20) => STARTER_PACKAGE;

const resolveRequestedTargetPlan = (targetPlan, standardSkuLimit, fallback = 'trial') => {
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

    return normalizePlanId(targetPlan, fallback);
};

const isStandardPlan = (planId) => {
    const normalized = normalizePlanId(planId, 'trial');
    return STANDARD_PLAN_IDS.has(normalized);
};

const resolvePlanRank = (planId) => {
    const normalized = normalizePlanId(planId, 'trial');
    return PLAN_RANK[normalized] || 0;
};

const resolvePlanDetails = (planId, options = {}) => {
    const normalized = normalizePlanId(planId, 'trial');
    if (normalized === 'standard') {
        const standardSkuLimit = Math.max(0, Number(options.standardSkuLimit || 0)) || 20;
        return {
            ...PLAN_LIMITS.standard,
            products: standardSkuLimit
        };
    }
    return PLAN_LIMITS[normalized] || PLAN_LIMITS.trial;
};

module.exports = {
    PLAN_LIMITS,
    STARTER_PACKAGE,
    STANDARD_SKU_PACKAGES,
    PLAN_RANK,
    STANDARD_PLAN_IDS,
    ALLOWED_TARGET_PLANS,
    CONTACT_INFO,
    normalizePlanId,
    resolveStandardPlanBySkuLimit,
    inferLegacyStandardSkuLimit,
    resolveStandardPackage,
    resolveRequestedTargetPlan,
    isStandardPlan,
    resolvePlanRank,
    resolvePlanDetails
};
