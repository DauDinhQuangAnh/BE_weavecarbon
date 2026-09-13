const {
  RULESET,
  packagingDataset,
  classificationDataset,
  reachRestrictionDataset,
  wildlifeSpeciesDataset,
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
  reachContext: {
    directAndProlongedSkinOrOralContact: true,
    washableInWaterDuringNormalLifecycle: true,
    secondHand: false,
    exclusivelyRecycledWithoutNpe: false,
    leatherPartsContactSkin: false
  },
  packagingContext: {
    present: true, types: ['Sales', 'ecommerce'], materials: ['Paper', 'plastic'], reusable: false,
    supplierIdentified: true, customerIdentified: true, directDistanceSaleToEuEndUser: true,
    producerRoleAssessed: false
  },
  materialFacts: [{
    reference: 'TRIM-1', description: 'Python leather trim', hsCode: '4205', originCountry: 'ID',
    percentageByWeight: 2, animalOrigin: true, substancesScreened: false,
    speciesScientificName: 'Python reticulatus', specimenDescription: 'Tanned leather trim',
    wildlifeSourceCode: 'C', countryOfExport: 'VN',
    citesDocumentReference: 'VN-REEXPORT-SYNTHETIC', euImportPermitReference: 'NL-IMPORT-SYNTHETIC',
    wildlifeDocumentsVerified: true
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
    expect(input.materials[1]).toMatchObject({
      speciesScientificName: 'Python reticulatus', wildlifeSourceCode: 'C',
      countryOfExport: 'VN', wildlifeDocumentsVerified: true
    });
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
    expect(RULESET.sources.every((source) =>
      /^https:\/\/(eur-lex|ec|echa|euon\.echa)\.europa\.eu\//.test(source.url)
    )).toBe(true);
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
    expect(evaluation.result.restrictionScreenings).toEqual([]);
    expect(evaluation.result.speciesScreenings).toEqual([]);
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
      ...context, productCategory: 'footwear', textileFibrePercent: null,
      reachContext: { ...context.reachContext, leatherPartsContactSkin: true }
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
    expect(evaluation.result.restrictionScreenings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'ANNEX_XVII_47_CHROMIUM_VI_LEATHER', scopeStatus: 'screen_required',
        threshold: { operator: 'greater_than_or_equal', value: 3, unit: 'mg/kg_dry_leather' }
      })
    ]));
  });

  test('routes exact textile products to maintained Annex XVII thresholds without a compliance conclusion', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), context);
    const route = evaluation.result.matches.find((item) =>
      item.code === 'EU_REACH_ANNEX_XVII_TEXTILE_LEATHER_ROUTING'
    );

    expect(reachRestrictionDataset.restrictions).toHaveLength(3);
    expect(Object.isFrozen(reachRestrictionDataset)).toBe(true);
    expect(evaluation.result.datasets[2]).toMatchObject({
      id: reachRestrictionDataset.datasetId, version: reachRestrictionDataset.version,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(route).toMatchObject({
      decision: 'specialist_review_required',
      matchPrecision: 'exact_classification_plus_operator_scope_facts',
      sourceId: 'EU-REACH-2026-05-11'
    });
    expect(route.reason).toMatch(/screening boundaries, not compliance conclusions/i);
    expect(evaluation.result.restrictionScreenings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'ANNEX_XVII_43_AZO_AMINES', scopeStatus: 'screen_required',
        threshold: { operator: 'above', value: 30, unit: 'mg/kg' }
      }),
      expect.objectContaining({
        ruleId: 'ANNEX_XVII_46A_NPE', scopeStatus: 'screen_required',
        threshold: { operator: 'greater_than_or_equal', value: 0.01, unit: 'percent_by_weight' }
      })
    ]));
  });

  test('fails closed when a routed restriction lacks operator scope facts', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context, reachContext: undefined
    });
    const route = evaluation.result.matches.find((item) =>
      item.code === 'EU_REACH_ANNEX_XVII_TEXTILE_LEATHER_ROUTING'
    );

    expect(route.matchPrecision).toBe('exact_classification_scope_facts_missing');
    expect(evaluation.result.missingInputs).toEqual(expect.arrayContaining([
      'marketContext.reach.directAndProlongedSkinOrOralContact',
      'marketContext.reach.washableInWaterDuringNormalLifecycle',
      'marketContext.reach.secondHand',
      'marketContext.reach.exclusivelyRecycledWithoutNpe'
    ]));
    expect(evaluation.result.restrictionScreenings.every((item) =>
      item.scopeStatus === 'scope_facts_required'
    )).toBe(true);
  });

  test('requires specialist evidence for a claimed Entry 46a exclusion', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context,
      reachContext: { ...context.reachContext, exclusivelyRecycledWithoutNpe: true }
    });
    const npe = evaluation.result.restrictionScreenings.find((item) =>
      item.ruleId === 'ANNEX_XVII_46A_NPE'
    );

    expect(npe.scopeStatus).toBe('specialist_exemption_review');
    expect(npe.reason).toMatch(/requires product-specific evidence/i);
  });

  test('does not reuse the restriction snapshot for another assessment date', () => {
    const value = snapshot();
    value.euImportLineDetails[0].taricConfirmed = false;
    const evaluation = evaluateComplianceApplicability(value, {
      ...context, assessmentDate: '2026-09-13'
    });
    const route = evaluation.result.matches.find((item) =>
      item.code === 'EU_REACH_ANNEX_XVII_TEXTILE_LEATHER_ROUTING'
    );

    expect(route.matchPrecision).toBe('restriction_dataset_date_mismatch');
    expect(evaluation.result.restrictionScreenings.every((item) =>
      item.scopeStatus === 'dataset_date_mismatch'
    )).toBe(true);
  });

  test('requires textile fibre percentage to scope Entry 46a', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context, textileFibrePercent: null
    });
    const npe = evaluation.result.restrictionScreenings.find((item) =>
      item.ruleId === 'ANNEX_XVII_46A_NPE'
    );

    expect(npe.scopeStatus).toBe('scope_facts_required');
    expect(npe.missingScopeFacts).toContain('textileFibrePercent');
    expect(evaluation.result.missingInputs).toContain('marketContext.textileFibrePercent');
  });

  test('routes an exact Annex B species but does not infer permit validity or import eligibility', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), context);
    const route = evaluation.result.matches.find((item) =>
      item.code === 'EU_WILDLIFE_TRADE_SPECIES_ROUTING'
    );
    const species = evaluation.result.speciesScreenings[0];

    expect(wildlifeSpeciesDataset.species).toHaveLength(3);
    expect(Object.isFrozen(wildlifeSpeciesDataset)).toBe(true);
    expect(evaluation.result.datasets[3]).toMatchObject({
      id: wildlifeSpeciesDataset.datasetId, version: wildlifeSpeciesDataset.version,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(species).toMatchObject({
      matchedScientificName: 'Python reticulatus', citesAppendix: 'II', euAnnex: 'B',
      euListingBasis: 'higher_taxon', matchStatus: 'exact_species_match_documents_recorded',
      currentSuspensionCheckRequired: true
    });
    expect(route).toMatchObject({
      decision: 'specialist_review_required',
      matchPrecision: 'exact_species_plus_operator_document_references', sourceId: 'EC-338-97'
    });
    expect(route.reason).toMatch(/document authenticity still require specialist and authority verification/i);
  });

  test('fails closed when animal origin is recorded without an exact scientific name', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context,
      materialFacts: [{ ...context.materialFacts[0], speciesScientificName: '' }]
    });
    const gap = evaluation.result.matches.find((item) =>
      item.code === 'EU_WILDLIFE_TRADE_SPECIES_DATASET_GAP'
    );

    expect(evaluation.result.speciesScreenings[0]).toMatchObject({
      matchStatus: 'species_required', missingFacts: ['speciesScientificName']
    });
    expect(evaluation.result.missingInputs).toContain('materials[1].speciesScientificName');
    expect(gap.reason).toMatch(/No CITES Appendix, EU Annex, permit or import-eligibility conclusion/i);
  });

  test('does not classify a CITES species outside the deliberately limited dataset', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context,
      materialFacts: [{ ...context.materialFacts[0], speciesScientificName: 'Panthera tigris' }]
    });

    expect(evaluation.result.speciesScreenings[0].matchStatus).toBe('species_not_in_limited_dataset');
    expect(evaluation.result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EU_WILDLIFE_TRADE_SPECIES_DATASET_GAP' })
    ]));
  });

  test('surfaces Annex A commercial-purpose review for Siamese crocodile', () => {
    const evaluation = evaluateComplianceApplicability(snapshot(), {
      ...context,
      materialFacts: [{
        ...context.materialFacts[0], speciesScientificName: 'Crocodylus siamensis',
        specimenDescription: 'Crocodile leather trim', wildlifeSourceCode: 'D'
      }]
    });

    expect(evaluation.result.speciesScreenings[0]).toMatchObject({
      matchedScientificName: 'Crocodylus siamensis', citesAppendix: 'I', euAnnex: 'A',
      euListingBasis: 'explicit_species', commercialPurposeReviewRequired: true
    });
  });

  test('rejects invalid source codes and out-of-window wildlife snapshots', () => {
    const invalidSource = evaluateComplianceApplicability(snapshot(), {
      ...context,
      materialFacts: [{ ...context.materialFacts[0], wildlifeSourceCode: 'Z' }]
    });
    const stale = evaluateComplianceApplicability(snapshot(), {
      ...context, assessmentDate: '2026-09-15'
    });

    expect(invalidSource.result.speciesScreenings[0]).toMatchObject({
      matchStatus: 'exact_species_match_documents_incomplete',
      validationIssues: ['wildlifeSourceCode_not_in_limited_code_list']
    });
    expect(stale.result.speciesScreenings[0].matchStatus).toBe('dataset_date_mismatch');
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
    expect(first.result.datasets).toHaveLength(4);
  });
});
