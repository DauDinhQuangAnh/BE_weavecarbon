const crypto = require('crypto');

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-product-compliance-triage',
  version: 'R20-EU-APPLICABILITY-2026.09.1',
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
    })
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

function sourceManifest() {
  return RULESET.sources.map((source) => ({ ...source }));
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
      salesChannels: unique(array(input.salesChannels || input.sales_channels).map((item) => text(item).toLowerCase())),
      consumerProduct: boolOrNull(input.consumerProduct ?? input.consumer_product),
      placedOnEuMarket: boolOrNull(input.placedOnEuMarket ?? input.placed_on_eu_market),
      textileFibrePercent: numberOrNull(input.textileFibrePercent ?? input.textile_fibre_percent),
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

  const matches = [];
  const productCodes = normalized.products.map((item) =>
    item.taricCode && item.taricConfirmed ? item.taricCode : item.hsCode
  );
  const textileCodes = productCodes.filter((item) => item.startsWith('61') || item.startsWith('62'));
  const footwearCodes = productCodes.filter((item) => item.startsWith('64'));

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
          matchPrecision: 'chapter_plus_operator_fact'
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
          matchPrecision: 'chapter_routing'
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
  const sourceManifestSha256 = sha256(sources);
  const inputSha256 = sha256(normalized);
  const body = {
    schemaId: 'weavecarbon.compliance-applicability-evaluation',
    schemaVersion: '1.0.0',
    rulesetId: RULESET.id,
    rulesetVersion: RULESET.version,
    rulesetCoverage: RULESET.coverageStatus,
    sourceManifestSha256,
    assessmentDate: normalized.assessmentDate,
    status,
    specialistReviewRequired: requiresSpecialist,
    missingInputs: unique(missingInputs),
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
  buildInputSnapshot,
  evaluateComplianceApplicability,
  sha256
};
