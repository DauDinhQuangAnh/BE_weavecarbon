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
    // Behaviour change (2026-11-18 price list): SKU tiers are no longer sold;
    // every Starter purchase is the single 20-SKU Starter package.
    it('always returns the single Starter package', () => {
        expect(planRules.resolveStandardPackage(50)).toEqual(planRules.STARTER_PACKAGE);
        expect(planRules.resolveStandardPackage(37)).toEqual(planRules.STARTER_PACKAGE);
        expect(planRules.resolveStandardPackage(5)).toEqual(planRules.STARTER_PACKAGE);
        expect(planRules.STARTER_PACKAGE).toEqual({ sku_increment: 20, name: 'Starter', price_monthly: 6000000 });
    });
});

describe('official price list (pitch deck)', () => {
    it('prices Starter at 6.000.000 and Pro at 8.000.000 VND/month', () => {
        expect(planRules.PLAN_LIMITS.standard).toMatchObject({ name: 'Starter', price_monthly: 6000000 });
        expect(planRules.PLAN_LIMITS.export).toMatchObject({ name: 'Pro', price_monthly: 8000000 });
    });

    it('returns a real sales contact instead of a placeholder', () => {
        expect(planRules.CONTACT_INFO.phone).not.toBe('123456789');
        expect(planRules.CONTACT_INFO.name).not.toBe('Nguyen Van A');
        expect(planRules.CONTACT_INFO.email).toMatch(/@/);
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
        // display name follows the 2026-11-18 price list (internal id stays 'standard')
        expect(details.name).toBe('Starter');
    });

    it('falls back to trial limits for unknown plans', () => {
        expect(planRules.resolvePlanDetails('unknown')).toEqual(planRules.PLAN_LIMITS.trial);
    });
});
