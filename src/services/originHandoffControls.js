const HANDOFF_SCHEMA = Object.freeze({
  id: 'weavecarbon.evfta-origin-support-handoff',
  version: '1.0.0',
  rulesetVersion: 'R07-EVFTA-ORIGIN-2026.09.1',
  regulatoryBasisVersion: 'EVFTA-PROTOCOL-1-ART2-6+12-16+ANNEX-II@OJ-L186-2020',
  protocolSource: 'https://trade.ec.europa.eu/access-to-markets/en/assets/VN_ENG_Protocol-1.pdf',
  productRuleSource: 'https://trade.ec.europa.eu/access-to-markets/en/assets/VN_ENG_PSRs-Annex-II.pdf'
});

const CLAIM_TYPES = new Set(['certificate_application', 'origin_declaration_draft']);
const AUTHORIZATION_TYPES = new Set(['none', 'approved', 'registered']);
const ORIGIN_STATUSES = new Set(['originating', 'non_originating', 'cumulated', 'unknown']);
const CUMULATION_BASES = new Set(['none', 'eu_bilateral', 'asean_article_3_2', 'korea_fabric_article_3_7']);
const RULE_CODES = new Set([
  'CH61_CUT_SEWN_KNITTING_AND_MAKING_UP',
  'CH61_KNITTED_TO_SHAPE_SPINNING_OR_EXTRUSION_AND_KNITTING',
  'CH62_GENERAL_WEAVING_AND_MAKING_UP',
  'CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY',
  'SPECIALIST_RULE_REVIEW'
]);
const CH62_EXCEPTIONS = ['6202', '6204', '6206', '6209', '6210', '6211', '6213', '6214', '6216', '6217'];
const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function hs(value) { return text(value).replace(/\D/g, ''); }

function normalizeMaterial(value = {}) {
  const material = object(value);
  const status = text(material.originStatus || material.origin_status).toLowerCase() || 'unknown';
  const cumulation = text(material.cumulationBasis || material.cumulation_basis).toLowerCase() || 'none';
  return {
    id: text(material.id),
    reference: text(material.reference),
    description: text(material.description),
    hsCode: hs(material.hsCode || material.hs_code),
    supplierName: text(material.supplierName || material.supplier_name),
    originCountry: code(material.originCountry || material.origin_country),
    originStatus: ORIGIN_STATUSES.has(status) ? status : 'unknown',
    cumulationBasis: CUMULATION_BASES.has(cumulation) ? cumulation : 'none',
    value: numberOrNull(material.value),
    weightKg: numberOrNull(material.weightKg ?? material.weight_kg),
    evidenceDocumentId: text(material.evidenceDocumentId || material.evidence_document_id),
    isUpperAssemblyAffixedToSole: typeof (material.isUpperAssemblyAffixedToSole
      ?? material.is_upper_assembly_affixed_to_sole) === 'boolean'
      ? (material.isUpperAssemblyAffixedToSole ?? material.is_upper_assembly_affixed_to_sole)
      : null,
    notes: text(material.notes)
  };
}

function normalizeLineAssessment(value = {}) {
  const line = object(value);
  const ruleCode = code(line.ruleCode || line.rule_code);
  return {
    exportLineId: text(line.exportLineId || line.export_line_id),
    ruleCode: RULE_CODES.has(ruleCode) ? ruleCode : '',
    ruleSourcePage: text(line.ruleSourcePage || line.rule_source_page),
    specialistRuleText: text(line.specialistRuleText || line.specialist_rule_text),
    productionProcesses: array(line.productionProcesses || line.production_processes)
      .map((item) => text(item).toLowerCase()).filter(Boolean),
    exWorksPrice: numberOrNull(line.exWorksPrice ?? line.ex_works_price),
    nonOriginatingMaterialValue: numberOrNull(
      line.nonOriginatingMaterialValue ?? line.non_originating_material_value
    ),
    materials: array(line.materials).map(normalizeMaterial),
    notes: text(line.notes)
  };
}

function normalizeOriginProfile(input = {}) {
  const claimType = text(input.claimType || input.claim_type).toLowerCase();
  const authorizationType = text(
    input.exporterAuthorizationType || input.exporter_authorization_type
  ).toLowerCase() || 'none';
  return {
    schemaId: HANDOFF_SCHEMA.id,
    schemaVersion: HANDOFF_SCHEMA.version,
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    handoffPurpose: 'origin_specialist_review',
    claimType: CLAIM_TYPES.has(claimType) ? claimType : 'certificate_application',
    invoiceTotalEur: numberOrNull(input.invoiceTotalEur ?? input.invoice_total_eur),
    exporterAuthorizationType: AUTHORIZATION_TYPES.has(authorizationType) ? authorizationType : 'none',
    exporterAuthorizationReference: text(
      input.exporterAuthorizationReference || input.exporter_authorization_reference
    ),
    territorialityConfirmed: input.territorialityConfirmed === true || input.territoriality_confirmed === true,
    nonAlterationConfirmed: input.nonAlterationConfirmed === true || input.non_alteration_confirmed === true,
    insufficientProcessingExcluded:
      input.insufficientProcessingExcluded === true || input.insufficient_processing_excluded === true,
    lineAssessments: array(input.lineAssessments || input.line_assessments).map(normalizeLineAssessment),
    notes: text(input.notes),
    metadata: object(input.metadata)
  };
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    ...normalizeOriginProfile({
      ...(row.profile_data || {}),
      claimType: row.claim_type,
      invoiceTotalEur: row.invoice_total_eur,
      exporterAuthorizationType: row.exporter_authorization_type,
      exporterAuthorizationReference: row.exporter_authorization_reference,
      territorialityConfirmed: row.territoriality_confirmed,
      nonAlterationConfirmed: row.non_alteration_confirmed,
      insufficientProcessingExcluded: row.insufficient_processing_excluded
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function expectedRuleCodes(hsCode) {
  const normalized = hs(hsCode);
  if (normalized.startsWith('61')) {
    return [
      'CH61_CUT_SEWN_KNITTING_AND_MAKING_UP',
      'CH61_KNITTED_TO_SHAPE_SPINNING_OR_EXTRUSION_AND_KNITTING'
    ];
  }
  if (normalized.startsWith('62')) {
    return CH62_EXCEPTIONS.some((prefix) => normalized.startsWith(prefix))
      ? ['SPECIALIST_RULE_REVIEW']
      : ['CH62_GENERAL_WEAVING_AND_MAKING_UP'];
  }
  if (normalized.startsWith('64')) return ['CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY'];
  return ['SPECIALIST_RULE_REVIEW'];
}

function validateRuleExecution(assessment) {
  const processes = new Set(assessment.productionProcesses);
  const materialRows = assessment.materials;
  if (assessment.ruleCode === 'CH61_CUT_SEWN_KNITTING_AND_MAKING_UP') {
    return processes.has('knitting') && processes.has('making_up_including_cutting');
  }
  if (assessment.ruleCode === 'CH61_KNITTED_TO_SHAPE_SPINNING_OR_EXTRUSION_AND_KNITTING') {
    return (processes.has('spinning') || processes.has('extrusion') || processes.has('natural_yarn_dyeing'))
      && processes.has('knitting');
  }
  if (assessment.ruleCode === 'CH62_GENERAL_WEAVING_AND_MAKING_UP') {
    return processes.has('weaving') && processes.has('making_up_including_cutting');
  }
  if (assessment.ruleCode === 'CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY') {
    return !materialRows.some((material) => material.originStatus === 'non_originating'
      && material.hsCode.startsWith('6406')
      && material.isUpperAssemblyAffixedToSole !== false);
  }
  if (assessment.ruleCode === 'SPECIALIST_RULE_REVIEW') {
    return assessment.specialistRuleText.length >= 20 && assessment.ruleSourcePage.length > 0;
  }
  return false;
}

function validateOriginHandoff(snapshot) {
  const trade = snapshot?.profile || {};
  if (trade.preferentialOriginClaim !== true) {
    return {
      status: 'not_applicable', schema: HANDOFF_SCHEMA, checks: [], blockingCodes: [],
      applicability: 'PREFERENCE_NOT_CLAIMED'
    };
  }
  const profile = snapshot?.originProfile;
  const lines = array(snapshot?.lines);
  const evidence = array(snapshot?.carrierDocuments).filter((item) => item?.type === 'origin_support');
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const assessments = array(profile?.lineAssessments);
  const checks = [];
  const add = (name, valid, fieldPath, message, expected = null, actual = null) => checks.push({
    code: name,
    status: valid ? 'ready' : (actual === '' || actual === null || actual === undefined ? 'missing' : 'invalid'),
    fieldPath, message: valid ? null : message, expected, actual, blocking: true
  });

  add('internal_schema_identity', profile?.schemaId === HANDOFF_SCHEMA.id
    && profile?.schemaVersion === HANDOFF_SCHEMA.version,
  'originProfile.schemaVersion', 'The controlled R07 origin handoff schema is missing or unsupported.',
  `${HANDOFF_SCHEMA.id}@${HANDOFF_SCHEMA.version}`, profile ? `${profile.schemaId}@${profile.schemaVersion}` : null);
  add('evfta_lane', code(snapshot?.shipment?.originCountry) === 'VN'
    && EU_COUNTRY_CODES.has(code(snapshot?.shipment?.destinationCountry)),
  'shipment', 'R07 currently supports Vietnam-to-EU specialist handoff only.', 'VN to EU',
  `${code(snapshot?.shipment?.originCountry)} to ${code(snapshot?.shipment?.destinationCountry)}`);
  add('territoriality', profile?.territorialityConfirmed === true, 'originProfile.territorialityConfirmed',
    'Territoriality under EVFTA Protocol 1 must be confirmed.', true, profile?.territorialityConfirmed);
  add('non_alteration', profile?.nonAlterationConfirmed === true, 'originProfile.nonAlterationConfirmed',
    'Non-alteration and transit evidence must be confirmed.', true, profile?.nonAlterationConfirmed);
  add('insufficient_processing', profile?.insufficientProcessingExcluded === true,
    'originProfile.insufficientProcessingExcluded',
    'The exporter must confirm production goes beyond insufficient operations in Article 6.', true,
    profile?.insufficientProcessingExcluded);

  const invoiceTotal = Number(profile?.invoiceTotalEur);
  add('invoice_total_eur', Number.isFinite(invoiceTotal) && invoiceTotal > 0, 'originProfile.invoiceTotalEur',
    'A positive shipment invoice total in EUR is required to evaluate origin-declaration eligibility.', '> 0',
    profile?.invoiceTotalEur);
  if (profile?.claimType === 'origin_declaration_draft' && invoiceTotal > 6000) {
    add('exporter_authorization', ['approved', 'registered'].includes(profile?.exporterAuthorizationType)
      && Boolean(text(profile?.exporterAuthorizationReference)),
    'originProfile.exporterAuthorizationReference',
    'An approved/registered exporter reference is required for an origin-declaration draft above EUR 6,000.',
    'approved or registered exporter reference', profile?.exporterAuthorizationReference || null);
  }

  add('goods_lines', lines.length > 0, 'lines', 'At least one shipment line is required.', '> 0', lines.length);
  lines.forEach((line, index) => {
    const prefix = `originProfile.lineAssessments[${index}]`;
    const matches = assessments.filter((item) => item.exportLineId === line.id);
    add(`line_${index + 1}_assessment`, matches.length === 1, `${prefix}.exportLineId`,
      `Shipment line ${index + 1} must have exactly one origin assessment.`, 1, matches.length);
    if (matches.length !== 1) return;
    const assessment = matches[0];
    const hsCode = hs(line.hsCode);
    add(`line_${index + 1}_hs_confirmed`, /^\d{6,10}$/.test(hsCode) && line.hsCodeConfirmed === true,
      `lines[${index}].hsCode`, `Line ${index + 1} requires a confirmed 6-to-10-digit HS/CN code.`,
      'confirmed HS6+', hsCode || null);
    const expectedRules = expectedRuleCodes(hsCode);
    add(`line_${index + 1}_rule_selection`, expectedRules.includes(assessment.ruleCode), `${prefix}.ruleCode`,
      `Line ${index + 1} rule selection does not match the conservative Annex-II route for HS ${hsCode || '(missing)'}.`,
      expectedRules, assessment.ruleCode || null);
    add(`line_${index + 1}_rule_source_page`, Boolean(assessment.ruleSourcePage), `${prefix}.ruleSourcePage`,
      `Line ${index + 1} requires the exact Annex-II page/row reference.`, 'non-empty',
      assessment.ruleSourcePage || null);
    add(`line_${index + 1}_rule_execution`, validateRuleExecution(assessment), `${prefix}.productionProcesses`,
      `Line ${index + 1} does not evidence the selected product-specific rule or requires specialist rule text.`,
      assessment.ruleCode, assessment.productionProcesses);
    add(`line_${index + 1}_ex_works_price`, Number(assessment.exWorksPrice) > 0, `${prefix}.exWorksPrice`,
      `Line ${index + 1} requires a positive ex-works price.`, '> 0', assessment.exWorksPrice);
    add(`line_${index + 1}_bom`, assessment.materials.length > 0, `${prefix}.materials`,
      `Line ${index + 1} requires a material-level origin BOM.`, '> 0', assessment.materials.length);
    const declaredNonOriginating = assessment.materials.reduce((sum, material) =>
      sum + (material.originStatus === 'non_originating' ? Number(material.value || 0) : 0), 0);
    add(`line_${index + 1}_non_originating_value`, Number(assessment.nonOriginatingMaterialValue) >= 0
      && Math.abs(Number(assessment.nonOriginatingMaterialValue) - declaredNonOriginating) <= 0.01,
    `${prefix}.nonOriginatingMaterialValue`, `Line ${index + 1} non-originating value must reconcile with its BOM.`,
    declaredNonOriginating, assessment.nonOriginatingMaterialValue);
    add(`line_${index + 1}_value_boundary`, declaredNonOriginating <= Number(assessment.exWorksPrice || 0),
      `${prefix}.materials[].value`, `Line ${index + 1} material value cannot exceed its ex-works price.`,
      `<= ${assessment.exWorksPrice}`, declaredNonOriginating);
    assessment.materials.forEach((material, materialIndex) => {
      const materialPath = `${prefix}.materials[${materialIndex}]`;
      add(`line_${index + 1}_material_${materialIndex + 1}_identity`, Boolean(material.reference
        && material.description && /^\d{4,10}$/.test(material.hsCode) && /^[A-Z]{2}$/.test(material.originCountry)),
      materialPath, `Line ${index + 1} material ${materialIndex + 1} needs reference, description, HS4+ and origin country.`,
      'complete material identity', material.reference || null);
      add(`line_${index + 1}_material_${materialIndex + 1}_status`, material.originStatus !== 'unknown',
        `${materialPath}.originStatus`, `Line ${index + 1} material ${materialIndex + 1} origin status is unknown.`,
        [...ORIGIN_STATUSES].filter((item) => item !== 'unknown'), material.originStatus);
      const support = evidenceById.get(material.evidenceDocumentId);
      add(`line_${index + 1}_material_${materialIndex + 1}_evidence`, Boolean(support
        && ['locked', 'third_party_verified'].includes(support.status)
        && /^[a-f0-9]{64}$/i.test(text(support.checksumSha256))),
      `${materialPath}.evidenceDocumentId`,
      `Line ${index + 1} material ${materialIndex + 1} requires current locked origin-support evidence with SHA-256.`,
      'locked origin_support evidence', material.evidenceDocumentId || null);
      if (material.originStatus === 'cumulated') {
        add(`line_${index + 1}_material_${materialIndex + 1}_cumulation`, material.cumulationBasis !== 'none',
          `${materialPath}.cumulationBasis`, `Line ${index + 1} material ${materialIndex + 1} requires an explicit cumulation basis.`,
          [...CUMULATION_BASES].filter((item) => item !== 'none'), material.cumulationBasis);
      }
      if (assessment.ruleCode === 'CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY'
        && material.originStatus === 'non_originating' && material.hsCode.startsWith('6406')) {
        add(`line_${index + 1}_material_${materialIndex + 1}_upper_assembly_classification`,
          material.isUpperAssemblyAffixedToSole === false,
          `${materialPath}.isUpperAssemblyAffixedToSole`,
          `Line ${index + 1} material ${materialIndex + 1} must be explicitly confirmed not to be an excluded upper assembly affixed to an inner sole or other sole component.`,
          false, material.isUpperAssemblyAffixedToSole);
      }
    });
  });
  const knownLineIds = new Set(lines.map((line) => line.id));
  add('assessment_line_references', assessments.every((item) => knownLineIds.has(item.exportLineId)),
    'originProfile.lineAssessments[].exportLineId', 'Origin assessments contain unknown shipment-line references.',
    'known shipment lines', assessments.map((item) => item.exportLineId));

  const blocking = checks.filter((item) => item.blocking && item.status !== 'ready');
  return {
    status: blocking.length ? 'blocked' : 'ready_for_specialist_review',
    schema: HANDOFF_SCHEMA,
    checks,
    blockingCodes: blocking.map((item) => item.code),
    applicability: 'PREFERENCE_CLAIMED'
  };
}

function buildOriginHandoffDataset(snapshot, {
  generatedAt = new Date().toISOString(), documentVersion = null,
  sourceSnapshotSha256 = null, reconciliation = null
} = {}) {
  const profile = normalizeOriginProfile(snapshot?.originProfile || {});
  const lines = array(snapshot?.lines);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  return {
    schema: HANDOFF_SCHEMA,
    datasetNature: 'EVFTA_ORIGIN_SUPPORT_HANDOFF_NOT_PROOF_OF_ORIGIN',
    notProofOfOrigin: true,
    proofOfOriginStatus: 'NOT_ISSUED',
    preferentialTreatmentStatus: 'NOT_GRANTED',
    specialistReviewRequired: true,
    generatedAt,
    documentVersion,
    sourceSnapshotSha256,
    reconciliationStatus: reconciliation?.status || null,
    claim: {
      ...profile,
      lineAssessments: profile.lineAssessments.map((assessment) => ({
        ...assessment,
        shipmentLine: lineById.has(assessment.exportLineId) ? {
          lineNumber: lineById.get(assessment.exportLineId).lineNumber,
          sku: lineById.get(assessment.exportLineId).sku,
          hsCode: hs(lineById.get(assessment.exportLineId).hsCode),
          description: lineById.get(assessment.exportLineId).goodsDescription
        } : null
      }))
    },
    shipment: {
      id: snapshot?.shipment?.id || null,
      referenceNumber: snapshot?.shipment?.referenceNumber || null,
      originCountry: snapshot?.shipment?.originCountry || null,
      destinationCountry: snapshot?.shipment?.destinationCountry || null,
      invoiceNumber: snapshot?.profile?.invoiceNumber || null
    },
    declarations: [
      'This is an internal evidence and calculation handoff for origin-specialist review; it is not a certificate of origin or origin declaration.',
      'WeaveCarbon does not determine preferential origin, issue EUR.1, endorse a certificate or grant preferential tariff treatment.',
      'The exporter and competent authority or authorised customs/origin specialist must verify the exact HS classification, Annex-II rule, evidence and applicable proof route.'
    ]
  };
}

module.exports = {
  AUTHORIZATION_TYPES,
  CLAIM_TYPES,
  CUMULATION_BASES,
  HANDOFF_SCHEMA,
  ORIGIN_STATUSES,
  RULE_CODES,
  buildOriginHandoffDataset,
  expectedRuleCodes,
  normalizeLineAssessment,
  normalizeMaterial,
  normalizeOriginProfile,
  profileFromRow,
  validateOriginHandoff
};
