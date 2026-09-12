const HANDOFF_SCHEMA = Object.freeze({
  id: 'weavecarbon.eu-import-declarant-handoff',
  version: '1.0.0',
  rulesetVersion: 'R05-EU-IMPORT-HANDOFF-2026.09.1',
  regulatoryBasisVersion: 'UCC-DA-2015/2446-ANNEX-B+UCC-IA-2015/2447-ANNEX-B@EUCDM-7.0.11',
  eucdmVersion: '7.0.11'
});

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const REPRESENTATION_TYPES = new Set(['none', 'direct', 'indirect']);
const REQUIREMENT_STATUSES = new Set(['not_required', 'required']);
const TAX_TREATMENTS = new Set(['not_subject', 'exempt', 'payable']);
const PREFERENCE_STATUSES = new Set(['no_claim', 'claimed']);
const EVENT_TYPES = new Set([
  'declarant_received', 'declarant_validated', 'declarant_rejected',
  'authority_submitted', 'authority_accepted', 'authority_rejected',
  'authority_released', 'authority_cancelled',
  'amendment_requested', 'amendment_submitted'
]);
const AUTHORITY_EVENT_TYPES = new Set([
  'authority_accepted', 'authority_rejected', 'authority_released', 'authority_cancelled'
]);

function text(value) { return String(value ?? '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}
function code(value) { return text(value).toUpperCase(); }
function digits(value) { return text(value).replace(/[^0-9]/g, ''); }
function validEori(value) { return /^[A-Z]{2}[A-Z0-9]{1,15}$/.test(code(value)); }

function normalizeEuImportProfile(input = {}) {
  return {
    schemaId: HANDOFF_SCHEMA.id,
    schemaVersion: HANDOFF_SCHEMA.version,
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    filingPurpose: 'declarant_handoff',
    memberStateCode: code(input.memberStateCode || input.member_state_code),
    importer: object(input.importer),
    declarant: object(input.declarant),
    representative: object(input.representative),
    representationType: text(input.representationType || input.representation_type).toLowerCase() || 'none',
    customsOfficeCode: code(input.customsOfficeCode || input.customs_office_code),
    declarationDatasetCode: code(input.declarationDatasetCode || input.declaration_dataset_code),
    additionalDeclarationType: code(input.additionalDeclarationType || input.additional_declaration_type),
    requestedProcedureCode: code(input.requestedProcedureCode || input.requested_procedure_code),
    previousProcedureCode: code(input.previousProcedureCode || input.previous_procedure_code),
    modeOfTransportAtBorder: code(input.modeOfTransportAtBorder || input.mode_of_transport_at_border),
    inlandModeOfTransport: code(input.inlandModeOfTransport || input.inland_mode_of_transport),
    borderTransportIdentity: text(input.borderTransportIdentity || input.border_transport_identity),
    placeOfGoodsCode: code(input.placeOfGoodsCode || input.place_of_goods_code),
    deliveryTermsLocation: text(input.deliveryTermsLocation || input.delivery_terms_location),
    valuationMethodCode: code(input.valuationMethodCode || input.valuation_method_code),
    exchangeRate: numberOrNull(input.exchangeRate ?? input.exchange_rate),
    customsValueCurrency: code(input.customsValueCurrency || input.customs_value_currency),
    customsValueAmount: numberOrNull(input.customsValueAmount ?? input.customs_value_amount),
    dutyTreatment: text(input.dutyTreatment || input.duty_treatment).toLowerCase() || 'unknown',
    dutyRate: numberOrNull(input.dutyRate ?? input.duty_rate),
    dutyAmount: numberOrNull(input.dutyAmount ?? input.duty_amount),
    vatTreatment: text(input.vatTreatment || input.vat_treatment).toLowerCase() || 'unknown',
    vatRate: numberOrNull(input.vatRate ?? input.vat_rate),
    vatAmount: numberOrNull(input.vatAmount ?? input.vat_amount),
    taxBasis: text(input.taxBasis || input.tax_basis),
    restrictionStatus: text(input.restrictionStatus || input.restriction_status).toLowerCase() || 'unknown',
    restrictionReferences: array(input.restrictionReferences || input.restriction_references),
    preferenceClaimStatus: text(input.preferenceClaimStatus || input.preference_claim_status).toLowerCase() || 'no_claim',
    preferenceReferences: array(input.preferenceReferences || input.preference_references),
    guaranteeRequirementStatus: text(input.guaranteeRequirementStatus || input.guarantee_requirement_status).toLowerCase() || 'unknown',
    guaranteeReferences: array(input.guaranteeReferences || input.guarantee_references),
    supportingDocuments: array(input.supportingDocuments || input.supporting_documents),
    targetSystemSchemaId: text(input.targetSystemSchemaId || input.target_system_schema_id),
    targetSystemSchemaVersion: text(input.targetSystemSchemaVersion || input.target_system_schema_version),
    declarationNotes: text(input.declarationNotes || input.declaration_notes),
    metadata: object(input.metadata)
  };
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    ...normalizeEuImportProfile({
      memberStateCode: row.member_state_code,
      importer: row.importer,
      declarant: row.declarant,
      representative: row.representative,
      representationType: row.representation_type,
      customsOfficeCode: row.customs_office_code,
      declarationDatasetCode: row.declaration_dataset_code,
      additionalDeclarationType: row.additional_declaration_type,
      requestedProcedureCode: row.requested_procedure_code,
      previousProcedureCode: row.previous_procedure_code,
      modeOfTransportAtBorder: row.mode_of_transport_at_border,
      inlandModeOfTransport: row.inland_mode_of_transport,
      borderTransportIdentity: row.border_transport_identity,
      placeOfGoodsCode: row.place_of_goods_code,
      deliveryTermsLocation: row.delivery_terms_location,
      valuationMethodCode: row.valuation_method_code,
      exchangeRate: row.exchange_rate,
      customsValueCurrency: row.customs_value_currency,
      customsValueAmount: row.customs_value_amount,
      dutyTreatment: row.duty_treatment,
      dutyRate: row.duty_rate,
      dutyAmount: row.duty_amount,
      vatTreatment: row.vat_treatment,
      vatRate: row.vat_rate,
      vatAmount: row.vat_amount,
      taxBasis: row.tax_basis,
      restrictionStatus: row.restriction_status,
      restrictionReferences: row.restriction_references,
      preferenceClaimStatus: row.preference_claim_status,
      preferenceReferences: row.preference_references,
      guaranteeRequirementStatus: row.guarantee_requirement_status,
      guaranteeReferences: row.guarantee_references,
      supportingDocuments: row.supporting_documents,
      targetSystemSchemaId: row.target_system_schema_id,
      targetSystemSchemaVersion: row.target_system_schema_version,
      declarationNotes: row.declaration_notes,
      metadata: row.metadata
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeEuImportLineDetail(input = {}) {
  return {
    exportLineId: text(input.exportLineId || input.export_line_id),
    taricCode: digits(input.taricCode || input.taric_code),
    taricSource: text(input.taricSource || input.taric_source),
    taricVersion: text(input.taricVersion || input.taric_version),
    taricEffectiveDate: dateOnly(input.taricEffectiveDate || input.taric_effective_date),
    taricConfirmed: input.taricConfirmed === true || input.taric_confirmed === true,
    supplementaryUnitCode: code(input.supplementaryUnitCode || input.supplementary_unit_code),
    additionalCodes: array(input.additionalCodes || input.additional_codes).map(code).filter(Boolean),
    nationalAdditionalCodes: array(input.nationalAdditionalCodes || input.national_additional_codes).map(code).filter(Boolean),
    preferenceCode: code(input.preferenceCode || input.preference_code),
    requestedProcedureCode: code(input.requestedProcedureCode || input.requested_procedure_code),
    previousProcedureCode: code(input.previousProcedureCode || input.previous_procedure_code),
    metadata: object(input.metadata)
  };
}

function lineDetailFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    ...normalizeEuImportLineDetail({
      exportLineId: row.export_line_id,
      taricCode: row.taric_code,
      taricSource: row.taric_source,
      taricVersion: row.taric_version,
      taricEffectiveDate: row.taric_effective_date,
      taricConfirmed: row.taric_confirmed,
      supplementaryUnitCode: row.supplementary_unit_code,
      additionalCodes: row.additional_codes,
      nationalAdditionalCodes: row.national_additional_codes,
      preferenceCode: row.preference_code,
      requestedProcedureCode: row.requested_procedure_code,
      previousProcedureCode: row.previous_procedure_code,
      metadata: row.metadata
    }),
    taricConfirmedBy: row.taric_confirmed_by || null,
    taricConfirmedAt: row.taric_confirmed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateEuImportHandoff(snapshot, {
  isCarrierCurrent = () => false,
  isSupportingDocumentCurrent = () => false
} = {}) {
  const profile = snapshot?.euImportProfile;
  const trade = snapshot?.profile || {};
  const lines = array(snapshot?.lines);
  const details = array(snapshot?.euImportLineDetails);
  const packages = array(snapshot?.packages).filter((item) => text(item?.packageType).toLowerCase() !== 'pallet');
  const checks = [];
  const add = (codeName, valid, fieldPath, message, expected = null, actual = null) => checks.push({
    code: codeName,
    status: valid ? 'ready' : (actual === '' || actual === null || actual === undefined ? 'missing' : 'invalid'),
    fieldPath,
    message: valid ? null : message,
    expected,
    actual,
    blocking: true
  });
  const required = (codeName, value, fieldPath, label) => add(codeName, Boolean(text(value)), fieldPath,
    `${label} is required.`, 'non-empty', text(value));
  const party = (key, value) => {
    required(`${key}_name`, value?.name, `euImportProfile.${key}.name`, `${key} name`);
    required(`${key}_address`, value?.address, `euImportProfile.${key}.address`, `${key} address`);
    add(`${key}_eori`, validEori(value?.eori), `euImportProfile.${key}.eori`,
      `${key} EORI must start with a 2-letter country prefix followed by up to 15 letters/digits.`, 'valid EORI', code(value?.eori) || null);
  };

  add('internal_schema_identity', profile?.schemaId === HANDOFF_SCHEMA.id && profile?.schemaVersion === HANDOFF_SCHEMA.version,
    'euImportProfile.schemaVersion', 'The controlled EU import handoff schema identity is missing or unsupported.',
    `${HANDOFF_SCHEMA.id}@${HANDOFF_SCHEMA.version}`, profile ? `${profile.schemaId}@${profile.schemaVersion}` : null);
  add('filing_purpose', profile?.filingPurpose === 'declarant_handoff', 'euImportProfile.filingPurpose',
    'R05 supports declarant handoff only; direct national customs submission is not supported.', 'declarant_handoff', profile?.filingPurpose || null);
  required('target_system_schema_id', profile?.targetSystemSchemaId, 'euImportProfile.targetSystemSchemaId', 'National/declarant target schema ID');
  required('target_system_schema_version', profile?.targetSystemSchemaVersion, 'euImportProfile.targetSystemSchemaVersion', 'National/declarant target schema version');

  const destination = code(snapshot?.shipment?.destinationCountry);
  const memberState = code(profile?.memberStateCode);
  add('member_state', EU_COUNTRY_CODES.has(memberState), 'euImportProfile.memberStateCode',
    'The import Member State must be an EU ISO alpha-2 code.', 'EU ISO alpha-2', memberState || null);
  add('destination_member_state_match', memberState && memberState === destination, 'shipment.destinationCountry',
    'Shipment destination country must match the import Member State.', memberState || null, destination || null);
  add('third_country_origin', code(snapshot?.shipment?.originCountry) && !EU_COUNTRY_CODES.has(code(snapshot?.shipment?.originCountry)),
    'shipment.originCountry', 'R05 standard import handoff requires goods arriving from outside the EU.', 'non-EU origin', code(snapshot?.shipment?.originCountry) || null);

  party('importer', profile?.importer);
  party('declarant', profile?.declarant);
  add('representation_type', REPRESENTATION_TYPES.has(profile?.representationType), 'euImportProfile.representationType',
    'Representation type must be none, direct or indirect.', [...REPRESENTATION_TYPES], profile?.representationType || null);
  if (profile?.representationType !== 'none') party('representative', profile?.representative);

  [
    ['customs_office_code', profile?.customsOfficeCode, 'Customs office code'],
    ['declaration_dataset_code', profile?.declarationDatasetCode, 'EUCDM declaration dataset code'],
    ['additional_declaration_type', profile?.additionalDeclarationType, 'Additional declaration type'],
    ['requested_procedure_code', profile?.requestedProcedureCode, 'Requested procedure code'],
    ['previous_procedure_code', profile?.previousProcedureCode, 'Previous procedure code'],
    ['mode_of_transport_at_border', profile?.modeOfTransportAtBorder, 'Mode of transport at the border'],
    ['inland_mode_of_transport', profile?.inlandModeOfTransport, 'Inland mode of transport'],
    ['place_of_goods_code', profile?.placeOfGoodsCode, 'Location/place of goods code'],
    ['valuation_method_code', profile?.valuationMethodCode, 'Valuation method code']
  ].forEach(([codeName, value, label]) => {
    const normalized = code(value);
    add(codeName, /^[A-Z0-9][A-Z0-9._/-]{0,34}$/.test(normalized),
      `euImportProfile.${codeName.replace(/_([a-z])/g, (_, char) => char.toUpperCase())}`,
      `${label} must be a controlled target-system code.`, 'controlled code', normalized || null);
  });
  required('border_transport_identity', profile?.borderTransportIdentity, 'euImportProfile.borderTransportIdentity', 'Border transport identity');
  required('delivery_terms_location', profile?.deliveryTermsLocation || trade.incotermLocation,
    'euImportProfile.deliveryTermsLocation', 'Delivery terms location');

  required('invoice_number', trade.invoiceNumber, 'profile.invoiceNumber', 'Commercial Invoice number');
  required('invoice_date', trade.invoiceDate, 'profile.invoiceDate', 'Commercial Invoice date');
  required('packing_list_number', trade.packingListNumber, 'profile.packingListNumber', 'Packing List number');
  required('contract_reference', trade.poContractId, 'profile.poContractId', 'PO/contract reference');
  required('invoice_currency', trade.currency, 'profile.currency', 'Invoice currency');
  const exchangeRate = numberOrNull(profile?.exchangeRate);
  add('exchange_rate', exchangeRate !== null && exchangeRate > 0, 'euImportProfile.exchangeRate',
    'A positive customs exchange rate is required.', '> 0', exchangeRate);
  add('customs_value_currency', /^[A-Z]{3}$/.test(code(profile?.customsValueCurrency)),
    'euImportProfile.customsValueCurrency', 'Customs value currency must be an ISO 4217 code.', 'ISO 4217', code(profile?.customsValueCurrency) || null);
  const customsValue = numberOrNull(profile?.customsValueAmount);
  add('customs_value_amount', customsValue !== null && customsValue >= 0, 'euImportProfile.customsValueAmount',
    'A non-negative import customs value is required.', '>= 0', customsValue);
  const tradeCustomsValue = numberOrNull(trade.customsValueAmount);
  const tolerance = (left, right) => Math.abs(Number(left) - Number(right)) <= Math.max(0.01, Math.abs(Number(left)) * 0.001);
  add('customs_value_reconciliation', customsValue !== null && tradeCustomsValue !== null && tolerance(customsValue, tradeCustomsValue),
    'euImportProfile.customsValueAmount', 'Import customs value must reconcile with the controlled Commercial Invoice customs value.',
    tradeCustomsValue, customsValue);

  add('goods_lines', lines.length > 0, 'lines', 'At least one goods line is required.', '> 0', lines.length);
  lines.forEach((line, index) => {
    const detail = details.find((item) => item.exportLineId === line.id);
    const prefix = `euImportLineDetails[${index}]`;
    add(`line_${index + 1}_mapping`, Boolean(detail), prefix, `EU import classification is required for line ${index + 1}.`, 'mapped line', detail?.id || null);
    const taric = digits(detail?.taricCode);
    add(`line_${index + 1}_taric10`, /^\d{10}$/.test(taric), `${prefix}.taricCode`,
      `TARIC code for line ${index + 1} must contain exactly 10 digits.`, '10 digits', taric || null);
    const sourceHs = digits(line.hsCode);
    add(`line_${index + 1}_classification_continuity`, /^\d{10}$/.test(taric) && sourceHs.length >= 6 && taric.startsWith(sourceHs.slice(0, 6)),
      `${prefix}.taricCode`, `TARIC code for line ${index + 1} must preserve the controlled HS6 heading.`, sourceHs.slice(0, 6) || null, taric.slice(0, 6) || null);
    required(`line_${index + 1}_taric_source`, detail?.taricSource, `${prefix}.taricSource`, `TARIC source for line ${index + 1}`);
    required(`line_${index + 1}_taric_version`, detail?.taricVersion, `${prefix}.taricVersion`, `TARIC version for line ${index + 1}`);
    required(`line_${index + 1}_taric_effective_date`, detail?.taricEffectiveDate, `${prefix}.taricEffectiveDate`, `TARIC effective date for line ${index + 1}`);
    add(`line_${index + 1}_taric_confirmed`, detail?.taricConfirmed === true, `${prefix}.taricConfirmed`,
      `TARIC classification for line ${index + 1} requires a separate named confirmation.`, true, detail?.taricConfirmed === true);
    required(`line_${index + 1}_procedure`, detail?.requestedProcedureCode || profile?.requestedProcedureCode,
      `${prefix}.requestedProcedureCode`, `Requested procedure for line ${index + 1}`);
    add(`line_${index + 1}_quantity`, Number(line.quantity) > 0, `lines[${index}].quantity`,
      `Quantity for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.quantity));
    add(`line_${index + 1}_net_weight`, Number(line.netWeightKg) > 0, `lines[${index}].netWeightKg`,
      `Net weight for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.netWeightKg));
    add(`line_${index + 1}_gross_weight`, Number(line.grossWeightKg) > 0, `lines[${index}].grossWeightKg`,
      `Gross weight for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.grossWeightKg));
  });

  add('packages', packages.length > 0, 'packages', 'At least one physical package is required.', '> 0', packages.length);
  const packageFactor = (item) => item?.weightMeasurementBasis === 'group_total' ? 1 : Number(item?.quantity || 1);
  const lineNet = lines.reduce((sum, item) => sum + Number(item.netWeightKg || 0), 0);
  const lineGross = lines.reduce((sum, item) => sum + Number(item.grossWeightKg || 0), 0);
  const packageNet = packages.reduce((sum, item) => sum + Number(item.netWeightKg || 0) * packageFactor(item), 0);
  const packageGross = packages.reduce((sum, item) => sum + Number(item.grossWeightKg || 0) * packageFactor(item), 0);
  add('net_weight_reconciliation', tolerance(lineNet, packageNet), 'packages[].netWeightKg',
    'Goods-line net weight must reconcile with physical packages.', packageNet, lineNet);
  add('gross_weight_reconciliation', tolerance(lineGross, packageGross), 'packages[].grossWeightKg',
    'Goods-line gross weight must reconcile with physical packages.', packageGross, lineGross);

  add('duty_treatment', TAX_TREATMENTS.has(profile?.dutyTreatment), 'euImportProfile.dutyTreatment',
    'Customs-duty treatment must be explicitly payable, exempt or not_subject.', [...TAX_TREATMENTS], profile?.dutyTreatment || null);
  add('duty_values', profile?.dutyTreatment !== 'payable' || (numberOrNull(profile?.dutyRate) !== null && numberOrNull(profile?.dutyAmount) !== null),
    'euImportProfile.dutyAmount', 'Duty rate and amount are required when duty is payable.', 'rate and amount', profile?.dutyAmount);
  add('vat_treatment', TAX_TREATMENTS.has(profile?.vatTreatment), 'euImportProfile.vatTreatment',
    'Import VAT treatment must be explicitly payable, exempt or not_subject.', [...TAX_TREATMENTS], profile?.vatTreatment || null);
  add('vat_values', profile?.vatTreatment !== 'payable' || (numberOrNull(profile?.vatRate) !== null && numberOrNull(profile?.vatAmount) !== null),
    'euImportProfile.vatAmount', 'VAT rate and amount are required when import VAT is payable.', 'rate and amount', profile?.vatAmount);
  add('tax_basis', !['payable'].includes(profile?.dutyTreatment) && !['payable'].includes(profile?.vatTreatment) || Boolean(text(profile?.taxBasis)),
    'euImportProfile.taxBasis', 'Tax basis is required when duty or VAT is payable.', 'non-empty when payable', profile?.taxBasis || null);
  add('restriction_determination', REQUIREMENT_STATUSES.has(profile?.restrictionStatus), 'euImportProfile.restrictionStatus',
    'Import restriction applicability must be explicitly required or not_required.', [...REQUIREMENT_STATUSES], profile?.restrictionStatus || null);
  add('restriction_references', profile?.restrictionStatus !== 'required' || array(profile?.restrictionReferences).length > 0,
    'euImportProfile.restrictionReferences', 'Restriction references are required when controls apply.', '> 0', array(profile?.restrictionReferences).length);
  add('preference_claim', PREFERENCE_STATUSES.has(profile?.preferenceClaimStatus), 'euImportProfile.preferenceClaimStatus',
    'Preference status must be no_claim or claimed.', [...PREFERENCE_STATUSES], profile?.preferenceClaimStatus || null);
  add('preference_references', profile?.preferenceClaimStatus !== 'claimed' || array(profile?.preferenceReferences).length > 0,
    'euImportProfile.preferenceReferences', 'Origin/preference references are required when preference is claimed.', '> 0', array(profile?.preferenceReferences).length);
  add('guarantee_determination', REQUIREMENT_STATUSES.has(profile?.guaranteeRequirementStatus), 'euImportProfile.guaranteeRequirementStatus',
    'Guarantee applicability must be explicitly required or not_required.', [...REQUIREMENT_STATUSES], profile?.guaranteeRequirementStatus || null);
  add('guarantee_references', profile?.guaranteeRequirementStatus !== 'required' || array(profile?.guaranteeReferences).length > 0,
    'euImportProfile.guaranteeReferences', 'Guarantee references are required when a guarantee applies.', '> 0', array(profile?.guaranteeReferences).length);

  const supportTypes = new Set(array(profile?.supportingDocuments).map((item) => text(item?.type || item).toLowerCase()));
  ['commercial_invoice', 'packing_list', 'carrier_document'].forEach((type) => add(`${type}_reference`, supportTypes.has(type),
    'euImportProfile.supportingDocuments', `The declarant handoff must reference the controlled ${type}.`, type, [...supportTypes]));
  ['commercial_invoice', 'packing_list'].forEach((documentType) => {
    const issued = array(snapshot?.documents).find((document) => document?.type === documentType
      && document?.status === 'issued' && isSupportingDocumentCurrent(document));
    add(`${documentType}_issued_current`, Boolean(issued), 'documents',
      `A current issued ${documentType} with exact payload/file checksums is required.`, `current issued ${documentType}`, issued?.id || null);
  });
  const carrier = array(snapshot?.carrierDocuments).find((item) => item?.structured?.status === 'confirmed' && isCarrierCurrent(item));
  add('carrier_document_reconciliation', Boolean(carrier), 'carrierDocuments',
    'A confirmed carrier document with a current passing reconciliation is required.', 'current confirmed carrier document', carrier?.structured?.id || null);

  const blocking = checks.filter((item) => item.status !== 'ready');
  return {
    status: blocking.length ? 'failed' : 'passed',
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    checks,
    summary: {
      memberStateCode: memberState,
      goodsLineCount: lines.length,
      mappedLineCount: details.length,
      packageCount: packages.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      netWeightKg: packageNet,
      grossWeightKg: packageGross,
      customsValue,
      carrierDocumentId: carrier?.structured?.id || null
    }
  };
}

function buildEuImportHandoffDataset(snapshot, options = {}) {
  const profile = snapshot.euImportProfile;
  const trade = snapshot.profile || {};
  const details = array(snapshot.euImportLineDetails);
  const packages = array(snapshot.packages).filter((item) => text(item.packageType).toLowerCase() !== 'pallet');
  const carrier = array(snapshot.carrierDocuments).find((item) => item?.structured?.status === 'confirmed');
  return {
    schema: { id: HANDOFF_SCHEMA.id, version: HANDOFF_SCHEMA.version },
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    eucdmReferenceVersion: HANDOFF_SCHEMA.eucdmVersion,
    generatedAt: options.generatedAt,
    documentVersion: options.documentVersion,
    sourceSnapshotSha256: options.sourceSnapshotSha256,
    controlStatus: 'DECLARANT_HANDOFF_CONTROLLED_COPY',
    authorityStatus: 'NOT_SUBMITTED',
    notForDirectSubmission: true,
    warning: 'This is a WeaveCarbon declarant-handoff dataset, not a SAD, national import message, customs declaration, MRN or authority acceptance.',
    targetMapping: {
      memberStateCode: profile.memberStateCode,
      targetSystemSchemaId: profile.targetSystemSchemaId,
      targetSystemSchemaVersion: profile.targetSystemSchemaVersion,
      declarationDatasetCode: profile.declarationDatasetCode
    },
    declaration: {
      customsOfficeCode: profile.customsOfficeCode,
      additionalDeclarationType: profile.additionalDeclarationType,
      requestedProcedureCode: profile.requestedProcedureCode,
      previousProcedureCode: profile.previousProcedureCode,
      importer: profile.importer,
      declarant: profile.declarant,
      representative: profile.representationType === 'none' ? null : profile.representative,
      representationType: profile.representationType,
      notes: profile.declarationNotes
    },
    commercial: {
      invoiceNumber: trade.invoiceNumber,
      invoiceDate: trade.invoiceDate,
      contractReference: trade.poContractId,
      invoiceCurrency: trade.currency,
      exchangeRate: profile.exchangeRate,
      customsValueCurrency: profile.customsValueCurrency,
      customsValueAmount: profile.customsValueAmount,
      valuationMethodCode: profile.valuationMethodCode,
      incoterm: { code: trade.incotermCode, location: profile.deliveryTermsLocation || trade.incotermLocation }
    },
    transport: {
      modeOfTransportAtBorder: profile.modeOfTransportAtBorder,
      inlandModeOfTransport: profile.inlandModeOfTransport,
      borderTransportIdentity: profile.borderTransportIdentity,
      placeOfGoodsCode: profile.placeOfGoodsCode,
      loadingPlace: trade.portOfLoading,
      dischargePlace: trade.portOfDischarge,
      deliveryPlace: trade.placeOfDelivery,
      carrierDocument: carrier ? {
        id: carrier.structured.id,
        type: carrier.structured.documentType,
        number: carrier.structured.documentNumber,
        issuer: carrier.structured.issuerName,
        fileSha256: carrier.checksumSha256
      } : null,
      containers: array(snapshot.containers).map((item) => ({
        number: item.containerNumber, seal: item.sealNumber, equipmentType: item.equipmentType
      }))
    },
    goods: array(snapshot.lines).map((line) => {
      const detail = details.find((item) => item.exportLineId === line.id) || {};
      return {
        lineNumber: line.lineNumber,
        sku: line.sku,
        description: line.goodsDescription,
        taricCode: detail.taricCode || '',
        taricSource: detail.taricSource || '',
        taricVersion: detail.taricVersion || '',
        taricEffectiveDate: detail.taricEffectiveDate || null,
        taricConfirmed: detail.taricConfirmed === true,
        taricConfirmedBy: detail.taricConfirmedBy || null,
        taricConfirmedAt: detail.taricConfirmedAt || null,
        supplementaryUnitCode: detail.supplementaryUnitCode || '',
        additionalCodes: detail.additionalCodes || [],
        nationalAdditionalCodes: detail.nationalAdditionalCodes || [],
        preferenceCode: detail.preferenceCode || '',
        requestedProcedureCode: detail.requestedProcedureCode || profile.requestedProcedureCode,
        previousProcedureCode: detail.previousProcedureCode || profile.previousProcedureCode,
        originCountry: line.originCountry,
        quantity: line.quantity,
        unit: line.unit,
        itemValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
        currency: line.currency || trade.currency,
        netWeightKg: line.netWeightKg,
        grossWeightKg: line.grossWeightKg,
        packageRefs: line.packageRefs || []
      };
    }),
    packages: packages.map((item) => ({
      number: item.packageNumber,
      type: item.packageType,
      marksAndNumbers: item.marksAndNumbers,
      quantity: item.quantity,
      netWeightKg: item.netWeightKg,
      grossWeightKg: item.grossWeightKg,
      weightMeasurementBasis: item.weightMeasurementBasis,
      containerNumber: item.containerNumber,
      sealNumber: item.sealNumber,
      contents: item.contents || []
    })),
    fiscal: {
      duty: { treatment: profile.dutyTreatment, rate: profile.dutyRate, amount: profile.dutyAmount },
      vat: { treatment: profile.vatTreatment, rate: profile.vatRate, amount: profile.vatAmount },
      taxBasis: profile.taxBasis
    },
    controls: {
      restrictions: { status: profile.restrictionStatus, references: profile.restrictionReferences },
      preference: { status: profile.preferenceClaimStatus, references: profile.preferenceReferences },
      guarantee: { status: profile.guaranteeRequirementStatus, references: profile.guaranteeReferences }
    },
    supportingDocuments: {
      declaredReferences: profile.supportingDocuments,
      controlledIssuedDocuments: array(snapshot.documents)
        .filter((document) => ['commercial_invoice', 'packing_list'].includes(document.type) && document.status === 'issued')
        .map((document) => ({
          id: document.id, type: document.type, version: document.version,
          payloadSha256: document.payloadSha256, fileSha256: document.fileSha256,
          filename: document.filename, issuedAt: document.issuedAt
        }))
    },
    reconciliation: options.reconciliation
  };
}

module.exports = {
  AUTHORITY_EVENT_TYPES,
  EU_COUNTRY_CODES,
  EVENT_TYPES,
  HANDOFF_SCHEMA,
  buildEuImportHandoffDataset,
  lineDetailFromRow,
  normalizeEuImportLineDetail,
  normalizeEuImportProfile,
  profileFromRow,
  validateEuImportHandoff
};
