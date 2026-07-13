const PLAN_LIMITS = {
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

const STANDARD_SKU_PACKAGES = {
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

const CONTACT_INFO = {
    name: 'Nguyen Van A',
    phone: '123456789'
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

const resolveStandardPackage = (value, fallback = 20) => {
    const numericValue = Number(value);
    if (numericValue >= 50) return STANDARD_SKU_PACKAGES[50];
    if (numericValue >= 35) return STANDARD_SKU_PACKAGES[35];
    if (numericValue >= 20) return STANDARD_SKU_PACKAGES[20];
    return STANDARD_SKU_PACKAGES[fallback] || STANDARD_SKU_PACKAGES[20];
};

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
