const { CorporateGhgInventoryService } = require('../../src/services/corporateGhgInventoryService');
const { normalizeCorporateGhgInput } = require('../../src/services/corporateGhgInventoryControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const inventoryId = '30000000-0000-4000-8000-000000000001';

describe('R13 corporate GHG inventory persistence', () => {
  test('maps period-scoped invoice activity to the declared facility and factor provenance', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'elec-1', facility_name: 'Main Facility', billing_period: '2026-01', kwh: 100,
        emission_factor_kg_per_kwh: 0.4, emission_factor_source: 'Grid source', scope2_co2e_kg: 40,
        status: 'verified', evidence_document_id: '40000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'fuel-1', billing_period: '2026-01', fuel_type: 'diesel', quantity_liters: 10,
        emission_factor_kg_per_liter: 2.5, scope1_co2e_kg: 25, status: 'reviewed',
        evidence_document_id: '40000000-0000-4000-8000-000000000002' }] }) };
    const service = new CorporateGhgInventoryService(database);
    const normalized = normalizeCorporateGhgInput({ reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-01-31',
      facilities: [{ reference: 'FAC-1', name: 'Main Facility', country: 'VN', included: true, rationale: 'Controlled.' }],
      defaultFuelFacilityReference: 'FAC-1', scope2Accounting: { locationBasedFactorVersion: '2023', gwpBasis: 'AR6' },
      fuelFactorMetadata: [{ fuelType: 'diesel', source: 'DEFRA', version: '2025', gwpBasis: 'AR6' }] });
    const rows = await service._loadInvoiceActivity(companyId, normalized);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ facilityReference: 'FAC-1', category: 'purchased_electricity', factorVersion: '2023' });
    expect(rows[1]).toMatchObject({ facilityReference: 'FAC-1', category: 'stationary_combustion', factorSource: 'DEFRA' });
  });

  test('rejects approval by a non-inventory-reviewer role without database writes', async () => {
    const database = { query: jest.fn() }; const service = new CorporateGhgInventoryService(database);
    const result = await service.review(companyId, inventoryId, userId,
      { reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_report', notes: 'No.' });
    expect(result.code).toBe('GHG_REVIEW_ROLE_INVALID'); expect(database.query).not.toHaveBeenCalled();
  });

  test('blocks approval of a superseded inventory revision', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: inventoryId, revision: 1, latest_revision: 2,
      automated_status: 'inventory_review_required' }] }) };
    const service = new CorporateGhgInventoryService(database);
    const result = await service.review(companyId, inventoryId, userId,
      { reviewerRole: 'corporate_ghg_inventory_reviewer', decision: 'approved_for_internal_report', notes: 'Reviewed.' });
    expect(result.code).toBe('GHG_INVENTORY_NOT_CURRENT');
  });
});
