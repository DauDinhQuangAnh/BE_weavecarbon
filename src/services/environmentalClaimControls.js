const crypto = require('crypto');

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const CHANNELS = new Set(['website', 'product_label', 'marketplace', 'advertising', 'sales_material', 'report', 'other']);
const SUBJECT_TYPES = new Set(['product', 'sku', 'batch', 'shipment', 'brand', 'company']);
const CLAIM_KINDS = new Set([
  'generic_environmental', 'specific_environmental', 'comparative', 'future_performance',
  'sustainability_label', 'offset_based_product_climate', 'legal_requirement_feature', 'other'
]);

const RULESET = Object.freeze({
  id: 'weavecarbon.eu-environmental-claim-register',
  version: 'R18-EU-CLAIMS-2026.09.1',
  coverageStatus: 'limited',
  appliesFrom: '2026-09-27',
  sources: Object.freeze([
    Object.freeze({
      id: 'EU-2024-825',
      title: 'Directive (EU) 2024/825 — empowering consumers for the green transition',
      url: 'https://eur-lex.europa.eu/eli/dir/2024/825/oj',
      version: 'original-2024-03-06',
      appliesFrom: '2026-09-27'
    }),
    Object.freeze({
      id: 'EU-2005-29-2026',
      title: 'Directive 2005/29/EC — consolidated unfair commercial practices rules',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02005L0029-20260927',
      version: 'consolidated-2026-09-27',
      appliesFrom: '2026-09-27'
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
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized : null;
}
function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function normalizeClaimInput(input = {}) {
  const methodology = object(input.methodology);
  const comparison = object(input.comparison);
  const futureCommitment = object(input.futureCommitment || input.future_commitment);
  const labelScheme = object(input.labelScheme || input.label_scheme);
  return {
    claimReference: text(input.claimReference || input.claim_reference),
    exactClaimText: text(input.exactClaimText || input.exact_claim_text),
    publicCommunication: input.publicCommunication === true || input.public_communication === true,
    channel: text(input.channel).toLowerCase(),
    marketCodes: unique(array(input.marketCodes || input.market_codes).map(code)).sort(),
    languageCode: text(input.languageCode || input.language_code),
    communicationStart: dateOnly(input.communicationStart || input.communication_start),
    communicationEnd: dateOnly(input.communicationEnd || input.communication_end),
    subjectType: text(input.subjectType || input.subject_type).toLowerCase(),
    subjectReference: text(input.subjectReference || input.subject_reference),
    scopeStatement: text(input.scopeStatement || input.scope_statement),
    claimKind: text(input.claimKind || input.claim_kind).toLowerCase(),
    specificationText: text(input.specificationText || input.specification_text),
    claimScopeMode: text(input.claimScopeMode || input.claim_scope_mode).toLowerCase(),
    actualCoverage: text(input.actualCoverage || input.actual_coverage).toLowerCase(),
    recognizedExcellentPerformance: input.recognizedExcellentPerformance === true
      || input.recognized_excellent_performance === true,
    methodology: {
      standard: text(methodology.standard), version: text(methodology.version),
      pcr: text(methodology.pcr), calculationSha256: text(methodology.calculationSha256 || methodology.calculation_sha256).toLowerCase(),
      datasetReferences: unique(array(methodology.datasetReferences || methodology.dataset_references).map(text)),
      factorReferences: unique(array(methodology.factorReferences || methodology.factor_references).map(text))
    },
    comparison: {
      baseline: text(comparison.baseline), comparator: text(comparison.comparator),
      sameMethodAndScope: comparison.sameMethodAndScope === true || comparison.same_method_and_scope === true
    },
    futureCommitment: {
      implementationPlanUrl: text(futureCommitment.implementationPlanUrl || futureCommitment.implementation_plan_url),
      milestones: unique(array(futureCommitment.milestones).map(text)),
      independentMonitoring: futureCommitment.independentMonitoring === true
        || futureCommitment.independent_monitoring === true
    },
    labelScheme: {
      schemeType: text(labelScheme.schemeType || labelScheme.scheme_type).toLowerCase(),
      schemeName: text(labelScheme.schemeName || labelScheme.scheme_name),
      publicCriteriaUrl: text(labelScheme.publicCriteriaUrl || labelScheme.public_criteria_url)
    },
    limitations: unique(array(input.limitations).map(text)),
    exclusions: unique(array(input.exclusions).map(text)),
    uncertaintyStatement: text(input.uncertaintyStatement || input.uncertainty_statement),
    qualifiers: unique(array(input.qualifiers).map(text)),
    updateTriggers: unique(array(input.updateTriggers || input.update_triggers).map(text)),
    withdrawalTriggers: unique(array(input.withdrawalTriggers || input.withdrawal_triggers).map(text)),
    assuranceReference: text(input.assuranceReference || input.assurance_reference),
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    notes: text(input.notes)
  };
}

function finding(codeValue, severity, message, sourceId = null) {
  return { code: codeValue, severity, message, sourceId };
}

function evaluateEnvironmentalClaim(input = {}, evidenceSnapshot = []) {
  const normalized = normalizeClaimInput(input);
  const findings = [];
  const missingInputs = [];
  const required = [
    ['claimReference', normalized.claimReference], ['exactClaimText', normalized.exactClaimText],
    ['channel', CHANNELS.has(normalized.channel)], ['marketCodes', normalized.marketCodes.length > 0],
    ['languageCode', normalized.languageCode], ['communicationStart', normalized.communicationStart],
    ['subjectType', SUBJECT_TYPES.has(normalized.subjectType)], ['subjectReference', normalized.subjectReference],
    ['scopeStatement', normalized.scopeStatement], ['claimKind', CLAIM_KINDS.has(normalized.claimKind)]
  ];
  required.forEach(([field, present]) => { if (!present) missingInputs.push(field); });
  if (normalized.communicationEnd && normalized.communicationStart
    && normalized.communicationEnd < normalized.communicationStart) {
    missingInputs.push('communicationEnd');
  }

  const euConsumerClaim = normalized.publicCommunication
    && normalized.marketCodes.some((market) => EU_COUNTRY_CODES.has(market));
  const amendedRulesApply = euConsumerClaim
    && normalized.communicationStart >= RULESET.appliesFrom;

  if (amendedRulesApply && normalized.claimKind === 'generic_environmental'
    && !normalized.recognizedExcellentPerformance) {
    findings.push(finding('GENERIC_CLAIM_RECOGNISED_PERFORMANCE_REQUIRED', 'prohibited',
      'A generic environmental claim requires recognised excellent environmental performance relevant to the claim.', 'EU-2005-29-2026'));
  }
  if (amendedRulesApply && normalized.claimScopeMode === 'entire_subject'
    && normalized.actualCoverage === 'aspect_only') {
    findings.push(finding('WHOLE_SUBJECT_ASPECT_ONLY', 'prohibited',
      'The claim covers the whole subject although the recorded substantiation covers only one aspect.', 'EU-2005-29-2026'));
  }
  if (amendedRulesApply && normalized.claimKind === 'offset_based_product_climate') {
    findings.push(finding('OFFSET_BASED_PRODUCT_CLIMATE_CLAIM', 'prohibited',
      'A product climate-impact claim based on greenhouse-gas offsetting is not eligible for publication.', 'EU-2005-29-2026'));
  }
  if (amendedRulesApply && normalized.claimKind === 'sustainability_label'
    && !['certification_scheme', 'public_authority'].includes(normalized.labelScheme.schemeType)) {
    findings.push(finding('SUSTAINABILITY_LABEL_SCHEME_REQUIRED', 'prohibited',
      'The sustainability label is not recorded as a qualifying certification scheme or public-authority label.', 'EU-2005-29-2026'));
  }
  if (normalized.claimKind === 'sustainability_label'
    && (!normalized.labelScheme.schemeName || !/^https:\/\//i.test(normalized.labelScheme.publicCriteriaUrl))) {
    findings.push(finding('SUSTAINABILITY_LABEL_DETAILS_INCOMPLETE', 'blocker',
      'The label scheme name and public HTTPS criteria are required for review.'));
  }
  if (amendedRulesApply && normalized.claimKind === 'legal_requirement_feature') {
    findings.push(finding('LEGAL_REQUIREMENT_AS_DISTINCTIVE_FEATURE', 'prohibited',
      'A requirement imposed by law on the product category cannot be presented as a distinctive feature.', 'EU-2005-29-2026'));
  }

  if (normalized.claimKind === 'comparative'
    && (!normalized.comparison.baseline || !normalized.comparison.comparator
      || !normalized.comparison.sameMethodAndScope)) {
    findings.push(finding('COMPARISON_BASIS_INCOMPLETE', 'blocker',
      'Comparative claims require a named baseline, comparator and confirmation of consistent method and scope.'));
  }
  if (normalized.claimKind === 'future_performance'
    && (!/^https:\/\//i.test(normalized.futureCommitment.implementationPlanUrl)
      || !normalized.futureCommitment.milestones.length
      || !normalized.futureCommitment.independentMonitoring)) {
    findings.push(finding('FUTURE_COMMITMENT_PLAN_INCOMPLETE', 'blocker',
      'Future-performance claims require a public implementation plan, measurable milestones and independent monitoring.', 'EU-2024-825'));
  }
  if (normalized.publicCommunication && !normalized.specificationText) {
    findings.push(finding('VISIBLE_SPECIFICATION_REQUIRED', 'blocker',
      'A clear and prominent specification must accompany a public environmental claim on the same medium.'));
  }
  if (normalized.publicCommunication
    && (!normalized.methodology.standard || !normalized.methodology.version
      || !/^[a-f0-9]{64}$/.test(normalized.methodology.calculationSha256)
      || !normalized.methodology.datasetReferences.length)) {
    findings.push(finding('SUBSTANTIATION_METHOD_INCOMPLETE', 'blocker',
      'Public claims require a versioned method, calculation hash and dataset references.'));
  }
  if (normalized.publicCommunication && evidenceSnapshot.length === 0) {
    findings.push(finding('CLAIM_EVIDENCE_REQUIRED', 'blocker',
      'At least one locked, checksum-bound evidence document is required for a public claim.'));
  }
  if (normalized.publicCommunication && evidenceSnapshot.some((item) =>
    !['locked', 'third_party_verified'].includes(item.status)
      || !/^[a-f0-9]{64}$/.test(text(item.checksumSha256).toLowerCase())
      || Number(item.fileSizeBytes || 0) <= 0
      || (item.validTo && normalized.communicationStart && item.validTo < normalized.communicationStart)
  )) {
    findings.push(finding('CLAIM_EVIDENCE_NOT_CONTROLLED', 'blocker',
      'Every public-claim evidence record must be locked, checksum-identified, non-empty and valid when communication starts.'));
  }
  if (normalized.publicCommunication
    && (!normalized.uncertaintyStatement || !normalized.updateTriggers.length
      || !normalized.withdrawalTriggers.length)) {
    findings.push(finding('LIMITS_AND_LIFECYCLE_INCOMPLETE', 'blocker',
      'Uncertainty plus update and withdrawal triggers are required before legal review.'));
  }
  if (euConsumerClaim && normalized.communicationStart < RULESET.appliesFrom) {
    findings.push(finding('PRE_APPLICATION_DATE_REVIEW', 'warning',
      'The communication starts before 27 September 2026; current national law still requires review and this ruleset must not be treated as complete.', 'EU-2024-825'));
  }

  const automatedStatus = findings.some((item) => item.severity === 'prohibited')
    ? 'blocked_prohibited'
    : missingInputs.length || findings.some((item) => item.severity === 'blocker')
      ? 'needs_information'
      : normalized.publicCommunication ? 'ready_for_legal_review' : 'internal_draft';
  const sources = RULESET.sources.map((source) => ({ ...source }));
  const sourceManifestSha256 = sha256(sources);
  const inputSha256 = sha256(normalized);
  const body = {
    schemaId: 'weavecarbon.environmental-claim-dossier', schemaVersion: '1.0.0',
    rulesetId: RULESET.id, rulesetVersion: RULESET.version,
    rulesetCoverage: RULESET.coverageStatus, sourceManifestSha256,
    amendedRulesApply, euConsumerClaim, automatedStatus,
    missingInputs: unique(missingInputs), findings, sources,
    disclaimer: 'Internal claim-control dossier only; not legal advice, regulator approval, certification or permission to publish.'
  };
  return { input: normalized, inputSha256, result: { ...body, resultSha256: sha256(body) } };
}

function derivePublicationStatus(dossier, currentEvidence = [], asOf = new Date().toISOString().slice(0, 10)) {
  const result = dossier.result || dossier.result_snapshot || {};
  const input = dossier.input || dossier.input_snapshot || {};
  const review = dossier.latestReview || dossier.latest_review || null;
  if (result.automatedStatus === 'blocked_prohibited') return { status: 'blocked_prohibited', staleEvidenceIds: [] };
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (!input.publicCommunication) return { status: 'internal_draft', staleEvidenceIds: [] };
  if (!review) return { status: 'legal_review_required', staleEvidenceIds: [] };
  if (review.decision === 'withdrawn') return { status: 'withdrawn', staleEvidenceIds: [] };
  if (review.decision === 'rejected') return { status: 'rejected', staleEvidenceIds: [] };
  if (review.decision === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const snapshot = array(review.evidenceSnapshot || review.evidence_snapshot);
  const staleEvidenceIds = snapshot.filter((item) => {
    const current = byId.get(item.id);
    return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256
      || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0)
      || (current.validTo || null) !== (item.validTo || null)
      || (current.validTo && current.validTo < asOf);
  }).map((item) => item.id);
  if (staleEvidenceIds.length) return { status: 'evidence_review_required', staleEvidenceIds };
  if (input.communicationEnd && input.communicationEnd < asOf) return { status: 'expired', staleEvidenceIds: [] };
  if (input.communicationStart && input.communicationStart > asOf) return { status: 'approved_scheduled', staleEvidenceIds: [] };
  return { status: 'approved_current', staleEvidenceIds: [] };
}

module.exports = {
  RULESET, CLAIM_KINDS, CHANNELS, SUBJECT_TYPES,
  normalizeClaimInput, evaluateEnvironmentalClaim, derivePublicationStatus, sha256
};
