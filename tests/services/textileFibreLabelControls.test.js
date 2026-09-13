const {
  RULESET, ANNEX_I_FIBRES, evaluateTextileFibreLabel, deriveArtworkStatus
} = require('../../src/services/textileFibreLabelControls');

const evidence = [{
  id: '11111111-1111-4111-8111-111111111111', status: 'locked',
  checksumSha256: 'a'.repeat(64), fileSizeBytes: 256
}];
const validInput = (patch = {}) => ({
  specificationReference: 'LABEL-SHIRT-001', assessmentDate: '2026-09-13',
  productReference: 'SHIRT-001', productCategory: 'woven shirt', specialProductCategory: 'standard',
  textileFibrePercent: 100, marketCodes: ['DE'],
  components: [
    { componentReference: 'shell', componentName: 'Shell', weightPercent: 80, mainLining: false,
      fibres: [{ fibreCode: '5', percentage: 80 }, { fibreCode: '35', percentage: 20 }] },
    { componentReference: 'lining', componentName: 'Main lining', weightPercent: 20, mainLining: true,
      fibres: [{ fibreCode: '35', percentage: 100 }] }
  ],
  animalOriginPresence: 'absent',
  languageLabels: [{ marketCode: 'DE', languageCode: 'de-DE', labelText: 'Oberstoff: 80% Baumwolle, 20% Polyester', operatorApproved: true }],
  economicOperator: { role: 'importer', name: 'EU Import GmbH', address: 'Berlin, Germany' },
  placement: { method: 'sewn', durable: true, easilyLegible: true, visible: true,
    accessible: true, securelyAttached: true, onlineBeforePurchase: true },
  evidenceDocumentIds: [evidence[0].id], notes: 'Synthetic test fixture.', ...patch
});

describe('R08 EU textile fibre label controls', () => {
  test('creates a checksum-bound specification ready for label review', () => {
    const evaluated = evaluateTextileFibreLabel(validInput(), evidence);
    expect(evaluated.result.rulesetVersion).toBe(RULESET.version);
    expect(evaluated.result.automatedStatus).toBe('ready_for_label_review');
    expect(evaluated.result.englishPreview).toContain('Shell: 80% cotton, 20% polyester');
    expect(evaluated.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ANNEX_I_FIBRES.length).toBeGreaterThanOrEqual(50);
  });

  test('rejects unknown names, invalid totals and non-descending fibre order', () => {
    const evaluated = evaluateTextileFibreLabel(validInput({
      components: [{ componentReference: 'shell', componentName: 'Shell', weightPercent: 100,
        fibres: [{ fibreCode: 'marketing-bamboo', percentage: 20 }, { fibreCode: '5', percentage: 80 }] }]
    }), evidence);
    expect(evaluated.result.automatedStatus).toBe('needs_information');
    expect(evaluated.result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ANNEX_I_FIBRE_NAME_INVALID', 'FIBRE_ORDER_INVALID'
    ]));
  });

  test('requires composition for a main lining even when below 30 percent', () => {
    const evaluated = evaluateTextileFibreLabel(validInput({
      components: [
        { componentReference: 'shell', componentName: 'Shell', weightPercent: 90,
          fibres: [{ fibreCode: '5', percentage: 100 }] },
        { componentReference: 'lining', componentName: 'Lining', weightPercent: 10, mainLining: true, fibres: [] }
      ]
    }), evidence);
    expect(evaluated.result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COMPONENT_COMPOSITION_REQUIRED' })
    ]));
  });

  test('requires prescribed animal-origin handling and complete online placement', () => {
    const evaluated = evaluateTextileFibreLabel(validInput({
      animalOriginPresence: 'present',
      languageLabels: [{ marketCode: 'DE', languageCode: 'de-DE', labelText: 'Materialangabe', operatorApproved: true }],
      placement: { method: 'sewn', durable: true, easilyLegible: true, visible: true,
        accessible: true, securelyAttached: true, onlineBeforePurchase: false }
    }), evidence);
    expect(evaluated.result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ANIMAL_ORIGIN_STATEMENT_REQUIRED', 'LABEL_PLACEMENT_INCOMPLETE'
    ]));
  });

  test('routes derogations and uncertain below-80 scope to a specialist', () => {
    const evaluated = evaluateTextileFibreLabel(validInput({
      textileFibrePercent: 75, specialProductCategory: 'annex_iv'
    }), evidence);
    expect(evaluated.result.automatedStatus).toBe('specialist_review_required');
  });

  test('invalidates approval when locked evidence changes', () => {
    const evaluated = evaluateTextileFibreLabel(validInput(), evidence);
    const specification = { input: evaluated.input, result: evaluated.result,
      latestReview: { decision: 'approved_for_internal_artwork', evidenceSnapshot: evidence } };
    expect(deriveArtworkStatus(specification, evidence).status).toBe('approved_for_internal_artwork');
    expect(deriveArtworkStatus(specification, [{ ...evidence[0], checksumSha256: 'b'.repeat(64) }]))
      .toEqual({ status: 'evidence_review_required', staleEvidenceIds: [evidence[0].id] });
  });
});
