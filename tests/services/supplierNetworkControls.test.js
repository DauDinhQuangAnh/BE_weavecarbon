const controls = require('../../src/services/supplierNetworkControls');

const a = '12345678-1234-4234-8234-123456789abc';
const b = '22345678-1234-4234-8234-123456789abc';
const c = '32345678-1234-4234-8234-123456789abc';

test('criticality model requires transparent weights totaling exactly 100', () => {
  const valid = { modelReference: 'supplier-priority-v1', carbonWeightPercent: 35, climateWeightPercent: 35,
    dependencyWeightPercent: 30, mediumThreshold: 40, highThreshold: 70,
    normalizationPolicy: 'Normalize carbon, climate and dependency inputs to documented 0–100 scales.',
    rationale: 'Approved procurement prioritization method.', approvalStatus: 'approved', evidenceDocumentId: a };
  expect(controls.criticalityModel(valid).errors).toEqual([]);
  expect(controls.criticalityModel({ ...valid, dependencyWeightPercent: 29 }).errors).toContain('Criticality weights must total exactly 100.000.');
});

test('supplier dependency keeps spend, production, single-source, SKU and route facts separate', () => {
  const parsed = controls.relationship({ supplierRevisionId: a, relationshipReference: 'REL-1', materialOrService: 'Cotton yarn',
    procurementCategory: 'Raw material', spendPercent: 25.5, productionDependencyPercent: 40, singleSource: true,
    dependentSkuCount: 12, dependentRouteCount: 2, effectiveFrom: '2026-01-01', evidenceDocumentId: b });
  expect(parsed.errors).toEqual([]);
  expect(parsed.value).toMatchObject({ spendPercent: 25.5, productionDependencyPercent: 40, singleSource: true, dependentSkuCount: 12, dependentRouteCount: 2 });
});

test('criticality input binds one subject, carbon basis, climate evidence and component rationales', () => {
  const valid = { subjectKind: 'supplier', supplierRevisionId: a, relationshipRevisionId: b, carbonSnapshotId: c,
    modelRevisionId: a, climateAssessmentIds: [b], assessmentPeriodStart: '2026-01-01', assessmentPeriodEnd: '2026-12-31',
    normalizedCarbonScore: 60, normalizedClimateScore: 75, normalizedDependencyScore: 40,
    carbonScoreRationale: 'Percentile against the approved peer set.', climateScoreRationale: 'Three source-backed hazards.',
    dependencyScoreRationale: 'Spend, production dependence and single-source flag under the approved policy.' };
  expect(controls.criticality(valid).errors).toEqual([]);
  expect(controls.criticality({ ...valid, facilityRevisionId: c }).errors).toContain('Subject and relationship references do not match subjectKind.');
});

test('carbon basis rejects mixing facility and supplier subjects', () => {
  const input = { subjectKind: 'supplier', supplierRevisionId: a, reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31',
    grossKgCo2e: 1000, boundary: 'Cradle-to-gate supplier declaration.', methodologyReference: 'Supplier PCF method v1',
    sourceKind: 'supplier_specific', dataQualityLevel: 'L2', evidenceDocumentId: b };
  expect(controls.carbonSnapshot(input).errors).toEqual([]);
  expect(controls.carbonSnapshot({ ...input, facilityRevisionId: c }).errors).toContain('Exactly one subject revision matching subjectKind is required.');
});
