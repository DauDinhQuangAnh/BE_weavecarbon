const crypto = require('crypto');

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const CANDIDATE_STATUSES = new Set(['included', 'not_included', 'unknown']);
const SCOPE_DECISIONS = new Set(['applies', 'not_applies', 'unknown']);
const LIMIT_UNITS = new Set(['percent_w_w', 'mg_kg', 'mg_kg_material', 'mg_kg_extracted']);
const LIMIT_COMPARATORS = new Set(['at_or_above_limit', 'above_limit']);
const EVIDENCE_BASES = new Set(['supplier_declaration', 'sds', 'laboratory_test', 'calculation', 'unknown']);

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-reach-svhc-article-dossier',
  version: 'R11-REACH-2026.06.22-1',
  coverageStatus: 'limited',
  reachConsolidatedDate: '2026-06-22',
  candidateListSnapshotDate: '2026-02-04',
  candidateListEntryCount: 253,
  article33ThresholdPercent: 0.1,
  article7AnnualTonnageThreshold: 1,
  consumerResponseDays: 45,
  sources: Object.freeze([
    Object.freeze({ id: 'EU-REACH-2026-06-22', title: 'Regulation (EC) No 1907/2006 — consolidated REACH',
      url: 'https://eur-lex.europa.eu/eli/reg/2006/1907/2026-06-22', version: 'consolidated-2026-06-22' }),
    Object.freeze({ id: 'ECHA-CANDIDATE-2026-02-04', title: 'ECHA Candidate List of SVHC for Authorisation',
      url: 'https://echa.europa.eu/candidate-list-table', version: '253-entries-2026-02-04' }),
    Object.freeze({ id: 'ECHA-ANNEX-XVII', title: 'ECHA substances restricted under REACH / Annex XVII',
      url: 'https://echa.europa.eu/substances-restricted-under-reach', version: 'checked-2026-09-13' }),
    Object.freeze({ id: 'ECHA-SCIP', title: 'ECHA SCIP duties for suppliers of articles',
      url: 'https://echa.europa.eu/scip-suppliers-of-articles', version: 'checked-2026-09-13' })
  ])
});

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function number(value) { if (value === '' || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function dateOnly(value) { const v = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizeRestriction(value = {}) {
  return {
    entryNumber: text(value.entryNumber || value.entry_number), scopeDecision: text(value.scopeDecision || value.scope_decision).toLowerCase(),
    scopeRationale: text(value.scopeRationale || value.scope_rationale), legalLimit: number(value.legalLimit ?? value.legal_limit),
    limitUnit: text(value.limitUnit || value.limit_unit).toLowerCase(), measuredValue: number(value.measuredValue ?? value.measured_value),
    prohibitedWhen: text(value.prohibitedWhen || value.prohibited_when).toLowerCase(),
    testMethod: text(value.testMethod || value.test_method), exemptionClaimed: value.exemptionClaimed === true || value.exemption_claimed === true,
    exemptionRationale: text(value.exemptionRationale || value.exemption_rationale), evidenceDocumentIds: unique(array(value.evidenceDocumentIds || value.evidence_document_ids).map(text)).sort()
  };
}

function normalizeSubstance(value = {}) {
  return {
    substanceName: text(value.substanceName || value.substance_name), casNumber: text(value.casNumber || value.cas_number),
    ecNumber: text(value.ecNumber || value.ec_number), echaId: text(value.echaId || value.echa_id),
    candidateListStatus: text(value.candidateListStatus || value.candidate_list_status).toLowerCase(),
    candidateInclusionDate: dateOnly(value.candidateInclusionDate || value.candidate_inclusion_date),
    concentrationPercentWw: number(value.concentrationPercentWw ?? value.concentration_percent_ww),
    annualTonnage: number(value.annualTonnage ?? value.annual_tonnage), location: text(value.location),
    evidenceBasis: text(value.evidenceBasis || value.evidence_basis).toLowerCase(),
    detectionLimit: number(value.detectionLimit ?? value.detection_limit), detectionLimitUnit: text(value.detectionLimitUnit || value.detection_limit_unit).toLowerCase(),
    safeUseInstructions: array(value.safeUseInstructions || value.safe_use_instructions).map((item) => ({
      marketCode: code(item.marketCode || item.market_code), languageCode: text(item.languageCode || item.language_code),
      text: text(item.text), operatorApproved: item.operatorApproved === true || item.operator_approved === true
    })),
    article7Exemption: text(value.article7Exemption || value.article_7_exemption).toLowerCase(),
    article7ExemptionRationale: text(value.article7ExemptionRationale || value.article_7_exemption_rationale),
    evidenceDocumentIds: unique(array(value.evidenceDocumentIds || value.evidence_document_ids).map(text)).sort(),
    restrictionAssessments: array(value.restrictionAssessments || value.restriction_assessments).map(normalizeRestriction)
  };
}

function normalizeReachDossierInput(input = {}) {
  return {
    dossierReference: text(input.dossierReference || input.dossier_reference), assessmentDate: dateOnly(input.assessmentDate || input.assessment_date),
    productReference: text(input.productReference || input.product_reference), productName: text(input.productName || input.product_name),
    articleCategory: text(input.articleCategory || input.article_category), consumerArticle: input.consumerArticle === true || input.consumer_article === true,
    placedOnEuMarket: input.placedOnEuMarket === true || input.placed_on_eu_market === true,
    marketCodes: unique(array(input.marketCodes || input.market_codes).map(code)).sort(),
    euActorRole: text(input.euActorRole || input.eu_actor_role).toLowerCase(), articleLevelAssessmentConfirmed: input.articleLevelAssessmentConfirmed === true || input.article_level_assessment_confirmed === true,
    candidateListSnapshotDate: dateOnly(input.candidateListSnapshotDate || input.candidate_list_snapshot_date),
    candidateListEntryCount: number(input.candidateListEntryCount ?? input.candidate_list_entry_count),
    reachConsolidatedDate: dateOnly(input.reachConsolidatedDate || input.reach_consolidated_date),
    components: array(input.components).map((component) => ({
      componentReference: text(component.componentReference || component.component_reference), componentName: text(component.componentName || component.component_name),
      articleReference: text(component.articleReference || component.article_reference), homogeneousMaterialReference: text(component.homogeneousMaterialReference || component.homogeneous_material_reference),
      materialName: text(component.materialName || component.material_name), materialLocation: text(component.materialLocation || component.material_location),
      substances: array(component.substances).map(normalizeSubstance)
    })),
    supplierDeclarationEvidenceIds: unique(array(input.supplierDeclarationEvidenceIds || input.supplier_declaration_evidence_ids).map(text)).sort(),
    notes: text(input.notes)
  };
}

function finding(codeValue, severity, message, sourceArticle = null, path = null) { return { code: codeValue, severity, message, sourceArticle, path }; }

function evaluateReachDossier(input = {}, evidenceSnapshot = []) {
  const normalized = normalizeReachDossierInput(input);
  const findings = [];
  const obligations = [];
  const missingInputs = [];
  for (const [path, value] of [
    ['dossierReference', normalized.dossierReference], ['assessmentDate', normalized.assessmentDate],
    ['productReference', normalized.productReference], ['productName', normalized.productName], ['articleCategory', normalized.articleCategory],
    ['marketCodes', normalized.marketCodes.length], ['euActorRole', normalized.euActorRole], ['components', normalized.components.length]
  ]) if (!value) missingInputs.push(path);
  const euMarket = normalized.marketCodes.some((market) => EU_COUNTRY_CODES.has(market));
  if (!normalized.placedOnEuMarket || !euMarket) findings.push(finding('REACH_SCOPE_SPECIALIST_REVIEW', 'specialist',
    'The limited ruleset cannot confirm an EU article obligation without an EU market.', 'REACH Articles 3 and 33'));
  if (!normalized.articleLevelAssessmentConfirmed) findings.push(finding('ARTICLE_LEVEL_ASSESSMENT_REQUIRED', 'blocker',
    'SVHC concentration must be assessed for each article/component, not only the assembled product.', 'REACH Articles 7 and 33', 'components'));
  if (normalized.candidateListSnapshotDate !== RULESET.candidateListSnapshotDate
    || normalized.candidateListEntryCount !== RULESET.candidateListEntryCount
    || normalized.reachConsolidatedDate !== RULESET.reachConsolidatedDate) {
    findings.push(finding('CHEMICAL_SOURCE_VERSION_MISMATCH', 'blocker',
      `Use REACH ${RULESET.reachConsolidatedDate} and Candidate List ${RULESET.candidateListSnapshotDate} (${RULESET.candidateListEntryCount} entries).`, null, 'sourceVersions'));
  }
  if (!normalized.supplierDeclarationEvidenceIds.length) findings.push(finding('SUPPLIER_DECLARATION_REQUIRED', 'blocker',
    'At least one supplier declaration/SDS/laboratory evidence record is required.', null, 'supplierDeclarationEvidenceIds'));
  normalized.components.forEach((component, componentIndex) => {
    const basePath = `components[${componentIndex}]`;
    if (!component.componentReference || !component.componentName || !component.articleReference
      || !component.homogeneousMaterialReference || !component.materialName || !component.materialLocation) {
      findings.push(finding('ARTICLE_MATERIAL_IDENTITY_INCOMPLETE', 'blocker',
        'Each component needs article and homogeneous-material identity plus material location.', 'Annex XVII', basePath));
    }
    if (!component.substances.length) findings.push(finding('SUBSTANCE_SCREEN_REQUIRED', 'blocker',
      'Each homogeneous material needs at least one named screened substance or a documented negative screen.', null, `${basePath}.substances`));
    component.substances.forEach((substance, substanceIndex) => {
      const path = `${basePath}.substances[${substanceIndex}]`;
      if (!substance.substanceName || (!substance.casNumber && !substance.ecNumber && !substance.echaId)) {
        findings.push(finding('SUBSTANCE_IDENTITY_INCOMPLETE', 'blocker', 'A substance name and CAS, EC or ECHA identifier are required.', null, path));
      }
      if (!CANDIDATE_STATUSES.has(substance.candidateListStatus)) findings.push(finding('CANDIDATE_STATUS_REQUIRED', 'blocker',
        'Candidate List status must be included, not_included or unknown.', 'REACH Article 59', path));
      if (substance.candidateListStatus === 'unknown') findings.push(finding('CANDIDATE_STATUS_SPECIALIST_REVIEW', 'specialist',
        'Unknown Candidate List status requires current-list verification.', 'REACH Article 59', path));
      if (substance.concentrationPercentWw === null || substance.concentrationPercentWw < 0 || substance.concentrationPercentWw > 100) {
        findings.push(finding('CONCENTRATION_INVALID', 'blocker', 'Concentration must be 0–100 percent w/w for the assessed article.', 'REACH Articles 7 and 33', path));
      }
      if (!EVIDENCE_BASES.has(substance.evidenceBasis) || !substance.evidenceDocumentIds.length) findings.push(finding('SUBSTANCE_EVIDENCE_REQUIRED', 'blocker',
        'Each substance decision needs a declared evidence basis and evidence identifiers.', null, path));
      if (substance.evidenceBasis === 'laboratory_test' && (substance.detectionLimit === null || substance.detectionLimit < 0 || !substance.detectionLimitUnit)) {
        findings.push(finding('LAB_DETECTION_LIMIT_REQUIRED', 'blocker', 'Laboratory evidence needs a non-negative detection limit and unit.', null, path));
      }
      const aboveThreshold = substance.candidateListStatus === 'included'
        && substance.concentrationPercentWw !== null && substance.concentrationPercentWw > RULESET.article33ThresholdPercent;
      if (aboveThreshold) {
        obligations.push({ code: 'ARTICLE_33_COMMUNICATION_REQUIRED', componentReference: component.componentReference,
          substanceName: substance.substanceName, thresholdPercent: RULESET.article33ThresholdPercent });
        const safeUseMarkets = new Set(substance.safeUseInstructions.filter((item) => item.languageCode && item.text && item.operatorApproved).map((item) => item.marketCode));
        const missingMarkets = normalized.marketCodes.filter((market) => !safeUseMarkets.has(market));
        if (missingMarkets.length) findings.push(finding('SAFE_USE_INFORMATION_REQUIRED', 'blocker',
          `Operator-approved Article 33 safe-use information is missing for: ${missingMarkets.join(', ')}.`, 'REACH Article 33', path));
        obligations.push({ code: 'CONSUMER_RESPONSE_WITHIN_45_DAYS', componentReference: component.componentReference,
          substanceName: substance.substanceName, responseDays: RULESET.consumerResponseDays });
        obligations.push({ code: 'SCIP_NOTIFICATION_ASSESSMENT_REQUIRED', componentReference: component.componentReference,
          substanceName: substance.substanceName, legalBasis: 'Waste Framework Directive Article 9(1)(i)' });
        if (substance.annualTonnage === null || substance.annualTonnage < 0) findings.push(finding('ANNUAL_TONNAGE_REQUIRED', 'blocker',
          'Annual tonnage is required to assess REACH Article 7(2).', 'REACH Article 7(2)', path));
        else if (substance.annualTonnage > RULESET.article7AnnualTonnageThreshold) {
          obligations.push({ code: 'ARTICLE_7_NOTIFICATION_ASSESSMENT_REQUIRED', componentReference: component.componentReference,
            substanceName: substance.substanceName, annualTonnage: substance.annualTonnage });
          if (!['registered_for_use', 'exposure_excluded', 'none'].includes(substance.article7Exemption)
            || (substance.article7Exemption !== 'none' && !substance.article7ExemptionRationale)) {
            findings.push(finding('ARTICLE_7_EXEMPTION_DECISION_REQUIRED', 'blocker',
              'Record none or a supported Article 7 exemption decision.', 'REACH Article 7(3) and 7(6)', path));
          }
        }
      }
      if (!substance.restrictionAssessments.length) findings.push(finding('ANNEX_XVII_SCREEN_REQUIRED', 'specialist',
        'Record applicable/not-applicable assessments for relevant Annex XVII entries.', 'REACH Annex XVII', path));
      substance.restrictionAssessments.forEach((restriction, restrictionIndex) => {
        const restrictionPath = `${path}.restrictionAssessments[${restrictionIndex}]`;
        if (!restriction.entryNumber || !SCOPE_DECISIONS.has(restriction.scopeDecision) || !restriction.scopeRationale) {
          findings.push(finding('RESTRICTION_SCOPE_INCOMPLETE', 'blocker', 'Each restriction needs entry, scope decision and rationale.', 'REACH Annex XVII', restrictionPath));
        }
        if (restriction.scopeDecision === 'unknown') findings.push(finding('RESTRICTION_SCOPE_SPECIALIST_REVIEW', 'specialist',
          'Unknown Annex XVII scope requires chemical specialist review.', 'REACH Annex XVII', restrictionPath));
        if (restriction.scopeDecision === 'applies' && !restriction.exemptionClaimed) {
          if (restriction.legalLimit === null || restriction.legalLimit < 0 || !LIMIT_UNITS.has(restriction.limitUnit)
            || !LIMIT_COMPARATORS.has(restriction.prohibitedWhen)
            || restriction.measuredValue === null || restriction.measuredValue < 0 || !restriction.testMethod
            || !restriction.evidenceDocumentIds.length) findings.push(finding('RESTRICTION_RESULT_INCOMPLETE', 'blocker',
            'An applicable restriction needs limit/unit, measured result, method and evidence.', 'REACH Annex XVII', restrictionPath));
          else if ((restriction.prohibitedWhen === 'at_or_above_limit' && restriction.measuredValue >= restriction.legalLimit)
            || (restriction.prohibitedWhen === 'above_limit' && restriction.measuredValue > restriction.legalLimit)) findings.push(finding('ANNEX_XVII_LIMIT_REACHED_OR_EXCEEDED', 'blocker',
            `Measured ${restriction.measuredValue} ${restriction.limitUnit} reaches/exceeds limit ${restriction.legalLimit}.`, `REACH Annex XVII entry ${restriction.entryNumber}`, restrictionPath));
        }
        if (restriction.exemptionClaimed && !restriction.exemptionRationale) findings.push(finding('RESTRICTION_EXEMPTION_RATIONALE_REQUIRED', 'blocker',
          'A claimed Annex XVII exemption needs a product-specific rationale.', 'REACH Annex XVII', restrictionPath));
      });
    });
  });
  const evidenceIds = new Set(normalized.supplierDeclarationEvidenceIds);
  normalized.components.forEach((component) => component.substances.forEach((substance) => {
    substance.evidenceDocumentIds.forEach((id) => evidenceIds.add(id));
    substance.restrictionAssessments.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
  }));
  if (!evidenceIds.size || evidenceSnapshot.length !== evidenceIds.size) findings.push(finding('REACH_EVIDENCE_UNRESOLVED', 'blocker',
    'Every supplier, SDS, laboratory and restriction evidence id must resolve within the shipment.'));
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/.test(text(item.checksumSha256).toLowerCase()) || Number(item.fileSizeBytes || 0) <= 0)) {
    findings.push(finding('REACH_EVIDENCE_NOT_CONTROLLED', 'blocker', 'All REACH evidence must be locked, checksum identified and non-empty.'));
  }
  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker')
    ? 'needs_information' : findings.some((item) => item.severity === 'specialist')
      ? 'specialist_review_required' : 'ready_for_chemical_review';
  const sources = RULESET.sources.map((source) => ({ ...source }));
  const body = { schemaId: 'weavecarbon.reach-svhc-dossier', schemaVersion: '1.0.0', rulesetId: RULESET.id,
    rulesetVersion: RULESET.version, rulesetCoverage: RULESET.coverageStatus, sourceManifestSha256: sha256(sources),
    euMarket, automatedStatus, missingInputs: unique(missingInputs), findings, obligations, sources,
    disclaimer: 'Internal, limited REACH/SVHC control only; not legal advice, a generic REACH certificate, an ECHA submission or proof of compliance.' };
  return { input: normalized, inputSha256: sha256(normalized), result: { ...body, resultSha256: sha256(body) } };
}

function deriveReachReleaseStatus(dossier, currentEvidence = []) {
  const result = dossier.result || dossier.result_snapshot || {};
  const review = dossier.latestReview || dossier.latest_review || null;
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (result.automatedStatus === 'specialist_review_required') return { status: 'specialist_review_required', staleEvidenceIds: [] };
  if (!review) return { status: 'chemical_review_required', staleEvidenceIds: [] };
  if (review.decision !== 'approved_for_internal_release') return { status: review.decision, staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const staleEvidenceIds = array(review.evidenceSnapshot || review.evidence_snapshot).filter((item) => {
    const current = byId.get(item.id);
    return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256 || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0);
  }).map((item) => item.id);
  return staleEvidenceIds.length ? { status: 'evidence_review_required', staleEvidenceIds }
    : { status: 'approved_for_internal_release', staleEvidenceIds: [] };
}

module.exports = { RULESET, normalizeReachDossierInput, evaluateReachDossier, deriveReachReleaseStatus, sha256 };
