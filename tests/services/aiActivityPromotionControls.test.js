const { aiActivityPromotionControls: controls } = require('../../src/modules/evidence');

const EVIDENCE_ID = '223e4567-e89b-42d3-a456-426614174000';
const FACILITY_ID = '323e4567-e89b-42d3-a456-426614174000';
const REVIEW_ID = '423e4567-e89b-42d3-a456-426614174000';
const CHECKSUM = 'a'.repeat(64);

function suggestions(extraFields = []) {
  return controls.buildPromotionSuggestions({
    evidence: { id: EVIDENCE_ID, checksum_sha256: CHECKSUM },
    review: {
      id: REVIEW_ID,
      extraction_sha256: 'b'.repeat(64),
      fields: [
        ['invoice_number', 'INV-2026-001'],
        ['activity_type', 'purchased_electricity'],
        ['period_start', '2026-01-01'],
        ['period_end', '2026-01-31'],
        ['kwh_total', 1200],
        ['unit', 'kWh'],
        ['emission_factor_id', 'FORBIDDEN-FACTOR'],
        ...extraFields
      ].map(([field_path, confirmed_value]) => ({
        field_path,
        confirmed_value,
        decision: 'accepted'
      }))
    }
  });
}

function validInput(source = suggestions()) {
  return {
    suggestionSha256: source.suggestionSha256,
    fieldDecisions: source.fields.map((field) => ({
      fieldPath: field.fieldPath,
      decision: 'accepted',
      confirmedCanonicalField: field.suggestedCanonicalField,
      rationale: 'Accepted after reviewing the source document.'
    })),
    overrideRationales: {},
    anomalyResolutions: [],
    activityPayload: {
      activityReference: 'INV-2026-001',
      facilityRevisionId: FACILITY_ID,
      activityType: 'purchased_electricity',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      quantity: 1200,
      canonicalUnit: 'kWh',
      sourceKind: 'invoice',
      dataQualityLevel: 'L3'
    }
  };
}

describe('controlled AI/OCR activity promotion controls', () => {
  test('produces deterministic checksum-bound governed suggestions', () => {
    const first = suggestions();
    const second = suggestions();

    expect(first).toEqual(second);
    expect(first.engine).toBe('weavecarbon.governed-semantic-mapper');
    expect(first.evidenceDocumentId).toBe(EVIDENCE_ID);
    expect(first.suggestionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fields.find((field) => field.fieldPath === 'emission_factor_id'))
      .toEqual(expect.objectContaining({ suggestedCanonicalField: 'unmapped', confidence: 1 }));
    expect(controls.fieldSuggestion('hệ_số_phát_thải_kg_co2e')).toEqual(
      expect.objectContaining({ suggestedCanonicalField: 'unmapped', confidence: 1 })
    );
    expect(controls.fieldSuggestion('ef_value')).toEqual(
      expect.objectContaining({ suggestedCanonicalField: 'unmapped', confidence: 1 })
    );
    expect(controls.fieldSuggestion('Kỳ bắt đầu')).toEqual(
      expect.objectContaining({ suggestedCanonicalField: 'periodStart' })
    );
    expect(controls.fieldSuggestion('Số lượng')).toEqual(
      expect.objectContaining({ suggestedCanonicalField: 'quantity' })
    );
    expect(controls.fieldSuggestion('Đơn vị')).toEqual(
      expect.objectContaining({ suggestedCanonicalField: 'canonicalUnit' })
    );
  });

  test('accepts a complete human-reviewed candidate without letting AI choose factors', () => {
    const result = controls.validateCandidateInput(suggestions(), validInput());

    expect(result.blockerCodes).toEqual([]);
    expect(result.activityPayload).toEqual(expect.objectContaining({
      activityReference: 'INV-2026-001',
      quantity: 1200,
      canonicalUnit: 'kWh',
      sourceSha256: CHECKSUM,
      evidenceDocumentIds: [EVIDENCE_ID]
    }));
    expect(result.fieldDecisions.find((field) => field.fieldPath === 'emission_factor_id'))
      .toEqual(expect.objectContaining({ confirmedCanonicalField: 'unmapped' }));
  });

  test('blocks incomplete semantic review coverage', () => {
    const source = suggestions();
    const input = validInput(source);
    input.fieldDecisions.pop();

    const result = controls.validateCandidateInput(source, input);

    expect(result.blockerCodes).toEqual(expect.arrayContaining([
      'FIELD_DECISION_MISSING',
      'FIELD_DECISION_COVERAGE_INVALID'
    ]));
  });

  test('blocks attempts to promote factor or calculation output fields', () => {
    const source = suggestions();
    const input = validInput(source);
    const factor = input.fieldDecisions.find((field) => field.fieldPath === 'emission_factor_id');
    factor.decision = 'corrected';
    factor.confirmedCanonicalField = 'quantity';
    factor.rationale = 'This should never be permitted as activity quantity.';

    const result = controls.validateCandidateInput(source, input);

    expect(result.blockerCodes).toContain('FACTOR_OR_CALCULATION_PROMOTION_FORBIDDEN');
  });

  test('blocks OCR candidates from claiming independently verified L4 or L5 quality', () => {
    const source = suggestions();
    const input = validInput(source);
    input.activityPayload.dataQualityLevel = 'L5';

    const result = controls.validateCandidateInput(source, input);

    expect(result.blockerCodes).toContain('OCR_DATA_QUALITY_OVERCLAIM');
  });

  test('requires and records an explicit resolution for zero quantity', () => {
    const source = suggestions();
    const input = validInput(source);
    input.activityPayload.quantity = 0;
    const quantityField = source.fields.find((field) => field.fieldPath === 'kwh_total');
    quantityField.confirmedValue = 0;

    expect(controls.validateCandidateInput(source, input).blockerCodes)
      .toContain('UNRESOLVED_WARNING:ZERO_QUANTITY');

    input.anomalyResolutions = [{
      code: 'ZERO_QUANTITY',
      resolution: 'accepted_with_rationale',
      rationale: 'The meter was inactive for the complete billing period.'
    }];
    const resolved = controls.validateCandidateInput(source, input);
    expect(resolved.warningCodes).toContain('ZERO_QUANTITY');
    expect(resolved.blockerCodes).not.toContain('UNRESOLVED_WARNING:ZERO_QUANTITY');

    input.anomalyResolutions.push({
      code: 'NOT_A_CURRENT_WARNING',
      resolution: 'resolved',
      rationale: 'This fabricated warning must be rejected by the control.'
    });
    expect(controls.validateCandidateInput(source, input).blockerCodes)
      .toContain('ANOMALY_RESOLUTION_INVALID');
  });
});
