const {
  RULESET,
  buildInputSnapshot,
  evaluateComplianceApplicability
} = require('../../src/services/complianceApplicabilityControls');

const snapshot = (destinationCountry = 'NL') => ({
  shipment: {
    id: '10000000-0000-4000-8000-000000000001', referenceNumber: 'SHP-R20-1',
    originCountry: 'VN', destinationCountry
  },
  profile: {
    importer: { country: destinationCountry }, transportMode: 'sea',
    customsValueAmount: 1000, currency: 'EUR'
  },
  lines: [{
    id: '20000000-0000-4000-8000-000000000001', sku: 'SHIRT-1',
    goodsDescription: 'Cotton shirt', hsCode: '62052000', hsCodeConfirmed: true,
    originCountry: 'VN'
  }],
  euImportLineDetails: [{
    exportLineId: '20000000-0000-4000-8000-000000000001',
    taricCode: '6205200010', taricConfirmed: true
  }],
  originProfile: {
    lineAssessments: [{ materials: [{
      id: 'MAT-1', reference: 'YARN-1', description: 'Cotton yarn', hsCode: '5205',
      originCountry: 'IN'
    }] }]
  }
});

const context = {
  assessmentDate: '2026-09-13', productCategory: 'apparel', intendedUse: 'everyday wear',
  consumerGroup: 'adults', importerRole: 'EU importer', salesChannels: ['retail', 'online'],
  consumerProduct: true, placedOnEuMarket: true, textileFibrePercent: 85,
  materialFacts: [{
    reference: 'TRIM-1', description: 'Leather trim', hsCode: '4205', originCountry: 'IN',
    percentageByWeight: 2, animalOrigin: true, substancesScreened: false
  }]
};

describe('R20 compliance applicability controls', () => {
  test('captures exact shipment codes, material facts and an explicit effective date', () => {
    const input = buildInputSnapshot(snapshot(), context);

    expect(input.assessmentDate).toBe('2026-09-13');
    expect(input.shipment).toMatchObject({ destinationCountry: 'NL', destinationIsEu: true });
    expect(input.products[0]).toMatchObject({
      hsCode: '62052000', hsConfirmed: true, taricCode: '6205200010', taricConfirmed: true
    });
    expect(input.materials.map((item) => item.source)).toEqual(['origin_bom', 'operator_context']);
  });

  test('identifies textile requirements but retains specialist review for incomplete legal coverage', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), context);
    const textile = evaluation.result.matches.find((item) => item.code === 'EU_TEXTILE_FIBRE_LABEL_SCOPE');

    expect(textile).toMatchObject({
      decision: 'requirements_identified', matchPrecision: 'chapter_plus_operator_fact',
      sourceId: 'EU-1007-2011'
    });
    expect(evaluation.result.status).toBe('specialist_review_required');
    expect(evaluation.result.rulesetCoverage).toBe('limited');
    expect(evaluation.result.specialistReviewRequired).toBe(true);
    expect(evaluation.result.disclaimer).toMatch(/not legal advice/i);
    expect(evaluation.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluation.result.resultSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(RULESET.sources.every((source) => source.url.startsWith('https://eur-lex.europa.eu/'))).toBe(true);
  });

  test('does not infer global non-applicability outside the limited EU ruleset', () => {
    const evaluation = evaluateComplianceApplicability(snapshot('US'), context);

    expect(evaluation.result.status).toBe('specialist_review_required');
    expect(evaluation.result.matches[0]).toMatchObject({
      code: 'R20_EU_RULESET_ROUTE', decision: 'not_triggered'
    });
    expect(evaluation.result.matches[0].reason).toMatch(/no global non-applicability conclusion/i);
  });

  test('routes missing composition facts to specialist review instead of guessing scope', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context, textileFibrePercent: null, consumerProduct: null
    });
    const textile = evaluation.result.matches.find((item) => item.code === 'EU_TEXTILE_FIBRE_LABEL_SCOPE');

    expect(textile.decision).toBe('specialist_review_required');
    expect(evaluation.result.missingInputs).toContain('marketContext.consumerProduct');
  });

  test('does not treat an unconfirmed TARIC code as the exact classification', () => {
    const value = snapshot();
    value.euImportLineDetails[0].taricConfirmed = false;
    const evaluation = evaluateComplianceApplicability(value, context);
    const textile = evaluation.result.matches.find((item) => item.code === 'EU_TEXTILE_FIBRE_LABEL_SCOPE');

    expect(evaluation.result.missingInputs).toContain('products[0].confirmedTaricCode');
    expect(textile.matchedProductCodes).toEqual(['62052000']);
  });

  test('produces stable hashes for an unchanged normalized evaluation', () => {
    const first = evaluateComplianceApplicability(snapshot(), context);
    const second = evaluateComplianceApplicability(snapshot(), context);

    expect(second.inputSha256).toBe(first.inputSha256);
    expect(second.result.resultSha256).toBe(first.result.resultSha256);
  });
});
