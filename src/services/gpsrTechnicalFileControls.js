const crypto = require('crypto');

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const OPERATOR_ROLES = ['manufacturer', 'importer', 'responsible_person'];
const HARMONISATION_COVERAGE = new Set(['none', 'partial', 'full', 'unknown']);
const WARNING_LOCATIONS = new Set(['product', 'packaging', 'accompanying_document', 'online_offer']);

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-gpsr-technical-file',
  version: 'R10-GPSR-2026.05.29-1',
  coverageStatus: 'limited',
  appliesFrom: '2024-12-13',
  sources: Object.freeze([
    Object.freeze({
      id: 'EU-2023-988-2026',
      title: 'Regulation (EU) 2023/988 — consolidated General Product Safety Regulation',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529',
      version: 'consolidated-2026-05-29', appliesFrom: '2024-12-13'
    }),
    Object.freeze({
      id: 'EU-GPSR-BUSINESS-GUIDANCE-2025',
      title: 'Commission Notice — GPSR guidance for businesses',
      url: 'https://eur-lex.europa.eu/eli/C/2025/6233/oj',
      version: 'C/2025/6233', appliesFrom: '2025-11-21'
    }),
    Object.freeze({
      id: 'EU-SBG-GUIDANCE-2025',
      title: 'Commission Notice — Safety Business Gateway implementation guidance',
      url: 'https://eur-lex.europa.eu/eli/C/2025/6238/oj',
      version: 'C/2025/6238', appliesFrom: '2025-11-21'
    })
  ])
});

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function dateOnly(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : null;
}
function integer(value) { const number = Number(value); return Number.isInteger(number) ? number : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function addYears(date, years) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
}

function normalizeOperator(value, role) {
  const item = object(value);
  return {
    role, name: text(item.name), tradeName: text(item.tradeName || item.trade_name),
    postalAddress: text(item.postalAddress || item.postal_address),
    electronicAddress: text(item.electronicAddress || item.electronic_address),
    contactPoint: text(item.contactPoint || item.contact_point),
    euEstablished: item.euEstablished === true || item.eu_established === true
  };
}

function normalizeGpsrTechnicalFileInput(input = {}) {
  const product = object(input.product);
  const operators = object(input.operators);
  const onlineOffer = object(input.onlineOffer || input.online_offer);
  return {
    fileReference: text(input.fileReference || input.file_reference),
    assessmentDate: dateOnly(input.assessmentDate || input.assessment_date),
    firstPlacedOnMarketDate: dateOnly(input.firstPlacedOnMarketDate || input.first_placed_on_market_date),
    consumerProduct: input.consumerProduct === true || input.consumer_product === true,
    placedOnEuMarket: input.placedOnEuMarket === true || input.placed_on_eu_market === true,
    marketCodes: unique(array(input.marketCodes || input.market_codes).map(code)).sort(),
    harmonisationCoverage: text(input.harmonisationCoverage || input.harmonisation_coverage).toLowerCase(),
    applicableSectorRules: unique(array(input.applicableSectorRules || input.applicable_sector_rules).map(text)),
    product: {
      brand: text(product.brand), name: text(product.name), model: text(product.model), type: text(product.type),
      batchNumber: text(product.batchNumber || product.batch_number),
      serialNumber: text(product.serialNumber || product.serial_number),
      otherIdentifier: text(product.otherIdentifier || product.other_identifier),
      description: text(product.description),
      essentialCharacteristics: text(product.essentialCharacteristics || product.essential_characteristics),
      composition: text(product.composition), packagingDescription: text(product.packagingDescription || product.packaging_description),
      productImageEvidenceId: text(product.productImageEvidenceId || product.product_image_evidence_id),
      packagingImageEvidenceId: text(product.packagingImageEvidenceId || product.packaging_image_evidence_id)
    },
    intendedUse: text(input.intendedUse || input.intended_use),
    foreseeableMisuse: text(input.foreseeableMisuse || input.foreseeable_misuse),
    vulnerableGroups: unique(array(input.vulnerableGroups || input.vulnerable_groups).map(text)),
    operators: {
      manufacturer: normalizeOperator(operators.manufacturer, 'manufacturer'),
      importer: normalizeOperator(operators.importer, 'importer'),
      responsiblePerson: normalizeOperator(operators.responsiblePerson || operators.responsible_person, 'responsible_person')
    },
    risks: array(input.risks).map((risk) => ({
      hazardId: text(risk.hazardId || risk.hazard_id), hazardCategory: text(risk.hazardCategory || risk.hazard_category),
      hazardDescription: text(risk.hazardDescription || risk.hazard_description),
      affectedGroups: unique(array(risk.affectedGroups || risk.affected_groups).map(text)),
      foreseeableScenario: text(risk.foreseeableScenario || risk.foreseeable_scenario),
      likelihood: integer(risk.likelihood), severity: integer(risk.severity),
      mitigation: text(risk.mitigation), residualLikelihood: integer(risk.residualLikelihood ?? risk.residual_likelihood),
      residualSeverity: integer(risk.residualSeverity ?? risk.residual_severity),
      verificationEvidenceIds: unique(array(risk.verificationEvidenceIds || risk.verification_evidence_ids).map(text)).sort()
    })),
    standards: array(input.standards).map((standard) => ({
      reference: text(standard.reference), title: text(standard.title), version: text(standard.version),
      applicationExtent: text(standard.applicationExtent || standard.application_extent).toLowerCase(),
      appliedParts: text(standard.appliedParts || standard.applied_parts)
    })),
    warnings: array(input.warnings).map((warning) => ({
      marketCode: code(warning.marketCode || warning.market_code),
      languageCode: text(warning.languageCode || warning.language_code), text: text(warning.text),
      location: text(warning.location).toLowerCase(),
      operatorApproved: warning.operatorApproved === true || warning.operator_approved === true
    })),
    onlineOffer: {
      enabled: onlineOffer.enabled === true,
      manufacturerDisplayed: onlineOffer.manufacturerDisplayed === true || onlineOffer.manufacturer_displayed === true,
      responsiblePersonDisplayed: onlineOffer.responsiblePersonDisplayed === true || onlineOffer.responsible_person_displayed === true,
      productImageDisplayed: onlineOffer.productImageDisplayed === true || onlineOffer.product_image_displayed === true,
      identifiersDisplayed: onlineOffer.identifiersDisplayed === true || onlineOffer.identifiers_displayed === true,
      warningsDisplayed: onlineOffer.warningsDisplayed === true || onlineOffer.warnings_displayed === true,
      offerUrl: text(onlineOffer.offerUrl || onlineOffer.offer_url)
    },
    seriesProductionProcedure: text(input.seriesProductionProcedure || input.series_production_procedure),
    complaintChannel: text(input.complaintChannel || input.complaint_channel),
    postMarketPlan: text(input.postMarketPlan || input.post_market_plan),
    retentionUntil: dateOnly(input.retentionUntil || input.retention_until),
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    notes: text(input.notes)
  };
}

function finding(codeValue, severity, message, sourceArticle = null, path = null) {
  return { code: codeValue, severity, message, sourceArticle, path };
}

function evaluateGpsrTechnicalFile(input = {}, evidenceSnapshot = []) {
  const normalized = normalizeGpsrTechnicalFileInput(input);
  const findings = [];
  const missingInputs = [];
  const required = [
    ['fileReference', normalized.fileReference], ['assessmentDate', normalized.assessmentDate],
    ['firstPlacedOnMarketDate', normalized.firstPlacedOnMarketDate], ['marketCodes', normalized.marketCodes.length],
    ['harmonisationCoverage', HARMONISATION_COVERAGE.has(normalized.harmonisationCoverage)],
    ['product.brand', normalized.product.brand], ['product.name', normalized.product.name],
    ['product.model', normalized.product.model], ['product.description', normalized.product.description],
    ['product.essentialCharacteristics', normalized.product.essentialCharacteristics],
    ['intendedUse', normalized.intendedUse], ['foreseeableMisuse', normalized.foreseeableMisuse],
    ['seriesProductionProcedure', normalized.seriesProductionProcedure],
    ['complaintChannel', normalized.complaintChannel], ['postMarketPlan', normalized.postMarketPlan],
    ['retentionUntil', normalized.retentionUntil]
  ];
  required.forEach(([field, value]) => { if (!value) missingInputs.push(field); });
  const euMarket = normalized.marketCodes.some((market) => EU_COUNTRY_CODES.has(market));
  const appliesByDate = normalized.firstPlacedOnMarketDate >= RULESET.appliesFrom;
  if (!normalized.consumerProduct || !normalized.placedOnEuMarket || !euMarket) {
    findings.push(finding('GPSR_SCOPE_SPECIALIST_REVIEW', 'specialist',
      'The limited ruleset cannot confirm GPSR applicability without an EU-targeted consumer product.', 'Articles 2 and 4'));
  }
  if (normalized.firstPlacedOnMarketDate && !appliesByDate) {
    findings.push(finding('GPSR_PRE_APPLICATION_DATE', 'specialist',
      'The recorded first placement predates 13 December 2024 and requires assessment under the prior regime.', 'Article 52'));
  }
  if (normalized.harmonisationCoverage !== 'none') {
    findings.push(finding('SECTOR_LAW_OVERLAP_REVIEW', 'specialist',
      'Partial/full/unknown Union harmonisation coverage requires risk-by-risk allocation before GPSR controls can be approved.', 'Article 2'));
  }
  if (!normalized.product.batchNumber && !normalized.product.serialNumber && !normalized.product.otherIdentifier) {
    findings.push(finding('PRODUCT_IDENTIFIER_REQUIRED', 'blocker',
      'A visible type, batch, serial number or other traceable product identifier is required.', 'Article 9(5)', 'product'));
  }
  if (!normalized.product.productImageEvidenceId || !normalized.product.packagingImageEvidenceId) {
    findings.push(finding('PRODUCT_AND_PACKAGING_IMAGES_REQUIRED', 'blocker',
      'The technical file needs evidence identifiers for representative product and packaging images.', 'Article 9(2)', 'product'));
  }
  const manufacturer = normalized.operators.manufacturer;
  const importer = normalized.operators.importer;
  const responsible = normalized.operators.responsiblePerson;
  for (const operator of [manufacturer, importer, responsible]) {
    const path = `operators.${operator.role}`;
    if (!operator.name || !operator.postalAddress || !operator.electronicAddress) {
      findings.push(finding('ECONOMIC_OPERATOR_CONTACT_INCOMPLETE', 'blocker',
        `${operator.role} needs name, postal address and direct electronic address.`, 'Articles 9, 11 and 16', path));
    }
  }
  if (!importer.euEstablished || !responsible.euEstablished) {
    findings.push(finding('EU_OPERATOR_ESTABLISHMENT_REQUIRED', 'blocker',
      'Importer and responsible person must be recorded as established in the Union.', 'Articles 11 and 16', 'operators'));
  }
  if (!normalized.risks.length) {
    findings.push(finding('RISK_ANALYSIS_REQUIRED', 'blocker',
      'The technical file needs a product-specific internal risk analysis.', 'Articles 6 and 9(2)', 'risks'));
  }
  normalized.risks.forEach((risk, index) => {
    const path = `risks[${index}]`;
    if (!risk.hazardId || !risk.hazardCategory || !risk.hazardDescription || !risk.foreseeableScenario
      || !risk.affectedGroups.length || !risk.mitigation) {
      findings.push(finding('RISK_ENTRY_INCOMPLETE', 'blocker',
        'Each hazard needs identity, category, scenario, affected groups and a mitigation.', 'Articles 6 and 9(2)', path));
    }
    if (![risk.likelihood, risk.severity, risk.residualLikelihood, risk.residualSeverity]
      .every((score) => score !== null && score >= 1 && score <= 5)) {
      findings.push(finding('RISK_SCORE_INVALID', 'blocker',
        'Initial and residual likelihood/severity scores must be integers from 1 to 5.', 'Article 9(2)', path));
    }
    if (risk.likelihood !== null && risk.severity !== null && risk.residualLikelihood !== null && risk.residualSeverity !== null
      && risk.residualLikelihood * risk.residualSeverity > risk.likelihood * risk.severity) {
      findings.push(finding('RISK_MITIGATION_NOT_EFFECTIVE', 'blocker',
        'The residual risk score cannot exceed the initial risk score without documented specialist escalation.', 'Article 9(2)', path));
    }
    if (!risk.verificationEvidenceIds.length) findings.push(finding('RISK_VERIFICATION_EVIDENCE_REQUIRED', 'blocker',
      'Each mitigation needs test/report evidence identifiers.', 'Article 9(2)', path));
  });
  normalized.standards.forEach((standard, index) => {
    if (!standard.reference || !standard.version || !['full', 'partial'].includes(standard.applicationExtent)
      || (standard.applicationExtent === 'partial' && !standard.appliedParts)) {
      findings.push(finding('STANDARD_APPLICATION_INCOMPLETE', 'blocker',
        'Each standard needs reference, version, full/partial extent and applied parts when partial.', 'Articles 7 and 9(2)', `standards[${index}]`));
    }
  });
  normalized.marketCodes.forEach((market) => {
    const marketWarnings = normalized.warnings.filter((warning) => warning.marketCode === market);
    if (!marketWarnings.length || marketWarnings.some((warning) => !warning.languageCode || !warning.text
      || !WARNING_LOCATIONS.has(warning.location) || !warning.operatorApproved)) {
      findings.push(finding('MARKET_WARNING_REQUIRED', 'blocker',
        `Market ${market} needs complete, operator-approved warnings/instructions in an easily understood language.`, 'Articles 9(7) and 19(d)', 'warnings'));
    }
  });
  if (normalized.onlineOffer.enabled) {
    const onlineComplete = normalized.onlineOffer.manufacturerDisplayed
      && normalized.onlineOffer.responsiblePersonDisplayed && normalized.onlineOffer.productImageDisplayed
      && normalized.onlineOffer.identifiersDisplayed && normalized.onlineOffer.warningsDisplayed
      && /^https:\/\//i.test(normalized.onlineOffer.offerUrl);
    if (!onlineComplete) findings.push(finding('DISTANCE_SALE_INFORMATION_INCOMPLETE', 'blocker',
      'The online offer must clearly show manufacturer, EU responsible person, product image/identity and warnings.', 'Article 19', 'onlineOffer'));
  }
  const minimumRetention = addYears(normalized.firstPlacedOnMarketDate, 10);
  if (minimumRetention && (!normalized.retentionUntil || normalized.retentionUntil < minimumRetention)) {
    findings.push(finding('TECHNICAL_FILE_RETENTION_TOO_SHORT', 'blocker',
      `Technical documentation must be retained through at least ${minimumRetention}.`, 'Article 9(3)', 'retentionUntil'));
  }
  const requestedEvidence = new Set(normalized.evidenceDocumentIds);
  [normalized.product.productImageEvidenceId, normalized.product.packagingImageEvidenceId]
    .concat(normalized.risks.flatMap((risk) => risk.verificationEvidenceIds)).filter(Boolean)
    .forEach((id) => requestedEvidence.add(id));
  if (!requestedEvidence.size || evidenceSnapshot.length !== requestedEvidence.size) {
    findings.push(finding('GPSR_EVIDENCE_REQUIRED', 'blocker',
      'Every product image, packaging image, test and technical-file evidence id must resolve within the shipment.'));
  }
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/.test(text(item.checksumSha256).toLowerCase()) || Number(item.fileSizeBytes || 0) <= 0)) {
    findings.push(finding('GPSR_EVIDENCE_NOT_CONTROLLED', 'blocker',
      'All GPSR evidence must be locked, checksum identified and non-empty.'));
  }
  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker')
    ? 'needs_information' : findings.some((item) => item.severity === 'specialist')
      ? 'specialist_review_required' : 'ready_for_safety_review';
  const sources = RULESET.sources.map((source) => ({ ...source }));
  const body = {
    schemaId: 'weavecarbon.gpsr-technical-file', schemaVersion: '1.0.0',
    rulesetId: RULESET.id, rulesetVersion: RULESET.version, rulesetCoverage: RULESET.coverageStatus,
    sourceManifestSha256: sha256(sources), euMarket, appliesByDate, automatedStatus,
    minimumRetentionUntil: minimumRetention, missingInputs: unique(missingInputs), findings, sources,
    disclaimer: 'Internal GPSR technical-file control only; not legal advice, a conformity certificate, an authority filing or proof that a product is safe.'
  };
  return { input: normalized, inputSha256: sha256(normalized), result: { ...body, resultSha256: sha256(body) } };
}

function deriveSafetyFileStatus(file, currentEvidence = []) {
  const result = file.result || file.result_snapshot || {};
  const review = file.latestReview || file.latest_review || null;
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (result.automatedStatus === 'specialist_review_required') return { status: 'specialist_review_required', staleEvidenceIds: [] };
  if (!review) return { status: 'safety_review_required', staleEvidenceIds: [] };
  if (review.decision !== 'approved_for_internal_release') return { status: review.decision, staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const staleEvidenceIds = array(review.evidenceSnapshot || review.evidence_snapshot).filter((item) => {
    const current = byId.get(item.id);
    return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256
      || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0);
  }).map((item) => item.id);
  return staleEvidenceIds.length ? { status: 'evidence_review_required', staleEvidenceIds }
    : { status: 'approved_for_internal_release', staleEvidenceIds: [] };
}

module.exports = {
  RULESET, OPERATOR_ROLES, HARMONISATION_COVERAGE,
  normalizeGpsrTechnicalFileInput, evaluateGpsrTechnicalFile, deriveSafetyFileStatus, sha256
};
