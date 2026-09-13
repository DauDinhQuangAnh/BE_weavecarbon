const crypto = require('crypto');

const EU_MEMBER_STATES = Object.freeze(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const ANNEX_IVC_PREFIXES = Object.freeze(['61', '62', '6301', '6302', '6303', '6304', '6309', '6504', '6505',
  '4203', '6401', '6402', '6403', '6404', '6405']);
const RULESET = Object.freeze({
  id: 'weavecarbon.eu-textile-footwear-epr-core',
  version: 'R17-WFD-2025-1892-EU-CORE-1',
  coverageStatus: 'limited',
  dates: Object.freeze({ directiveEffective: '2025-10-16', harmonisedRegistrationFormatDue: '2027-04-17',
    schemesDue: '2028-04-17', microenterpriseApplication: '2029-04-17' }),
  sources: Object.freeze([
    Object.freeze({ id: 'EU-2025-1892', title: 'Directive (EU) 2025/1892 amending Directive 2008/98/EC',
      url: 'https://eur-lex.europa.eu/eli/dir/2025/1892/oj', version: 'OJ-L-2025-1892-2025-09-26' }),
    Object.freeze({ id: 'WFD-CONSOLIDATED-2025-10-16', title: 'Waste Framework Directive consolidated text',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02008L0098-20251016', version: '2025-10-16' })
  ])
});

function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function number(value) { if (value === '' || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function bool(value) { return value === true; }
function dateOnly(value) { const result = text(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return null;
  const parsed = new Date(`${result}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function cn(value) { return text(value).replace(/[^0-9]/g, ''); }
function isAnnexIvcCode(value) { const code = cn(value); if (code === '63011000') return false;
  return ANNEX_IVC_PREFIXES.some((prefix) => code.startsWith(prefix)); }
function normalizeAddress(value = {}) { return { street: text(value.street), postalCode: text(value.postalCode || value.postal_code),
  city: text(value.city), country: text(value.country).toUpperCase() }; }
function normalizeCorporateActor(value = {}) { return { name: text(value.name), address: normalizeAddress(value.address),
  email: text(value.email), phone: text(value.phone), website: text(value.website),
  nationalIdentificationCode: text(value.nationalIdentificationCode || value.national_identification_code),
  tradeRegisterNumber: text(value.tradeRegisterNumber || value.trade_register_number),
  taxIdentificationNumber: text(value.taxIdentificationNumber || value.tax_identification_number),
  mandateEvidenceIds: unique(array(value.mandateEvidenceIds || value.mandate_evidence_ids).map(text)).sort() }; }

function normalizeEprInput(input = {}) {
  const producer = input.producer || {}; const representative = input.authorizedRepresentative || input.authorized_representative || {};
  const pro = input.producerResponsibilityOrganisation || input.producer_responsibility_organisation || {};
  const adapter = input.memberStateRule || input.member_state_rule || {};
  return {
    assessmentReference: text(input.assessmentReference || input.assessment_reference), assessmentDate: dateOnly(input.assessmentDate || input.assessment_date),
    memberState: text(input.memberState || input.member_state).toUpperCase(), reportingPeriodStart: dateOnly(input.reportingPeriodStart || input.reporting_period_start),
    reportingPeriodEnd: dateOnly(input.reportingPeriodEnd || input.reporting_period_end), intendedUse: text(input.intendedUse || input.intended_use),
    producer: { legalName: text(producer.legalName || producer.legal_name), trademarks: unique(array(producer.trademarks).map(text)).sort(),
      brandNames: unique(array(producer.brandNames || producer.brand_names).map(text)).sort(), address: normalizeAddress(producer.address),
      email: text(producer.email), phone: text(producer.phone), website: text(producer.website), contactPoint: text(producer.contactPoint || producer.contact_point),
      nationalIdentificationCode: text(producer.nationalIdentificationCode || producer.national_identification_code),
      tradeRegisterNumber: text(producer.tradeRegisterNumber || producer.trade_register_number),
      taxIdentificationNumber: text(producer.taxIdentificationNumber || producer.tax_identification_number),
      establishedCountry: text(producer.establishedCountry || producer.established_country).toUpperCase(), role: text(producer.role).toLowerCase(),
      employeeCount: number(producer.employeeCount ?? producer.employee_count), annualTurnoverEur: number(producer.annualTurnoverEur ?? producer.annual_turnover_eur),
      annualBalanceSheetEur: number(producer.annualBalanceSheetEur ?? producer.annual_balance_sheet_eur),
      suppliesUsedGoodsOnly: bool(producer.suppliesUsedGoodsOnly ?? producer.supplies_used_goods_only),
      selfEmployedTailorCustomizedOnly: bool(producer.selfEmployedTailorCustomizedOnly ?? producer.self_employed_tailor_customized_only),
      derivedFromUsedWasteOnly: bool(producer.derivedFromUsedWasteOnly ?? producer.derived_from_used_waste_only) },
    authorizedRepresentative: { applicable: bool(representative.applicable), nationalRuleBasis: text(representative.nationalRuleBasis || representative.national_rule_basis),
      ...normalizeCorporateActor(representative) },
    producerResponsibilityOrganisation: normalizeCorporateActor(pro),
    cnCodes: unique(array(input.cnCodes || input.cn_codes).map(cn)).sort(),
    memberStateRule: { adapterId: text(adapter.adapterId || adapter.adapter_id), version: text(adapter.version), sourceUrl: text(adapter.sourceUrl || adapter.source_url),
      effectiveFrom: dateOnly(adapter.effectiveFrom || adapter.effective_from), schemeStatus: text(adapter.schemeStatus || adapter.scheme_status).toLowerCase(),
      competentAuthorityName: text(adapter.competentAuthorityName || adapter.competent_authority_name), registerUrl: text(adapter.registerUrl || adapter.register_url),
      reportingSchedule: text(adapter.reportingSchedule || adapter.reporting_schedule), feeMethodStatus: text(adapter.feeMethodStatus || adapter.fee_method_status).toLowerCase(),
      reviewEvidenceIds: unique(array(adapter.reviewEvidenceIds || adapter.review_evidence_ids).map(text)).sort() },
    declaredMarketRows: array(input.declaredMarketRows || input.declared_market_rows).map((item) => ({ cnCode: cn(item.cnCode || item.cn_code),
      quantity: number(item.quantity), unit: text(item.unit).toUpperCase(), weightKg: number(item.weightKg ?? item.weight_kg),
      productDescription: text(item.productDescription || item.product_description) })),
    truthStatementConfirmed: bool(input.truthStatementConfirmed ?? input.truth_statement_confirmed),
    evidenceDocumentIds: unique(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text)).sort(),
    limitations: text(input.limitations), notes: text(input.notes)
  };
}

function finding(code, severity, message, path = null) { return { code, severity, message, path }; }
function actorComplete(actor) { return actor.name && actor.address.street && actor.address.postalCode && actor.address.city
  && /^[A-Z]{2}$/.test(actor.address.country) && actor.email && actor.nationalIdentificationCode && actor.tradeRegisterNumber
  && actor.taxIdentificationNumber; }
function aggregateRows(rows) {
  const aggregated = new Map();
  rows.forEach((row) => { const code = cn(row.cnCode); const unit = text(row.unit).toUpperCase(); const key = `${code}:${unit}`;
    const current = aggregated.get(key) || { cnCode: code, unit, quantity: 0, weightKg: 0 };
    current.quantity += Number(row.quantity || 0); current.weightKg += Number(row.weightKg || 0); aggregated.set(key, current); });
  return [...aggregated.values()].sort((a, b) => `${a.cnCode}:${a.unit}`.localeCompare(`${b.cnCode}:${b.unit}`))
    .map((row) => ({ ...row, quantity: Number(row.quantity.toFixed(4)), weightKg: Number(row.weightKg.toFixed(4)) }));
}

function evaluateEprAssessment(input = {}, shipmentSnapshot = [], evidenceSnapshot = []) {
  const normalized = normalizeEprInput(input); const findings = []; const missingInputs = [];
  const required = [['assessmentReference', normalized.assessmentReference], ['assessmentDate', normalized.assessmentDate],
    ['memberState', normalized.memberState], ['reportingPeriodStart', normalized.reportingPeriodStart], ['reportingPeriodEnd', normalized.reportingPeriodEnd],
    ['intendedUse', normalized.intendedUse], ['producer.legalName', normalized.producer.legalName], ['producer.address.street', normalized.producer.address.street],
    ['producer.address.postalCode', normalized.producer.address.postalCode], ['producer.address.city', normalized.producer.address.city],
    ['producer.address.country', normalized.producer.address.country], ['producer.email', normalized.producer.email],
    ['producer.contactPoint', normalized.producer.contactPoint], ['producer.nationalIdentificationCode', normalized.producer.nationalIdentificationCode],
    ['producer.tradeRegisterNumber', normalized.producer.tradeRegisterNumber], ['producer.taxIdentificationNumber', normalized.producer.taxIdentificationNumber],
    ['producer.establishedCountry', normalized.producer.establishedCountry], ['producer.role', normalized.producer.role],
    ['producer.employeeCount', normalized.producer.employeeCount], ['producer.annualTurnoverEur', normalized.producer.annualTurnoverEur],
    ['producer.annualBalanceSheetEur', normalized.producer.annualBalanceSheetEur], ['cnCodes', normalized.cnCodes.length || null],
    ['memberStateRule.adapterId', normalized.memberStateRule.adapterId], ['memberStateRule.version', normalized.memberStateRule.version],
    ['memberStateRule.sourceUrl', normalized.memberStateRule.sourceUrl], ['memberStateRule.schemeStatus', normalized.memberStateRule.schemeStatus],
    ['declaredMarketRows', normalized.declaredMarketRows.length || null], ['limitations', normalized.limitations]];
  required.forEach(([path, value]) => { if (value === null || value === '') missingInputs.push(path); });
  if (!EU_MEMBER_STATES.includes(normalized.memberState)) findings.push(finding('EPR_MEMBER_STATE_INVALID', 'blocker', 'Select an EU Member State.', 'memberState'));
  if (normalized.reportingPeriodStart && normalized.reportingPeriodEnd && normalized.reportingPeriodEnd < normalized.reportingPeriodStart) {
    findings.push(finding('EPR_REPORTING_PERIOD_INVALID', 'blocker', 'Reporting period end must not precede its start.', 'reportingPeriodEnd'));
  }
  if (!['manufacturer_own_brand', 'reseller_own_brand', 'first_supplier_import', 'distance_seller'].includes(normalized.producer.role)) {
    findings.push(finding('EPR_PRODUCER_ROLE_INVALID', 'blocker', 'Producer role must map to Directive 2008/98/EC Article 3(4b).', 'producer.role'));
  }
  if (![normalized.producer.address.country, normalized.producer.establishedCountry].every((value) => /^[A-Z]{2}$/.test(value))) {
    findings.push(finding('EPR_PRODUCER_ADDRESS_INVALID', 'blocker', 'Producer address and establishment countries need ISO alpha-2 codes.', 'producer'));
  }
  const excludedProducer = normalized.producer.suppliesUsedGoodsOnly || normalized.producer.selfEmployedTailorCustomizedOnly
    || normalized.producer.derivedFromUsedWasteOnly;
  if (excludedProducer) findings.push(finding('EPR_PRODUCER_EXCLUSION_REQUIRES_LEGAL_REVIEW', 'specialist',
    'A statutory producer exclusion is claimed; retain evidence and obtain Member-State legal review.', 'producer'));
  normalized.cnCodes.forEach((code, index) => { if (!isAnnexIvcCode(code)) findings.push(finding('EPR_CN_OUTSIDE_ANNEX_IVC', 'blocker',
    `${code || 'blank'} is outside the encoded Annex IVc list.`, `cnCodes[${index}]`)); });
  if (!actorComplete(normalized.producerResponsibilityOrganisation)) findings.push(finding('EPR_PRO_REQUIRED', 'blocker',
    'EU-core planning requires the selected producer responsibility organisation identity and mandate.', 'producerResponsibilityOrganisation'));
  if (!normalized.producerResponsibilityOrganisation.mandateEvidenceIds.length) findings.push(finding('EPR_PRO_MANDATE_EVIDENCE_REQUIRED', 'blocker',
    'The producer responsibility organisation written mandate needs controlled evidence.', 'producerResponsibilityOrganisation.mandateEvidenceIds'));
  const crossBorderDistance = normalized.producer.role === 'distance_seller' && normalized.producer.establishedCountry !== normalized.memberState;
  if (crossBorderDistance && (!normalized.authorizedRepresentative.nationalRuleBasis
    || (normalized.authorizedRepresentative.applicable && (!actorComplete(normalized.authorizedRepresentative)
      || !normalized.authorizedRepresentative.mandateEvidenceIds.length)))) {
    findings.push(finding('EPR_AUTHORISED_REPRESENTATIVE_COUNTRY_RULE_REQUIRED', 'blocker',
      'Cross-border distance sales need the Member-State representative rule and, when applicable, a complete mandate.', 'authorizedRepresentative'));
  }
  if (!['not_transposed', 'transposed', 'existing_scheme', 'unknown'].includes(normalized.memberStateRule.schemeStatus)
    || !/^https:\/\//i.test(normalized.memberStateRule.sourceUrl)) findings.push(finding('EPR_MEMBER_STATE_RULE_INVALID', 'blocker',
    'Member-State rule status and an HTTPS primary-source URL are required.', 'memberStateRule'));
  const implementedNationalScheme = ['transposed', 'existing_scheme'].includes(normalized.memberStateRule.schemeStatus);
  if (implementedNationalScheme && (!normalized.memberStateRule.effectiveFrom
    || !normalized.memberStateRule.competentAuthorityName
    || !/^https:\/\//i.test(normalized.memberStateRule.registerUrl)
    || !normalized.memberStateRule.reportingSchedule
    || !['pending', 'published'].includes(normalized.memberStateRule.feeMethodStatus)
    || !normalized.memberStateRule.reviewEvidenceIds.length)) {
    findings.push(finding('EPR_NATIONAL_ADAPTER_INCOMPLETE', 'blocker',
      'An implemented national scheme claim needs its effective date, authority, HTTPS register, reporting schedule, fee-method status and controlled review evidence.',
      'memberStateRule'));
  } else if (!implementedNationalScheme) {
    findings.push(finding('EPR_NATIONAL_ADAPTER_INCOMPLETE', 'specialist',
      'Registration, fee and reporting details remain planning-only until the national adapter is reviewed.', 'memberStateRule'));
  }
  if (!normalized.truthStatementConfirmed) findings.push(finding('EPR_TRUTH_STATEMENT_REQUIRED', 'blocker',
    'The Article 22b registration truth statement must be explicitly confirmed.', 'truthStatementConfirmed'));
  normalized.declaredMarketRows.forEach((row, index) => {
    if (!row.cnCode || !isAnnexIvcCode(row.cnCode) || !normalized.cnCodes.some((code) => row.cnCode.startsWith(code) || code.startsWith(row.cnCode))
      || row.quantity === null || row.quantity < 0 || !row.unit || row.weightKg === null || row.weightKg < 0 || !row.productDescription) {
      findings.push(finding('EPR_MARKET_ROW_INVALID', 'blocker', 'Each market row needs an Annex-IVc CN code, quantity/unit, weight and description.', `declaredMarketRows[${index}]`));
    }
  });
  shipmentSnapshot.forEach((row, index) => {
    if (!row.hsCodeConfirmed || !row.cnCode || !isAnnexIvcCode(row.cnCode) || number(row.quantity) === null || number(row.quantity) < 0
      || !row.unit || number(row.weightKg) === null || number(row.weightKg) < 0) findings.push(finding('EPR_SHIPMENT_SOURCE_INCOMPLETE', 'blocker',
      'Every in-period shipment line needs confirmed Annex-IVc classification, quantity/unit and net weight.', `shipmentSnapshot[${index}]`));
  });
  if (!shipmentSnapshot.length) findings.push(finding('EPR_NO_SHIPMENT_SOURCE', 'blocker',
    'No in-period shipment ledger rows were found for the selected Member State.', 'declaredMarketRows'));
  const declared = aggregateRows(normalized.declaredMarketRows); const system = aggregateRows(shipmentSnapshot.map((row) => ({
    cnCode: row.cnCode, quantity: row.quantity, unit: row.unit, weightKg: row.weightKg })));
  const keys = unique([...declared, ...system].map((row) => `${row.cnCode}:${row.unit}`)); const reconciliation = keys.map((key) => {
    const declaredRow = declared.find((row) => `${row.cnCode}:${row.unit}` === key) || { quantity: 0, weightKg: 0 };
    const systemRow = system.find((row) => `${row.cnCode}:${row.unit}` === key) || { quantity: 0, weightKg: 0 };
    const quantityDifference = Number((declaredRow.quantity - systemRow.quantity).toFixed(4));
    const weightDifferenceKg = Number((declaredRow.weightKg - systemRow.weightKg).toFixed(4));
    return { key, declaredQuantity: declaredRow.quantity, systemQuantity: systemRow.quantity, quantityDifference,
      declaredWeightKg: declaredRow.weightKg, systemWeightKg: systemRow.weightKg, weightDifferenceKg,
      status: Math.abs(quantityDifference) <= 0.0001 && Math.abs(weightDifferenceKg) <= 0.01 ? 'matched' : 'mismatch' };
  });
  if (reconciliation.some((item) => item.status === 'mismatch')) findings.push(finding('EPR_MARKET_VOLUME_MISMATCH', 'blocker',
    'Declared market quantities and weight must reconcile to the shipment ledger.', 'declaredMarketRows'));
  const evidenceIds = new Set(normalized.evidenceDocumentIds);
  normalized.producerResponsibilityOrganisation.mandateEvidenceIds.forEach((id) => evidenceIds.add(id));
  normalized.authorizedRepresentative.mandateEvidenceIds.forEach((id) => evidenceIds.add(id));
  normalized.memberStateRule.reviewEvidenceIds.forEach((id) => evidenceIds.add(id));
  const resolved = new Map(evidenceSnapshot.map((item) => [item.id, item]));
  if (!evidenceIds.size || [...evidenceIds].some((id) => !resolved.has(id))) findings.push(finding('EPR_EVIDENCE_UNRESOLVED', 'blocker',
    'All mandate, national-rule and assessment evidence must resolve in the active company.', 'evidenceDocumentIds'));
  if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status)
    || !/^[a-f0-9]{64}$/i.test(text(item.checksumSha256)) || Number(item.fileSizeBytes || 0) <= 0)) findings.push(finding('EPR_EVIDENCE_NOT_CONTROLLED', 'blocker',
    'Assessment evidence must be locked, checksum identified and non-empty.', 'evidenceDocumentIds'));
  const microenterprise = normalized.producer.employeeCount !== null && normalized.producer.employeeCount < 10
    && normalized.producer.annualTurnoverEur !== null && normalized.producer.annualTurnoverEur <= 2000000
    && normalized.producer.annualBalanceSheetEur !== null && normalized.producer.annualBalanceSheetEur <= 2000000;
  const totals = { declaredQuantity: Number(declared.reduce((sum, row) => sum + row.quantity, 0).toFixed(4)),
    declaredWeightKg: Number(declared.reduce((sum, row) => sum + row.weightKg, 0).toFixed(4)),
    systemQuantity: Number(system.reduce((sum, row) => sum + row.quantity, 0).toFixed(4)),
    systemWeightKg: Number(system.reduce((sum, row) => sum + row.weightKg, 0).toFixed(4)) };
  const automatedStatus = missingInputs.length || findings.some((item) => item.severity === 'blocker') ? 'needs_information' : 'specialist_review_required';
  const sources = RULESET.sources.map((item) => ({ ...item }));
  const body = { schemaId: RULESET.id, schemaVersion: '1.0.0', rulesetVersion: RULESET.version,
    rulesetCoverage: RULESET.coverageStatus, sourceManifestSha256: sha256(sources), automatedStatus,
    missingInputs: unique(missingInputs), findings, sources, memberState: normalized.memberState, scopeStatus: excludedProducer
      ? 'claimed_producer_exclusion_requires_review' : 'annex_ivc_candidate', microenterprise,
    statutoryApplicationDate: microenterprise ? RULESET.dates.microenterpriseApplication : RULESET.dates.schemesDue,
    registrationStatus: 'not_externally_confirmed', submissionStatus: 'not_externally_confirmed', paymentStatus: 'not_externally_confirmed',
    shipmentSourceCount: shipmentSnapshot.length, declaredRowCount: normalized.declaredMarketRows.length, totals, reconciliation,
    disclaimer: 'Limited EU-core EPR planning and shipment-reconciliation record. It is not a national registration, fee invoice, payment receipt or authority/PRO submission.' };
  return { input: normalized, inputSha256: sha256(normalized), shipmentSnapshot,
    shipmentSnapshotSha256: sha256(shipmentSnapshot), result: { ...body, resultSha256: sha256(body) } };
}

function evidenceDrift(snapshot, currentEvidence) { const byId = new Map(currentEvidence.map((item) => [item.id, item]));
  return array(snapshot).filter((item) => { const current = byId.get(item.id); return !current
    || !['locked', 'third_party_verified'].includes(current.status) || current.checksumSha256 !== item.checksumSha256
    || Number(current.fileSizeBytes || 0) !== Number(item.fileSizeBytes || 0); }).map((item) => item.id); }
function deriveEprStatus(assessment, currentEvidence = [], events = []) {
  const result = assessment.result || assessment.result_snapshot || {}; const review = assessment.latestReview || assessment.latest_review;
  if (result.automatedStatus === 'needs_information') return { status: 'needs_information', staleEvidenceIds: [], externalMilestones: [] };
  if (!review) return { status: 'specialist_review_required', staleEvidenceIds: [], externalMilestones: [] };
  if (review.decision !== 'approved_for_internal_planning') return { status: review.decision, staleEvidenceIds: [], externalMilestones: [] };
  const staleEvidenceIds = unique([...evidenceDrift(review.evidenceSnapshot || review.evidence_snapshot, currentEvidence),
    ...events.flatMap((event) => evidenceDrift(event.evidenceSnapshot || event.evidence_snapshot, currentEvidence))]);
  if (staleEvidenceIds.length) return { status: 'evidence_review_required', staleEvidenceIds, externalMilestones: [] };
  return { status: events.length ? 'external_evidence_recorded' : 'approved_for_internal_planning', staleEvidenceIds: [],
    externalMilestones: unique(events.map((event) => event.eventType || event.event_type)) };
}

module.exports = { RULESET, EU_MEMBER_STATES, ANNEX_IVC_PREFIXES, normalizeEprInput, evaluateEprAssessment,
  deriveEprStatus, isAnnexIvcCode, sha256 };
