const crypto = require('crypto');

const SCOPE1_CATEGORIES = Object.freeze(['stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions']);
const SCOPE2_CATEGORIES = Object.freeze(['purchased_electricity', 'purchased_steam', 'purchased_heat', 'purchased_cooling']);
const GASES = Object.freeze(['CO2', 'CH4', 'N2O', 'HFCs', 'PFCs', 'SF6', 'NF3']);

const RULESET = Object.freeze({
  id: 'weavecarbon.corporate-ghg-inventory',
  version: 'R13-GHGP-2004-S2-2015-ISO14064-1-2018-1',
  coverageStatus: 'limited',
  standardsStatus: 'existing-ghgp-guidance-effective-joint-iso-update-due-2028',
  sources: Object.freeze([
    Object.freeze({ id: 'GHGP-CORPORATE-2004', title: 'GHG Protocol Corporate Accounting and Reporting Standard',
      url: 'https://ghgprotocol.org/corporate-standard', version: 'revised-edition-2004-current' }),
    Object.freeze({ id: 'GHGP-SCOPE2-2015', title: 'GHG Protocol Scope 2 Guidance',
      url: 'https://ghgprotocol.org/scope-2-guidance', version: '2015-current' }),
    Object.freeze({ id: 'ISO-14064-1-2018', title: 'ISO 14064-1:2018 - Organization-level GHG inventories',
      url: 'https://www.iso.org/standard/66453.html', version: '2018-to-be-revised' }),
    Object.freeze({ id: 'GHGP-UPDATE-2026', title: 'GHG Protocol corporate suite update process',
      url: 'https://ghgprotocol.org/ghg-protocol-corporate-suite-standards-and-guidance-update-process', version: '2026-07-29' })
  ])
});

function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function number(value) { if (value === '' || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function bool(value) { return value === true; }
function dateOnly(value) { const v = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizeDecision(item = {}) {
  return { category: text(item.category).toLowerCase(), status: text(item.status).toLowerCase(), rationale: text(item.rationale) };
}

function normalizeCorporateGhgInput(input = {}) {
  const boundary = input.organizationalBoundary || input.organizational_boundary || {};
  const operations = input.operationalBoundary || input.operational_boundary || {};
  const baseYear = input.baseYear || input.base_year || {};
  const scope2 = input.scope2Accounting || input.scope2_accounting || {};
  const assurance = input.assurance || {};
  return {
    inventoryReference: text(input.inventoryReference || input.inventory_reference),
    inventoryDate: dateOnly(input.inventoryDate || input.inventory_date),
    reportingEntityName: text(input.reportingEntityName || input.reporting_entity_name),
    reportingPeriodStart: dateOnly(input.reportingPeriodStart || input.reporting_period_start),
    reportingPeriodEnd: dateOnly(input.reportingPeriodEnd || input.reporting_period_end),
    intendedUse: text(input.intendedUse || input.intended_use),
    organizationalBoundary: {
      approach: text(boundary.approach).toLowerCase(), description: text(boundary.description),
      entities: array(boundary.entities).map((item) => ({ reference: text(item.reference), name: text(item.name),
        ownershipPercent: number(item.ownershipPercent ?? item.ownership_percent), included: bool(item.included),
        rationale: text(item.rationale) }))
    },
    facilities: array(input.facilities).map((item) => ({ reference: text(item.reference), name: text(item.name),
      country: text(item.country).toUpperCase(), included: bool(item.included), rationale: text(item.rationale),
      evidenceDocumentIds: unique(array(item.evidenceDocumentIds || item.evidence_document_ids).map(text)).sort() })),
    defaultFuelFacilityReference: text(input.defaultFuelFacilityReference || input.default_fuel_facility_reference),
    operationalBoundary: {
      scope1: array(operations.scope1).map(normalizeDecision), scope2: array(operations.scope2).map(normalizeDecision),
      scope3Claim: text(operations.scope3Claim || operations.scope3_claim).toLowerCase(),
      scope3: array(operations.scope3).map(normalizeDecision)
    },
    gasCoverage: array(input.gasCoverage || input.gas_coverage).map((item) => ({ gas: text(item.gas),
      status: text(item.status).toLowerCase(), rationale: text(item.rationale) })),
    baseYear: { year: number(baseYear.year), emissionsKgCo2e: number(baseYear.emissionsKgCo2e ?? baseYear.emissions_kg_co2e),
      recalculationPolicy: text(baseYear.recalculationPolicy || baseYear.recalculation_policy),
      significanceThresholdPercent: number(baseYear.significanceThresholdPercent ?? baseYear.significance_threshold_percent),
      structuralChanges: text(baseYear.structuralChanges || baseYear.structural_changes) },
    scope2Accounting: { marketBasedApplicable: bool(scope2.marketBasedApplicable ?? scope2.market_based_applicable),
      locationBasedFactorVersion: text(scope2.locationBasedFactorVersion || scope2.location_based_factor_version),
      gwpBasis: text(scope2.gwpBasis || scope2.gwp_basis),
      marketBasedMethod: text(scope2.marketBasedMethod || scope2.market_based_method),
      contractualInstrumentEvidenceIds: unique(array(scope2.contractualInstrumentEvidenceIds || scope2.contractual_instrument_evidence_ids).map(text)).sort() },
    fuelFactorMetadata: array(input.fuelFactorMetadata || input.fuel_factor_metadata).map((item) => ({ fuelType: text(item.fuelType || item.fuel_type).toLowerCase(),
      source: text(item.source), version: text(item.version), gwpBasis: text(item.gwpBasis || item.gwp_basis) })),
    additionalSources: array(input.additionalSources || input.additional_sources).map((item) => ({
      sourceReference: text(item.sourceReference || item.source_reference), facilityReference: text(item.facilityReference || item.facility_reference),
      scope: text(item.scope).toLowerCase(), category: text(item.category).toLowerCase(), gas: text(item.gas),
      accountingMethod: text(item.accountingMethod || item.accounting_method).toLowerCase() || 'location_based',
      activityValue: number(item.activityValue ?? item.activity_value), activityUnit: text(item.activityUnit || item.activity_unit),
      emissionFactor: number(item.emissionFactor ?? item.emission_factor), factorUnit: text(item.factorUnit || item.factor_unit),
      factorSource: text(item.factorSource || item.factor_source), factorVersion: text(item.factorVersion || item.factor_version),
      gwpBasis: text(item.gwpBasis || item.gwp_basis), evidenceDocumentIds: unique(array(item.evidenceDocumentIds || item.evidence_document_ids).map(text)).sort()
    })),
    dataCompletenessPercent: number(input.dataCompletenessPercent ?? input.data_completeness_percent),
    dataQualityAssessment: text(input.dataQualityAssessment || input.data_quality_assessment),
    dataImprovementPlan: text(input.dataImprovementPlan || input.data_improvement_plan),
    uncertaintyAssessment: text(input.uncertaintyAssessment || input.uncertainty_assessment),
    biogenicCo2Kg: number(input.biogenicCo2Kg ?? input.biogenic_co2_kg) ?? 0,
    removalsCo2Kg: number(input.removalsCo2Kg ?? input.removals_co2_kg) ?? 0,
    offsetsRetiredKgCo2e: number(input.offsetsRetiredKgCo2e ?? input.offsets_retired_kg_co2e) ?? 0,
    exclusions: array(input.exclusions).map((item) => ({ source: text(item.source), rationale: text(item.rationale),
      estimatedImpactPercent: number(item.estimatedImpactPercent ?? item.estimated_impact_percent) })),
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    assurance: { verifiedLanguageRequested: bool(assurance.verifiedLanguageRequested ?? assurance.verified_language_requested),
      providerName: text(assurance.providerName || assurance.provider_name), level: text(assurance.level).toLowerCase(),
      statementDate: dateOnly(assurance.statementDate || assurance.statement_date),
      evidenceDocumentId: text(assurance.evidenceDocumentId || assurance.evidence_document_id) || null },
    limitations: text(input.limitations), notes: text(input.notes)
  };
}

function finding(code, severity, message, path = null) { return { code, severity, message, path }; }
function sourceCo2e(row) { return Number(((number(row.activityValue) || 0) * (number(row.emissionFactor) || 0)).toFixed(4)); }

function evaluateCorporateGhgInventory(input = {}, activitySnapshot = [], evidenceSnapshot = []) {
  const normalized = normalizeCorporateGhgInput(input); const findings = []; const missingInputs = [];
  const required = [['inventoryReference', normalized.inventoryReference], ['inventoryDate', normalized.inventoryDate],
    ['reportingEntityName', normalized.reportingEntityName], ['reportingPeriodStart', normalized.reportingPeriodStart],
    ['reportingPeriodEnd', normalized.reportingPeriodEnd], ['intendedUse', normalized.intendedUse],
    ['organizationalBoundary.approach', normalized.organizationalBoundary.approach],
    ['organizationalBoundary.description', normalized.organizationalBoundary.description],
    ['organizationalBoundary.entities', normalized.organizationalBoundary.entities.length], ['facilities', normalized.facilities.length],
    ['baseYear.year', normalized.baseYear.year], ['baseYear.recalculationPolicy', normalized.baseYear.recalculationPolicy],
    ['baseYear.significanceThresholdPercent', normalized.baseYear.significanceThresholdPercent],
    ['dataCompletenessPercent', normalized.dataCompletenessPercent], ['dataQualityAssessment', normalized.dataQualityAssessment],
    ['dataImprovementPlan', normalized.dataImprovementPlan], ['uncertaintyAssessment', normalized.uncertaintyAssessment],
    ['limitations', normalized.limitations]];
  required.forEach(([path, value]) => { if (value === null || value === '' || value === 0) missingInputs.push(path); });
  if (!['equity_share', 'financial_control', 'operational_control'].includes(normalized.organizationalBoundary.approach)) {
    findings.push(finding('GHG_ORGANIZATIONAL_BOUNDARY_INVALID', 'blocker', 'Select equity share, financial control or operational control.', 'organizationalBoundary.approach'));
  }
  if (normalized.reportingPeriodStart && normalized.reportingPeriodEnd && normalized.reportingPeriodEnd < normalized.reportingPeriodStart) {
    findings.push(finding('GHG_REPORTING_PERIOD_INVALID', 'blocker', 'Reporting period end must be on or after its start.', 'reportingPeriodEnd'));
  }
  normalized.organizationalBoundary.entities.forEach((item, index) => {
    if (!item.reference || !item.name || item.ownershipPercent === null || item.ownershipPercent < 0 || item.ownershipPercent > 100 || !item.rationale) {
      findings.push(finding('GHG_ENTITY_BOUNDARY_INCOMPLETE', 'blocker', 'Every entity needs identity, ownership, inclusion decision and rationale.', `organizationalBoundary.entities[${index}]`));
    }
  });
  const includedFacilities = normalized.facilities.filter((item) => item.included); const facilityRefs = new Set(includedFacilities.map((item) => item.reference));
  normalized.facilities.forEach((item, index) => { if (!item.reference || !item.name || !/^[A-Z]{2}$/.test(item.country) || !item.rationale) {
    findings.push(finding('GHG_FACILITY_BOUNDARY_INCOMPLETE', 'blocker', 'Every facility needs identity, country, inclusion decision and rationale.', `facilities[${index}]`));
  } });
  if (!includedFacilities.length || !facilityRefs.has(normalized.defaultFuelFacilityReference)) {
    findings.push(finding('GHG_FACILITY_MAPPING_REQUIRED', 'blocker', 'At least one included facility and a valid default fuel facility are required.', 'defaultFuelFacilityReference'));
  }
  const decisions = [...normalized.operationalBoundary.scope1, ...normalized.operationalBoundary.scope2];
  for (const category of [...SCOPE1_CATEGORIES, ...SCOPE2_CATEGORIES]) {
    const decision = decisions.find((item) => item.category === category);
    if (!decision || !['quantified', 'not_relevant', 'excluded'].includes(decision.status) || !decision.rationale) {
      findings.push(finding('GHG_OPERATIONAL_BOUNDARY_INCOMPLETE', 'blocker', `Record a supported decision and rationale for ${category}.`, 'operationalBoundary'));
    } else if (decision.status === 'excluded') {
      findings.push(finding('GHG_SOURCE_EXCLUDED', 'specialist', `${category} is explicitly excluded; the report must remain qualified.`, 'operationalBoundary'));
    }
  }
  if (!['not_included', 'screened', 'full_inventory'].includes(normalized.operationalBoundary.scope3Claim)) {
    findings.push(finding('GHG_SCOPE3_CLAIM_REQUIRED', 'blocker', 'State whether Scope 3 is not included, screened or reported as a full inventory.', 'operationalBoundary.scope3Claim'));
  } else if (normalized.operationalBoundary.scope3Claim !== 'not_included' && !normalized.operationalBoundary.scope3.length) {
    findings.push(finding('GHG_SCOPE3_COVERAGE_INCOMPLETE', 'blocker', 'A Scope 3 claim requires category decisions.', 'operationalBoundary.scope3'));
  }
  for (const gas of GASES) {
    const gasDecision = normalized.gasCoverage.find((item) => item.gas === gas);
    if (!gasDecision || !['quantified', 'not_relevant'].includes(gasDecision.status) || !gasDecision.rationale) {
      findings.push(finding('GHG_GAS_COVERAGE_INCOMPLETE', 'blocker', `Record quantified/not-relevant treatment and rationale for ${gas}.`, 'gasCoverage'));
    }
  }
  if (normalized.baseYear.year && (!Number.isInteger(normalized.baseYear.year) || normalized.baseYear.year < 1990
    || normalized.baseYear.year > Number(normalized.reportingPeriodEnd?.slice(0, 4)))) {
    findings.push(finding('GHG_BASE_YEAR_INVALID', 'blocker', 'Base year must be a valid year no later than the reporting year.', 'baseYear.year'));
  }
  if (normalized.baseYear.significanceThresholdPercent === null || normalized.baseYear.significanceThresholdPercent <= 0
    || normalized.baseYear.significanceThresholdPercent > 100) {
    findings.push(finding('GHG_RECALCULATION_POLICY_INCOMPLETE', 'blocker', 'Base-year recalculation policy needs a positive significance threshold.', 'baseYear'));
  }
  const allSources = [...activitySnapshot, ...normalized.additionalSources.map((item) => ({ ...item, sourceType: 'additional_source',
    calculatedCo2eKg: sourceCo2e(item) }))];
  allSources.forEach((item, index) => {
    const evidenceIds = array(item.evidenceDocumentIds || (item.evidenceDocumentId ? [item.evidenceDocumentId] : []));
    if (!item.sourceReference || !facilityRefs.has(item.facilityReference) || !['scope1', 'scope2', 'scope3'].includes(item.scope)
      || !item.category || !item.activityUnit || number(item.activityValue) === null || number(item.activityValue) < 0
      || number(item.emissionFactor) === null || number(item.emissionFactor) < 0 || !item.factorUnit || !item.factorSource
      || !item.factorVersion || !item.gwpBasis || !evidenceIds.length) {
      findings.push(finding('GHG_ACTIVITY_SOURCE_INCOMPLETE', 'blocker', 'Each activity row needs facility/scope/category, AD, EF provenance, GWP basis and evidence.', `activitySources[${index}]`));
    }
    if (item.recordStatus && !['reviewed', 'verified'].includes(item.recordStatus)) {
      findings.push(finding('GHG_ACTIVITY_SOURCE_NOT_REVIEWED', 'blocker', 'Invoice-derived activity must be reviewed or verified before inventory use.', `activitySources[${index}]`));
    }
    if (number(item.reportedCo2eKg) !== null && Math.abs(sourceCo2e(item) - number(item.reportedCo2eKg)) > 0.0001) {
      findings.push(finding('GHG_ACTIVITY_NOT_REPRODUCIBLE', 'blocker', 'Activity × emission factor must reproduce the stored source total.', `activitySources[${index}]`));
    }
  });
  for (const decision of decisions.filter((item) => item.status === 'quantified')) {
    if (!allSources.some((item) => item.category === decision.category)) {
      findings.push(finding('GHG_QUANTIFIED_CATEGORY_HAS_NO_SOURCE', 'blocker', `${decision.category} is marked quantified but has no activity source.`, 'operationalBoundary'));
    }
  }
  const fuelTypes = unique(activitySnapshot.filter((item) => item.sourceType === 'fuel_invoice').map((item) => item.fuelType));
  fuelTypes.forEach((fuelType) => { const metadata = normalized.fuelFactorMetadata.find((item) => item.fuelType === fuelType);
    if (!metadata || !metadata.source || !metadata.version || !metadata.gwpBasis) findings.push(finding('GHG_FUEL_FACTOR_PROVENANCE_REQUIRED', 'blocker', `Fuel factor provenance is missing for ${fuelType}.`, 'fuelFactorMetadata'));
  });
  const evidenceIds = new Set(normalized.evidenceDocumentIds);
  normalized.facilities.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
  normalized.additionalSources.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
  normalized.scope2Accounting.contractualInstrumentEvidenceIds.forEach((id) => evidenceIds.add(id));
  activitySnapshot.forEach((item) => array(item.evidenceDocumentIds || (item.evidenceDocumentId ? [item.evidenceDocumentId] : [])).forEach((id) => evidenceIds.add(id)));
  if (normalized.assurance.evidenceDocumentId) evidenceIds.add(normalized.assurance.evidenceDocumentId);
  const resolvedEvidence = new Map(evidenceSnapshot.map((item) => [item.id, item]));
  if (!evidenceIds.size || [...evidenceIds].some((id) => !resolvedEvidence.has(id))) {
    findings.push(finding('GHG_EVIDENCE_UNRESOLVED', 'blocker', 'Every inventory, facility, activity and contractual-instrument evidence id must resolve within the company.', 'evidenceDocumentIds'));
  }
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/i.test(text(item.checksumSha256)) || Number(item.fileSizeBytes || 0) <= 0)) {
    findings.push(finding('GHG_EVIDENCE_NOT_CONTROLLED', 'blocker', 'All inventory evidence must be locked, checksum identified and non-empty.', 'evidenceDocumentIds'));
  }
  const locationScope2 = allSources.filter((item) => item.scope === 'scope2' && item.accountingMethod !== 'market_based')
    .reduce((sum, item) => sum + Number(item.calculatedCo2eKg || 0), 0);
  const marketScope2Sources = allSources.filter((item) => item.scope === 'scope2' && item.accountingMethod === 'market_based');
  const marketScope2 = marketScope2Sources.reduce((sum, item) => sum + Number(item.calculatedCo2eKg || 0), 0);
  if (normalized.scope2Accounting.marketBasedApplicable && (!normalized.scope2Accounting.marketBasedMethod
    || !normalized.scope2Accounting.contractualInstrumentEvidenceIds.length || !marketScope2Sources.length)) {
    findings.push(finding('GHG_SCOPE2_DUAL_REPORTING_INCOMPLETE', 'blocker', 'Market-based Scope 2 needs a method, contractual-instrument evidence and market-based source rows.', 'scope2Accounting'));
  }
  if (normalized.dataCompletenessPercent === null || normalized.dataCompletenessPercent < 0 || normalized.dataCompletenessPercent > 100) {
    findings.push(finding('GHG_DATA_COMPLETENESS_INVALID', 'blocker', 'Data completeness must be stated from 0 to 100 percent.', 'dataCompletenessPercent'));
  } else if (normalized.dataCompletenessPercent < 100) {
    findings.push(finding('GHG_DATA_INCOMPLETE', 'specialist', 'Inventory completeness is below 100%; disclose and resolve material gaps.', 'dataCompletenessPercent'));
  }
  normalized.exclusions.forEach((item, index) => { if (!item.source || !item.rationale || item.estimatedImpactPercent === null || item.estimatedImpactPercent < 0) {
    findings.push(finding('GHG_EXCLUSION_INCOMPLETE', 'blocker', 'Each exclusion needs a source, rationale and estimated significance.', `exclusions[${index}]`));
  } });
  const assuranceEvidence = normalized.assurance.evidenceDocumentId ? resolvedEvidence.get(normalized.assurance.evidenceDocumentId) : null;
  if (normalized.assurance.verifiedLanguageRequested && (!normalized.assurance.providerName
    || !['limited_assurance', 'reasonable_assurance'].includes(normalized.assurance.level) || !normalized.assurance.statementDate
    || !assuranceEvidence || assuranceEvidence.status !== 'third_party_verified')) {
    findings.push(finding('GHG_ASSURANCE_INVALID', 'blocker', 'Verified language requires named provider, level, date and third-party-verified assurance evidence.', 'assurance'));
  }
  const scope1KgCo2e = allSources.filter((item) => item.scope === 'scope1').reduce((sum, item) => sum + Number(item.calculatedCo2eKg || 0), 0);
  const scope3KgCo2e = allSources.filter((item) => item.scope === 'scope3').reduce((sum, item) => sum + Number(item.calculatedCo2eKg || 0), 0);
  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker') ? 'needs_information' : 'inventory_review_required';
  const sources = RULESET.sources.map((item) => ({ ...item }));
  const body = { schemaId: 'weavecarbon.corporate-ghg-inventory', schemaVersion: '1.0.0', rulesetId: RULESET.id,
    rulesetVersion: RULESET.version, rulesetCoverage: RULESET.coverageStatus, sourceManifestSha256: sha256(sources),
    automatedStatus, missingInputs: unique(missingInputs), findings, sources,
    totals: { scope1KgCo2e: Number(scope1KgCo2e.toFixed(4)), scope2LocationBasedKgCo2e: Number(locationScope2.toFixed(4)),
      scope2MarketBasedKgCo2e: normalized.scope2Accounting.marketBasedApplicable ? Number(marketScope2.toFixed(4)) : null,
      scope3KgCo2e: normalized.operationalBoundary.scope3Claim === 'not_included' ? null : Number(scope3KgCo2e.toFixed(4)),
      biogenicCo2Kg: normalized.biogenicCo2Kg, removalsCo2Kg: normalized.removalsCo2Kg,
      offsetsRetiredKgCo2e: normalized.offsetsRetiredKgCo2e,
      grossScope1AndLocationScope2KgCo2e: Number((scope1KgCo2e + locationScope2).toFixed(4)) },
    activitySourceCount: allSources.length, evidenceCount: evidenceSnapshot.length,
    inventoryScopeLabel: normalized.operationalBoundary.scope3Claim === 'not_included'
      ? 'Internal Scope 1 and Scope 2 inventory' : `Internal Scope 1, Scope 2 and ${normalized.operationalBoundary.scope3Claim === 'full_inventory' ? 'Scope 3' : 'screened Scope 3'} inventory`,
    assuranceStatus: normalized.assurance.verifiedLanguageRequested && assuranceEvidence?.status === 'third_party_verified'
      ? normalized.assurance.level : 'not_independently_verified',
    disclaimer: 'Internal limited organizational GHG inventory. Offsets are not netted from gross inventory totals. Not ISO certification or independent assurance unless authentic assurance evidence is linked.' };
  return { input: normalized, inputSha256: sha256(normalized), activitySnapshot: allSources,
    activitySnapshotSha256: sha256(allSources), result: { ...body, resultSha256: sha256(body) } };
}

function deriveCorporateGhgStatus(inventory, currentEvidence = []) {
  const result = inventory.result || inventory.result_snapshot || {}; const review = inventory.latestReview || inventory.latest_review || null;
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [] };
  if (!review) return { status: 'inventory_review_required', staleEvidenceIds: [] };
  if (review.decision !== 'approved_for_internal_report') return { status: review.decision, staleEvidenceIds: [] };
  const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  const staleEvidenceIds = array(review.evidenceSnapshot || review.evidence_snapshot).filter((item) => {
    const current = byId.get(item.id); return !current || !['locked', 'third_party_verified'].includes(current.status)
      || current.checksumSha256 !== item.checksumSha256 || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0);
  }).map((item) => item.id);
  return staleEvidenceIds.length ? { status: 'evidence_review_required', staleEvidenceIds }
    : { status: 'approved_for_internal_report', staleEvidenceIds: [] };
}

module.exports = { RULESET, SCOPE1_CATEGORIES, SCOPE2_CATEGORIES, GASES, normalizeCorporateGhgInput,
  evaluateCorporateGhgInventory, deriveCorporateGhgStatus, sha256 };
