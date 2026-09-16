const { ClimateRiskService } = require('../../src/services/climateRiskService');
const companyId = '12345678-1234-4234-8234-123456789abc';
const userId = '22345678-1234-4234-8234-123456789abc';
const ids = ['32345678-1234-4234-8234-123456789abc', '42345678-1234-4234-8234-123456789abc'];
const checksum = 'a'.repeat(64);
const rows = [
  { id: ids[0], facility_revision_id: 'f1', facility_reference: 'F1', hazard_type: 'heat', scenario_kind: 'projection', scenario_reference: 'ssp245-2031-2050',
    horizon_start: new Date('2031-01-01Z'), horizon_end: new Date('2050-12-31Z'), model_name: 'model-a', scenario_name: 'ssp245',
    business_dependency_percent: '60.000', priority_band: 'high', current_evidence_status: 'locked', current_evidence_sha256: checksum,
    current_evidence_size: 100, current_location_status: 'locked', current_location_sha256: checksum, current_location_size: 100,
    evidence_snapshot: { checksumSha256: checksum }, location_evidence_snapshot: { checksumSha256: checksum } },
  { id: ids[1], facility_revision_id: 'f2', facility_reference: 'F2', hazard_type: 'drought', scenario_kind: 'projection', scenario_reference: 'ssp245-2031-2050',
    horizon_start: new Date('2031-01-01Z'), horizon_end: new Date('2050-12-31Z'), model_name: 'model-a', scenario_name: 'ssp245',
    business_dependency_percent: '40.000', priority_band: 'medium', current_evidence_status: 'locked', current_evidence_sha256: checksum,
    current_evidence_size: 100, current_location_status: 'locked', current_location_sha256: checksum, current_location_size: 100,
    evidence_snapshot: { checksumSha256: checksum }, location_evidence_snapshot: { checksumSha256: checksum } }
];
function database(selected) {
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (sql.includes('FROM climate_risk_assessments a JOIN evidence_documents')) return { rows: selected };
    if (sql.includes('INSERT INTO climate_risk_portfolio_snapshots')) return { rows: [{ id: 'p1', company_id: companyId,
      portfolio_reference: params[1], scenario_kind: params[2], scenario_reference: params[3], horizon_start: params[4],
      horizon_end: params[5], facility_count: params[6], assessment_count: params[7], priority_summary: JSON.parse(params[8]),
      methodology_notes: params[9], input_sha256: params[10] }] };
    return { rows: [] };
  }) };
  return { pool: { connect: async () => client }, client };
}
const input = { portfolioReference: 'pilot-01', assessmentIds: ids, methodologyNotes: 'Author-screened, not a forecast' };

test('portfolio aggregates facility dependency without pretending to calculate physical risk', async () => {
  const { pool, client } = database(rows);
  const result = await new ClimateRiskService(pool).createPortfolio(companyId, userId, input);
  expect(result.facilityCount).toBe(2);
  expect(result.prioritySummary.dependencyPercentByPriority).toEqual({ low: 0, medium: 40, high: 60 });
  expect(result.prioritySummary.incompleteHazardCoverageFacilities).toBe(2);
  expect(result.prioritySummary.reviewStatus).toBe('needs_specialist_review');
  expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO climate_risk_portfolio_members'))).toHaveLength(2);
  expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
});

test('portfolio refuses mixed projection models', async () => {
  const { pool, client } = database([rows[0], { ...rows[1], model_name: 'model-b' }]);
  const result = await new ClimateRiskService(pool).createPortfolio(companyId, userId, input);
  expect(result.code).toBe('CLIMATE_PORTFOLIO_SCOPE_INVALID');
  expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

test('portfolio refuses two revisions of one physical facility', async () => {
  const { pool } = database([rows[0], { ...rows[1], facility_reference: 'F1' }]);
  const result = await new ClimateRiskService(pool).createPortfolio(companyId, userId, input);
  expect(result.code).toBe('CLIMATE_PORTFOLIO_FACILITY_REVISION_CONFLICT');
});
