const crypto = require('crypto');

const RULESET = Object.freeze({
  id: 'weavecarbon.product-carbon-footprint-study',
  version: 'R12-PCF-ISO14067-2024CONFIRMED-1',
  coverageStatus: 'limited',
  iso14067Edition: 'ISO 14067:2018',
  iso14067ReviewStatus: 'confirmed-2024-revision-in-development',
  sources: Object.freeze([
    Object.freeze({ id: 'ISO-14067-2018', title: 'ISO 14067:2018 - Carbon footprint of products',
      url: 'https://www.iso.org/standard/71206.html', version: '2018-confirmed-2024' }),
    Object.freeze({ id: 'ISO-14040-2006', title: 'ISO 14040:2006 - LCA principles and framework',
      url: 'https://www.iso.org/standard/37456.html', version: '2006-amended-2020-confirmed-2022' }),
    Object.freeze({ id: 'GHGP-PRODUCT-2011', title: 'GHG Protocol Product Life Cycle Accounting and Reporting Standard',
      url: 'https://ghgprotocol.org/product-standard', version: '2011-current-update-in-development' })
  ])
});

function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function number(value) { if (value === '' || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function dateOnly(value) { const v = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizePcfStudyInput(input = {}) {
  const pcr = input.pcr || {};
  const allocation = input.allocation || {};
  const recycling = input.recyclingModel || input.recycling_model || {};
  const uncertainty = input.uncertaintyAssessment || input.uncertainty_assessment || {};
  return {
    studyReference: text(input.studyReference || input.study_reference),
    studyDate: dateOnly(input.studyDate || input.study_date),
    calculationSnapshotId: text(input.calculationSnapshotId || input.calculation_snapshot_id),
    productReference: text(input.productReference || input.product_reference),
    productName: text(input.productName || input.product_name),
    reportingPeriodStart: dateOnly(input.reportingPeriodStart || input.reporting_period_start),
    reportingPeriodEnd: dateOnly(input.reportingPeriodEnd || input.reporting_period_end),
    intendedApplication: text(input.intendedApplication || input.intended_application),
    intendedAudience: text(input.intendedAudience || input.intended_audience),
    comparativeAssertion: input.comparativeAssertion === true || input.comparative_assertion === true,
    functionalUnit: {
      quantity: number(input.functionalUnit?.quantity ?? input.functional_unit?.quantity),
      unit: text(input.functionalUnit?.unit || input.functional_unit?.unit),
      description: text(input.functionalUnit?.description || input.functional_unit?.description)
    },
    referenceFlow: {
      amount: number(input.referenceFlow?.amount ?? input.reference_flow?.amount),
      unit: text(input.referenceFlow?.unit || input.reference_flow?.unit),
      basis: text(input.referenceFlow?.basis || input.reference_flow?.basis)
    },
    boundaryType: text(input.boundaryType || input.boundary_type).toLowerCase(),
    includedStages: unique(array(input.includedStages || input.included_stages).map((item) => text(item).toLowerCase())).sort(),
    processMap: array(input.processMap || input.process_map).map((item) => ({
      processReference: text(item.processReference || item.process_reference),
      processName: text(item.processName || item.process_name),
      stage: text(item.stage).toLowerCase(), included: item.included === true,
      dataSource: text(item.dataSource || item.data_source), evidenceDocumentIds: unique(array(item.evidenceDocumentIds || item.evidence_document_ids).map(text)).sort()
    })),
    excludedProcesses: array(input.excludedProcesses || input.excluded_processes).map((item) => ({
      processName: text(item.processName || item.process_name), rationale: text(item.rationale),
      estimatedImpactPercent: number(item.estimatedImpactPercent ?? item.estimated_impact_percent)
    })),
    cutoff: {
      massPercent: number(input.cutoff?.massPercent ?? input.cutoff?.mass_percent),
      energyPercent: number(input.cutoff?.energyPercent ?? input.cutoff?.energy_percent),
      environmentalSignificanceApplied: input.cutoff?.environmentalSignificanceApplied === true || input.cutoff?.environmental_significance_applied === true,
      rationale: text(input.cutoff?.rationale)
    },
    pcr: {
      status: text(pcr.status).toLowerCase(), name: text(pcr.name), publisher: text(pcr.publisher),
      version: text(pcr.version), validFrom: dateOnly(pcr.validFrom || pcr.valid_from), validTo: dateOnly(pcr.validTo || pcr.valid_to),
      rationale: text(pcr.rationale)
    },
    allocation: {
      required: allocation.required === true, method: text(allocation.method).toLowerCase(),
      rationale: text(allocation.rationale), hierarchyJustification: text(allocation.hierarchyJustification || allocation.hierarchy_justification),
      sensitivityPerformed: allocation.sensitivityPerformed === true || allocation.sensitivity_performed === true,
      sensitivitySummary: text(allocation.sensitivitySummary || allocation.sensitivity_summary)
    },
    recyclingModel: { method: text(recycling.method).toLowerCase(), rationale: text(recycling.rationale) },
    dataQualityAssessment: text(input.dataQualityAssessment || input.data_quality_assessment),
    dataImprovementPlan: text(input.dataImprovementPlan || input.data_improvement_plan),
    uncertaintyAssessment: {
      method: text(uncertainty.method).toLowerCase(), parameter: text(uncertainty.parameter),
      scenario: text(uncertainty.scenario), model: text(uncertainty.model),
      sensitivityScenarios: unique(array(uncertainty.sensitivityScenarios || uncertainty.sensitivity_scenarios).map(text))
    },
    landUseChangeMethod: text(input.landUseChangeMethod || input.land_use_change_method),
    biogenicCarbonTreatment: text(input.biogenicCarbonTreatment || input.biogenic_carbon_treatment),
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    externalAssuranceRecordId: text(input.externalAssuranceRecordId || input.external_assurance_record_id) || null,
    limitations: text(input.limitations), notes: text(input.notes)
  };
}

function finding(code, severity, message, path = null) { return { code, severity, message, path }; }

function evaluatePcfStudy(input = {}, calculationSnapshot = {}, evidenceSnapshot = [], assuranceRecord = null) {
  const normalized = normalizePcfStudyInput(input);
  const result = calculationSnapshot.payload?.carbonResults || {};
  const findings = [];
  const missingInputs = [];
  const required = [
    ['studyReference', normalized.studyReference], ['studyDate', normalized.studyDate],
    ['calculationSnapshotId', normalized.calculationSnapshotId], ['productReference', normalized.productReference],
    ['productName', normalized.productName], ['reportingPeriodStart', normalized.reportingPeriodStart],
    ['reportingPeriodEnd', normalized.reportingPeriodEnd], ['intendedApplication', normalized.intendedApplication],
    ['intendedAudience', normalized.intendedAudience], ['functionalUnit.quantity', normalized.functionalUnit.quantity],
    ['functionalUnit.unit', normalized.functionalUnit.unit], ['functionalUnit.description', normalized.functionalUnit.description],
    ['referenceFlow.amount', normalized.referenceFlow.amount], ['referenceFlow.unit', normalized.referenceFlow.unit],
    ['referenceFlow.basis', normalized.referenceFlow.basis], ['boundaryType', normalized.boundaryType],
    ['includedStages', normalized.includedStages.length], ['processMap', normalized.processMap.length],
    ['dataQualityAssessment', normalized.dataQualityAssessment], ['dataImprovementPlan', normalized.dataImprovementPlan],
    ['limitations', normalized.limitations]
  ];
  required.forEach(([path, value]) => { if (!value) missingInputs.push(path); });
  if (normalized.reportingPeriodStart && normalized.reportingPeriodEnd
    && normalized.reportingPeriodEnd < normalized.reportingPeriodStart) {
    findings.push(finding('PCF_PERIOD_INVALID', 'blocker', 'Reporting period end must be on or after its start.', 'reportingPeriodEnd'));
  }
  if (normalized.functionalUnit.quantity === null || normalized.functionalUnit.quantity <= 0
    || normalized.referenceFlow.amount === null || normalized.referenceFlow.amount <= 0) {
    findings.push(finding('PCF_UNIT_FLOW_INVALID', 'blocker', 'Functional unit and reference flow must be positive and explicit.', 'functionalUnit'));
  }
  if (!calculationSnapshot.id || calculationSnapshot.id !== normalized.calculationSnapshotId
    || calculationSnapshot.is_legacy || !calculationSnapshot.finalized_at) {
    findings.push(finding('PCF_FINALIZED_SNAPSHOT_REQUIRED', 'blocker', 'Select a non-legacy finalized authoritative calculation snapshot.', 'calculationSnapshotId'));
  }
  if (!/^[a-f0-9]{64}$/i.test(text(calculationSnapshot.canonical_input_hash))
    || !text(calculationSnapshot.engine_version) || !text(calculationSnapshot.methodology_version)
    || !text(calculationSnapshot.factor_registry_version) || !text(calculationSnapshot.gwp_basis)) {
    findings.push(finding('PCF_PROVENANCE_INCOMPLETE', 'blocker', 'Calculation engine, method, factor registry, GWP basis and canonical input hash are required.', 'calculationSnapshotId'));
  }
  const terms = array(result.calculationTerms);
  const factors = array(calculationSnapshot.factor_snapshot);
  const reportedTotal = number(result.reportedTotalKgCO2e ?? result.perProduct?.total);
  const reproducedTotal = Number(terms.reduce((sum, term) => sum + (number(term.kgCo2e) || 0), 0).toFixed(3));
  if (!terms.length || !factors.length || reportedTotal === null || Math.abs(reproducedTotal - reportedTotal) > 0.001) {
    findings.push(finding('PCF_CALCULATION_NOT_REPRODUCIBLE', 'blocker', 'Stored AD x EF contribution terms must reproduce the reported product total.', 'calculationSnapshotId'));
  }
  const resultStages = array(result.boundary?.includedStages).map((item) => text(item).toLowerCase()).sort();
  if (!normalized.includedStages.length || normalized.includedStages.some((stage) => !resultStages.includes(stage))) {
    findings.push(finding('PCF_BOUNDARY_MISMATCH', 'blocker', 'Study stages must match the stages present in the calculation snapshot.', 'includedStages'));
  }
  normalized.processMap.forEach((process, index) => {
    if (!process.processReference || !process.processName || !process.stage || !process.dataSource) {
      findings.push(finding('PCF_PROCESS_MAP_INCOMPLETE', 'blocker', 'Every process-map row needs identity, stage and data source.', `processMap[${index}]`));
    }
    if (process.included && !process.evidenceDocumentIds.length) {
      findings.push(finding('PCF_PROCESS_EVIDENCE_REQUIRED', 'blocker', 'Every included process needs source evidence.', `processMap[${index}].evidenceDocumentIds`));
    }
  });
  normalized.excludedProcesses.forEach((process, index) => {
    if (!process.processName || !process.rationale || process.estimatedImpactPercent === null || process.estimatedImpactPercent < 0) {
      findings.push(finding('PCF_EXCLUSION_INCOMPLETE', 'blocker', 'Every exclusion needs a rationale and estimated climate significance.', `excludedProcesses[${index}]`));
    }
  });
  if (normalized.cutoff.massPercent === null || normalized.cutoff.energyPercent === null
    || normalized.cutoff.massPercent < 0 || normalized.cutoff.energyPercent < 0
    || !normalized.cutoff.environmentalSignificanceApplied || !normalized.cutoff.rationale) {
    findings.push(finding('PCF_CUTOFF_CRITERIA_INCOMPLETE', 'blocker', 'Record mass, energy and environmental-significance cutoff criteria and rationale.', 'cutoff'));
  }
  if (!['applicable', 'not_identified', 'not_applicable'].includes(normalized.pcr.status) || !normalized.pcr.rationale) {
    findings.push(finding('PCF_PCR_DECISION_REQUIRED', 'blocker', 'Record whether a current PCR applies and explain the decision.', 'pcr'));
  } else if (normalized.pcr.status === 'applicable' && (!normalized.pcr.name || !normalized.pcr.publisher || !normalized.pcr.version
    || !normalized.pcr.validFrom || !normalized.pcr.validTo || normalized.pcr.validTo < normalized.studyDate)) {
    findings.push(finding('PCF_PCR_INVALID', 'blocker', 'An applicable PCR needs publisher, version and validity covering the study date.', 'pcr'));
  } else if (normalized.pcr.status === 'not_identified') {
    findings.push(finding('PCF_PCR_SPECIALIST_REVIEW', 'specialist', 'A practitioner must confirm that no applicable PCR was identified.', 'pcr'));
  }
  if (normalized.allocation.required && (!['physical', 'economic', 'mass', 'energy', 'other'].includes(normalized.allocation.method)
    || !normalized.allocation.rationale || !normalized.allocation.hierarchyJustification
    || !normalized.allocation.sensitivityPerformed || !normalized.allocation.sensitivitySummary)) {
    findings.push(finding('PCF_ALLOCATION_INCOMPLETE', 'blocker', 'Required allocation needs method, hierarchy justification and sensitivity result.', 'allocation'));
  }
  if (!normalized.recyclingModel.method || !normalized.recyclingModel.rationale) {
    findings.push(finding('PCF_RECYCLING_MODEL_REQUIRED', 'blocker', 'Record the recycling model and rationale, including when recycling is out of scope.', 'recyclingModel'));
  }
  if (!['qualitative', 'rss_fallback', 'monte_carlo'].includes(normalized.uncertaintyAssessment.method)
    || !normalized.uncertaintyAssessment.parameter || !normalized.uncertaintyAssessment.scenario
    || !normalized.uncertaintyAssessment.model || !normalized.uncertaintyAssessment.sensitivityScenarios.length) {
    findings.push(finding('PCF_UNCERTAINTY_INCOMPLETE', 'blocker', 'Uncertainty needs method, parameter/scenario/model descriptions and sensitivity scenarios.', 'uncertaintyAssessment'));
  }
  if (!normalized.landUseChangeMethod || !normalized.biogenicCarbonTreatment) {
    findings.push(finding('PCF_GHG_CATEGORY_TREATMENT_REQUIRED', 'blocker', 'Land-use-change and biogenic-carbon treatment must be explicit.', 'landUseChangeMethod'));
  }
  if (normalized.comparativeAssertion && !assuranceRecord) {
    findings.push(finding('PCF_COMPARATIVE_ASSERTION_BLOCKED', 'blocker', 'Do not release a public comparative assertion without an applicable critical review/assurance record.', 'comparativeAssertion'));
  }
  if (normalized.externalAssuranceRecordId && (!assuranceRecord
    || !['limited_assurance', 'reasonable_assurance'].includes(assuranceRecord.outcome))) {
    findings.push(finding('PCF_ASSURANCE_INVALID', 'blocker', 'Verified language requires a current limited/reasonable assurance record tied to this calculation.', 'externalAssuranceRecordId'));
  }
  const evidenceIds = new Set(normalized.evidenceDocumentIds);
  normalized.processMap.forEach((process) => process.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
  if (!evidenceIds.size || evidenceSnapshot.length !== evidenceIds.size) {
    findings.push(finding('PCF_EVIDENCE_UNRESOLVED', 'blocker', 'Every study and process evidence id must resolve inside the shipment.', 'evidenceDocumentIds'));
  }
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/i.test(text(item.checksumSha256)) || Number(item.fileSizeBytes || 0) <= 0)) {
    findings.push(finding('PCF_EVIDENCE_NOT_CONTROLLED', 'blocker', 'All PCF evidence must be locked, checksum identified and non-empty.', 'evidenceDocumentIds'));
  }
  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker')
    ? 'needs_information' : 'practitioner_review_required';
  const sources = RULESET.sources.map((source) => ({ ...source }));
  const body = {
    schemaId: 'weavecarbon.pcf-study', schemaVersion: '1.0.0', rulesetId: RULESET.id,
    rulesetVersion: RULESET.version, rulesetCoverage: RULESET.coverageStatus,
    sourceManifestSha256: sha256(sources), automatedStatus, missingInputs: unique(missingInputs), findings, sources,
    calculation: {
      snapshotId: calculationSnapshot.id || null, snapshotVersion: Number(calculationSnapshot.version || 0),
      canonicalInputHash: calculationSnapshot.canonical_input_hash || null,
      engineVersion: calculationSnapshot.engine_version || null, methodologyVersion: calculationSnapshot.methodology_version || null,
      factorRegistryVersion: calculationSnapshot.factor_registry_version || null, gwpBasis: calculationSnapshot.gwp_basis || null,
      contributionTermCount: terms.length, factorCount: factors.length, reportedTotalKgCO2e: reportedTotal,
      reproducedTotalKgCO2e: terms.length ? reproducedTotal : null,
      gwpBreakdown: result.gwpBreakdown || null, quality: result.quality || null, uncertainty: result.uncertainty || null
    },
    assurance: assuranceRecord ? { id: assuranceRecord.id, outcome: assuranceRecord.outcome,
      providerName: assuranceRecord.provider_name, statementDate: assuranceRecord.statement_date || null } : null,
    claimStatus: assuranceRecord && ['limited_assurance', 'reasonable_assurance'].includes(assuranceRecord.outcome)
      ? 'assurance_record_linked' : 'not_independently_verified',
    disclaimer: 'Internal limited partial CFP study support. Not ISO certification, a comparative claim, an EPD, PEF result or independent assurance.'
  };
  return { input: normalized, inputSha256: sha256(normalized), result: { ...body, resultSha256: sha256(body) } };
}

function derivePcfStudyStatus(study, currentEvidence = [], latestCalculationSnapshotId = null) {
  const result = study.result || study.result_snapshot || {};
  const review = study.latestReview || study.latest_review || null;
  if (latestCalculationSnapshotId && result.calculation?.snapshotId !== latestCalculationSnapshotId) {
    return { status: 'calculation_superseded', staleEvidenceIds: [] };
  }
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (!review) return { status: 'practitioner_review_required', staleEvidenceIds: [] };
  if (review.decision !== 'approved_for_internal_report') return { status: review.decision, staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const staleEvidenceIds = array(review.evidenceSnapshot || review.evidence_snapshot).filter((item) => {
    const current = byId.get(item.id);
    return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256 || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0);
  }).map((item) => item.id);
  return staleEvidenceIds.length ? { status: 'evidence_review_required', staleEvidenceIds }
    : { status: 'approved_for_internal_report', staleEvidenceIds: [] };
}

module.exports = { RULESET, normalizePcfStudyInput, evaluatePcfStudy, derivePcfStudyStatus, sha256 };
