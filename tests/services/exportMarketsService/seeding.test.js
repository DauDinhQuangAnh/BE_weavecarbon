const {
    ensureMarketsAndRequiredDocuments,
    ensureExportMarkets,
    ensureRequiredDocuments,
    ensureMaterialCertificationDocuments
} = require('../../../src/services/exportMarketsService/seeding');

function createMockClient() {
    return { query: jest.fn() };
}

describe('ensureExportMarkets', () => {
    it('seeds draft rows for missing default markets and returns the final row set', async () => {
        const client = createMockClient();
        const finalRows = [{ id: '1', market_code: 'VN' }, { id: '2', market_code: 'EU' }];

        // The implementation issues: 1 lookup of the company's target_markets,
        // then a SELECT of existing export_markets rows (same query text is
        // reused for the pre-insert check and the post-insert re-select), then
        // one INSERT per missing market code. Track the export_markets SELECT
        // call count to distinguish "before seeding" (empty) from "after
        // seeding" (finalRows).
        let exportMarketsSelectCalls = 0;
        client.query.mockImplementation((sql) => {
            const text = String(sql).trim();
            if (text.startsWith('SELECT target_markets')) {
                return Promise.resolve({ rows: [{ target_markets: null }] });
            }
            if (text.startsWith('SELECT') && text.includes('FROM export_markets')) {
                exportMarketsSelectCalls += 1;
                return Promise.resolve({ rows: exportMarketsSelectCalls === 1 ? [] : finalRows });
            }
            return Promise.resolve({});
        });

        const result = await ensureExportMarkets(client, 'company-1');

        expect(result).toEqual(finalRows);
        const insertCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO export_markets'));
        expect(insertCalls.length).toBe(7); // DEFAULT_MARKET_CODES has 7 entries
    });

    it('does not insert anything when every default market already exists', async () => {
        const client = createMockClient();
        const existingRows = [
            { market_code: 'VN' }, { market_code: 'EU' }, { market_code: 'US' },
            { market_code: 'JP' }, { market_code: 'KR' }, { market_code: 'AU' }, { market_code: 'ASEAN' }
        ];
        client.query.mockImplementation((sql) => {
            const text = String(sql).trim();
            if (text.startsWith('SELECT target_markets')) {
                return Promise.resolve({ rows: [{ target_markets: [] }] });
            }
            if (text.startsWith('SELECT') && text.includes('FROM export_markets')) {
                return Promise.resolve({ rows: existingRows });
            }
            return Promise.resolve({});
        });

        const result = await ensureExportMarkets(client, 'company-1');

        expect(result).toEqual(existingRows);
        const insertCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO export_markets'));
        expect(insertCalls.length).toBe(0);
    });
});

describe('ensureRequiredDocuments', () => {
    it('inserts only the required documents that are not already present', async () => {
        const client = createMockClient();
        client.query
            .mockResolvedValueOnce({ rows: [{ market_code: 'EU', document_code: 'dpp' }] }) // existing docs
            .mockResolvedValue({}); // inserts

        await ensureRequiredDocuments(client, 'company-1', [{ market_code: 'EU' }]);

        const insertCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO compliance_documents'));
        // EU requires 4 docs (dpp, textile_epr, reach_compliance, green_claims_substantiation); one already exists.
        expect(insertCalls.length).toBe(3);
    });

    it('does nothing when there are no markets', async () => {
        const client = createMockClient();

        await ensureRequiredDocuments(client, 'company-1', []);

        expect(client.query).not.toHaveBeenCalled();
    });
});

describe('ensureMaterialCertificationDocuments', () => {
    it('inserts material certification templates not already present', async () => {
        const client = createMockClient();
        client.query
            .mockResolvedValueOnce({ rows: [] }) // no existing docs
            .mockResolvedValue({});

        await ensureMaterialCertificationDocuments(client, 'company-1', [{ market_code: 'EU' }]);

        const insertCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO compliance_documents'));
        expect(insertCalls.length).toBe(6); // MATERIAL_CERTIFICATION_DOCUMENTS has 6 entries
    });
});

describe('ensureMarketsAndRequiredDocuments', () => {
    it('short-circuits when no markets are resolved', async () => {
        const client = createMockClient();
        client.query.mockResolvedValueOnce({ rows: [{ target_markets: [] }] }).mockResolvedValue({ rows: [] });

        const result = await ensureMarketsAndRequiredDocuments(client, 'company-1');

        expect(Array.isArray(result)).toBe(true);
    });
});
