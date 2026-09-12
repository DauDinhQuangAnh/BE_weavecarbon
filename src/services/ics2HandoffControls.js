const HANDOFF_SCHEMA = Object.freeze({
  id: 'weavecarbon.ics2-filing-handoff',
  version: '1.0.0',
  rulesetVersion: 'R06-ICS2-FILING-HANDOFF-2026.09.1',
  regulatoryBasisVersion: 'UCC-952/2013-ART127+UCC-DA-2015/2446-ANNEX-B+EU-2026/1022@2026-09-12',
  ics2Release: 'R3',
  htiAgreementRef: 'EU-ICS2-TI-V2.0'
});

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const TRANSPORT_MODES = new Set(['sea', 'inland_waterway', 'air', 'road', 'rail']);
const FILING_ROLES = new Set(['carrier', 'house_level_filer', 'express_carrier', 'postal_operator', 'representative']);
const FILING_ARRANGEMENTS = new Set(['single', 'multiple']);
const EVENT_TYPES = new Set([
  'filer_received', 'filer_validated', 'filer_rejected',
  'authority_registered', 'authority_rejected', 'risk_referral', 'do_not_load',
  'assessment_complete', 'amendment_requested', 'amendment_registered',
  'invalidation_requested', 'invalidated'
]);
const AUTHORITY_EVENT_TYPES = new Set([
  'authority_registered', 'authority_rejected', 'risk_referral', 'do_not_load',
  'assessment_complete', 'amendment_registered', 'invalidated'
]);
const GENERIC_GOODS_DESCRIPTIONS = new Set([
  'goods', 'cargo', 'merchandise', 'unknown', 'not available', 'general cargo',
  'parts', 'samples', 'textiles', 'clothing', 'footwear'
]);

const DATASET_MODES = Object.freeze({
  F10: ['sea', 'inland_waterway'], F11: ['sea', 'inland_waterway'],
  F12: ['sea', 'inland_waterway'], F13: ['sea', 'inland_waterway'],
  F14: ['sea', 'inland_waterway'], F15: ['sea', 'inland_waterway'],
  F16: ['sea', 'inland_waterway'],
  F20: ['air'], F21: ['air'], F22: ['air'], F23: ['air'], F24: ['air'],
  F25: ['air'], F26: ['air'], F27: ['air'], F28: ['air'], F29: ['air'],
  F30: ['air'], F31: ['air'], F32: ['air'], F33: ['air'], F34: ['road'],
  F40: ['road'], F41: ['rail'], F42: ['air'], F43: ['air'], F44: ['air'],
  F45: ['sea', 'inland_waterway'], F50: ['road'], F51: ['rail']
});

function text(value) { return String(value ?? '').trim(); }
function code(value) { return text(value).toUpperCase(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function validEori(value) { return /^[A-Z]{2}[A-Z0-9]{1,15}$/.test(code(value)); }
function normalizeParty(value = {}) {
  const party = object(value);
  return {
    name: text(party.name), address: text(party.address), country: code(party.country),
    eori: code(party.eori), contactName: text(party.contactName || party.contact_name),
    phone: text(party.phone), email: text(party.email)
  };
}

function normalizeHouseConsignment(value = {}) {
  const house = object(value);
  return {
    id: text(house.id),
    transportDocumentType: code(house.transportDocumentType || house.transport_document_type),
    transportDocumentNumber: text(house.transportDocumentNumber || house.transport_document_number),
    ucr: text(house.ucr),
    consignor: normalizeParty(house.consignor),
    consignee: normalizeParty(house.consignee),
    buyer: normalizeParty(house.buyer),
    seller: normalizeParty(house.seller),
    destinationCountry: code(house.destinationCountry || house.destination_country),
    placeOfDelivery: text(house.placeOfDelivery || house.place_of_delivery),
    grossMassKg: numberOrNull(house.grossMassKg ?? house.gross_mass_kg),
    packageCount: numberOrNull(house.packageCount ?? house.package_count),
    goodsLineIds: array(house.goodsLineIds || house.goods_line_ids).map(text).filter(Boolean),
    additionalSupplyChainActors: array(house.additionalSupplyChainActors || house.additional_supply_chain_actors)
      .map(normalizeParty),
    metadata: object(house.metadata)
  };
}

function normalizeIcs2Profile(input = {}) {
  const transportMode = text(input.transportMode || input.transport_mode).toLowerCase();
  return {
    schemaId: HANDOFF_SCHEMA.id,
    schemaVersion: HANDOFF_SCHEMA.version,
    rulesetVersion: HANDOFF_SCHEMA.rulesetVersion,
    regulatoryBasisVersion: HANDOFF_SCHEMA.regulatoryBasisVersion,
    filingPurpose: 'filer_handoff',
    ics2Release: HANDOFF_SCHEMA.ics2Release,
    htiAgreementRef: HANDOFF_SCHEMA.htiAgreementRef,
    transportMode,
    messageDatasetCode: code(input.messageDatasetCode || input.message_dataset_code),
    filingRole: text(input.filingRole || input.filing_role).toLowerCase(),
    filingArrangement: text(input.filingArrangement || input.filing_arrangement).toLowerCase() || 'single',
    localReferenceNumber: text(input.localReferenceNumber || input.local_reference_number),
    sender: normalizeParty(input.sender),
    declarant: normalizeParty(input.declarant),
    representative: normalizeParty(input.representative),
    customsOfficeFirstEntry: code(input.customsOfficeFirstEntry || input.customs_office_first_entry),
    firstEntryCountry: code(input.firstEntryCountry || input.first_entry_country),
    estimatedArrivalAt: text(input.estimatedArrivalAt || input.estimated_arrival_at),
    itineraryCountries: array(input.itineraryCountries || input.itinerary_countries).map(code).filter(Boolean),
    conveyanceReference: text(input.conveyanceReference || input.conveyance_reference),
    containerIndicator: input.containerIndicator === true || input.container_indicator === true,
    masterTransportDocument: {
      type: code(input.masterTransportDocument?.type || input.master_transport_document?.type),
      number: text(input.masterTransportDocument?.number || input.master_transport_document?.number)
    },
    activeBorderTransportMeans: {
      identificationType: code(input.activeBorderTransportMeans?.identificationType
        || input.active_border_transport_means?.identification_type),
      identificationNumber: text(input.activeBorderTransportMeans?.identificationNumber
        || input.active_border_transport_means?.identification_number),
      nationality: code(input.activeBorderTransportMeans?.nationality
        || input.active_border_transport_means?.nationality)
    },
    seals: array(input.seals).map(text).filter(Boolean),
    paymentMethodCode: code(input.paymentMethodCode || input.payment_method_code),
    targetSystemSchemaId: text(input.targetSystemSchemaId || input.target_system_schema_id),
    targetSystemSchemaVersion: text(input.targetSystemSchemaVersion || input.target_system_schema_version),
    technicalPackageId: text(input.technicalPackageId || input.technical_package_id),
    technicalPackageVersion: text(input.technicalPackageVersion || input.technical_package_version),
    messageNamespace: text(input.messageNamespace || input.message_namespace),
    houseConsignments: array(input.houseConsignments || input.house_consignments).map(normalizeHouseConsignment),
    filingNotes: text(input.filingNotes || input.filing_notes),
    metadata: object(input.metadata)
  };
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    ...normalizeIcs2Profile({
      ...(row.profile_data || {}),
      transportMode: row.transport_mode,
      messageDatasetCode: row.message_dataset_code,
      filingRole: row.filing_role,
      filingArrangement: row.filing_arrangement,
      localReferenceNumber: row.local_reference_number,
      targetSystemSchemaId: row.target_system_schema_id,
      targetSystemSchemaVersion: row.target_system_schema_version,
      technicalPackageId: row.technical_package_id,
      technicalPackageVersion: row.technical_package_version
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isDetailedDescription(value) {
  const normalized = text(value).toLowerCase().replace(/\s+/g, ' ');
  return normalized.length >= 6 && !GENERIC_GOODS_DESCRIPTIONS.has(normalized);
}

function validateIcs2Handoff(snapshot, { isCarrierCurrent = () => false } = {}) {
  const profile = snapshot?.ics2Profile;
  const trade = snapshot?.profile || {};
  const lines = array(snapshot?.lines);
  const packages = array(snapshot?.packages).filter((item) => text(item?.packageType).toLowerCase() !== 'pallet');
  const houses = array(profile?.houseConsignments);
  const checks = [];
  const add = (codeName, valid, fieldPath, message, expected = null, actual = null) => checks.push({
    code: codeName,
    status: valid ? 'ready' : (actual === '' || actual === null || actual === undefined ? 'missing' : 'invalid'),
    fieldPath, message: valid ? null : message, expected, actual, blocking: true
  });
  const required = (codeName, value, fieldPath, label) => add(
    codeName, Boolean(text(value)), fieldPath, `${label} is required.`, 'non-empty', text(value)
  );
  const party = (key, value, requireEori = false) => {
    required(`${key}_name`, value?.name, `ics2Profile.${key}.name`, `${key} name`);
    required(`${key}_address`, value?.address, `ics2Profile.${key}.address`, `${key} address`);
    if (requireEori) add(`${key}_eori`, validEori(value?.eori), `ics2Profile.${key}.eori`,
      `${key} EORI must start with a 2-letter country prefix followed by up to 15 letters/digits.`,
      'valid EORI', code(value?.eori) || null);
  };

  add('internal_schema_identity', profile?.schemaId === HANDOFF_SCHEMA.id && profile?.schemaVersion === HANDOFF_SCHEMA.version,
    'ics2Profile.schemaVersion', 'The controlled ICS2 handoff schema identity is missing or unsupported.',
    `${HANDOFF_SCHEMA.id}@${HANDOFF_SCHEMA.version}`, profile ? `${profile.schemaId}@${profile.schemaVersion}` : null);
  add('filing_purpose', profile?.filingPurpose === 'filer_handoff', 'ics2Profile.filingPurpose',
    'R06 supports filer handoff only; direct ICS2 submission is not supported.', 'filer_handoff', profile?.filingPurpose || null);
  required('target_system_schema_id', profile?.targetSystemSchemaId, 'ics2Profile.targetSystemSchemaId', 'Filer/ITSP target schema ID');
  required('target_system_schema_version', profile?.targetSystemSchemaVersion, 'ics2Profile.targetSystemSchemaVersion', 'Filer/ITSP target schema version');
  required('technical_package_id', profile?.technicalPackageId, 'ics2Profile.technicalPackageId', 'ICS2 Common Technical Specifications package ID');
  required('technical_package_version', profile?.technicalPackageVersion, 'ics2Profile.technicalPackageVersion', 'ICS2 technical package version');

  const mode = text(profile?.transportMode).toLowerCase();
  const dataset = code(profile?.messageDatasetCode);
  add('transport_mode', TRANSPORT_MODES.has(mode), 'ics2Profile.transportMode',
    'Transport mode must be sea, inland_waterway, air, road or rail.', [...TRANSPORT_MODES], mode || null);
  add('message_dataset_code', Boolean(DATASET_MODES[dataset]), 'ics2Profile.messageDatasetCode',
    'Message dataset code must be an Annex B ENS dataset from F10 through F51 supported by this ruleset.',
    Object.keys(DATASET_MODES), dataset || null);
  add('dataset_mode_compatibility', Boolean(DATASET_MODES[dataset]?.includes(mode)), 'ics2Profile.messageDatasetCode',
    `Dataset ${dataset || '(missing)'} is not valid for ${mode || 'the selected mode'}.`, DATASET_MODES[dataset] || [], mode || null);
  add('filing_role', FILING_ROLES.has(profile?.filingRole), 'ics2Profile.filingRole',
    'Filing role is unsupported.', [...FILING_ROLES], profile?.filingRole || null);
  add('filing_arrangement', FILING_ARRANGEMENTS.has(profile?.filingArrangement), 'ics2Profile.filingArrangement',
    'Filing arrangement must be single or multiple.', [...FILING_ARRANGEMENTS], profile?.filingArrangement || null);
  required('local_reference_number', profile?.localReferenceNumber, 'ics2Profile.localReferenceNumber', 'Unique local reference number');

  party('sender', profile?.sender, true);
  party('declarant', profile?.declarant, true);
  if (profile?.filingRole === 'representative') party('representative', profile?.representative, true);
  add('first_entry_country', EU_COUNTRY_CODES.has(code(profile?.firstEntryCountry)), 'ics2Profile.firstEntryCountry',
    'First-entry country must be an EU ISO alpha-2 code.', 'EU ISO alpha-2', code(profile?.firstEntryCountry) || null);
  required('customs_office_first_entry', profile?.customsOfficeFirstEntry, 'ics2Profile.customsOfficeFirstEntry', 'Customs office of first entry');
  const arrival = new Date(profile?.estimatedArrivalAt || '');
  add('estimated_arrival_utc', !Number.isNaN(arrival.getTime()) && /(?:Z|[+-]\d{2}:\d{2})$/.test(text(profile?.estimatedArrivalAt)),
    'ics2Profile.estimatedArrivalAt', 'Estimated arrival must be an ISO-8601 timestamp with UTC or an explicit offset.',
    'ISO-8601 timezone timestamp', profile?.estimatedArrivalAt || null);
  add('itinerary', array(profile?.itineraryCountries).includes(code(profile?.firstEntryCountry)), 'ics2Profile.itineraryCountries',
    'Itinerary must include the first-entry country.', code(profile?.firstEntryCountry) || null, profile?.itineraryCountries || []);
  required('master_transport_document_type', profile?.masterTransportDocument?.type,
    'ics2Profile.masterTransportDocument.type', 'Master transport-document type');
  required('master_transport_document_number', profile?.masterTransportDocument?.number,
    'ics2Profile.masterTransportDocument.number', 'Master transport-document number');
  add('master_transport_document_match', text(profile?.masterTransportDocument?.number) === text(trade.billOfLadingNo),
    'ics2Profile.masterTransportDocument.number', 'Master transport-document number must match the controlled shipment carrier reference.',
    text(trade.billOfLadingNo) || null, text(profile?.masterTransportDocument?.number) || null);
  required('active_transport_identification', profile?.activeBorderTransportMeans?.identificationNumber,
    'ics2Profile.activeBorderTransportMeans.identificationNumber', 'Active border transport means identification');
  required('conveyance_reference', profile?.conveyanceReference, 'ics2Profile.conveyanceReference', 'Conveyance reference');

  add('house_consignments', houses.length > 0, 'ics2Profile.houseConsignments',
    'At least one lowest-level house consignment is required for traceable goods allocation.', '> 0', houses.length);
  const houseNumbers = houses.map((house) => text(house.transportDocumentNumber)).filter(Boolean);
  add('unique_house_transport_documents', new Set(houseNumbers).size === houseNumbers.length,
    'ics2Profile.houseConsignments[].transportDocumentNumber', 'House transport-document numbers must be unique within the filing.',
    'unique', houseNumbers);
  const assigned = new Map();
  houses.forEach((house, index) => {
    const prefix = `ics2Profile.houseConsignments[${index}]`;
    required(`house_${index + 1}_transport_document_type`, house.transportDocumentType,
      `${prefix}.transportDocumentType`, `House ${index + 1} transport-document type`);
    required(`house_${index + 1}_transport_document_number`, house.transportDocumentNumber,
      `${prefix}.transportDocumentNumber`, `House ${index + 1} transport-document number`);
    party(`house_${index + 1}_consignor`, house.consignor);
    party(`house_${index + 1}_consignee`, house.consignee);
    add(`house_${index + 1}_destination`, /^[A-Z]{2}$/.test(code(house.destinationCountry)),
      `${prefix}.destinationCountry`, `House ${index + 1} destination country is required.`, 'ISO alpha-2', house.destinationCountry || null);
    add(`house_${index + 1}_gross_mass`, Number(house.grossMassKg) > 0, `${prefix}.grossMassKg`,
      `House ${index + 1} gross mass must be positive.`, '> 0', house.grossMassKg);
    add(`house_${index + 1}_packages`, Number(house.packageCount) > 0, `${prefix}.packageCount`,
      `House ${index + 1} package count must be positive.`, '> 0', house.packageCount);
    house.goodsLineIds.forEach((lineId) => assigned.set(lineId, (assigned.get(lineId) || 0) + 1));
  });

  add('goods_lines', lines.length > 0, 'lines', 'At least one goods line is required.', '> 0', lines.length);
  lines.forEach((line, index) => {
    add(`line_${index + 1}_house_assignment`, assigned.get(line.id) === 1, `lines[${index}].id`,
      `Goods line ${index + 1} must be assigned to exactly one lowest-level house consignment.`, 1, assigned.get(line.id) || 0);
    add(`line_${index + 1}_description`, isDetailedDescription(line.goodsDescription), `lines[${index}].goodsDescription`,
      `Goods line ${index + 1} requires a precise description; generic descriptions are rejected.`, 'specific description', line.goodsDescription || null);
    add(`line_${index + 1}_hs6`, /^\d{6,10}$/.test(text(line.hsCode).replace(/\D/g, '')), `lines[${index}].hsCode`,
      `Goods line ${index + 1} requires a 6-to-10-digit HS/CN code.`, '6-10 digits', line.hsCode || null);
    add(`line_${index + 1}_origin`, /^[A-Z]{2}$/.test(code(line.originCountry)), `lines[${index}].originCountry`,
      `Goods line ${index + 1} requires an ISO alpha-2 origin country.`, 'ISO alpha-2', line.originCountry || null);
    add(`line_${index + 1}_gross_weight`, Number(line.grossWeightKg) > 0, `lines[${index}].grossWeightKg`,
      `Goods line ${index + 1} requires positive gross mass.`, '> 0', line.grossWeightKg);
  });
  const knownLineIds = new Set(lines.map((line) => line.id));
  const unknownIds = [...assigned.keys()].filter((lineId) => !knownLineIds.has(lineId));
  add('house_goods_references', unknownIds.length === 0, 'ics2Profile.houseConsignments[].goodsLineIds',
    'House consignments contain unknown shipment-line references.', [], unknownIds);

  const tolerance = (left, right) => Math.abs(Number(left) - Number(right)) <= Math.max(0.01, Math.abs(Number(left)) * 0.001);
  const lineGross = lines.reduce((sum, line) => sum + Number(line.grossWeightKg || 0), 0);
  const houseGross = houses.reduce((sum, house) => sum + Number(house.grossMassKg || 0), 0);
  const packageFactor = (item) => item?.weightMeasurementBasis === 'group_total' ? 1 : Number(item?.quantity || 1);
  const packageGross = packages.reduce((sum, item) => sum + Number(item.grossWeightKg || 0) * packageFactor(item), 0);
  const packageCount = packages.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const housePackages = houses.reduce((sum, house) => sum + Number(house.packageCount || 0), 0);
  add('house_line_gross_reconciliation', houses.length > 0 && tolerance(houseGross, lineGross),
    'ics2Profile.houseConsignments[].grossMassKg', 'House-consignment gross mass must reconcile with goods lines.', lineGross, houseGross);
  add('house_package_gross_reconciliation', houses.length > 0 && tolerance(houseGross, packageGross),
    'packages[].grossWeightKg', 'House-consignment gross mass must reconcile with physical packages.', packageGross, houseGross);
  add('house_package_count_reconciliation', houses.length > 0 && tolerance(housePackages, packageCount),
    'ics2Profile.houseConsignments[].packageCount', 'House-consignment package counts must reconcile with physical packages.', packageCount, housePackages);

  const carriers = array(snapshot?.carrierDocuments);
  const currentCarriers = carriers.filter(isCarrierCurrent);
  add('carrier_document_reconciliation', currentCarriers.length > 0, 'carrierDocuments',
    'A structured, confirmed and currently reconciled carrier document is required.', '> 0 current carrier documents', currentCarriers.length);

  const blocking = checks.filter((item) => item.blocking && item.status !== 'ready');
  return {
    status: blocking.length ? 'blocked' : 'ready',
    schema: HANDOFF_SCHEMA,
    checks,
    blockingCodes: blocking.map((item) => item.code)
  };
}

function buildIcs2HandoffDataset(snapshot, {
  generatedAt = new Date().toISOString(), documentVersion = null,
  sourceSnapshotSha256 = null, reconciliation = null
} = {}) {
  const profile = normalizeIcs2Profile(snapshot?.ics2Profile || {});
  const lineById = new Map(array(snapshot?.lines).map((line) => [line.id, line]));
  const houses = profile.houseConsignments.map((house) => ({
    ...house,
    goodsItems: house.goodsLineIds.map((lineId) => lineById.get(lineId)).filter(Boolean).map((line) => ({
      sourceLineId: line.id,
      lineNumber: line.lineNumber,
      sku: line.sku,
      goodsDescription: line.goodsDescription,
      hsCode: text(line.hsCode).replace(/\D/g, ''),
      originCountry: code(line.originCountry),
      quantity: Number(line.quantity || 0),
      unit: line.unit,
      grossMassKg: Number(line.grossWeightKg || 0),
      packageReferences: array(line.packageRefs)
    }))
  }));
  return {
    schema: HANDOFF_SCHEMA,
    datasetNature: 'ICS2_FILER_HANDOFF_NOT_FOR_DIRECT_SUBMISSION',
    notForDirectSubmission: true,
    authorityStatus: 'NOT_SUBMITTED',
    generatedAt,
    documentVersion,
    sourceSnapshotSha256,
    reconciliationStatus: reconciliation?.status || null,
    filing: {
      ...profile,
      houseConsignments: houses
    },
    shipment: {
      id: snapshot?.shipment?.id || null,
      referenceNumber: snapshot?.shipment?.referenceNumber || null,
      originCountry: snapshot?.shipment?.originCountry || null,
      destinationCountry: snapshot?.shipment?.destinationCountry || null
    },
    declarations: [
      'This file is a controlled handoff to a carrier, filer or IT service provider; it is not an ENS message.',
      'No MRN, registration, risk decision or customs acceptance is created by WeaveCarbon.',
      'The recipient must map and validate this file against the exact accepted ICS2 technical package and complete conformance testing.'
    ]
  };
}

module.exports = {
  AUTHORITY_EVENT_TYPES,
  DATASET_MODES,
  EVENT_TYPES,
  HANDOFF_SCHEMA,
  buildIcs2HandoffDataset,
  isDetailedDescription,
  normalizeHouseConsignment,
  normalizeIcs2Profile,
  profileFromRow,
  validateIcs2Handoff
};
