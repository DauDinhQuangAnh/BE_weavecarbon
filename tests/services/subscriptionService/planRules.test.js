const planRules = require('../../../src/services/subscriptionService/planRules');

describe('normalizePlanId', () => {
    it('maps standard variants to "standard"', () => {
        expect(planRules.normalizePlanId('standard_20')).toBe('standard');
        expect(planRules.normalizePlanId('standard-35')).toBe('standard');
        expect(planRules.normalizePlanId('standard50')).toBe('standard');
    });

    it('passes through trial/export as-is', () => {
        expect(planRules.normalizePlanId('trial')).toBe('trial');
        expect(planRules.normalizePlanId('export')).toBe('export');
    });

    it('falls back for empty/unknown values', () => {
        expect(planRules.normalizePlanId('')).toBe('trial');
        expect(planRules.normalizePlanId('garbage', 'export')).toBe('export');
    });
});

describe('resolveStandardPlanBySkuLimit', () => {
    it('picks the correct tier by sku count', () => {
        expect(planRules.resolveStandardPlanBySkuLimit(60)).toBe('standard_50');
        expect(planRules.resolveStandardPlanBySkuLimit(40)).toBe('standard_35');
        expect(planRules.resolveStandardPlanBySkuLimit(25)).toBe('standard_20');
        expect(planRules.resolveStandardPlanBySkuLimit(5)).toBe('standard_20');
    });
});

describe('inferLegacyStandardSkuLimit', () => {
    it('infers sku limit from legacy plan tokens', () => {
        expect(planRules.inferLegacyStandardSkuLimit('standard_50')).toBe(50);
        expect(planRules.inferLegacyStandardSkuLimit('standard35')).toBe(35);
        expect(planRules.inferLegacyStandardSkuLimit('standard')).toBe(20);
        expect(planRules.inferLegacyStandardSkuLimit('', 99)).toBe(99);
    });
});

describe('resolveStandardPackage', () => {
    it('returns the matching SKU package', () => {
        expect(planRules.resolveStandardPackage(50)).toEqual(planRules.STANDARD_SKU_PACKAGES[50]);
        expect(planRules.resolveStandardPackage(37)).toEqual(planRules.STANDARD_SKU_PACKAGES[35]);
        expect(planRules.resolveStandardPackage(5)).toEqual(planRules.STANDARD_SKU_PACKAGES[20]);
    });
});

describe('resolveRequestedTargetPlan', () => {
    it('collapses any standard token to "standard"', () => {
        expect(planRules.resolveRequestedTargetPlan('standard_20')).toBe('standard');
        expect(planRules.resolveRequestedTargetPlan('standard-50')).toBe('standard');
    });

    it('delegates to normalizePlanId for non-standard tokens', () => {
        expect(planRules.resolveRequestedTargetPlan('export')).toBe('export');
        expect(planRules.resolveRequestedTargetPlan('', null, 'trial')).toBe('trial');
    });
});

describe('isStandardPlan', () => {
    it('recognizes all standard tiers', () => {
        expect(planRules.isStandardPlan('standard_20')).toBe(true);
        expect(planRules.isStandardPlan('standard_50')).toBe(true);
        expect(planRules.isStandardPlan('trial')).toBe(false);
        expect(planRules.isStandardPlan('export')).toBe(false);
    });
});

describe('resolvePlanRank', () => {
    it('ranks export highest, trial lowest', () => {
        expect(planRules.resolvePlanRank('export')).toBeGreaterThan(planRules.resolvePlanRank('standard'));
        expect(planRules.resolvePlanRank('standard')).toBeGreaterThan(planRules.resolvePlanRank('trial'));
    });
});

describe('resolvePlanDetails', () => {
    it('uses the requested SKU limit for standard plans', () => {
        const details = planRules.resolvePlanDetails('standard', { standardSkuLimit: 45 });
        expect(details.products).toBe(45);
        expect(details.name).toBe('Standard');
    });

    it('falls back to trial limits for unknown plans', () => {
        expect(planRules.resolvePlanDetails('unknown')).toEqual(planRules.PLAN_LIMITS.trial);
    });
});
