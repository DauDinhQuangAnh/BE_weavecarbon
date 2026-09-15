const { DQL_METHOD_VERSION, scoreDql, validateFactorProposal, validateFactorReview } = require('../../src/services/dataQualityGovernanceControls');

describe('G2-02 data quality and factor controls', () => {
  test('scores five dimensions deterministically', () => {
    const result = scoreDql({ subjectType: 'activity', subjectReference: 'ACT-1', temporalScore: 5,
      geographicScore: 4, technologicalScore: 4, completenessScore: 5, reliabilityScore: 4,
      completenessPercent: 98, rationale: 'Primary meter data.' });
    expect(result.errors).toEqual([]); expect(result.value).toMatchObject({ methodologyVersion: DQL_METHOD_VERSION,
      overallScore: 4.4, dataQualityLevel: 'L4' }); expect(result.value.assessmentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('rejects incomplete factor provenance and unsupported review roles', () => {
    expect(validateFactorProposal({ factorValue: 1 }).errors.length).toBeGreaterThan(5);
    expect(validateFactorReview({ reviewerRole: 'admin', decision: 'approved_for_release_candidate', notes: 'No.' }).errors)
      .toContain('reviewerRole must be emission_factor_reviewer.');
  });
});
