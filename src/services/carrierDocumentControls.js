const DOCUMENT_TYPES = new Set(['bill_of_lading', 'fbl', 'air_waybill', 'cmr', 'cim']);
const AUTHENTICITY_STATUSES = new Set(['unverified', 'operator_confirmed', 'issuer_verified', 'rejected']);
const ORIGINAL_STATUSES = new Set(['original', 'copy', 'electronic', 'sea_waybill', 'non_negotiable', 'unknown']);
const TRANSPORT_MODES = new Set(['sea', 'air', 'road', 'rail', 'multimodal']);

const MODE_BY_DOCUMENT = {
  bill_of_lading: new Set(['sea']),
  fbl: new Set(['multimodal']),
  air_waybill: new Set(['air']),
  cmr: new Set(['road']),
  cim: new Set(['rail'])
};

const EVIDENCE_TYPES_BY_DOCUMENT = {
  bill_of_lading: new Set(['bill_of_lading', 'carrier_bill_of_lading']),
  fbl: new Set(['fbl', 'carrier_fbl']),
  air_waybill: new Set(['air_waybill', 'airway_bill', 'awb']),
  cmr: new Set(['cmr', 'carrier_cmr']),
  cim: new Set(['cim', 'carrier_cim'])
};

function text(value) { return String(value ?? '').trim(); }
function comparable(value) { return text(value).toUpperCase().replace(/\s+/g, ' '); }
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : null;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function uniqueTexts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(comparable).filter(Boolean))].sort();
}
function sameSet(left, right) {
  const a = uniqueTexts(left);
  const b = uniqueTexts(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function packageFactor(pkg, field) {
  const basis = field === 'weight' ? pkg?.weightMeasurementBasis : pkg?.dimensionMeasurementBasis;
  return basis === 'group_total' ? 1 : Number(pkg?.quantity || 1);
}
function packageGrossTotal(pkg) { return Number(pkg?.grossWeightKg || 0) * packageFactor(pkg, 'weight'); }
function packageCbmTotal(pkg) {
  return Number(pkg?.lengthCm || 0) * Number(pkg?.widthCm || 0) * Number(pkg?.heightCm || 0)
    * packageFactor(pkg, 'dimension') / 1000000;
}
function closeEnough(actual, expected, absoluteTolerance, relativeTolerance) {
  return Math.abs(Number(actual) - Number(expected)) <= Math.max(absoluteTolerance, Math.abs(Number(expected)) * relativeTolerance);
}

function normalizeCarrierDocument(input = {}) {
  const party = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const documentType = text(input.documentType || input.document_type).toLowerCase();
  return {
    evidenceDocumentId: text(input.evidenceDocumentId || input.evidence_document_id),
    documentType,
    contractLevel: text(input.contractLevel || input.contract_level).toLowerCase() || 'direct',
    transportMode: text(input.transportMode || input.transport_mode).toLowerCase(),
    documentNumber: text(input.documentNumber || input.document_number),
    issuerName: text(input.issuerName || input.issuer_name),
    issuerIdentifier: text(input.issuerIdentifier || input.issuer_identifier),
    issueDate: dateOnly(input.issueDate || input.issue_date),
    issuePlace: text(input.issuePlace || input.issue_place),
    onBoardDate: dateOnly(input.onBoardDate || input.on_board_date),
    shipper: party(input.shipper),
    consignee: party(input.consignee),
    notifyParty: party(input.notifyParty || input.notify_party),
    vesselName: text(input.vesselName || input.vessel_name),
    voyageNumber: text(input.voyageNumber || input.voyage_number),
    flightNumber: text(input.flightNumber || input.flight_number),
    vehicleRegistration: text(input.vehicleRegistration || input.vehicle_registration),
    trainNumber: text(input.trainNumber || input.train_number),
    placeOfReceipt: text(input.placeOfReceipt || input.place_of_receipt),
    placeOfLoading: text(input.placeOfLoading || input.place_of_loading),
    placeOfDischarge: text(input.placeOfDischarge || input.place_of_discharge),
    placeOfDelivery: text(input.placeOfDelivery || input.place_of_delivery),
    goodsDescription: text(input.goodsDescription || input.goods_description),
    packageCount: numberOrNull(input.packageCount ?? input.package_count),
    packageType: text(input.packageType || input.package_type),
    marksAndNumbers: text(input.marksAndNumbers || input.marks_and_numbers),
    grossWeightKg: numberOrNull(input.grossWeightKg ?? input.gross_weight_kg),
    measurementCbm: numberOrNull(input.measurementCbm ?? input.measurement_cbm),
    containerNumbers: uniqueTexts(input.containerNumbers || input.container_numbers),
    sealNumbers: uniqueTexts(input.sealNumbers || input.seal_numbers),
    freightTerms: text(input.freightTerms || input.freight_terms).toLowerCase(),
    paymentTerms: text(input.paymentTerms || input.payment_terms),
    authenticationMethod: text(input.authenticationMethod || input.authentication_method),
    authenticationReference: text(input.authenticationReference || input.authentication_reference),
    authenticityStatus: text(input.authenticityStatus || input.authenticity_status).toLowerCase() || 'unverified',
    originalStatus: text(input.originalStatus || input.original_status).toLowerCase() || 'unknown',
    negotiable: typeof input.negotiable === 'boolean' ? input.negotiable : null,
    metadataSource: text(input.metadataSource || input.metadata_source).toLowerCase() || 'manual',
    metadata: party(input.metadata),
    supersedesId: text(input.supersedesId || input.supersedes_id) || null
  };
}

function validateCarrierDocument(snapshot, rawDocument) {
  const document = normalizeCarrierDocument(rawDocument);
  const profile = snapshot?.profile || {};
  const packages = (snapshot?.packages || []).filter((pkg) => comparable(pkg.packageType) !== 'PALLET');
  const containers = snapshot?.containers || [];
  const expectedPackageCount = packages.reduce((sum, pkg) => sum + Number(pkg.quantity || 0), 0);
  const expectedGrossKg = packages.reduce((sum, pkg) => sum + packageGrossTotal(pkg), 0);
  const expectedCbm = packages.reduce((sum, pkg) => sum + packageCbmTotal(pkg), 0);
  const expectedContainers = containers.map((item) => item.containerNumber);
  const expectedSeals = containers.map((item) => item.sealNumber);
  const checks = [];
  const add = (code, status, message, fieldPath, expected = null, actual = null, blocking = true) => {
    checks.push({ code, status, message: status === 'ready' ? null : message, fieldPath, expected, actual, blocking });
  };
  const need = (code, value, label, fieldPath) => add(
    code, text(value) ? 'ready' : 'missing', `${label} is required.`, fieldPath, null, text(value) || null
  );
  const matchText = (code, actual, expected, label, fieldPath) => {
    if (!text(expected)) return;
    add(code, comparable(actual) === comparable(expected) ? 'ready' : 'invalid',
      `${label} does not match the shipment profile.`, fieldPath, text(expected), text(actual));
  };

  add('document_type', DOCUMENT_TYPES.has(document.documentType) ? 'ready' : 'invalid',
    'Unsupported carrier document type.', 'documentType', [...DOCUMENT_TYPES], document.documentType);
  add('transport_mode', TRANSPORT_MODES.has(document.transportMode) ? 'ready' : 'invalid',
    'Unsupported transport mode.', 'transportMode', [...TRANSPORT_MODES], document.transportMode);
  if (MODE_BY_DOCUMENT[document.documentType]) {
    add('document_mode_compatibility', MODE_BY_DOCUMENT[document.documentType].has(document.transportMode) ? 'ready' : 'invalid',
      `${document.documentType} is not compatible with transport mode ${document.transportMode || '(empty)'}.`,
      'transportMode', [...MODE_BY_DOCUMENT[document.documentType]], document.transportMode);
  }
  need('document_number', document.documentNumber, 'Carrier document number', 'documentNumber');
  need('issuer_name', document.issuerName, 'Carrier/forwarder issuer name', 'issuerName');
  need('issue_date', document.issueDate, 'Issue date', 'issueDate');
  need('issue_place', document.issuePlace, 'Issue place', 'issuePlace');
  need('shipper_name', document.shipper?.name, 'Shipper name', 'shipper.name');
  need('consignee_name', document.consignee?.name, 'Consignee name', 'consignee.name');
  need('goods_description', document.goodsDescription, 'Goods description', 'goodsDescription');
  need('package_type', document.packageType, 'Package type', 'packageType');
  need('marks_and_numbers', document.marksAndNumbers, 'Marks and numbers', 'marksAndNumbers');
  need('authentication_method', document.authenticationMethod, 'Signature/authentication method', 'authenticationMethod');
  need('authentication_reference', document.authenticationReference, 'Signature/authentication reference', 'authenticationReference');
  add('authenticity_status', ['operator_confirmed', 'issuer_verified'].includes(document.authenticityStatus) ? 'ready' : 'invalid',
    'Authenticity must be explicitly confirmed by an operator or verified with the issuer.',
    'authenticityStatus', ['operator_confirmed', 'issuer_verified'], document.authenticityStatus);
  add('original_status', ORIGINAL_STATUSES.has(document.originalStatus) && document.originalStatus !== 'unknown' ? 'ready' : 'invalid',
    'Original/electronic/copy or negotiability status must be recorded.', 'originalStatus', null, document.originalStatus);
  add('package_count_positive', Number.isInteger(document.packageCount) && document.packageCount > 0 ? 'ready' : 'invalid',
    'Package count must be a positive integer.', 'packageCount', expectedPackageCount || null, document.packageCount);
  add('gross_weight_positive', document.grossWeightKg > 0 ? 'ready' : 'invalid',
    'Gross weight must be greater than zero.', 'grossWeightKg', expectedGrossKg || null, document.grossWeightKg);
  add('measurement_nonnegative', document.measurementCbm !== null && document.measurementCbm >= 0 ? 'ready' : 'missing',
    'Carrier measurement in CBM is required.', 'measurementCbm', expectedCbm, document.measurementCbm);

  matchText('profile_document_number', document.documentNumber, profile.billOfLadingNo, 'Carrier document number', 'documentNumber');
  matchText('profile_carrier', document.issuerName, profile.carrierName, 'Carrier/issuer name', 'issuerName');
  matchText('profile_transport_mode', document.transportMode, profile.transportMode, 'Transport mode', 'transportMode');
  matchText('shipper_profile', document.shipper?.name, profile.exporter?.name, 'Shipper name', 'shipper.name');
  matchText('consignee_profile', document.consignee?.name, profile.consignee?.name, 'Consignee name', 'consignee.name');
  matchText('loading_profile', document.placeOfLoading, profile.portOfLoading, 'Place of loading', 'placeOfLoading');
  matchText('discharge_profile', document.placeOfDischarge, profile.portOfDischarge, 'Place of discharge', 'placeOfDischarge');
  matchText('delivery_profile', document.placeOfDelivery, profile.placeOfDelivery, 'Place of delivery', 'placeOfDelivery');

  if (expectedPackageCount > 0 && Number.isInteger(document.packageCount)) {
    add('package_count_reconciliation', document.packageCount === expectedPackageCount ? 'ready' : 'invalid',
      'Carrier package count does not match the Packing List.', 'packageCount', expectedPackageCount, document.packageCount);
  }
  if (expectedGrossKg > 0 && document.grossWeightKg !== null) {
    add('gross_weight_reconciliation', closeEnough(document.grossWeightKg, expectedGrossKg, 0.01, 0.001) ? 'ready' : 'invalid',
      'Carrier gross weight does not match the Packing List tolerance.', 'grossWeightKg', expectedGrossKg, document.grossWeightKg);
  }
  if (expectedCbm > 0 && document.measurementCbm !== null) {
    add('measurement_reconciliation', closeEnough(document.measurementCbm, expectedCbm, 0.001, 0.01) ? 'ready' : 'invalid',
      'Carrier measurement does not match calculated package CBM tolerance.', 'measurementCbm', expectedCbm, document.measurementCbm);
  }
  if (expectedContainers.length) {
    add('container_reconciliation', sameSet(document.containerNumbers, expectedContainers) ? 'ready' : 'invalid',
      'Carrier container numbers must exactly match the shipment container ledger.', 'containerNumbers', uniqueTexts(expectedContainers), document.containerNumbers);
    add('seal_reconciliation', sameSet(document.sealNumbers, expectedSeals) ? 'ready' : 'invalid',
      'Carrier seal numbers must exactly match the shipment container ledger.', 'sealNumbers', uniqueTexts(expectedSeals), document.sealNumbers);
  }

  if (['bill_of_lading', 'fbl'].includes(document.documentType)) {
    need('vessel_name', document.vesselName, 'Vessel name', 'vesselName');
    need('voyage_number', document.voyageNumber, 'Voyage number', 'voyageNumber');
    need('place_of_loading', document.placeOfLoading, 'Port/place of loading', 'placeOfLoading');
    need('place_of_discharge', document.placeOfDischarge, 'Port/place of discharge', 'placeOfDischarge');
    need('freight_terms', document.freightTerms, 'Freight prepaid/collect terms', 'freightTerms');
  } else if (document.documentType === 'air_waybill') {
    need('flight_number', document.flightNumber, 'Flight number', 'flightNumber');
    need('place_of_loading', document.placeOfLoading, 'Airport of departure', 'placeOfLoading');
    need('place_of_delivery', document.placeOfDelivery, 'Airport/place of destination', 'placeOfDelivery');
    const digits = document.documentNumber.replace(/\D/g, '');
    add('air_waybill_number_format', digits.length === 11 ? 'ready' : 'invalid',
      'Air waybill number must contain 11 digits.', 'documentNumber', '11 digits', document.documentNumber);
  } else if (document.documentType === 'cmr') {
    need('vehicle_registration', document.vehicleRegistration, 'Vehicle registration', 'vehicleRegistration');
    need('place_of_loading', document.placeOfLoading, 'Place of taking over goods', 'placeOfLoading');
    need('place_of_delivery', document.placeOfDelivery, 'Place of delivery', 'placeOfDelivery');
  } else if (document.documentType === 'cim') {
    need('train_number', document.trainNumber, 'Train/rail reference', 'trainNumber');
    need('place_of_loading', document.placeOfLoading, 'Rail departure place', 'placeOfLoading');
    need('place_of_delivery', document.placeOfDelivery, 'Rail destination', 'placeOfDelivery');
  }

  const evidence = rawDocument?.evidence || rawDocument;
  add('evidence_type', EVIDENCE_TYPES_BY_DOCUMENT[document.documentType]?.has(text(evidence.type || evidence.evidenceType).toLowerCase()) ? 'ready' : 'invalid',
    'Uploaded evidence type does not match the structured carrier document type.', 'evidence.type',
    [...(EVIDENCE_TYPES_BY_DOCUMENT[document.documentType] || [])], text(evidence.type || evidence.evidenceType));
  add('evidence_file_hash', /^[a-f0-9]{64}$/i.test(text(evidence.checksumSha256)) && Number(evidence.fileSizeBytes) > 0 ? 'ready' : 'invalid',
    'Carrier evidence requires a stored non-empty file and SHA-256.', 'evidence.checksumSha256', '64-character SHA-256', evidence.checksumSha256 || null);

  const blocking = checks.filter((check) => check.blocking && check.status !== 'ready');
  return {
    status: blocking.length ? 'failed' : 'passed',
    checks,
    summary: {
      expectedPackageCount,
      expectedGrossWeightKg: expectedGrossKg,
      expectedMeasurementCbm: expectedCbm,
      expectedContainerNumbers: uniqueTexts(expectedContainers),
      expectedSealNumbers: uniqueTexts(expectedSeals)
    }
  };
}

module.exports = {
  AUTHENTICITY_STATUSES,
  DOCUMENT_TYPES,
  EVIDENCE_TYPES_BY_DOCUMENT,
  MODE_BY_DOCUMENT,
  ORIGINAL_STATUSES,
  TRANSPORT_MODES,
  normalizeCarrierDocument,
  sameSet,
  validateCarrierDocument
};
