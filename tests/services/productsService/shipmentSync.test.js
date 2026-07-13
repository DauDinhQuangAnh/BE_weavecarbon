const {
    syncShipmentFromProduct,
    createShipmentFromProduct
} = require('../../../src/services/productsService/shipmentSync');

function createMockClient() {
    return { query: jest.fn() };
}

const baseProduct = (overrides = {}) => ({
    weight_kg: 2,
    payload: {
        quantity: 10,
        originAddress: { city: 'Hanoi', country: 'VN' },
        destinationAddress: { city: 'Berlin', country: 'DE' },
        transportLegs: [{ mode: 'sea', distance_km: 9000, co2e: 120 }]
    },
    ...overrides
});

describe('createShipmentFromProduct', () => {
    it('skips creation when logistics data is missing', async () => {
        const client = createMockClient();
        const result = await createShipmentFromProduct(client, 'p1', 'c1', { payload: {} });

        expect(result).toEqual({
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'MISSING_LOGISTICS_DATA'
        });
        expect(client.query).not.toHaveBeenCalled();
    });

    it('skips creation when origin/destination country is missing', async () => {
        const client = createMockClient();
        const product = baseProduct({
            payload: {
                quantity: 1,
                originAddress: { city: 'Hanoi' },
                destinationAddress: { city: 'Berlin' },
                transportLegs: [{ mode: 'sea' }]
            }
        });

        const result = await createShipmentFromProduct(client, 'p1', 'c1', product);

        expect(result.shipmentCreationSkipped).toBe(true);
        expect(result.skipReason).toBe('MISSING_LOCATION_COUNTRY');
    });

    it('creates a shipment, its legs, and the product link on the happy path', async () => {
        const client = createMockClient();
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT COUNT(*) as count FROM shipments')) {
                return Promise.resolve({ rows: [{ count: '3' }] });
            }
            if (text.includes('INSERT INTO shipments')) {
                return Promise.resolve({ rows: [{ id: 'shipment-1' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const result = await createShipmentFromProduct(client, 'p1', 'c1', baseProduct());

        expect(result).toEqual({
            shipmentId: 'shipment-1',
            shipmentReferenceNumber: expect.stringMatching(/^SHIP-\d{4}-0004$/),
            shipmentCreationSkipped: false,
            skipReason: null
        });

        const legInsertCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO shipment_legs'));
        expect(legInsertCalls.length).toBe(1);
        const productLinkCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO shipment_products'));
        expect(productLinkCalls.length).toBe(1);
    });

    it('returns a SHIPMENT_CREATE_ERROR result instead of throwing when a query fails', async () => {
        const client = createMockClient();
        client.query.mockRejectedValue(new Error('db exploded'));

        const result = await createShipmentFromProduct(client, 'p1', 'c1', baseProduct());

        expect(result).toEqual({
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'SHIPMENT_CREATE_ERROR'
        });
    });
});

describe('syncShipmentFromProduct', () => {
    it('delegates to createShipmentFromProduct when no shipment is linked yet', async () => {
        const client = createMockClient();
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('FROM shipments s')) {
                return Promise.resolve({ rows: [] }); // no linked shipment
            }
            if (text.includes('SELECT COUNT(*) as count FROM shipments')) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            if (text.includes('INSERT INTO shipments')) {
                return Promise.resolve({ rows: [{ id: 'shipment-new' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const result = await syncShipmentFromProduct(client, 'p1', 'c1', baseProduct());

        expect(result.shipmentId).toBe('shipment-new');
        expect(result.shipmentCreationSkipped).toBe(false);
    });

    it('skips updating when the linked shipment already has multiple products', async () => {
        const client = createMockClient();
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('FROM shipments s')) {
                return Promise.resolve({
                    rows: [{ id: 'shipment-1', reference_number: 'SHIP-2026-0001', created_at: new Date(), pending_until: null }]
                });
            }
            if (text.includes('COUNT(*)::int AS count FROM shipment_products')) {
                return Promise.resolve({ rows: [{ count: 2 }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const result = await syncShipmentFromProduct(client, 'p1', 'c1', baseProduct());

        expect(result).toEqual({
            shipmentId: 'shipment-1',
            shipmentReferenceNumber: 'SHIP-2026-0001',
            shipmentCreationSkipped: true,
            skipReason: 'SHIPMENT_HAS_MULTIPLE_PRODUCTS'
        });
    });
});
