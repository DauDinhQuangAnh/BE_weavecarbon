jest.mock('../../../src/config/database', () => require('../../helpers/mockPool').createMockPool());
jest.mock('../../../src/services/shipmentSimulationService', () => ({
    ensureShipmentSimulationSchema: jest.fn().mockResolvedValue(undefined),
    buildShipmentSimulationState: jest.fn().mockReturnValue({
        simulation_enabled: false,
        pending_until: null,
        estimated_arrival: null,
        estimated_arrival_at: null
    }),
    syncShipmentSimulationById: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/services/domesticComplianceService', () => ({
    validateProductsForDomesticPublish: jest.fn(),
    createMissingDocumentsError: jest.fn((validation) => new Error('missing docs'))
}));

const pool = require('../../../src/config/database');
const domesticComplianceService = require('../../../src/services/domesticComplianceService');
const { bulkImport } = require('../../../src/services/productsService/bulkImportExecution');

function createMockClient() {
    return { query: jest.fn(), release: jest.fn() };
}

describe('bulkImport', () => {
    let client;

    beforeEach(() => {
        client = createMockClient();
        pool.connect.mockResolvedValue(client);
        domesticComplianceService.validateProductsForDomesticPublish.mockReset();
    });

    it('imports a valid draft row and commits the transaction', async () => {
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [{ is_demo_user: false }] });
            if (text.includes('SELECT id FROM products WHERE company_id')) return Promise.resolve({ rows: [] });
            if (text.includes('INSERT INTO products')) return Promise.resolve({ rows: [{ id: 'product-1' }] });
            return Promise.resolve({ rows: [] });
        });

        const rows = [{ sku: 'SKU-1', productName: 'Tee', productType: 'tshirt' }];
        const result = await bulkImport('company-1', 'user-1', rows, 'draft');

        expect(result).toEqual({ imported: 1, failed: 0, errors: [], ids: ['product-1'] });
        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    it('records a per-row failure without aborting the whole batch', async () => {
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [] });
            if (text.includes('SELECT id FROM products WHERE company_id')) {
                return Promise.resolve({ rows: [{ id: 'existing' }] }); // triggers DUPLICATE_SKU
            }
            return Promise.resolve({ rows: [] });
        });

        const rows = [{ sku: 'SKU-DUP', productName: 'Tee' }];
        const result = await bulkImport('company-1', 'user-1', rows, 'draft');

        expect(result.imported).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.errors[0]).toMatchObject({ row: 1, code: 'DUPLICATE_SKU' });
        expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('ignores tampered client totals and stores the authoritative bulk result', async () => {
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [] });
            if (text.includes('SELECT id FROM products WHERE company_id')) return Promise.resolve({ rows: [] });
            if (text.includes('INSERT INTO products')) return Promise.resolve({ rows: [{ id: 'product-auth' }] });
            return Promise.resolve({ rows: [] });
        });
        const serverResult = {
            perProduct: {
                materials: 1,
                production: 2,
                transport: 3,
                packaging: 4,
                total: 10
            },
            confidenceScore: 63
        };

        await bulkImport(
            'company-1',
            'user-1',
            [{
                sku: 'SKU-AUTH',
                productName: 'Tee',
                carbonResults: { perProduct: { total: 999999 } },
                total_co2e: 999999
            }],
            'draft',
            {
                calculateProductCarbon: jest.fn().mockReturnValue({
                    input: { unitMassKg: 0.2, quantity: 1 },
                    result: serverResult
                })
            }
        );

        const productInsert = client.query.mock.calls.find(([sql]) =>
            String(sql).includes('INSERT INTO products')
        );
        expect(productInsert[1].slice(6, 12)).toEqual([10, 1, 2, 3, 4, 63]);

        const snapshotInsert = client.query.mock.calls.find(([sql]) =>
            String(sql).includes('INSERT INTO product_assessment_snapshots')
        );
        const snapshot = JSON.parse(snapshotInsert[1][1]);
        expect(snapshot.carbonResults).toEqual(serverResult);
        expect(snapshot).not.toHaveProperty('total_co2e');
    });

    it('rolls back the whole transaction when the outer BEGIN/COMMIT machinery throws', async () => {
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text === 'BEGIN') return Promise.resolve({});
            if (text.includes('SELECT is_demo_user')) throw new Error('connection lost');
            return Promise.resolve({ rows: [] });
        });

        await expect(bulkImport('company-1', 'user-1', [{ sku: 'X' }], 'draft')).rejects.toThrow('connection lost');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });

    it('publishes (status=active) only after domestic compliance validation passes', async () => {
        domesticComplianceService.validateProductsForDomesticPublish.mockResolvedValue({ success: true });
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [{ is_demo_user: false }] });
            if (text.includes('SELECT id FROM products WHERE company_id')) return Promise.resolve({ rows: [] });
            if (text.includes('INSERT INTO products')) return Promise.resolve({ rows: [{ id: 'product-2' }] });
            if (text.includes('SELECT COUNT(*) as count FROM shipments')) return Promise.resolve({ rows: [{ count: '0' }] });
            if (text.includes('INSERT INTO shipments')) return Promise.resolve({ rows: [{ id: 'shipment-1' }] });
            return Promise.resolve({ rows: [] });
        });

        const rows = [{
            sku: 'SKU-PUB',
            productName: 'Published Tee',
            originAddress: { city: 'Hanoi', country: 'VN' },
            destinationAddress: { city: 'Berlin', country: 'DE' },
            transportLegs: [{ mode: 'sea', distance_km: 9000, co2e: 100 }]
        }];

        const result = await bulkImport('company-1', 'user-1', rows, 'publish');

        expect(result.imported).toBe(1);
        expect(domesticComplianceService.validateProductsForDomesticPublish).toHaveBeenCalledWith(
            client, 'company-1', ['product-2']
        );
    });

    it('fails the row when domestic compliance validation reports missing documents', async () => {
        domesticComplianceService.validateProductsForDomesticPublish.mockResolvedValue({ success: false });
        client.query.mockImplementation((sql) => {
            const text = String(sql);
            if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [{ is_demo_user: false }] });
            if (text.includes('SELECT id FROM products WHERE company_id')) return Promise.resolve({ rows: [] });
            if (text.includes('INSERT INTO products')) return Promise.resolve({ rows: [{ id: 'product-3' }] });
            return Promise.resolve({ rows: [] });
        });

        const result = await bulkImport('company-1', 'user-1', [{ sku: 'SKU-BAD', productName: 'X' }], 'publish');

        expect(result.imported).toBe(0);
        expect(result.failed).toBe(1);
    });
});
