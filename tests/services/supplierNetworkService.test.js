const { SupplierNetworkService } = require('../../src/services/supplierNetworkService');

const companyId = '12345678-1234-4234-8234-123456789abc';
const userId = '22345678-1234-4234-8234-123456789abc';
const supplierId = '32345678-1234-4234-8234-123456789abc';
const relationshipId = '42345678-1234-4234-8234-123456789abc';
const carbonId = '52345678-1234-4234-8234-123456789abc';
const modelId = '62345678-1234-4234-8234-123456789abc';
const climateIds = [
  '72345678-1234-4234-8234-123456789abc',
  '82345678-1234-4234-8234-123456789abc',
  '92345678-1234-4234-8234-123456789abc'
];
const snapshotId = 'a2345678-1234-4234-8234-123456789abc';
const checksum = 'a'.repeat(64);

const evidenceColumns = (prefix = 'evidence_') => ({
  [`${prefix}status`]: 'locked',
  [`${prefix}checksum_sha256`]: checksum,
  [`${prefix}file_size_bytes`]: 100
});

const model = {
  id: modelId,
  model_reference: 'supplier-priority-v1',
  revision: 1,
  carbon_weight_percent: '35',
  climate_weight_percent: '35',
  dependency_weight_percent: '30',
  medium_threshold: '40',
  high_threshold: '70',
  normalization_policy: 'Documented peer percentiles and dependency bands.',
  approval_status: 'approved',
  evidence_snapshot: { checksumSha256: checksum },
  model_sha256: 'b'.repeat(64),
  ...evidenceColumns()
};

const carbon = {
  id: carbonId,
  subject_kind: 'supplier',
  supplier_revision_id: supplierId,
  reporting_period_start: new Date('2026-01-01Z'),
  reporting_period_end: new Date('2026-12-31Z'),
  gross_kg_co2e: '1000',
  intensity_kg_co2e: '2.5',
  source_kind: 'supplier_specific',
  data_quality_level: 'L2',
  carbon_sha256: 'c'.repeat(64),
  evidence_snapshot: { checksumSha256: checksum },
  ...evidenceColumns()
};

const relationship = {
  id: supplierId,
  relationship_id: relationshipId,
  spend_percent: '25.5',
  production_dependency_percent: '40',
  single_source: true,
  dependent_sku_count: 12,
  dependent_route_count: 2,
  profile_sha256: 'd'.repeat(64),
  relationship_sha256: 'e'.repeat(64),
  effective_from: new Date('2026-01-01Z'),
  effective_to: null,
  profile_evidence_snapshot: { checksumSha256: checksum },
  relationship_evidence_snapshot: { checksumSha256: checksum },
  ...evidenceColumns('profile_evidence_'),
  ...evidenceColumns('relationship_evidence_')
};

const climates = ['heat', 'drought', 'extreme_rainfall'].map((hazard_type, index) => ({
  id: climateIds[index],
  supplier_revision_id: supplierId,
  hazard_type,
  scenario_kind: 'projection',
  scenario_reference: 'ssp245-2031-2050',
  horizon_start: new Date('2031-01-01Z'),
  horizon_end: new Date('2050-12-31Z'),
  source_kind: 'CMIP6',
  model_name: 'ensemble-a',
  scenario_name: 'ssp245',
  exposure_rating: index + 2,
  vulnerability_rating: index + 1,
  priority_band: index === 2 ? 'high' : 'medium',
  input_sha256: String(index + 1).repeat(64),
  evidence_snapshot: { checksumSha256: checksum },
  site_evidence_snapshot: { checksumSha256: checksum },
  ...evidenceColumns(),
  ...evidenceColumns('site_evidence_')
}));

const criticalityInput = {
  subjectKind: 'supplier',
  supplierRevisionId: supplierId,
  relationshipRevisionId: relationshipId,
  carbonSnapshotId: carbonId,
  modelRevisionId: modelId,
  climateAssessmentIds: climateIds,
  assessmentPeriodStart: '2026-01-01',
  assessmentPeriodEnd: '2026-12-31',
  normalizedCarbonScore: 60,
  normalizedClimateScore: 75,
  normalizedDependencyScore: 40,
  carbonScoreRationale: 'Percentile against the approved supplier peer set.',
  climateScoreRationale: 'Three comparable source-backed hazards.',
  dependencyScoreRationale: 'Approved bands using spend, production dependency, single-source, SKU and route facts.'
};

function criticalityDatabase(climateRows = climates, modelRow = model) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      if (sql.includes('FROM carbon_climate_criticality_model_revisions m')) return { rows: modelRow ? [modelRow] : [] };
      if (sql.includes('FROM carbon_climate_subject_carbon_snapshots c')) return { rows: [carbon] };
      if (sql.includes('FROM industrial_supplier_revisions p JOIN evidence_documents pe')) return { rows: [relationship] };
      if (sql.includes('FROM industrial_supplier_climate_assessments a')) return { rows: climateRows };
      if (sql.includes('INSERT INTO carbon_climate_criticality_snapshots')) return { rows: [{
        id: snapshotId,
        subject_kind: 'supplier',
        supplier_revision_id: supplierId,
        relationship_revision_id: relationshipId,
        carbon_snapshot_id: carbonId,
        model_revision_id: modelId,
        assessment_period_start: params[7],
        assessment_period_end: params[8],
        normalized_carbon_score: params[9],
        normalized_climate_score: params[10],
        normalized_dependency_score: params[11],
        weighted_score: params[15],
        priority_band: params[16],
        review_status: 'needs_specialist_review',
        input_snapshot: JSON.parse(params[17]),
        input_sha256: params[18]
      }] };
      return { rows: [] };
    })
  };
  return { pool: { connect: async () => client }, client };
}

test('criticality derives a transparent weighted score while preserving raw supplier dependency facts', async () => {
  const { pool, client } = criticalityDatabase();
  const result = await new SupplierNetworkService(pool).createCriticality(companyId, userId, criticalityInput);

  expect(result.weightedScore).toBe(59.25);
  expect(result.priorityBand).toBe('medium');
  expect(result.reviewStatus).toBe('needs_specialist_review');
  expect(result.inputSnapshot.dependencyBasis).toEqual({
    source: 'supplier_relationship',
    relationshipRevisionId: relationshipId,
    relationshipSha256: 'e'.repeat(64),
    spendPercent: 25.5,
    productionDependencyPercent: 40,
    singleSource: true,
    dependentSkuCount: 12,
    dependentRouteCount: 2
  });
  expect(result.inputSnapshot.climateAssessments).toHaveLength(3);
  expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO carbon_climate_criticality_climate_members'))).toHaveLength(3);
  expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
});

test('criticality refuses climate inputs from mixed scenarios', async () => {
  const { pool, client } = criticalityDatabase([climates[0], { ...climates[1], scenario_reference: 'ssp585-2031-2050' }, climates[2]]);
  const result = await new SupplierNetworkService(pool).createCriticality(companyId, userId, criticalityInput);

  expect(result.code).toBe('CRITICALITY_CLIMATE_NOT_COMPARABLE');
  expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO carbon_climate_criticality_snapshots'))).toBe(false);
  expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

test('criticality refuses an unapproved model', async () => {
  const { pool, client } = criticalityDatabase(climates, { ...model, approval_status: 'draft' });
  const result = await new SupplierNetworkService(pool).createCriticality(companyId, userId, criticalityInput);

  expect(result.code).toBe('CRITICALITY_MODEL_NOT_APPROVED');
  expect(client.query.mock.calls.some(([sql]) => sql.includes('FROM carbon_climate_subject_carbon_snapshots'))).toBe(false);
  expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

function portfolioDatabase(rows) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      if (sql.includes('FROM carbon_climate_criticality_snapshots s')) return { rows };
      if (sql.includes('INSERT INTO carbon_climate_criticality_portfolio_snapshots')) return { rows: [{
        id: 'b2345678-1234-4234-8234-123456789abc',
        portfolio_reference: params[1],
        model_revision_id: params[2],
        assessment_period_start: params[3],
        assessment_period_end: params[4],
        subject_count: params[5],
        priority_summary: JSON.parse(params[6]),
        coverage_summary: JSON.parse(params[7]),
        methodology_notes: params[8],
        input_sha256: params[9]
      }] };
      return { rows: [] };
    })
  };
  return { pool: { connect: async () => client }, client };
}

test('portfolio reports coverage without disguising selected-subject coverage as total supplier coverage', async () => {
  const ids = ['c2345678-1234-4234-8234-123456789abc', 'd2345678-1234-4234-8234-123456789abc'];
  const rows = [
    { id: ids[0], subject_kind: 'supplier', supplier_revision_id: supplierId, model_revision_id: modelId,
      assessment_period_start: new Date('2026-01-01Z'), assessment_period_end: new Date('2026-12-31Z'),
      weighted_score: '75', priority_band: 'high', carbon_source_kind: 'supplier_specific', relationship_revision_id: relationshipId,
      spend_percent: '25.5', single_source: true, hazard_count: '3', input_snapshot: { climateScope: { scenarioReference: 'ssp245', horizonStart: '2031-01-01', horizonEnd: '2050-12-31' } } },
    { id: ids[1], subject_kind: 'facility', facility_revision_id: 'e2345678-1234-4234-8234-123456789abc', model_revision_id: modelId,
      assessment_period_start: new Date('2026-01-01Z'), assessment_period_end: new Date('2026-12-31Z'),
      weighted_score: '45', priority_band: 'medium', carbon_source_kind: 'facility_inventory', hazard_count: '2',
      input_snapshot: { climateScope: { scenarioReference: 'ssp245', horizonStart: '2031-01-01', horizonEnd: '2050-12-31' } } }
  ];
  const { pool, client } = portfolioDatabase(rows);
  const result = await new SupplierNetworkService(pool).createPortfolio(companyId, userId, {
    portfolioReference: 'priority-pilot-2026',
    criticalitySnapshotIds: ids,
    methodologyNotes: 'Coverage is limited to selected immutable subjects.'
  });

  expect(result.prioritySummary).toMatchObject({ countByPriority: { low: 0, medium: 1, high: 1 }, averageWeightedScore: 60 });
  expect(result.coverageSummary).toMatchObject({ method: 'selected_immutable_criticality_snapshots', subjectCount: 2,
    facilityCount: 1, supplierCount: 1, supplierSpecificCarbonCount: 1, completeThreeHazardCount: 1,
    supplierDependencyRecordCount: 1, singleSourceSupplierCount: 1, selectedSupplierSpendPercent: 25.5 });
  expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO carbon_climate_criticality_portfolio_members'))).toHaveLength(2);
});

test('portfolio refuses criticality snapshots with different climate horizons', async () => {
  const ids = ['c2345678-1234-4234-8234-123456789abc', 'd2345678-1234-4234-8234-123456789abc'];
  const base = { model_revision_id: modelId, assessment_period_start: new Date('2026-01-01Z'),
    assessment_period_end: new Date('2026-12-31Z'), weighted_score: '50', priority_band: 'medium',
    carbon_source_kind: 'estimated', hazard_count: '3' };
  const { pool, client } = portfolioDatabase([
    { ...base, id: ids[0], subject_kind: 'supplier', supplier_revision_id: supplierId, relationship_revision_id: relationshipId,
      input_snapshot: { climateScope: { scenarioReference: 'ssp245', horizonStart: '2031-01-01', horizonEnd: '2050-12-31' } } },
    { ...base, id: ids[1], subject_kind: 'facility', facility_revision_id: 'e2345678-1234-4234-8234-123456789abc',
      input_snapshot: { climateScope: { scenarioReference: 'ssp245', horizonStart: '2051-01-01', horizonEnd: '2070-12-31' } } }
  ]);
  const result = await new SupplierNetworkService(pool).createPortfolio(companyId, userId, {
    portfolioReference: 'mixed-horizons', criticalitySnapshotIds: ids, methodologyNotes: 'Must be refused.'
  });

  expect(result.code).toBe('CRITICALITY_PORTFOLIO_NOT_COMPARABLE');
  expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO carbon_climate_criticality_portfolio_snapshots'))).toBe(false);
  expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});
