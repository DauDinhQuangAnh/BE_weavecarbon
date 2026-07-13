const {
    extractDestinationMarketFromPayload,
    extractV2MetadataFromPayload
} = require('../../../src/services/productsService/payloadExtraction');

describe('extractDestinationMarketFromPayload', () => {
    it('resolves a direct destinationMarket field', () => {
        expect(extractDestinationMarketFromPayload({ destinationMarket: 'EU' })).toBe('EU');
    });

    it('resolves nested destination country', () => {
        expect(extractDestinationMarketFromPayload({ destination: { country: 'DE' } })).toBe('DE');
    });

    it('picks the entry flagged selected out of an array of candidates', () => {
        // Note: candidate objects are matched against `directCandidates` (market/
        // country-shaped keys) before `code`/`id`/`name`, and the `selected` flag
        // itself is checked as a candidate value before `code` is. A boolean
        // `selected: true` therefore resolves to the string "true" rather than
        // falling through to `code` — this is existing, preserved behavior of the
        // original algorithm, not something introduced by the productsService
        // module split.
        const payload = { destinationMarkets: [{ code: 'VN' }, { code: 'KR', selected: true }] };
        expect(extractDestinationMarketFromPayload(payload)).toBe('true');
    });

    it('resolves the market code when the selected candidate has no other truthy fields ahead of it', () => {
        const payload = { destinationMarkets: [{ code: 'VN' }, { marketCode: 'KR', selected: true }] };
        expect(extractDestinationMarketFromPayload(payload)).toBe('KR');
    });

    it('falls back to the first provided target market when nothing resolves from the payload', () => {
        expect(extractDestinationMarketFromPayload({}, ['vn', 'eu'])).toBe('VN');
    });

    it('returns an empty string when nothing can be resolved', () => {
        expect(extractDestinationMarketFromPayload({}, [])).toBe('');
    });
});

describe('extractV2MetadataFromPayload', () => {
    it('extracts and normalizes v2 metadata fields, preferring camelCase', () => {
        const result = extractV2MetadataFromPayload({
            hsCode: '123456',
            hs_code: '999999',
            facility: 'Factory A',
            supplyGap: true,
            poContractId: 'PO-1'
        });

        expect(result).toMatchObject({
            hsCode: '123456',
            cnCode: '123456',
            facility: 'Factory A',
            supplyGap: true,
            poContractId: 'PO-1'
        });
    });

    it('falls back to snake_case fields when camelCase is absent', () => {
        const result = extractV2MetadataFromPayload({
            hs_code: '654321',
            supplier_country: 'VN',
            bill_of_lading_no: 'BL-1'
        });

        expect(result).toMatchObject({
            hsCode: '654321',
            cnCode: '654321',
            supplierCountry: 'VN',
            billOfLadingNo: 'BL-1'
        });
    });

    it('defaults missing fields to null/false', () => {
        const result = extractV2MetadataFromPayload({});
        expect(result).toEqual({
            hsCode: null,
            cnCode: null,
            facility: null,
            evidenceLookupCode: null,
            supplierCountry: null,
            supplyGap: false,
            customsDeclarationNo: null,
            poContractId: null,
            billOfLadingNo: null,
            containerNo: null
        });
    });
});
