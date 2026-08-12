const {
    toNumber,
    roundTo,
    computeDonationCo2Saved,
    REUSE_DISPLACEMENT_FACTOR,
    RECYCLE_NET_EF_PER_KG,
    normalizeOptionalString,
    calculateDistanceKm,
    resolveLevel,
    createBusinessError,
    mapMaterialReward,
    resolveAnalysisMaterial,
    inferAnalysisItems,
    mapCoupon,
    mapCollectionPointSummary,
    mapDonationSummary
} = require('../../../src/services/b2cService/helpers');

describe('toNumber / roundTo', () => {
    it('parses numbers with a fallback', () => {
        expect(toNumber('12.5')).toBe(12.5);
        expect(toNumber('abc', 5)).toBe(5);
    });

    it('rounds to the given decimal places', () => {
        expect(roundTo(1.23456, 2)).toBe(1.23);
    });
});

describe('computeDonationCo2Saved', () => {
    it('applies the conservative displacement factor for reuse (charity)', () => {
        // cotton virgin EF 8.0 → WRAP net reuse ~4.0 kg/kg
        expect(computeDonationCo2Saved('charity', 8.0, 1)).toBeCloseTo(4.0, 6);
        expect(computeDonationCo2Saved('charity', 8.0, 2)).toBeCloseTo(8.0, 6);
        expect(REUSE_DISPLACEMENT_FACTOR).toBe(0.5);
    });

    it('uses a flat downcycling factor for recycle, independent of material', () => {
        expect(computeDonationCo2Saved('recycle', 8.0, 1)).toBeCloseTo(RECYCLE_NET_EF_PER_KG, 6);
        expect(computeDonationCo2Saved('recycle', 17.0, 1)).toBeCloseTo(RECYCLE_NET_EF_PER_KG, 6);
        expect(computeDonationCo2Saved('recycle', 8.0, 3)).toBeCloseTo(2.1, 6);
    });

    it('treats unknown categories as recycle (never over-credits)', () => {
        expect(computeDonationCo2Saved('unknown', 10, 1)).toBeCloseTo(RECYCLE_NET_EF_PER_KG, 6);
        expect(computeDonationCo2Saved(null, 10, 1)).toBeCloseTo(RECYCLE_NET_EF_PER_KG, 6);
    });

    it('returns 0 for non-positive or non-finite weight/EF', () => {
        expect(computeDonationCo2Saved('charity', 8.0, 0)).toBe(0);
        expect(computeDonationCo2Saved('charity', 8.0, -1)).toBe(0);
        expect(computeDonationCo2Saved('charity', 'x', 1)).toBe(0);
    });
});

describe('normalizeOptionalString', () => {
    it('trims non-empty strings and rejects blanks/non-strings', () => {
        expect(normalizeOptionalString('  hi  ')).toBe('hi');
        expect(normalizeOptionalString('   ')).toBeNull();
        expect(normalizeOptionalString(42)).toBeNull();
    });
});

describe('calculateDistanceKm', () => {
    it('returns ~0 for identical coordinates', () => {
        expect(calculateDistanceKm(21.0285, 105.8542, 21.0285, 105.8542)).toBeCloseTo(0, 5);
    });

    it('returns a plausible distance between Hanoi and Ho Chi Minh City', () => {
        const distance = calculateDistanceKm(21.0285, 105.8542, 10.8231, 106.6297);
        expect(distance).toBeGreaterThan(1000);
        expect(distance).toBeLessThan(1200);
    });
});

describe('resolveLevel', () => {
    it('picks the highest matching tier', () => {
        expect(resolveLevel(2500)).toBe('Champion');
        expect(resolveLevel(1000)).toBe('Advocate');
        expect(resolveLevel(400)).toBe('Explorer');
        expect(resolveLevel(0)).toBe('Beginner');
        expect(resolveLevel(-5)).toBe('Beginner');
    });
});

describe('createBusinessError', () => {
    it('builds an Error with code/statusCode/details attached', () => {
        const error = createBusinessError('NOT_FOUND', 'missing', 404, { id: 1 });
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('missing');
        expect(error.code).toBe('NOT_FOUND');
        expect(error.statusCode).toBe(404);
        expect(error.details).toEqual({ id: 1 });
    });

    it('defaults statusCode to 400 and omits details when not given', () => {
        const error = createBusinessError('BAD', 'bad request');
        expect(error.statusCode).toBe(400);
        expect(error.details).toBeUndefined();
    });
});

describe('mapMaterialReward', () => {
    it('maps a DB row, coercing numeric/boolean fields', () => {
        const row = {
            id: 'm1', material_name: 'Cotton', material_category: 'textile',
            points_per_kg: '10', co2_saved_per_kg: '2.5', description: 'x', is_active: true
        };
        expect(mapMaterialReward(row)).toEqual({
            id: 'm1', material_name: 'Cotton', material_category: 'textile',
            points_per_kg: 10, co2_saved_per_kg: 2.5, description: 'x', is_active: true
        });
    });
});

describe('resolveAnalysisMaterial', () => {
    const materials = [
        { material_name: 'Cotton', material_category: 'textile' },
        { material_name: 'Other', material_category: 'misc' }
    ];

    it('matches by hint against name or category', () => {
        expect(resolveAnalysisMaterial(materials, 'cotton')).toBe(materials[0]);
    });

    it('falls back to the "other" entry when no hint matches', () => {
        expect(resolveAnalysisMaterial(materials, 'unknown-hint')).toBe(materials[1]);
    });

    it('falls back to the first entry when there is no "other" and no match', () => {
        const noOther = [{ material_name: 'Cotton', material_category: 'textile' }];
        expect(resolveAnalysisMaterial(noOther, 'unknown')).toBe(noOther[0]);
    });
});

describe('inferAnalysisItems', () => {
    it('matches known keywords in the file name', () => {
        const items = inferAnalysisItems('my-tshirt-photo.jpg', 'charity');
        expect(items[0].itemType).toBe('shirt');
    });

    it('falls back to a generic textile item when nothing matches', () => {
        const items = inferAnalysisItems('IMG_001.jpg', 'recycle');
        expect(items).toEqual([
            { itemName: 'Recyclable textile item', itemType: 'textile', weightKg: 0.6, materialHint: 'other' }
        ]);
    });
});

describe('mapCoupon', () => {
    it('clamps negative/fractional stock and cost fields', () => {
        const row = {
            id: 'c1', title: 't', merchant_name: 'm', category: 'cat', description: 'd',
            points_cost: '10.9', discount_type: 'percent', discount_value: '20',
            currency: 'VND', code: 'X', image_url: null, valid_from: null, valid_until: null,
            stock_total: '5.9', stock_remaining: null, redemption_limit_per_user: '0',
            redemption_method: 'code', terms: null, tags: null,
            is_featured: false, is_active: true, created_at: null, updated_at: null
        };
        const result = mapCoupon(row);
        expect(result.points_cost).toBe(10);
        expect(result.stock_total).toBe(5);
        expect(result.stock_remaining).toBeNull();
        expect(result.redemption_limit_per_user).toBe(1);
        expect(result.tags).toEqual([]);
    });
});

describe('mapCollectionPointSummary', () => {
    it('returns null when there is no linked collection point', () => {
        expect(mapCollectionPointSummary({ collection_point_id: null })).toBeNull();
    });

    it('maps the collection point fields when present', () => {
        const row = {
            collection_point_id: 'cp1',
            collection_point_name: 'Point A',
            collection_point_address: '123 St',
            collection_point_city: 'Hanoi',
            collection_point_district: 'D1'
        };
        expect(mapCollectionPointSummary(row)).toEqual({
            id: 'cp1', name: 'Point A', address: '123 St', city: 'Hanoi', district: 'D1'
        });
    });
});

describe('mapDonationSummary', () => {
    it('clamps points/weight fields and nests the collection point + image info', () => {
        const row = {
            id: 'd1', category: 'charity', delivery_method: 'drop_off', status: 'confirmed',
            base_points: '10.9', bonus_points: '-5', total_points: '10.9',
            co2_saved: '1.23456', total_items: '3.9', total_weight_kg: '2.5678',
            item_description: null, shipping_tracking_number: null, confirmation_method: null,
            created_at: null, confirmed_at: null, completed_at: null,
            collection_point_id: null,
            source_image_storage_key: 'key1', source_image_original_name: 'a.jpg',
            source_image_mime_type: 'image/jpeg', source_image_size_bytes: '2048'
        };
        const result = mapDonationSummary(row);
        expect(result.base_points).toBe(10);
        expect(result.bonus_points).toBe(0);
        expect(result.co2_saved).toBeCloseTo(1.2346, 4);
        expect(result.total_items).toBe(3);
        expect(result.collection_point).toBeNull();
        expect(result.image_available).toBe(true);
        expect(result.source_image).toEqual({
            original_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 2048
        });
    });
});
