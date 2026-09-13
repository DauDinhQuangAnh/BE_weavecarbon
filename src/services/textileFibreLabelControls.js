const crypto = require('crypto');

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

// Canonical English Annex-I names. A market-language label remains operator supplied and reviewer approved.
const ANNEX_I_FIBRES = Object.freeze([
  ['1', 'wool'], ['2-alpaca', 'alpaca'], ['2-llama', 'llama'], ['2-camel', 'camel'],
  ['2-cashmere', 'cashmere'], ['2-mohair', 'mohair'], ['2-angora', 'angora'],
  ['2-vicuna', 'vicuna'], ['2-yak', 'yak'], ['2-guanaco', 'guanaco'],
  ['2-cashgora', 'cashgora'], ['2-beaver', 'beaver'], ['2-otter', 'otter'],
  ['3-animal-hair', 'animal hair'], ['3-horsehair', 'horsehair'], ['4', 'silk'],
  ['5', 'cotton'], ['6', 'kapok'], ['7', 'flax'], ['7-linen', 'linen'],
  ['8', 'true hemp'], ['9', 'jute'], ['10', 'abaca'], ['10-manila-hemp', 'Manila hemp'],
  ['11', 'alfa'], ['12', 'coir'], ['12-coconut', 'coconut'], ['13', 'broom'],
  ['14', 'ramie'], ['15', 'sisal'], ['16', 'sunn'], ['17', 'henequen'],
  ['18', 'maguey'], ['19', 'acetate'], ['20', 'alginate'], ['21', 'cupro'],
  ['22', 'modal'], ['23', 'protein'], ['24', 'triacetate'], ['25', 'viscose'],
  ['26', 'acrylic'], ['27', 'chlorofibre'], ['28', 'fluorofibre'], ['29', 'modacrylic'],
  ['30', 'polyamide'], ['30-nylon', 'nylon'], ['31', 'aramid'], ['32', 'polyimide'],
  ['33', 'lyocell'], ['34', 'polylactide'], ['35', 'polyester'], ['36', 'polyethylene'],
  ['37', 'polypropylene'], ['38', 'polycarbamide'], ['39', 'polyurethane'],
  ['40', 'vinylal'], ['41', 'trivinyl'], ['42', 'elastodiene'], ['43', 'elastane'],
  ['44', 'glass fibre'], ['45', 'elastomultiester'], ['46', 'elastolefin'],
  ['47', 'melamine'], ['48-metal', 'metal fibre'], ['48-metallised', 'metallised fibre'],
  ['48-asbestos', 'asbestos fibre'], ['48-paper', 'paper fibre'],
  ['49', 'polypropylene/polyamide bicomponent'], ['50', 'polyacrylate']
].map(([code, name]) => Object.freeze({ code, name })));
const FIBRE_BY_CODE = new Map(ANNEX_I_FIBRES.map((item) => [item.code, item]));

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-textile-fibre-label',
  version: 'R08-EU-TEXTILE-2018.02.15-1',
  coverageStatus: 'limited',
  sources: Object.freeze([Object.freeze({
    id: 'EU-1007-2011-CONSOLIDATED-2018-02-15',
    title: 'Regulation (EU) No 1007/2011 — consolidated textile fibre names and labelling rules',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02011R1007-20180215',
    version: 'consolidated-2018-02-15'
  })])
});

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
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
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function closeTo100(value) { return Math.abs(value - 100) <= 0.1; }

function normalizeTextileLabelInput(input = {}) {
  const placement = object(input.placement);
  const economicOperator = object(input.economicOperator || input.economic_operator);
  return {
    specificationReference: text(input.specificationReference || input.specification_reference),
    assessmentDate: dateOnly(input.assessmentDate || input.assessment_date),
    productReference: text(input.productReference || input.product_reference),
    productCategory: text(input.productCategory || input.product_category),
    specialProductCategory: text(input.specialProductCategory || input.special_product_category || 'standard').toLowerCase(),
    textileFibrePercent: numberOrNull(input.textileFibrePercent ?? input.textile_fibre_percent),
    marketCodes: unique(array(input.marketCodes || input.market_codes).map(code)).sort(),
    components: array(input.components).map((component) => ({
      componentReference: text(component.componentReference || component.component_reference),
      componentName: text(component.componentName || component.component_name),
      weightPercent: numberOrNull(component.weightPercent ?? component.weight_percent),
      mainLining: component.mainLining === true || component.main_lining === true,
      fibres: array(component.fibres).map((fibre) => ({
        fibreCode: text(fibre.fibreCode || fibre.fibre_code).toLowerCase(),
        percentage: numberOrNull(fibre.percentage)
      }))
    })),
    animalOriginPresence: text(input.animalOriginPresence || input.animal_origin_presence).toLowerCase(),
    languageLabels: array(input.languageLabels || input.language_labels).map((label) => ({
      marketCode: code(label.marketCode || label.market_code),
      languageCode: text(label.languageCode || label.language_code),
      labelText: text(label.labelText || label.label_text),
      animalOriginStatementIncluded: label.animalOriginStatementIncluded === true
        || label.animal_origin_statement_included === true,
      operatorApproved: label.operatorApproved === true || label.operator_approved === true
    })),
    economicOperator: {
      role: text(economicOperator.role).toLowerCase(),
      name: text(economicOperator.name), address: text(economicOperator.address)
    },
    placement: {
      method: text(placement.method).toLowerCase(),
      durable: placement.durable === true,
      easilyLegible: placement.easilyLegible === true || placement.easily_legible === true,
      visible: placement.visible === true,
      accessible: placement.accessible === true,
      securelyAttached: placement.securelyAttached === true || placement.securely_attached === true,
      onlineBeforePurchase: placement.onlineBeforePurchase === true || placement.online_before_purchase === true
    },
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    notes: text(input.notes)
  };
}

function finding(codeValue, severity, message, sourceArticle = null, path = null) {
  return { code: codeValue, severity, message, sourceArticle, path };
}

function buildEnglishPreview(input) {
  const lines = input.components.filter((component) => component.fibres.length).map((component) => {
    const composition = component.fibres.map((fibre) => {
      const controlled = FIBRE_BY_CODE.get(fibre.fibreCode);
      return `${fibre.percentage}% ${controlled?.name || fibre.fibreCode || 'unknown fibre'}`;
    }).join(', ');
    return `${component.componentName || component.componentReference}: ${composition}`;
  });
  if (input.animalOriginPresence === 'present') {
    lines.push('Contains non-textile parts of animal origin');
  }
  return lines.join('\n');
}

function evaluateTextileFibreLabel(input = {}, evidenceSnapshot = []) {
  const normalized = normalizeTextileLabelInput(input);
  const findings = [];
  const missingInputs = [];
  const required = [
    ['specificationReference', normalized.specificationReference],
    ['assessmentDate', normalized.assessmentDate], ['productReference', normalized.productReference],
    ['productCategory', normalized.productCategory], ['textileFibrePercent', normalized.textileFibrePercent !== null],
    ['marketCodes', normalized.marketCodes.length], ['components', normalized.components.length],
    ['animalOriginPresence', ['present', 'absent'].includes(normalized.animalOriginPresence)],
    ['economicOperator.role', normalized.economicOperator.role],
    ['economicOperator.name', normalized.economicOperator.name],
    ['economicOperator.address', normalized.economicOperator.address]
  ];
  required.forEach(([field, present]) => { if (!present) missingInputs.push(field); });

  const euMarket = normalized.marketCodes.some((market) => EU_COUNTRY_CODES.has(market));
  if (!euMarket) findings.push(finding('DESTINATION_OUTSIDE_LIMITED_RULESET', 'specialist',
    'The ruleset only covers products made available to consumers in the EU; it makes no conclusion for other markets.', 'Article 2'));
  if (normalized.textileFibrePercent !== null
    && (normalized.textileFibrePercent < 0 || normalized.textileFibrePercent > 100)) {
    findings.push(finding('TEXTILE_SHARE_INVALID', 'blocker', 'Textile fibre percentage must be between 0 and 100.', 'Article 2'));
  } else if (euMarket && normalized.textileFibrePercent !== null && normalized.textileFibrePercent < 80) {
    findings.push(finding('TEXTILE_SCOPE_SPECIALIST_REVIEW', 'specialist',
      'A share below 80% does not by itself prove exclusion because incorporated textiles may remain in scope.', 'Article 2'));
  }
  if (!['standard', 'annex_iv', 'annex_v', 'annex_vi', 'unknown'].includes(normalized.specialProductCategory)) {
    missingInputs.push('specialProductCategory');
  } else if (normalized.specialProductCategory !== 'standard') {
    findings.push(finding('SPECIAL_PRODUCT_DEROGATION_REVIEW', 'specialist',
      'Annex IV, V or VI product-specific rules are outside automated coverage and require specialist review.', 'Articles 13 and 17'));
  }

  const componentWeightTotal = normalized.components.reduce((sum, item) => sum + (item.weightPercent || 0), 0);
  if (normalized.components.some((item) => item.weightPercent === null || item.weightPercent < 0 || item.weightPercent > 100)
    || !closeTo100(componentWeightTotal)) {
    findings.push(finding('COMPONENT_WEIGHT_TOTAL_INVALID', 'blocker',
      'Component weights must each be between 0 and 100 and total 100% (±0.1).', 'Article 11', 'components'));
  }
  const seenComponents = new Set();
  normalized.components.forEach((component, componentIndex) => {
    const path = `components[${componentIndex}]`;
    if (!component.componentReference || !component.componentName) {
      findings.push(finding('COMPONENT_IDENTITY_REQUIRED', 'blocker',
        'Each component needs a stable reference and consumer-readable name.', 'Article 11', path));
    }
    if (seenComponents.has(component.componentReference)) {
      findings.push(finding('COMPONENT_REFERENCE_DUPLICATE', 'blocker',
        'Component references must be unique within a label specification.', 'Article 11', path));
    }
    seenComponents.add(component.componentReference);
    const compositionRequired = component.mainLining || Number(component.weightPercent || 0) >= 30;
    if (compositionRequired && !component.fibres.length) {
      findings.push(finding('COMPONENT_COMPOSITION_REQUIRED', 'blocker',
        'Main linings and components representing at least 30% of total weight require fibre composition.', 'Article 11', path));
    }
    if (!component.fibres.length) return;
    const fibreTotal = component.fibres.reduce((sum, fibre) => sum + (fibre.percentage || 0), 0);
    if (component.fibres.some((fibre) => fibre.percentage === null || fibre.percentage <= 0 || fibre.percentage > 100)
      || !closeTo100(fibreTotal)) {
      findings.push(finding('FIBRE_PERCENT_TOTAL_INVALID', 'blocker',
        'Declared fibres for each component must be greater than 0 and total 100% (±0.1).', 'Article 9', `${path}.fibres`));
    }
    if (component.fibres.some((fibre) => !FIBRE_BY_CODE.has(fibre.fibreCode))) {
      findings.push(finding('ANNEX_I_FIBRE_NAME_INVALID', 'blocker',
        'Every declared fibre must use a controlled Annex-I code; other-fibre derogations require specialist review.', 'Articles 5 and 9', `${path}.fibres`));
    }
    if (component.fibres.some((fibre, index) => index > 0
      && Number(component.fibres[index - 1].percentage) < Number(fibre.percentage))) {
      findings.push(finding('FIBRE_ORDER_INVALID', 'blocker',
        'Constituent fibres must be entered in descending percentage-by-weight order.', 'Article 9', `${path}.fibres`));
    }
  });

  normalized.marketCodes.forEach((marketCode) => {
    const labels = normalized.languageLabels.filter((label) => label.marketCode === marketCode);
    if (!labels.length || labels.some((label) => !label.languageCode || !label.labelText || !label.operatorApproved)) {
      findings.push(finding('MARKET_LANGUAGE_LABEL_REQUIRED', 'blocker',
        `Market ${marketCode} needs at least one complete, operator-approved official-language label.`, 'Article 16', 'languageLabels'));
    }
    if (normalized.animalOriginPresence === 'present'
      && labels.some((label) => !label.animalOriginStatementIncluded)) {
      findings.push(finding('ANIMAL_ORIGIN_STATEMENT_REQUIRED', 'blocker',
        `Market ${marketCode} label must include the approved local-language animal-origin statement.`, 'Article 12', 'languageLabels'));
    }
  });
  if (normalized.animalOriginPresence === 'present') {
    const englishLabels = normalized.languageLabels.filter((label) => /^en(?:-|$)/i.test(label.languageCode));
    if (englishLabels.some((label) => !label.labelText.includes('Contains non-textile parts of animal origin'))) {
      findings.push(finding('ENGLISH_ANIMAL_ORIGIN_PHRASE_INVALID', 'blocker',
        'English labels must use the prescribed animal-origin phrase verbatim.', 'Article 12', 'languageLabels'));
    }
  }
  if (!normalized.placement.method || Object.entries(normalized.placement)
    .filter(([key]) => key !== 'method').some(([, value]) => value !== true)) {
    findings.push(finding('LABEL_PLACEMENT_INCOMPLETE', 'blocker',
      'Record a durable, legible, visible, accessible and securely attached label plus pre-purchase online display.', 'Articles 14 and 16', 'placement'));
  }
  if (!normalized.evidenceDocumentIds.length || evidenceSnapshot.length !== normalized.evidenceDocumentIds.length) {
    findings.push(finding('TEXTILE_LABEL_EVIDENCE_REQUIRED', 'blocker',
      'At least one shipment-bound evidence document is required and every requested document must resolve.'));
  }
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/.test(text(item.checksumSha256).toLowerCase())
    || Number(item.fileSizeBytes || 0) <= 0)) {
    findings.push(finding('TEXTILE_LABEL_EVIDENCE_NOT_CONTROLLED', 'blocker',
      'Every evidence document must be locked, checksum identified and non-empty.'));
  }

  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker')
    ? 'needs_information'
    : findings.some((item) => item.severity === 'specialist')
      ? 'specialist_review_required' : 'ready_for_label_review';
  const sources = RULESET.sources.map((source) => ({ ...source }));
  const body = {
    schemaId: 'weavecarbon.textile-fibre-label-specification', schemaVersion: '1.0.0',
    rulesetId: RULESET.id, rulesetVersion: RULESET.version, rulesetCoverage: RULESET.coverageStatus,
    sourceManifestSha256: sha256(sources), automatedStatus, euMarket,
    missingInputs: unique(missingInputs), findings, englishPreview: buildEnglishPreview(normalized), sources,
    disclaimer: 'Internal label specification and preview only; not legal advice, a certified translation, or permission to place artwork on the market.'
  };
  return {
    input: normalized, inputSha256: sha256(normalized),
    result: { ...body, resultSha256: sha256(body) }
  };
}

function deriveArtworkStatus(specification, currentEvidence = []) {
  const result = specification.result || specification.result_snapshot || {};
  const review = specification.latestReview || specification.latest_review || null;
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (result.automatedStatus === 'specialist_review_required') return { status: 'specialist_review_required', staleEvidenceIds: [] };
  if (!review) return { status: 'label_review_required', staleEvidenceIds: [] };
  if (review.decision !== 'approved_for_internal_artwork') return { status: review.decision, staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const snapshot = array(review.evidenceSnapshot || review.evidence_snapshot);
  const staleEvidenceIds = snapshot.filter((item) => {
    const current = byId.get(item.id);
    return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256
      || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0);
  }).map((item) => item.id);
  return staleEvidenceIds.length
    ? { status: 'evidence_review_required', staleEvidenceIds }
    : { status: 'approved_for_internal_artwork', staleEvidenceIds: [] };
}

module.exports = {
  RULESET, ANNEX_I_FIBRES, normalizeTextileLabelInput, evaluateTextileFibreLabel,
  deriveArtworkStatus, sha256
};
