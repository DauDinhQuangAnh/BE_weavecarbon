const { EuTextileEprService } = require('../../src/services/euTextileEprService');
const { normalizeEprInput } = require('../../src/services/euTextileEprControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const assessmentId = '30000000-0000-4000-8000-000000000001';

describe('R17 EU textile EPR persistence', () => {
  test('loads period and Member-State scoped authoritative shipment lines', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ line_id: 'line-1', shipment_id: 'ship-1',
      invoice_date: '2026-09-10', destination_country: 'NL', sku: 'SKU', goods_description: 'Shirt', hs_code: '62052000',
      hs_code_confirmed: true, quantity: '100', unit: 'PCE', net_weight_kg: '50' }] }) };
    const service = new EuTextileEprService(database);
    const normalized = normalizeEprInput({ memberState: 'NL', reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31' });
    const rows = await service._loadShipmentSnapshot(companyId, normalized);
    expect(rows).toEqual([expect.objectContaining({ destinationCountry: 'NL', cnCode: '62052000', hsCodeConfirmed: true,
      quantity: 100, unit: 'PCE', weightKg: 50 })]);
    expect(database.query.mock.calls[0][1]).toEqual([companyId, 'NL', '2026-01-01', '2026-12-31']);
  });

  test('rejects approval by a non-specialist without database access', async () => {
    const database = { query: jest.fn() }; const service = new EuTextileEprService(database);
    const result = await service.review(companyId, assessmentId, userId,
      { reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_planning', notes: 'No.' });
    expect(result.code).toBe('EPR_REVIEW_ROLE_INVALID');
    expect(database.query).not.toHaveBeenCalled();
  });

  test('rejects incomplete external status claims before database access', async () => {
    const database = { query: jest.fn() }; const service = new EuTextileEprService(database);
    const result = await service.recordExternalEvent(companyId, assessmentId, userId,
      { eventType: 'authority_registration_confirmed', externalReference: '', actorName: '', occurredAt: null });
    expect(result.code).toBe('EPR_EXTERNAL_EVENT_INVALID');
    expect(database.query).not.toHaveBeenCalled();
  });

  test('rejects an invalid external-event timestamp before database access', async () => {
    const database = { query: jest.fn() }; const service = new EuTextileEprService(database);
    const result = await service.recordExternalEvent(companyId, assessmentId, userId,
      { eventType: 'authority_registration_confirmed', externalReference: 'NL-REG-1', actorName: 'Authority',
        occurredAt: 'not-a-date', evidenceDocumentId: companyId });
    expect(result.code).toBe('EPR_EXTERNAL_EVENT_DATE_INVALID');
    expect(database.query).not.toHaveBeenCalled();
  });
});
