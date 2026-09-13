const crypto = require('crypto');
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const packagingDataset = deepFreeze(require('../data/regulatory/euPackagingApplicabilityDataset.json'));
const classificationDataset = deepFreeze(require('../data/regulatory/euCnTaricProductRoutingDataset.json'));

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-product-compliance-triage',
  version: 'R20-EU-APPLICABILITY-2026.09.3',
  coverageStatus: 'limited',
  effectiveFrom: '2024-12-13',
  sources: Object.freeze([
    Object.freeze({
      id: 'EU-1007-2011',
      title: 'Regulation (EU) No 1007/2011 — textile fibre names and labelling',
      url: 'https://eur-lex.europa.eu/eli/reg/2011/1007/oj',
      version: 'consolidated-2018-02-15'
    }),
    Object.freeze({
      id: 'EU-94-11-EC',
      title: 'Directive 94/11/EC — footwear material labelling',
      url: 'https://eur-lex.europa.eu/eli/dir/1994/11/oj',
      version: 'consolidated-2013-07-01'
    }),
    Object.freeze({
      id: 'EU-2023-988',
      title: 'Regulation (EU) 2023/988 — general product safety',
      url: 'https://eur-lex.europa.eu/eli/reg/2023/988/oj',
      version: 'consolidated-2026-05-29'
    }),
    Object.freeze({
      id: 'EC-1907-2006',
      title: 'Regulation (EC) No 1907/2006 — REACH',
      url: 'https://eur-lex.europa.eu/eli/reg/2006/1907/oj',
      version: 'current-version-must-be-verified-at-review'
    }),
    ...packagingDataset.sources.map((source) => Object.freeze({ ...source })),
    ...classificationDataset.sources.map((source) => Object.freeze({ ...source }))
  ])
});

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function digits(value) { return text(value).replace(/\D/g, ''); }
function array(value) { return Array.isArray(value) ? value : []; }
function boolOrNull(value) { return typeof value === 'boolean' ? value : null; }
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateOnly(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized : null;
}
function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function normalizedList(value) {
  return unique(array(value).map((item) => text(item).toLowerCase()));
}

function sourceManifest() {
  return RULESET.sources.map((source) => ({ ...source }));
}

function classifyProduct(product, assessmentDate) {
  const confirmedCnCode = product.hsConfirmed && product.hsCode.length === 8 ? product.hsCode : null;
  const confirmedTaricCode = product.taricConfirmed && product.taricCode.length === 10
    ? product.taricCode : null;
  const entry = classificationDataset.entries.find((item) =>
    item.cnCode === confirmedCnCode || item.taricLeaves.some((leaf) => leaf.code === confirmedTaricCode)
  );
  const consultationUrl = confirmedTaricCode
    ? `${classificationDataset.taricConsultationBaseUrl}?Lang=en&SimDate=${classificationDataset.taricConsultedAt.replaceAll('-', '')}&Area=${classificationDataset.taricOriginContext}&Taric=${confirmedTaricCode}&LangDescr=en`
    : null;

  const base = {
    exportLineId: product.exportLineId,
    sku: product.sku,
    operatorDescription: product.description,
    declaredCnCode: confirmedCnCode,
    declaredTaricCode: confirmedTaricCode,
    datasetId: classificationDataset.datasetId,
    datasetVersion: classificationDataset.version,
    datasetDescription: null,
    category: null,
    legalRouteCodes: [],
    matchStatus: 'not_covered',
    matchPrecision: 'none',
    operatorDescriptionReviewRequired: true,
    consultationUrl
  };
  if (!entry) return base;

  const leaf = confirmedTaricCode
    ? entry.taricLeaves.find((item) => item.code === confirmedTaricCode)
    : null;
  const cnDateCurrent = Boolean(assessmentDate)
    && assessmentDate >= classificationDataset.cnValidFrom
    && assessmentDate <= classificationDataset.cnValidTo;
  const taricDateCurrent = assessmentDate === classificationDataset.taricConsultedAt;

  if (confirmedTaricCode && !leaf) {
    return {
      ...base, declaredCnCode: entry.cnCode, datasetDescription: entry.cnDescription,
      category: entry.category, matchStatus: 'taric_not_in_dataset', matchPrecision: 'dataset_gap'
    };
  }
  if (!cnDateCurrent) {
    return {
      ...base, declaredCnCode: entry.cnCode, datasetDescription: leaf?.description || entry.cnDescription,
      category: entry.category, matchStatus: 'cn_version_date_mismatch', matchPrecision: 'stale_dataset'
    };
  }
  if (leaf && !taricDateCurrent) {
    return {
      ...base, declaredCnCode: entry.cnCode, datasetDescription: leaf.description,
      category: entry.category, matchStatus: 'taric_snapshot_date_mismatch', matchPrecision: 'stale_dataset'
    };
  }

  return {
    ...base,
    declaredCnCode: entry.cnCode,
    datasetDescription: leaf?.description || entry.cnDescription,
    category: entry.category,
    legalRouteCodes: [...entry.legalRouteCodes],
    matchStatus: leaf ? 'exact_taric_match' : 'exact_cn_match',
    matchPrecision: leaf ? 'exact_taric_operator_confirmed' : 'exact_cn_operator_confirmed'
  };
}

function normalizeMaterial(value = {}, source = 'operator_context') {
  return {
    reference: text(value.reference || value.id),
    description: text(value.description),
    hsCode: digits(value.hsCode || value.hs_code),
    originCountry: code(value.originCountry || value.origin_country),
    percentageByWeight: numberOrNull(value.percentageByWeight ?? value.percentage_by_weight),
    animalOrigin: boolOrNull(value.animalOrigin ?? value.animal_origin),
    substancesScreened: boolOrNull(value.substancesScreened ?? value.substances_screened),
    source
  };
}

function buildInputSnapshot(snapshot = {}, input = {}) {
  const profile = snapshot.profile || {};
  const shipment = snapshot.shipment || {};
  const euDetails = new Map(array(snapshot.euImportLineDetails).map((item) => [item.exportLineId, item]));
  const originMaterials = array(snapshot.originProfile?.lineAssessments).flatMap((assessment) =>
    array(assessment.materials).map((material) => normalizeMaterial(material, 'origin_bom'))
  );
  const operatorMaterials = array(input.materialFacts || input.material_facts)
    .map((material) => normalizeMaterial(material));
  const destinationCountry = code(shipment.destinationCountry || profile.importer?.country);

  return {
    assessmentDate: dateOnly(input.assessmentDate || input.assessment_date),
    shipment: {
      id: shipment.id || null,
      referenceNumber: text(shipment.referenceNumber),
      originCountry: code(shipment.originCountry),
      destinationCountry,
      destinationIsEu: EU_COUNTRY_CODES.has(destinationCountry),
      transportMode: text(profile.transportMode).toLowerCase(),
      customsValueAmount: numberOrNull(profile.customsValueAmount),
      currency: code(profile.currency)
    },
    products: array(snapshot.lines).map((line) => {
      const detail = euDetails.get(line.id) || {};
      return {
        exportLineId: line.id,
        sku: text(line.sku),
        description: text(line.goodsDescription),
        hsCode: digits(line.hsCode),
        hsConfirmed: line.hsCodeConfirmed === true,
        taricCode: digits(detail.taricCode),
        taricConfirmed: detail.taricConfirmed === true,
        originCountry: code(line.originCountry)
      };
    }),
    materials: [...originMaterials, ...operatorMaterials],
    marketContext: {
      productCategory: text(input.productCategory || input.product_category),
      intendedUse: text(input.intendedUse || input.intended_use),
      consumerGroup: text(input.consumerGroup || input.consumer_group),
      importerRole: text(input.importerRole || input.importer_role),
      salesChannels: normalizedList(input.salesChannels || input.sales_channels),
      consumerProduct: boolOrNull(input.consumerProduct ?? input.consumer_product),
      placedOnEuMarket: boolOrNull(input.placedOnEuMarket ?? input.placed_on_eu_market),
      textileFibrePercent: numberOrNull(input.textileFibrePercent ?? input.textile_fibre_percent),
      packaging: (() => {
        const packaging = input.packagingContext || input.packaging_context || {};
        return {
          present: boolOrNull(packaging.present),
          types: normalizedList(packaging.types),
          materials: normalizedList(packaging.materials),
          reusable: boolOrNull(packaging.reusable),
          supplierIdentified: boolOrNull(packaging.supplierIdentified ?? packaging.supplier_identified),
          customerIdentified: boolOrNull(packaging.customerIdentified ?? packaging.customer_identified),
          directDistanceSaleToEuEndUser: boolOrNull(
            packaging.directDistanceSaleToEuEndUser ?? packaging.direct_distance_sale_to_eu_end_user
          ),
          producerRoleAssessed: boolOrNull(packaging.producerRoleAssessed ?? packaging.producer_role_assessed)
        };
      })(),
      notes: text(input.notes)
    }
  };
}

function result(codeValue, decision, reason, {
  sourceId, matchedProductCodes = [], requiredEvidenceTypes = [], risk = 'high', matchPrecision = 'context'
} = {}) {
  return {
    code: codeValue,
    decision,
    risk,
    matchPrecision,
    reason,
    sourceId,
    matchedProductCodes,
    requiredEvidenceTypes
  };
}

function evaluateComplianceApplicability(snapshot, input = {}) {
  const normalized = buildInputSnapshot(snapshot, input);
  const missingInputs = [];
  if (!normalized.assessmentDate) missingInputs.push('assessmentDate');
  if (!/^[A-Z]{2}$/.test(normalized.shipment.destinationCountry)) missingInputs.push('shipment.destinationCountry');
  if (!normalized.products.length) missingInputs.push('products');
  normalized.products.forEach((product, index) => {
    if (product.hsCode.length < 6 || !product.hsConfirmed) missingInputs.push(`products[${index}].confirmedHsCode`);
    if (product.taricCode && !product.taricConfirmed) missingInputs.push(`products[${index}].confirmedTaricCode`);
  });
  for (const field of ['productCategory', 'intendedUse', 'consumerGroup', 'importerRole']) {
    if (!normalized.marketContext[field]) missingInputs.push(`marketContext.${field}`);
  }
  if (!normalized.marketContext.salesChannels.length) missingInputs.push('marketContext.salesChannels');
  if (normalized.marketContext.consumerProduct === null) missingInputs.push('marketContext.consumerProduct');
  if (normalized.marketContext.placedOnEuMarket === null) missingInputs.push('marketContext.placedOnEuMarket');
  if (normalized.marketContext.textileFibrePercent !== null
    && (normalized.marketContext.textileFibrePercent < 0 || normalized.marketContext.textileFibrePercent > 100)) {
    missingInputs.push('marketContext.textileFibrePercent');
  }
  if (normalized.shipment.destinationIsEu) {
    const packaging = normalized.marketContext.packaging;
    if (packaging.present === null) missingInputs.push('marketContext.packaging.present');
    if (packaging.present === true && !packaging.types.length) missingInputs.push('marketContext.packaging.types');
    if (packaging.present === true && !packaging.materials.length) missingInputs.push('marketContext.packaging.materials');
    if (packaging.present === true && packaging.reusable === null) missingInputs.push('marketContext.packaging.reusable');
    if (packaging.present === true && packaging.supplierIdentified === null) {
      missingInputs.push('marketContext.packaging.supplierIdentified');
    }
    if (packaging.present === true && packaging.customerIdentified === null) {
      missingInputs.push('marketContext.packaging.customerIdentified');
    }
    if (packaging.present === true && packaging.directDistanceSaleToEuEndUser === null) {
      missingInputs.push('marketContext.packaging.directDistanceSaleToEuEndUser');
    }
    if (packaging.present === true && packaging.producerRoleAssessed === null) {
      missingInputs.push('marketContext.packaging.producerRoleAssessed');
    }
  }

  const matches = [];
  const productCodes = normalized.products.map((item) =>
    item.taricCode && item.taricConfirmed ? item.taricCode : item.hsCode
  );
  const classifications = normalized.products.map((product) => classifyProduct(product, normalized.assessmentDate));
  const textileClassifications = classifications.filter((item) =>
    item.legalRouteCodes.includes('EU_TEXTILE_FIBRE_LABEL_SCOPE')
  );
  const footwearClassifications = classifications.filter((item) =>
    item.legalRouteCodes.includes('EU_FOOTWEAR_MATERIAL_LABEL_SCOPE')
  );
  const textileCodes = textileClassifications.map((item) => item.declaredTaricCode || item.declaredCnCode);
  const footwearCodes = footwearClassifications.map((item) => item.declaredTaricCode || item.declaredCnCode);

  if (!normalized.shipment.destinationIsEu) {
    matches.push(result(
      'R20_EU_RULESET_ROUTE', 'not_triggered',
      'The recorded destination is outside the current EU-only ruleset; no global non-applicability conclusion is made.',
      { sourceId: null, risk: 'high', matchPrecision: 'lane' }
    ));
  } else {
    if (textileCodes.length) {
      const recordedFibrePercent = normalized.marketContext.textileFibrePercent;
      const fibrePercent = recordedFibrePercent !== null && recordedFibrePercent >= 0 && recordedFibrePercent <= 100
        ? recordedFibrePercent : null;
      matches.push(result(
        'EU_TEXTILE_FIBRE_LABEL_SCOPE',
        fibrePercent !== null && fibrePercent >= 80 ? 'requirements_identified' : 'specialist_review_required',
        fibrePercent !== null && fibrePercent >= 80
          ? 'An EU-bound Chapter 61/62 product is recorded with at least 80% textile fibres; controlled fibre-composition requirements must be prepared.'
          : 'Chapter 61/62 is only a routing signal. Confirm fibre percentage, components and Article 2 scope before deciding applicability.',
        {
          sourceId: 'EU-1007-2011', matchedProductCodes: textileCodes,
          requiredEvidenceTypes: ['controlled_fibre_composition', 'component_breakdown', 'market_language_plan'],
          matchPrecision: textileClassifications.every((item) => item.matchStatus === 'exact_taric_match')
            ? 'exact_taric_plus_operator_fact' : 'exact_cn_plus_operator_fact'
        }
      ));
    }

    if (footwearCodes.length) {
      matches.push(result(
        'EU_FOOTWEAR_MATERIAL_LABEL_SCOPE', 'specialist_review_required',
        'An EU-bound Chapter 64 product requires component/material and 80% rule analysis before footwear-label applicability can be confirmed.',
        {
          sourceId: 'EU-94-11-EC', matchedProductCodes: footwearCodes,
          requiredEvidenceTypes: ['upper_lining_sock_outsole_material_breakdown', 'component_80_percent_calculation'],
          matchPrecision: footwearClassifications.every((item) => item.matchStatus === 'exact_taric_match')
            ? 'exact_taric_routing' : 'exact_cn_routing'
        }
      ));
    }

    const classificationGaps = classifications.filter((item) =>
      ['61', '62', '64'].some((chapter) =>
        normalized.products.find((product) => product.exportLineId === item.exportLineId)?.hsCode.startsWith(chapter)
      ) && !['exact_cn_match', 'exact_taric_match'].includes(item.matchStatus)
    );
    if (classificationGaps.length) {
      matches.push(result(
        'EU_CN_TARIC_ROUTING_DATASET_GAP', 'specialist_review_required',
        'At least one declared Chapter 61/62/64 classification is absent from, conflicts with, or falls outside the effective date of the limited maintained dataset; no product-law scope conclusion is made for that line.',
        {
          sourceId: 'EU-2025-1926',
          matchedProductCodes: classificationGaps.map((item) => item.declaredTaricCode || item.declaredCnCode).filter(Boolean),
          requiredEvidenceTypes: ['classification_rationale', 'product_technical_description', 'current_taric_consultation'],
          matchPrecision: 'dataset_gap'
        }
      ));
    }

    const gpsrReady = normalized.marketContext.consumerProduct === true
      && normalized.marketContext.placedOnEuMarket === true
      && normalized.assessmentDate >= RULESET.effectiveFrom;
    matches.push(result(
      'EU_GPSR_BASELINE_SCOPE', gpsrReady ? 'requirements_identified' : 'specialist_review_required',
      gpsrReady
        ? 'The operator states that this is a consumer product placed on the EU market on or after the ruleset effective date; GPSR baseline controls must be assessed alongside product-specific law.'
        : 'Consumer-product, market-placement or effective-date facts are insufficient for a GPSR scope decision.',
      {
        sourceId: 'EU-2023-988', matchedProductCodes: productCodes,
        requiredEvidenceTypes: ['risk_assessment', 'economic_operator_identity', 'traceability_record', 'warning_language_plan'],
        matchPrecision: 'lane_plus_operator_context'
      }
    ));

    matches.push(result(
      'EU_REACH_SUBSTANCE_SCREEN', 'specialist_review_required',
      'EU destination alone cannot determine REACH duties; current substance, restriction, Candidate List and article-level evidence must be checked.',
      {
        sourceId: 'EC-1907-2006', matchedProductCodes: productCodes,
        requiredEvidenceTypes: ['material_substance_inventory', 'current_reach_list_version', 'supplier_declaration_or_lab_evidence'],
        matchPrecision: 'lane_only'
      }
    ));

    const packaging = normalized.marketContext.packaging;
    const ppwrDateReady = Boolean(normalized.assessmentDate)
      && normalized.assessmentDate >= packagingDataset.appliesFrom;
    const ppwrScopeReady = packaging.present === true
      && normalized.marketContext.placedOnEuMarket === true
      && ppwrDateReady;
    matches.push(result(
      'EU_PPWR_PACKAGING_SCOPE', ppwrScopeReady ? 'requirements_identified' : 'specialist_review_required',
      ppwrScopeReady
        ? `Packaging is recorded for goods placed on the EU market on or after ${packagingDataset.appliesFrom}; PPWR packaging controls must be assessed.`
        : `Packaging presence, EU market-placement or the ${packagingDataset.appliesFrom} application date is not established; no PPWR non-applicability conclusion is made.`,
      {
        sourceId: 'EU-2025-40', matchedProductCodes: productCodes,
        requiredEvidenceTypes: ['packaging_inventory', 'packaging_material_and_format_specification', 'packaging_scope_memo'],
        matchPrecision: 'lane_plus_operator_context'
      }
    ));

    if (packaging.present === true) {
      const traceabilityReady = packaging.supplierIdentified === true
        && packaging.customerIdentified === true;
      const retentionYears = packaging.reusable === true
        ? packagingDataset.traceabilityRetentionYears.reusable
        : packagingDataset.traceabilityRetentionYears.singleUse;
      matches.push(result(
        'EU_PPWR_SUPPLY_CHAIN_TRACEABILITY',
        ppwrDateReady && traceabilityReady ? 'requirements_identified' : 'specialist_review_required',
        ppwrDateReady && traceabilityReady
          ? `Supplier and customer identities are recorded; retain the applicable supply-chain identity record for ${retentionYears} years and verify the evidence with a specialist.`
          : 'Supplier/customer identity or effective-date facts are incomplete for PPWR supply-chain traceability routing.',
        {
          sourceId: 'EU-2025-40', matchedProductCodes: productCodes,
          requiredEvidenceTypes: ['packaging_supplier_identity', 'packaging_customer_identity', 'identity_record_retention_policy'],
          matchPrecision: 'lane_plus_packaging_context'
        }
      ));

      matches.push(result(
        'EU_PPWR_PRODUCER_ROLE_AND_EPR', 'specialist_review_required',
        packaging.directDistanceSaleToEuEndUser === true
          ? 'A direct distance sale to an EU end user is recorded. Determine the producer, Member State, authorised-representative and EPR duties; this ruleset does not calculate registrations, fees or reporting.'
          : 'Producer and EPR duties depend on the economic operator, first market availability, sales route and Member State; specialist determination is required.',
        {
          sourceId: 'EU-2025-40', matchedProductCodes: productCodes,
          requiredEvidenceTypes: [
            'economic_operator_role_map', 'member_state_producer_role_assessment',
            'epr_registration_or_authorised_representative_assessment'
          ],
          matchPrecision: packaging.producerRoleAssessed === true
            ? 'operator_assessment_recorded' : 'lane_plus_operator_context'
        }
      ));
    }

    if (normalized.materials.some((material) => material.animalOrigin === true)) {
      matches.push(result(
        'EU_TEXTILE_ANIMAL_ORIGIN_DISCLOSURE', 'specialist_review_required',
        'At least one operator-supplied material fact records animal origin; textile disclosure and any separate wildlife-trade controls require specialist review.',
        {
          sourceId: 'EU-1007-2011', matchedProductCodes: productCodes,
          requiredEvidenceTypes: ['animal_origin_component_declaration', 'species_and_source_evidence'],
          matchPrecision: 'material_fact'
        }
      ));
    }
  }

  if (!matches.length) {
    matches.push(result(
      'R20_RULE_COVERAGE_GAP', 'specialist_review_required',
      'No published rule in this limited ruleset covers the recorded lane and product facts.',
      { sourceId: null, requiredEvidenceTypes: ['specialist_scope_memo'], matchPrecision: 'coverage_gap' }
    ));
  }

  const requiresSpecialist = missingInputs.length > 0
    || matches.some((item) => item.decision === 'specialist_review_required')
    || !normalized.shipment.destinationIsEu;
  const status = requiresSpecialist
    ? 'specialist_review_required'
    : matches.some((item) => item.decision === 'requirements_identified')
      ? 'requirements_identified' : 'not_applicable';
  const sources = sourceManifest();
  const datasets = [packagingDataset, classificationDataset].map((dataset) => ({
    id: dataset.datasetId,
    version: dataset.version,
    coverageStatus: dataset.coverageStatus,
    sha256: sha256(dataset)
  }));
  const sourceManifestSha256 = sha256(sources);
  const inputSha256 = sha256(normalized);
  const body = {
    schemaId: 'weavecarbon.compliance-applicability-evaluation',
    schemaVersion: '1.0.0',
    rulesetId: RULESET.id,
    rulesetVersion: RULESET.version,
    rulesetCoverage: RULESET.coverageStatus,
    datasets,
    sourceManifestSha256,
    assessmentDate: normalized.assessmentDate,
    status,
    specialistReviewRequired: requiresSpecialist,
    missingInputs: unique(missingInputs),
    classifications,
    matches,
    requiredEvidenceTypes: unique(matches.flatMap((item) => item.requiredEvidenceTypes)),
    sources,
    disclaimer: 'Internal applicability triage only; not legal advice, a permit, a certificate, or an authority decision.'
  };

  return {
    input: normalized,
    inputSha256,
    result: { ...body, resultSha256: sha256(body) }
  };
}

module.exports = {
  RULESET,
  packagingDataset,
  classificationDataset,
  classifyProduct,
  buildInputSnapshot,
  evaluateComplianceApplicability,
  sha256
};
