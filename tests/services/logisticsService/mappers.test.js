const {
    toFloat,
    parseCoordinate,
    mapShipmentSummaryRow,
    mapShipmentMutationRow,
    mapShipmentLeg,
    mapShipmentProduct
} = require('../../../src/services/logisticsService/mappers');

describe('toFloat', () => {
    it('parses numeric strings and defaults nullish input to 0', () => {
        expect(toFloat('12.5')).toBe(12.5);
        expect(toFloat(null)).toBe(0);
        expect(toFloat(undefined)).toBe(0);
    });
});

describe('parseCoordinate', () => {
    it('parses valid coordinates', () => {
        expect(parseCoordinate('21.0285')).toBe(21.0285);
    });

    it('returns null for nullish or non-finite input', () => {
        expect(parseCoordinate(null)).toBeNull();
        expect(parseCoordinate(undefined)).toBeNull();
        expect(parseCoordinate('not-a-number')).toBeNull();
    });
});

describe('mapShipmentSummaryRow', () => {
    it('maps a DB row into the API shape', () => {
        const row = {
            id: 's1',
            reference_number: 'SHIP-2026-0001',
            status: 'pending',
            origin_country: 'VN',
            origin_city: 'Hanoi',
            origin_address: '123 Street',
            origin_lat: '21.0',
            origin_lng: '105.8',
            destination_country: 'DE',
            destination_city: 'Berlin',
            destination_address: null,
            destination_lat: null,
            destination_lng: null,
            total_weight_kg: '500',
            total_distance_km: '9000',
            total_co2e: '120.5',
            estimated_arrival: '2026-02-01',
            estimated_arrival_at: null,
            actual_arrival: null,
            actual_arrival_at: null,
            pending_until: null,
            simulation_enabled: true,
            legs_count: '2',
            products_count: '1',
            created_at: '2026-01-01',
            updated_at: '2026-01-02'
        };

        const result = mapShipmentSummaryRow(row);

        expect(result.origin).toEqual({ country: 'VN', city: 'Hanoi', address: '123 Street', lat: 21.0, lng: 105.8 });
        expect(result.destination).toEqual({ country: 'DE', city: 'Berlin', address: null, lat: null, lng: null });
        expect(result.totalWeightKg).toBe(500);
        expect(result.totalCo2e).toBe(120.5);
        expect(result.simulationEnabled).toBe(true);
        expect(result.legsCount).toBe(2);
        expect(result.productsCount).toBe(1);
    });
});

describe('mapShipmentMutationRow', () => {
    it('maps the minimal mutation row shape', () => {
        const row = {
            id: 's1',
            reference_number: 'SHIP-2026-0001',
            status: 'pending',
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
            estimated_arrival: null,
            estimated_arrival_at: null,
            actual_arrival: null,
            actual_arrival_at: null,
            pending_until: null,
            simulation_enabled: false
        };
        expect(mapShipmentMutationRow(row)).toEqual({
            id: 's1',
            referenceNumber: 'SHIP-2026-0001',
            status: 'pending',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-02',
            estimatedArrival: null,
            estimatedArrivalAt: null,
            actualArrival: null,
            actualArrivalAt: null,
            pendingUntil: null,
            simulationEnabled: false
        });
    });
});

describe('mapShipmentLeg', () => {
    it('maps a leg row, treating missing duration/emission factor as null', () => {
        const row = {
            id: 'leg1',
            leg_order: 1,
            transport_mode: 'sea',
            origin_location: 'Hanoi',
            destination_location: 'Berlin',
            distance_km: '9000',
            duration_hours: null,
            co2e: '100',
            emission_factor_used: null,
            carrier_name: null,
            vehicle_type: null
        };
        const result = mapShipmentLeg(row);
        expect(result.distanceKm).toBe(9000);
        expect(result.durationHours).toBeNull();
        expect(result.emissionFactorUsed).toBeNull();
    });
});

describe('mapShipmentProduct', () => {
    it('maps a product row', () => {
        const row = {
            id: 'sp1',
            product_id: 'p1',
            quantity: '10',
            weight_kg: '50',
            allocated_co2e: '20',
            sku: 'SKU-1',
            product_name: 'Tee'
        };
        expect(mapShipmentProduct(row)).toEqual({
            id: 'sp1',
            productId: 'p1',
            quantity: 10,
            weightKg: 50,
            allocatedCo2e: 20,
            sku: 'SKU-1',
            productName: 'Tee'
        });
    });
});
