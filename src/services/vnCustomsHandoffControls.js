const HANDOFF_SCHEMA = Object.freeze({
  id: 'weavecarbon.vn-export-broker-handoff',
  version: '1.0.0',
  rulesetVersion: 'R04-VN-CUSTOMS-HANDOFF-2026.09.1',
  regulatoryBasisVersion: 'TT38/2015+TT39/2018+TT121/2025@2026-02-01'
});

const REQUIREMENT_STATUSES = new Set(['not_required', 'required']);
const TAX_TREATMENTS = new Set(['not_subject', 'exempt', 'taxable']);
const DECLARANT_ROLES = new Set(['exporter', 'customs_broker']);
const EVENT_TYPES = new Set([
  'broker_received', 'broker_validated', 'broker_rejected',
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
function normalizeCode(value) { return text(value).toUpperCase(); }
function normalizedHs(value) { return text(value).replace(/[^0-9]/g, ''); }

function normalizeVnCustomsProfile(input = {}) {
  return {
    schemaId: HANDOFF_SCHEMA.id,
    schemaVersion: HANDOFF_SCHEMA.version,
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    filingPurpose: 'broker_handoff',
    declarant: object(input.declarant),
    customsBroker: object(input.customsBroker || input.customs_broker),
    customsOfficeCode: normalizeCode(input.customsOfficeCode || input.customs_office_code),
    declarationTypeCode: normalizeCode(input.declarationTypeCode || input.declaration_type_code),
    cargoClassificationCode: normalizeCode(input.cargoClassificationCode || input.cargo_classification_code),
    transportMethodCode: normalizeCode(input.transportMethodCode || input.transport_method_code),
    exitCustomsOfficeCode: normalizeCode(input.exitCustomsOfficeCode || input.exit_customs_office_code),
    loadingLocationCode: normalizeCode(input.loadingLocationCode || input.loading_location_code),
    destinationCountryCode: normalizeCode(input.destinationCountryCode || input.destination_country_code),
    invoiceClassificationCode: normalizeCode(input.invoiceClassificationCode || input.invoice_classification_code),
    invoicePaymentMethodCode: normalizeCode(input.invoicePaymentMethodCode || input.invoice_payment_method_code),
    exchangeRate: numberOrNull(input.exchangeRate ?? input.exchange_rate),
    permitRequirementStatus: text(input.permitRequirementStatus || input.permit_requirement_status).toLowerCase() || 'unknown',
    permitReferences: array(input.permitReferences || input.permit_references),
    inspectionRequirementStatus: text(input.inspectionRequirementStatus || input.inspection_requirement_status).toLowerCase() || 'unknown',
    inspectionReferences: array(input.inspectionReferences || input.inspection_references),
    taxTreatment: text(input.taxTreatment || input.tax_treatment).toLowerCase() || 'unknown',
    exportDutyRate: numberOrNull(input.exportDutyRate ?? input.export_duty_rate),
    exportDutyAmount: numberOrNull(input.exportDutyAmount ?? input.export_duty_amount),
    taxBasis: text(input.taxBasis || input.tax_basis),
    supportingDocuments: array(input.supportingDocuments || input.supporting_documents),
    brokerTargetSchemaId: text(input.brokerTargetSchemaId || input.broker_target_schema_id),
    brokerTargetSchemaVersion: text(input.brokerTargetSchemaVersion || input.broker_target_schema_version),
    declarationNotes: text(input.declarationNotes || input.declaration_notes),
    metadata: object(input.metadata)
  };
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    ...normalizeVnCustomsProfile({
    declarant: row.declarant,
    customsBroker: row.customs_broker,
    customsOfficeCode: row.customs_office_code,
    declarationTypeCode: row.declaration_type_code,
    cargoClassificationCode: row.cargo_classification_code,
    transportMethodCode: row.transport_method_code,
    exitCustomsOfficeCode: row.exit_customs_office_code,
    loadingLocationCode: row.loading_location_code,
    destinationCountryCode: row.destination_country_code,
    invoiceClassificationCode: row.invoice_classification_code,
    invoicePaymentMethodCode: row.invoice_payment_method_code,
    exchangeRate: row.exchange_rate,
    permitRequirementStatus: row.permit_requirement_status,
    permitReferences: row.permit_references,
    inspectionRequirementStatus: row.inspection_requirement_status,
    inspectionReferences: row.inspection_references,
    taxTreatment: row.tax_treatment,
    exportDutyRate: row.export_duty_rate,
    exportDutyAmount: row.export_duty_amount,
    taxBasis: row.tax_basis,
    supportingDocuments: row.supporting_documents,
    brokerTargetSchemaId: row.broker_target_schema_id,
    brokerTargetSchemaVersion: row.broker_target_schema_version,
    declarationNotes: row.declaration_notes,
      metadata: row.metadata
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateVnCustomsHandoff(snapshot, {
  isCarrierCurrent = () => false,
  isSupportingDocumentCurrent = () => false
} = {}) {
  const customs = snapshot?.vnCustomsProfile;
  const trade = snapshot?.profile || {};
  const lines = array(snapshot?.lines);
  const packages = array(snapshot?.packages).filter((item) => text(item?.packageType).toLowerCase() !== 'pallet');
  const checks = [];
  const add = (code, valid, fieldPath, message, expected = null, actual = null) => checks.push({
    code,
    status: valid ? 'ready' : (actual === '' || actual === null || actual === undefined ? 'missing' : 'invalid'),
    fieldPath,
    message: valid ? null : message,
    expected,
    actual,
    blocking: true
  });
  const requiredText = (code, value, fieldPath, label) => add(code, Boolean(text(value)), fieldPath, `${label} is required.`, 'non-empty', text(value));

  add('internal_schema_identity', customs?.schemaId === HANDOFF_SCHEMA.id && customs?.schemaVersion === HANDOFF_SCHEMA.version,
    'vnCustomsProfile.schemaVersion', 'The controlled WeaveCarbon broker-handoff schema identity is missing or unsupported.',
    `${HANDOFF_SCHEMA.id}@${HANDOFF_SCHEMA.version}`, customs ? `${customs.schemaId}@${customs.schemaVersion}` : null);
  add('filing_purpose', customs?.filingPurpose === 'broker_handoff', 'vnCustomsProfile.filingPurpose',
    'R04 supports broker handoff only; direct VNACCS submission is not supported.', 'broker_handoff', customs?.filingPurpose || null);
  requiredText('broker_target_schema_id', customs?.brokerTargetSchemaId, 'vnCustomsProfile.brokerTargetSchemaId', 'Broker target schema ID');
  requiredText('broker_target_schema_version', customs?.brokerTargetSchemaVersion, 'vnCustomsProfile.brokerTargetSchemaVersion', 'Broker target schema version');
  requiredText('broker_name', customs?.customsBroker?.name, 'vnCustomsProfile.customsBroker.name', 'Customs broker name');
  requiredText('broker_identifier', customs?.customsBroker?.taxId || customs?.customsBroker?.code,
    'vnCustomsProfile.customsBroker.taxId', 'Customs broker identifier');

  requiredText('declarant_name', customs?.declarant?.name, 'vnCustomsProfile.declarant.name', 'Declarant name');
  requiredText('declarant_tax_id', customs?.declarant?.taxId, 'vnCustomsProfile.declarant.taxId', 'Declarant tax ID');
  requiredText('declarant_address', customs?.declarant?.address, 'vnCustomsProfile.declarant.address', 'Declarant address');
  add('declarant_role', DECLARANT_ROLES.has(text(customs?.declarant?.role).toLowerCase()),
    'vnCustomsProfile.declarant.role', 'Declarant role must be exporter or customs_broker.', [...DECLARANT_ROLES], customs?.declarant?.role || null);

  [
    ['customs_office_code', customs?.customsOfficeCode, 'Customs office code'],
    ['declaration_type_code', customs?.declarationTypeCode, 'Declaration type code'],
    ['cargo_classification_code', customs?.cargoClassificationCode, 'Cargo classification code'],
    ['transport_method_code', customs?.transportMethodCode, 'VN customs transport method code'],
    ['exit_customs_office_code', customs?.exitCustomsOfficeCode, 'Exit customs office code'],
    ['loading_location_code', customs?.loadingLocationCode, 'Loading location code'],
    ['invoice_classification_code', customs?.invoiceClassificationCode, 'Invoice classification code'],
    ['invoice_payment_method_code', customs?.invoicePaymentMethodCode, 'Invoice payment method code']
  ].forEach(([code, value, label]) => {
    const normalized = normalizeCode(value);
    add(code, /^[A-Z0-9][A-Z0-9._/-]{0,19}$/.test(normalized), `vnCustomsProfile.${code.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`,
      `${label} must be 1-20 uppercase letters/digits or . _ / -.`, 'controlled broker code', normalized || null);
  });

  const origin = normalizeCode(snapshot?.shipment?.originCountry);
  add('origin_vietnam', origin === 'VN', 'shipment.originCountry', 'R04 is limited to exports originating in Vietnam.', 'VN', origin || null);
  const destination = normalizeCode(customs?.destinationCountryCode || snapshot?.shipment?.destinationCountry);
  add('destination_country', /^[A-Z]{2}$/.test(destination) && destination !== 'VN',
    'vnCustomsProfile.destinationCountryCode', 'Destination must be a non-Vietnam ISO 3166-1 alpha-2 country code.', 'ISO alpha-2, not VN', destination || null);

  requiredText('invoice_number', trade.invoiceNumber, 'profile.invoiceNumber', 'Commercial Invoice number');
  requiredText('invoice_date', trade.invoiceDate, 'profile.invoiceDate', 'Commercial Invoice date');
  requiredText('packing_list_number', trade.packingListNumber, 'profile.packingListNumber', 'Packing List number');
  requiredText('contract_reference', trade.poContractId, 'profile.poContractId', 'PO/contract reference');
  requiredText('currency', trade.currency, 'profile.currency', 'Invoice currency');
  const exchangeRate = numberOrNull(customs?.exchangeRate);
  add('exchange_rate', exchangeRate !== null && exchangeRate > 0, 'vnCustomsProfile.exchangeRate',
    'A positive exchange rate used for the broker handoff is required.', '> 0', exchangeRate);
  const customsValue = numberOrNull(trade.customsValueAmount);
  add('customs_value', customsValue !== null && customsValue >= 0, 'profile.customsValueAmount',
    'A non-negative customs value is required.', '>= 0', customsValue);
  requiredText('customs_value_basis', trade.customsValueBasis, 'profile.customsValueBasis', 'Customs value basis');

  add('goods_lines', lines.length > 0, 'lines', 'At least one export goods line is required.', '> 0 lines', lines.length);
  lines.forEach((line, index) => {
    const prefix = `lines[${index}]`;
    requiredText(`line_${index + 1}_description`, line.goodsDescription, `${prefix}.goodsDescription`, `Goods description for line ${index + 1}`);
    const hs = normalizedHs(line.hsCode);
    add(`line_${index + 1}_vn_hs8`, /^\d{8}$/.test(hs), `${prefix}.hsCode`,
      `Vietnam customs tariff code for line ${index + 1} must contain exactly 8 digits.`, '8 digits', hs || null);
    add(`line_${index + 1}_hs_confirmed`, line.hsCodeConfirmed === true, `${prefix}.hsCodeConfirmed`,
      `HS code for line ${index + 1} requires explicit confirmation.`, true, line.hsCodeConfirmed === true);
    requiredText(`line_${index + 1}_origin`, line.originCountry, `${prefix}.originCountry`, `Origin country for line ${index + 1}`);
    add(`line_${index + 1}_quantity`, Number(line.quantity) > 0, `${prefix}.quantity`,
      `Quantity for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.quantity));
    requiredText(`line_${index + 1}_unit`, line.unit, `${prefix}.unit`, `Customs quantity unit for line ${index + 1}`);
    add(`line_${index + 1}_unit_price`, numberOrNull(line.unitPrice) !== null && Number(line.unitPrice) >= 0,
      `${prefix}.unitPrice`, `Unit price for line ${index + 1} must be non-negative.`, '>= 0', numberOrNull(line.unitPrice));
    add(`line_${index + 1}_net_weight`, Number(line.netWeightKg) > 0, `${prefix}.netWeightKg`,
      `Net weight for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.netWeightKg));
    add(`line_${index + 1}_gross_weight`, Number(line.grossWeightKg) > 0, `${prefix}.grossWeightKg`,
      `Gross weight for line ${index + 1} must be positive.`, '> 0', numberOrNull(line.grossWeightKg));
  });

  add('packages', packages.length > 0, 'packages', 'At least one physical package is required.', '> 0 packages', packages.length);
  const lineNet = lines.reduce((sum, line) => sum + Number(line.netWeightKg || 0), 0);
  const lineGross = lines.reduce((sum, line) => sum + Number(line.grossWeightKg || 0), 0);
  const packageFactor = (item, field) => (item?.[field] === 'group_total' ? 1 : Number(item?.quantity || 1));
  const packageNet = packages.reduce((sum, item) => sum + Number(item.netWeightKg || 0) * packageFactor(item, 'weightMeasurementBasis'), 0);
  const packageGross = packages.reduce((sum, item) => sum + Number(item.grossWeightKg || 0) * packageFactor(item, 'weightMeasurementBasis'), 0);
  const tolerance = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.001);
  add('net_weight_reconciliation', tolerance(lineNet, packageNet), 'lines[].netWeightKg',
    `Line net weight (${lineNet}) must reconcile with package net weight (${packageNet}).`, packageNet, lineNet);
  add('gross_weight_reconciliation', tolerance(lineGross, packageGross), 'lines[].grossWeightKg',
    `Line gross weight (${lineGross}) must reconcile with package gross weight (${packageGross}).`, packageGross, lineGross);
  const goodsValue = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const invoiceTotal = goodsValue + Number(trade.freightAmount || 0) + Number(trade.insuranceAmount || 0)
    + Number(trade.surchargeAmount || 0) - Number(trade.discountAmount || 0);
  add('invoice_customs_value_reconciliation', customsValue !== null && tolerance(invoiceTotal, customsValue),
    'profile.customsValueAmount', `Customs value (${customsValue}) must reconcile with the Commercial Invoice total (${invoiceTotal}).`, invoiceTotal, customsValue);

  add('permit_determination', REQUIREMENT_STATUSES.has(customs?.permitRequirementStatus),
    'vnCustomsProfile.permitRequirementStatus', 'Permit applicability must be explicitly required or not_required.', [...REQUIREMENT_STATUSES], customs?.permitRequirementStatus || null);
  add('permit_references', customs?.permitRequirementStatus !== 'required' || array(customs?.permitReferences).length > 0,
    'vnCustomsProfile.permitReferences', 'At least one permit reference is required when permits are applicable.', '> 0 references', array(customs?.permitReferences).length);
  add('inspection_determination', REQUIREMENT_STATUSES.has(customs?.inspectionRequirementStatus),
    'vnCustomsProfile.inspectionRequirementStatus', 'Specialised-inspection applicability must be explicitly required or not_required.', [...REQUIREMENT_STATUSES], customs?.inspectionRequirementStatus || null);
  add('inspection_references', customs?.inspectionRequirementStatus !== 'required' || array(customs?.inspectionReferences).length > 0,
    'vnCustomsProfile.inspectionReferences', 'At least one inspection reference is required when inspection is applicable.', '> 0 references', array(customs?.inspectionReferences).length);
  add('tax_treatment', TAX_TREATMENTS.has(customs?.taxTreatment), 'vnCustomsProfile.taxTreatment',
    'Export-duty treatment must be explicitly taxable, exempt or not_subject.', [...TAX_TREATMENTS], customs?.taxTreatment || null);
  add('tax_basis', customs?.taxTreatment !== 'taxable' || Boolean(text(customs?.taxBasis)), 'vnCustomsProfile.taxBasis',
    'Tax basis is required for taxable goods.', 'non-empty when taxable', customs?.taxBasis || null);
  add('export_duty_rate', customs?.taxTreatment !== 'taxable' || (numberOrNull(customs?.exportDutyRate) !== null && Number(customs.exportDutyRate) >= 0),
    'vnCustomsProfile.exportDutyRate', 'A non-negative export duty rate is required for taxable goods.', '>= 0 when taxable', numberOrNull(customs?.exportDutyRate));
  add('export_duty_amount', customs?.taxTreatment !== 'taxable' || (numberOrNull(customs?.exportDutyAmount) !== null && Number(customs.exportDutyAmount) >= 0),
    'vnCustomsProfile.exportDutyAmount', 'A non-negative export duty amount is required for taxable goods.', '>= 0 when taxable', numberOrNull(customs?.exportDutyAmount));

  const supportTypes = new Set(array(customs?.supportingDocuments).map((item) => text(item?.type || item).toLowerCase()));
  add('commercial_invoice_reference', supportTypes.has('commercial_invoice'), 'vnCustomsProfile.supportingDocuments',
    'The handoff must reference the controlled Commercial Invoice.', 'commercial_invoice', [...supportTypes]);
  add('packing_list_reference', supportTypes.has('packing_list'), 'vnCustomsProfile.supportingDocuments',
    'The handoff must reference the controlled Packing List.', 'packing_list', [...supportTypes]);
  ['commercial_invoice', 'packing_list'].forEach((documentType) => {
    const issued = array(snapshot?.documents).find((document) => document?.type === documentType
      && document?.status === 'issued' && isSupportingDocumentCurrent(document));
    add(`${documentType}_issued_current`, Boolean(issued), 'documents',
      `A current issued ${documentType} with payload and file checksums is required before broker handoff.`,
      `current issued ${documentType}`, issued?.id || null);
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
      goodsLineCount: lines.length,
      packageCount: packages.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      netWeightKg: packageNet,
      grossWeightKg: packageGross,
      invoiceTotal,
      customsValue,
      carrierDocumentId: carrier?.structured?.id || null
    }
  };
}

function buildVnCustomsHandoffDataset(snapshot, options = {}) {
  const customs = snapshot.vnCustomsProfile;
  const trade = snapshot.profile || {};
  const packages = array(snapshot.packages).filter((item) => text(item.packageType).toLowerCase() !== 'pallet');
  const containers = array(snapshot.containers);
  const carrier = array(snapshot.carrierDocuments).find((item) => item?.structured?.status === 'confirmed');
  const goodsValue = array(snapshot.lines).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const invoiceTotal = goodsValue + Number(trade.freightAmount || 0) + Number(trade.insuranceAmount || 0)
    + Number(trade.surchargeAmount || 0) - Number(trade.discountAmount || 0);
  return {
    schema: { id: HANDOFF_SCHEMA.id, version: HANDOFF_SCHEMA.version },
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    generatedAt: options.generatedAt,
    documentVersion: options.documentVersion,
    sourceSnapshotSha256: options.sourceSnapshotSha256,
    controlStatus: 'BROKER_HANDOFF_CONTROLLED_COPY',
    authorityStatus: 'NOT_SUBMITTED',
    notForDirectSubmission: true,
    warning: 'This is a WeaveCarbon broker-handoff dataset, not a VNACCS message, customs declaration or authority acceptance.',
    brokerMapping: {
      brokerName: customs.customsBroker?.name || '',
      brokerIdentifier: customs.customsBroker?.taxId || customs.customsBroker?.code || '',
      targetSchemaId: customs.brokerTargetSchemaId,
      targetSchemaVersion: customs.brokerTargetSchemaVersion
    },
    declaration: {
      customsOfficeCode: customs.customsOfficeCode,
      declarationTypeCode: customs.declarationTypeCode,
      cargoClassificationCode: customs.cargoClassificationCode,
      transportMethodCode: customs.transportMethodCode,
      exitCustomsOfficeCode: customs.exitCustomsOfficeCode,
      loadingLocationCode: customs.loadingLocationCode,
      destinationCountryCode: customs.destinationCountryCode || snapshot.shipment?.destinationCountry,
      declarant: customs.declarant,
      notes: customs.declarationNotes
    },
    commercial: {
      invoiceNumber: trade.invoiceNumber,
      invoiceDate: trade.invoiceDate,
      contractReference: trade.poContractId,
      invoiceClassificationCode: customs.invoiceClassificationCode,
      invoicePaymentMethodCode: customs.invoicePaymentMethodCode,
      currency: trade.currency,
      exchangeRate: customs.exchangeRate,
      incoterm: { code: trade.incotermCode, location: trade.incotermLocation, version: trade.incotermVersion },
      goodsValue,
      freightAmount: Number(trade.freightAmount || 0),
      insuranceAmount: Number(trade.insuranceAmount || 0),
      discountAmount: Number(trade.discountAmount || 0),
      surchargeAmount: Number(trade.surchargeAmount || 0),
      invoiceTotal,
      customsValueAmount: trade.customsValueAmount,
      customsValueBasis: trade.customsValueBasis
    },
    parties: { exporter: trade.exporter, importer: trade.importer, consignee: trade.consignee, notifyParty: trade.notifyParty },
    transport: {
      mode: trade.transportMode,
      carrierName: trade.carrierName,
      carrierDocument: carrier ? {
        id: carrier.structured.id,
        type: carrier.structured.documentType,
        number: carrier.structured.documentNumber,
        issuer: carrier.structured.issuerName,
        fileSha256: carrier.checksumSha256
      } : null,
      loadingPlace: trade.portOfLoading,
      dischargePlace: trade.portOfDischarge,
      deliveryPlace: trade.placeOfDelivery,
      containers: containers.map((item) => ({ number: item.containerNumber, seal: item.sealNumber, equipmentType: item.equipmentType }))
    },
    goods: array(snapshot.lines).map((line) => ({
      lineNumber: line.lineNumber,
      sku: line.sku,
      description: line.goodsDescription,
      vietnamHsCode: normalizedHs(line.hsCode),
      hsSource: line.hsCodeSource,
      hsRuleset: line.hsCodeRuleset,
      hsEffectiveDate: line.hsCodeEffectiveDate,
      originCountry: line.originCountry,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      currency: line.currency || trade.currency,
      lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
      netWeightKg: line.netWeightKg,
      grossWeightKg: line.grossWeightKg,
      packageRefs: line.packageRefs || []
    })),
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
    permits: { status: customs.permitRequirementStatus, references: customs.permitReferences },
    specialisedInspection: { status: customs.inspectionRequirementStatus, references: customs.inspectionReferences },
    exportDuty: {
      treatment: customs.taxTreatment,
      rate: customs.exportDutyRate,
      amount: customs.exportDutyAmount,
      basis: customs.taxBasis
    },
    supportingDocuments: {
      declaredReferences: customs.supportingDocuments,
      controlledIssuedDocuments: array(snapshot.documents)
        .filter((document) => ['commercial_invoice', 'packing_list'].includes(document.type) && document.status === 'issued')
        .map((document) => ({
          id: document.id,
          type: document.type,
          version: document.version,
          payloadSha256: document.payloadSha256,
          fileSha256: document.fileSha256,
          filename: document.filename,
          issuedAt: document.issuedAt
        }))
    },
    reconciliation: options.reconciliation
  };
}

module.exports = {
  AUTHORITY_EVENT_TYPES,
  EVENT_TYPES,
  HANDOFF_SCHEMA,
  buildVnCustomsHandoffDataset,
  normalizeVnCustomsProfile,
  profileFromRow,
  validateVnCustomsHandoff
};
