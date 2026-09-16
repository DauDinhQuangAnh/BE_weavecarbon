const { getCapabilityRegistry, validateFacilityInput, validateActivityInput, validateProcessInput,
  validateMeasurementPointInput, validateActivityReviewInput } = require('../../src/services/industrialCoreControls');

describe('G2 industrial core controls', () => {
  test('publishes an honest, versioned capability registry', () => {
    const registry = getCapabilityRegistry();
    expect(registry.coverage).toBe('baseline');
    expect(registry.truthBoundary).toMatch(/planned capabilities must not be presented/i);
    expect(registry.layers.some((item) => item.id === 'industry-rules' && item.status === 'partial')).toBe(true);
    expect(registry.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('normalizes and validates a facility revision', () => {
    const result = validateFacilityInput({ facilityReference: ' FAC-01 ', name: 'Plant One', countryCode: 'vn' });
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ facilityReference: 'FAC-01', countryCode: 'VN', lifecycleStatus: 'active' });
  });

  test('rejects activity records without tenant-safe references and provenance', () => {
    const result = validateActivityInput({ activityReference: 'A-1', quantity: 10, sourceKind: 'manual', dataQualityLevel: 'L2' });
    expect(result.errors).toEqual(expect.arrayContaining([
      'facilityRevisionId must be a UUID.', 'A valid periodStart and periodEnd are required.',
      'canonicalUnit is required.', 'sourceSha256 must be a SHA-256 hex digest.'
    ]));
  });

  test('validates process, measurement point and reviewer contracts', () => {
    const facilityRevisionId = '30000000-0000-4000-8000-000000000001';
    expect(validateProcessInput({ facilityRevisionId, processReference: 'P-1', name: 'Kiln', processType: 'thermal' }).errors).toEqual([]);
    expect(validateMeasurementPointInput({ facilityRevisionId, measurementPointReference: 'M-1', measurementType: 'electricity', canonicalUnit: 'kWh', sourceType: 'meter' }).errors).toEqual([]);
    expect(validateActivityReviewInput({ reviewerRole: 'industrial_activity_reviewer', decision: 'approved', notes: 'Evidence checked.' }).errors).toEqual([]);
  });
});
