const {
  RULESET,
  packagingDataset,
  classificationDataset,
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
  assessmentDate: '2026-09-14', productCategory: 'apparel', intendedUse: 'everyday wear',
  consumerGroup: 'adults', importerRole: 'EU importer', salesChannels: ['retail', 'online'],
  consumerProduct: true, placedOnEuMarket: true, textileFibrePercent: 85,
  packagingContext: {
    present: true, types: ['Sales', 'ecommerce'], materials: ['Paper', 'plastic'], reusable: false,
    supplierIdentified: true, customerIdentified: true, directDistanceSaleToEuEndUser: true,
    producerRoleAssessed: false
  },
  materialFacts: [{
    reference: 'TRIM-1', description: 'Leather trim', hsCode: '4205', originCountry: 'IN',
    percentageByWeight: 2, animalOrigin: true, substancesScreened: false
  }]
};

describe('R20 compliance applicability controls', () => {
  test('captures exact shipment codes, material facts and an explicit effective date', () => {
    const input = buildInputSnapshot(snapshot(), context);

    expect(input.assessmentDate).toBe('2026-09-14');
    expect(input.shipment).toMatchObject({ destinationCountry: 'NL', destinationIsEu: true });
    expect(input.products[0]).toMatchObject({
      hsCode: '62052000', hsConfirmed: true, taricCode: '6205200010', taricConfirmed: true
    });
    expect(input.materials.map((item) => item.source)).toEqual(['origin_bom', 'operator_context']);
    expect(input.marketContext.packaging).toMatchObject({
      present: true, types: ['sales', 'ecommerce'], materials: ['paper', 'plastic'], reusable: false
    });
  });

  test('identifies textile requirements but retains specialist review for incomplete legal coverage', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), context);
    const textile = evaluation.result.matches.find((item) => item.code === 'EU_TEXTILE_FIBRE_LABEL_SCOPE');

    expect(textile).toMatchObject({
      decision: 'requirements_identified', matchPrecision: 'exact_taric_plus_operator_fact',
      sourceId: 'EU-1007-2011'
    });
    expect(evaluation.result.classifications[0]).toMatchObject({
      declaredCnCode: '62052000', declaredTaricCode: '6205200010',
      datasetDescription: 'Hand-printed by the batik method', matchStatus: 'exact_taric_match',
      operatorDescriptionReviewRequired: true,
      consultationUrl: expect.stringContaining('Taric=6205200010')
    });
    expect(evaluation.result.status).toBe('specialist_review_required');
    expect(evaluation.result.rulesetCoverage).toBe('limited');
    expect(evaluation.result.specialistReviewRequired).toBe(true);
    expect(evaluation.result.disclaimer).toMatch(/not legal advice/i);
    expect(evaluation.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluation.result.resultSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(RULESET.sources.every((source) => /^https:\/\/(eur-lex|ec)\.europa\.eu\//.test(source.url))).toBe(true);
  });

  test('uses the maintained PPWR dataset without inferring Member-State EPR compliance', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), context);
    const scope = evaluation.result.matches.find((item) => item.code === 'EU_PPWR_PACKAGING_SCOPE');
    const traceability = evaluation.result.matches.find((item) => item.code === 'EU_PPWR_SUPPLY_CHAIN_TRACEABILITY');
    const epr = evaluation.result.matches.find((item) => item.code === 'EU_PPWR_PRODUCER_ROLE_AND_EPR');

    expect(packagingDataset).toMatchObject({
      datasetId: 'weavecarbon.eu-ppwr-applicability', appliesFrom: '2026-08-12',
      coverageStatus: 'limited'
    });
    expect(Object.isFrozen(packagingDataset)).toBe(true);
    expect(evaluation.result.datasets[0]).toMatchObject({
      id: packagingDataset.datasetId, version: packagingDataset.version,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(scope).toMatchObject({ decision: 'requirements_identified', sourceId: 'EU-2025-40' });
    expect(traceability).toMatchObject({
      decision: 'requirements_identified', matchPrecision: 'lane_plus_packaging_context'
    });
    expect(traceability.reason).toMatch(/5 years/i);
    expect(epr).toMatchObject({ decision: 'specialist_review_required' });
    expect(epr.reason).toMatch(/does not calculate registrations, fees or reporting/i);
  });

  test('routes absent packaging facts to specialist review without a non-applicability claim', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), { ...context, packagingContext: undefined });
    const scope = evaluation.result.matches.find((item) => item.code === 'EU_PPWR_PACKAGING_SCOPE');

    expect(evaluation.result.missingInputs).toContain('marketContext.packaging.present');
    expect(scope).toMatchObject({ decision: 'specialist_review_required' });
    expect(scope.reason).toMatch(/no PPWR non-applicability conclusion/i);
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
    expect(evaluation.result.classifications[0]).toMatchObject({
      matchStatus: 'exact_cn_match', matchPrecision: 'exact_cn_operator_confirmed'
    });
  });

  test('routes an unlisted exact textile code to a dataset gap instead of a chapter-level decision', () => {
    const value = snapshot();
    value.lines[0].hsCode = '62063000';
    value.euImportLineDetails[0].taricCode = '6206300000';
    const evaluation = evaluateComplianceApplicability(value, context);

    expect(evaluation.result.matches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EU_TEXTILE_FIBRE_LABEL_SCOPE' })
    ]));
    expect(evaluation.result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'EU_CN_TARIC_ROUTING_DATASET_GAP', decision: 'specialist_review_required'
      })
    ]));
    expect(evaluation.result.classifications[0].matchStatus).toBe('not_covered');
  });

  test('routes an exact footwear TARIC leaf without relying on Chapter 64 alone', () => {
    const value = snapshot();
    value.lines[0].goodsDescription = 'Men leather shoes';
    value.lines[0].hsCode = '64039996';
    value.euImportLineDetails[0].taricCode = '6403999690';
    const evaluation = evaluateComplianceApplicability(value, {
      ...context, productCategory: 'footwear', textileFibrePercent: null
    });
    const footwear = evaluation.result.matches.find((item) =>
      item.code === 'EU_FOOTWEAR_MATERIAL_LABEL_SCOPE'
    );

    expect(footwear).toMatchObject({
      decision: 'specialist_review_required', matchPrecision: 'exact_taric_routing',
      matchedProductCodes: ['6403999690']
    });
    expect(evaluation.result.classifications[0]).toMatchObject({
      category: 'footwear', matchStatus: 'exact_taric_match', datasetDescription: 'Other'
    });
  });

  test('does not fall back to CN routing when a confirmed TARIC conflicts with the dataset', () => {
    const value = snapshot();
    value.euImportLineDetails[0].taricCode = '6205200099';
    const evaluation = evaluateComplianceApplicability(value, context);

    expect(evaluation.result.classifications[0].matchStatus).toBe('taric_not_in_dataset');
    expect(evaluation.result.matches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EU_TEXTILE_FIBRE_LABEL_SCOPE' })
    ]));
    expect(evaluation.result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EU_CN_TARIC_ROUTING_DATASET_GAP' })
    ]));
  });

  test('does not reuse a daily TARIC snapshot for another assessment date', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context, assessmentDate: '2026-09-13'
    });

    expect(evaluation.result.classifications[0]).toMatchObject({
      matchStatus: 'taric_snapshot_date_mismatch', matchPrecision: 'stale_dataset'
    });
    expect(evaluation.result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EU_CN_TARIC_ROUTING_DATASET_GAP' })
    ]));
  });

  test('produces stable hashes for an unchanged normalized evaluation', () => {
    const first = evaluateComplianceApplicability(snapshot(), context);
    const second = evaluateComplianceApplicability(snapshot(), context);

    expect(second.inputSha256).toBe(first.inputSha256);
    expect(second.result.resultSha256).toBe(first.result.resultSha256);
    expect(classificationDataset.entries).toHaveLength(3);
  });
});
