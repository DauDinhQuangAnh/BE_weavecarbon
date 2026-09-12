const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { UPLOADS_ROOT } = require('../config/runtime');
const { buildSimpleXlsx } = require('../utils/simpleXlsx');
const { buildExportDocumentPdf } = require('./exportDocumentPdf');
const {
  DOCUMENT_TYPES: CARRIER_DOCUMENT_TYPES,
  TRANSPORT_MODES: CARRIER_TRANSPORT_MODES,
  normalizeCarrierDocument,
  validateCarrierDocument
} = require('./carrierDocumentControls');
const {
  AUTHORITY_EVENT_TYPES: VN_CUSTOMS_AUTHORITY_EVENT_TYPES,
  EVENT_TYPES: VN_CUSTOMS_EVENT_TYPES,
  HANDOFF_SCHEMA: VN_CUSTOMS_HANDOFF_SCHEMA,
  buildVnCustomsHandoffDataset,
  normalizeVnCustomsProfile,
  profileFromRow: vnCustomsProfileFromRow,
  validateVnCustomsHandoff
} = require('./vnCustomsHandoffControls');
const {
  AUTHORITY_EVENT_TYPES: EU_IMPORT_AUTHORITY_EVENT_TYPES,
  EVENT_TYPES: EU_IMPORT_EVENT_TYPES,
  HANDOFF_SCHEMA: EU_IMPORT_HANDOFF_SCHEMA,
  buildEuImportHandoffDataset,
  lineDetailFromRow: euImportLineDetailFromRow,
  normalizeEuImportLineDetail,
  normalizeEuImportProfile,
  profileFromRow: euImportProfileFromRow,
  validateEuImportHandoff
} = require('./euImportHandoffControls');

const RULESET_VERSION = 'VN-EU-TEXTILE-2026.09.4';
const CARRIER_RULESET_VERSION = 'R03-CARRIER-RECONCILIATION-2026.09.1';
const DOCUMENT_TYPES = new Set([
  'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset',
  'vn_customs_handoff', 'eu_import_handoff'
]);
const DOCUMENT_FORMATS = {
  commercial_invoice: new Set(['xlsx', 'pdf']),
  packing_list: new Set(['xlsx', 'pdf']),
  carbon_annex: new Set(['xlsx']),
  origin_workbook: new Set(['xlsx']),
  ics2_dataset: new Set(['csv']),
  vn_customs_handoff: new Set(['json', 'xlsx']),
  eu_import_handoff: new Set(['json', 'xlsx'])
};
const CORE_DOCUMENT_TYPES = [
  'commercial_invoice', 'packing_list', 'carbon_annex', 'ics2_dataset', 'vn_customs_handoff', 'eu_import_handoff'
];
const CARRIER_EVIDENCE_TYPES = [
  'bill_of_lading', 'carrier_bill_of_lading', 'fbl', 'carrier_fbl',
  'air_waybill', 'airway_bill', 'awb', 'cmr', 'carrier_cmr', 'cim', 'carrier_cim'
];
const INCOTERMS_2020 = new Set(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);
const TRANSPORT_MODES = new Set(['sea', 'air', 'road', 'rail', 'multimodal']);
const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const REVIEW_ROLE_BY_DOCUMENT = {
  commercial_invoice: 'export_operator',
  packing_list: 'warehouse_reviewer',
  vn_customs_handoff: 'customs_declaration_reviewer',
  eu_import_handoff: 'eu_import_declaration_reviewer'
};
const REVIEW_DECISIONS = new Set(['approved', 'rejected', 'changes_requested']);
const MEASUREMENT_BASES = new Set(['per_package', 'group_total']);
const CARRIER_CONTRACT_LEVELS = new Set(['master', 'house', 'direct']);
const CARRIER_METADATA_SOURCES = new Set(['manual', 'ocr_confirmed', 'carrier_api']);
const CARRIER_AUTHENTICITY_STATUSES = new Set(['unverified', 'operator_confirmed', 'issuer_verified', 'rejected']);
const CARRIER_ORIGINAL_STATUSES = new Set(['original', 'copy', 'electronic', 'sea_waybill', 'non_negotiable', 'unknown']);
const CARRIER_FREIGHT_TERMS = new Set(['', 'prepaid', 'collect', 'other']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VN_CUSTOMS_EVENT_EVIDENCE_TYPES = {
  broker_received: new Set(['customs_broker_response']),
  broker_validated: new Set(['customs_broker_response']),
  broker_rejected: new Set(['customs_broker_response']),
  authority_submitted: new Set(['customs_broker_response', 'customs_declaration']),
  authority_accepted: new Set(['customs_authority_response']),
  authority_rejected: new Set(['customs_authority_response']),
  authority_released: new Set(['customs_authority_response']),
  authority_cancelled: new Set(['customs_authority_response']),
  amendment_requested: new Set(['customs_broker_response']),
  amendment_submitted: new Set(['customs_broker_response', 'customs_declaration'])
};
const EU_IMPORT_EVENT_EVIDENCE_TYPES = {
  declarant_received: new Set(['eu_declarant_response']),
  declarant_validated: new Set(['eu_declarant_response']),
  declarant_rejected: new Set(['eu_declarant_response']),
  authority_submitted: new Set(['eu_declarant_response', 'eu_import_declaration']),
  authority_accepted: new Set(['eu_customs_authority_response']),
  authority_rejected: new Set(['eu_customs_authority_response']),
  authority_released: new Set(['eu_customs_authority_response']),
  authority_cancelled: new Set(['eu_customs_authority_response']),
  amendment_requested: new Set(['eu_declarant_response']),
  amendment_submitted: new Set(['eu_declarant_response', 'eu_import_declaration'])
};

// Versioned, conservative heading-level gate. It deliberately excludes textile/apparel/footwear
// chapters 61, 62 and 64. A positive match still requires reviewer confirmation against Annex I.
const CBAM_RULESET = {
  version: 'EU-CBAM-ANNEX-I-2026.01',
  effectiveFrom: '2026-01-01',
  prefixes: [
    '2507', '2523', '27160000', '28041000', '2808', '2814', '28342100', '3102', '3105',
    '72', '7301', '7302', '7303', '7304', '7305', '7306', '7307', '7308', '7309', '7310',
    '7311', '7318', '7326', '7601', '7603', '7604', '7605', '7606', '7607', '7608',
    '7609', '7610', '7611', '7612', '7613', '7614', '7616'
  ]
};

function text(value) { return String(value ?? '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
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
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sourceSnapshotSha256(snapshot) {
  return sha256(JSON.stringify({
    shipment: snapshot?.shipment || null,
    profile: snapshot?.profile || null,
    lines: snapshot?.lines || [],
    containers: snapshot?.containers || [],
    packages: snapshot?.packages || [],
    carrierDocuments: snapshot?.carrierDocuments || []
  }));
}
function documentSourceSnapshotSha256(snapshot, documentType) {
  if (!['vn_customs_handoff', 'eu_import_handoff'].includes(documentType)) return sourceSnapshotSha256(snapshot);
  const isEuImport = documentType === 'eu_import_handoff';
  return sha256(JSON.stringify({
    baseSourceSnapshotSha256: sourceSnapshotSha256(snapshot),
    customsProfile: isEuImport ? snapshot?.euImportProfile || null : snapshot?.vnCustomsProfile || null,
    euImportLineDetails: isEuImport ? snapshot?.euImportLineDetails || [] : undefined,
    supportingIssuedDocuments: (snapshot?.documents || [])
      .filter((document) => ['commercial_invoice', 'packing_list'].includes(document.type) && document.status === 'issued')
      .map((document) => ({
        id: document.id, type: document.type, version: document.version,
        payloadSha256: document.payloadSha256, fileSha256: document.fileSha256,
        sourceSnapshotSha256: document.sourceSnapshotSha256
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
    handoffSchema: isEuImport ? EU_IMPORT_HANDOFF_SCHEMA : VN_CUSTOMS_HANDOFF_SCHEMA
  }));
}
function isCurrentIssuedSupportingDocument(snapshot, document) {
  return Boolean(document
    && ['commercial_invoice', 'packing_list'].includes(document.type)
    && document.status === 'issued'
    && document.payloadSha256
    && document.fileSha256
    && document.sourceSnapshotSha256 === sourceSnapshotSha256(snapshot));
}
function normalizeHsCode(value) { return text(value).replace(/[^0-9]/g, ''); }
function isIsoDate(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const date = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized;
}
function isCbamApplicable(hsCode) {
  const normalized = normalizeHsCode(hsCode);
  return Boolean(normalized && CBAM_RULESET.prefixes.some((prefix) => normalized.startsWith(prefix)));
}
function csvEscape(value) {
  const result = String(value ?? '');
  return /[",\r\n]/.test(result) ? `"${result.replace(/"/g, '""')}"` : result;
}

function packageFactor(pkg, field) {
  const basis = field === 'weight' ? pkg?.weightMeasurementBasis : pkg?.dimensionMeasurementBasis;
  return basis === 'group_total' ? 1 : Number(pkg?.quantity || 1);
}

function packageNetTotal(pkg) {
  return Number(pkg?.netWeightKg || 0) * packageFactor(pkg, 'weight');
}

function packageGrossTotal(pkg) {
  return Number(pkg?.grossWeightKg || 0) * packageFactor(pkg, 'weight');
}

function packageCbmTotal(pkg) {
  return Number(pkg?.lengthCm || 0) * Number(pkg?.widthCm || 0) * Number(pkg?.heightCm || 0)
    * packageFactor(pkg, 'dimension') / 1000000;
}

function measurementBasis(value) {
  const normalized = text(value) || 'per_package';
  return MEASUREMENT_BASES.has(normalized) ? normalized : 'per_package';
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    targetMarket: row.target_market,
    invoiceNumber: row.invoice_number || '',
    invoiceDate: dateOnly(row.invoice_date),
    invoiceIssuePlace: row.invoice_issue_place || '',
    packingListNumber: row.packing_list_number || '',
    packingListDate: dateOnly(row.packing_list_date),
    poContractId: row.po_contract_id || '',
    incotermCode: row.incoterm_code || '',
    incotermLocation: row.incoterm_location || '',
    incotermVersion: row.incoterm_version || 'Incoterms 2020',
    currency: row.currency || '',
    paymentTerms: row.payment_terms || '',
    exporter: row.exporter || {},
    importer: row.importer || {},
    consignee: row.consignee || {},
    notifyParty: row.notify_party || {},
    exporterTaxId: row.exporter_tax_id || '',
    importerEori: row.importer_eori || '',
    importerVatId: row.importer_vat_id || '',
    carrierName: row.carrier_name || '',
    portOfLoading: row.port_of_loading || '',
    portOfDischarge: row.port_of_discharge || '',
    placeOfDelivery: row.place_of_delivery || '',
    vesselName: row.vessel_name || '',
    voyageNumber: row.voyage_number || '',
    billOfLadingNo: row.bill_of_lading_no || '',
    containerNo: row.container_no || '',
    sealNo: row.seal_no || '',
    customsDeclarationNo: row.customs_declaration_no || '',
    freightAmount: numberOrNull(row.freight_amount),
    insuranceAmount: numberOrNull(row.insurance_amount),
    discountAmount: numberOrNull(row.discount_amount),
    surchargeAmount: numberOrNull(row.surcharge_amount),
    customsValueAmount: numberOrNull(row.customs_value_amount),
    customsValueBasis: row.customs_value_basis || '',
    transportMode: row.transport_mode || '',
    preferentialOriginClaim: row.preferential_origin_claim === true,
    metadata: row.metadata || {},
    updatedAt: row.updated_at
  };
}

function lineFromRow(row) {
  return {
    id: row.id, shipmentId: row.shipment_id, sourceProductId: row.source_product_id,
    lineNumber: Number(row.line_number), sku: row.sku, goodsDescription: row.goods_description,
    hsCode: row.hs_code, originCountry: row.origin_country, quantity: Number(row.quantity),
    styleCode: row.style_code || '', sizeLabel: row.size_label || '', colorLabel: row.color_label || '',
    lotNumber: row.lot_number || '', hsCodeConfirmed: row.hs_code_confirmed === true,
    hsCodeSource: row.hs_code_source || '', hsCodeRuleset: row.hs_code_ruleset || '',
    hsCodeEffectiveDate: dateOnly(row.hs_code_effective_date),
    hsCodeConfirmedBy: row.hs_code_confirmed_by || null, hsCodeConfirmedAt: row.hs_code_confirmed_at || null,
    unit: row.unit, unitPrice: numberOrNull(row.unit_price), currency: row.currency || '',
    netWeightKg: numberOrNull(row.net_weight_kg), grossWeightKg: numberOrNull(row.gross_weight_kg),
    embeddedCo2eKg: numberOrNull(row.embedded_co2e_kg), packageRefs: row.package_refs || [],
    carbonAuthority: row.carbon_snapshot_id ? {
      authoritative: true,
      snapshotId: row.carbon_snapshot_id,
      snapshotVersion: numberOrNull(row.carbon_snapshot_version),
      engineVersion: row.carbon_engine_version || '',
      methodologyVersion: row.carbon_methodology_version || '',
      factorRegistryVersion: row.carbon_factor_registry_version || '',
      gwpBasis: row.carbon_gwp_basis || '',
      boundary: row.carbon_boundary || '',
      canonicalInputHash: row.carbon_canonical_input_hash || '',
      factorSnapshot: row.carbon_factor_snapshot || [],
      allocationMethod: row.carbon_allocation_method || ''
    } : null,
    metadata: row.metadata || {}
  };
}

function packageFromRow(row) {
  return {
    id: row.id, shipmentId: row.shipment_id, packageNumber: row.package_number,
    packageType: row.package_type, marksAndNumbers: row.marks_and_numbers || '',
    containerId: row.container_id || null, containerNumber: row.container_number || '',
    sealNumber: row.seal_number || '', parentPackageId: row.parent_package_id || null,
    parentPackageNumber: row.parent_package_number || '', sequenceNo: numberOrNull(row.sequence_no),
    quantity: Number(row.quantity), netWeightKg: numberOrNull(row.net_weight_kg),
    grossWeightKg: numberOrNull(row.gross_weight_kg), lengthCm: numberOrNull(row.length_cm),
    widthCm: numberOrNull(row.width_cm), heightCm: numberOrNull(row.height_cm),
    weightMeasurementBasis: row.weight_measurement_basis || 'per_package',
    dimensionMeasurementBasis: row.dimension_measurement_basis || 'per_package',
    contents: row.contents || []
  };
}

function containerFromRow(row) {
  return {
    id: row.id, shipmentId: row.shipment_id, containerNumber: row.container_number,
    sealNumber: row.seal_number, equipmentType: row.equipment_type,
    marksAndNumbers: row.marks_and_numbers || '', tareWeightKg: numberOrNull(row.tare_weight_kg),
    maxGrossWeightKg: numberOrNull(row.max_gross_weight_kg), metadata: row.metadata || {}
  };
}

function carrierDocumentFromRow(row) {
  const value = row.carrier_metadata || null;
  const reconciliation = row.carrier_reconciliation || null;
  const evidence = {
    id: row.id,
    type: row.evidence_type,
    name: row.original_filename || row.document_name,
    status: row.status,
    validFrom: dateOnly(row.valid_from),
    validTo: dateOnly(row.valid_to),
    checksumSha256: row.checksum_sha256 || null,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    mimeType: row.mime_type || null,
    uploadedAt: row.uploaded_at,
    approvedAt: row.locked_at,
    approvedBy: row.approved_by,
    approvalNote: row.approval_note
  };
  if (!value) return { ...evidence, structured: null, latestReconciliation: null };
  return {
    ...evidence,
    structured: {
      id: value.id,
      evidenceDocumentId: value.evidence_document_id,
      documentType: value.document_type,
      contractLevel: value.contract_level,
      transportMode: value.transport_mode,
      documentNumber: value.document_number,
      version: Number(value.version),
      status: value.status,
      issuerName: value.issuer_name || '',
      issuerIdentifier: value.issuer_identifier || '',
      issueDate: dateOnly(value.issue_date),
      issuePlace: value.issue_place || '',
      onBoardDate: dateOnly(value.on_board_date),
      shipper: value.shipper || {},
      consignee: value.consignee || {},
      notifyParty: value.notify_party || {},
      vesselName: value.vessel_name || '',
      voyageNumber: value.voyage_number || '',
      flightNumber: value.flight_number || '',
      vehicleRegistration: value.vehicle_registration || '',
      trainNumber: value.train_number || '',
      placeOfReceipt: value.place_of_receipt || '',
      placeOfLoading: value.place_of_loading || '',
      placeOfDischarge: value.place_of_discharge || '',
      placeOfDelivery: value.place_of_delivery || '',
      goodsDescription: value.goods_description || '',
      packageCount: numberOrNull(value.package_count),
      packageType: value.package_type || '',
      marksAndNumbers: value.marks_and_numbers || '',
      grossWeightKg: numberOrNull(value.gross_weight_kg),
      measurementCbm: numberOrNull(value.measurement_cbm),
      containerNumbers: value.container_numbers || [],
      sealNumbers: value.seal_numbers || [],
      freightTerms: value.freight_terms || '',
      paymentTerms: value.payment_terms || '',
      authenticationMethod: value.authentication_method || '',
      authenticationReference: value.authentication_reference || '',
      authenticityStatus: value.authenticity_status,
      originalStatus: value.original_status,
      negotiable: value.negotiable,
      metadataSource: value.metadata_source,
      metadata: value.metadata || {},
      supersedesId: value.supersedes_id || null,
      confirmedBy: value.metadata_confirmed_by || null,
      confirmerName: value.metadata_confirmer_name_snapshot || null,
      confirmerEmail: value.metadata_confirmer_email_snapshot || null,
      confirmationNote: value.metadata_confirmation_note || null,
      confirmedAt: value.metadata_confirmed_at || null,
      createdAt: value.created_at,
      updatedAt: value.updated_at
    },
    latestReconciliation: reconciliation ? {
      id: reconciliation.id,
      rulesetVersion: reconciliation.ruleset_version,
      sourceSnapshotSha256: reconciliation.source_snapshot_sha256,
      status: reconciliation.status,
      checks: reconciliation.checks || [],
      reconciledBy: reconciliation.reconciled_by,
      reconcilerName: reconciliation.reconciler_name_snapshot,
      reconcilerEmail: reconciliation.reconciler_email_snapshot || null,
      reconciledAt: reconciliation.reconciled_at
    } : null
  };
}

function carrierReconciliationSha256(snapshot, carrierDocument) {
  const structured = carrierDocument?.structured || carrierDocument || {};
  return sha256(JSON.stringify({
    shipment: snapshot?.shipment || null,
    profile: snapshot?.profile || null,
    lines: snapshot?.lines || [],
    containers: snapshot?.containers || [],
    packages: snapshot?.packages || [],
    carrier: {
      id: structured.id || null,
      version: Number(structured.version || 0),
      ...normalizeCarrierDocument(structured)
    },
    evidence: {
      id: carrierDocument?.id || structured.evidenceDocumentId || null,
      type: carrierDocument?.type || null,
      checksumSha256: carrierDocument?.checksumSha256 || null,
      fileSizeBytes: Number(carrierDocument?.fileSizeBytes || 0)
    }
  }));
}

function requirement(documentType, code, status, fieldPath, message, applicable = true, evidenceIds = []) {
  return { documentType, code, status, fieldPath, message, applicable, evidenceDocumentIds: evidenceIds };
}

class ExportShipmentService {
  constructor({ database = pool, uploadsRoot = UPLOADS_ROOT, queue = null } = {}) {
    this.database = database;
    this.uploadsRoot = uploadsRoot;
    this.queue = queue;
  }

  async _assertShipment(companyId, shipmentId, queryable = this.database) {
    if (!UUID_REGEX.test(String(shipmentId || ''))) return null;
    const result = await queryable.query(
      `SELECT id, reference_number, origin_country, destination_country, total_weight_kg,
              total_co2e, status, created_at, updated_at
       FROM shipments WHERE id = $1 AND company_id = $2`,
      [shipmentId, companyId]
    );
    return result.rows[0] || null;
  }

  async getProfile(companyId, shipmentId) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    const [profileResult, linesResult, containersResult, packagesResult, evidenceResult, documentsResult,
      vnCustomsProfileResult, vnCustomsEventsResult, vnCustomsEvidenceResult,
      euImportProfileResult, euImportLineDetailsResult, euImportEventsResult, euImportEvidenceResult] = await Promise.all([
      this.database.query('SELECT * FROM shipment_export_profiles WHERE shipment_id = $1 AND company_id = $2', [shipmentId, companyId]),
      this.database.query('SELECT * FROM shipment_export_lines WHERE shipment_id = $1 AND company_id = $2 ORDER BY line_number', [shipmentId, companyId]),
      this.database.query('SELECT * FROM shipment_containers WHERE shipment_id = $1 AND company_id = $2 ORDER BY container_number', [shipmentId, companyId]),
      this.database.query(
        `SELECT p.*, c.container_number, c.seal_number, parent.package_number AS parent_package_number
         FROM shipment_packages p
         LEFT JOIN shipment_containers c ON c.id = p.container_id AND c.company_id = p.company_id AND c.shipment_id = p.shipment_id
         LEFT JOIN shipment_packages parent ON parent.id = p.parent_package_id AND parent.company_id = p.company_id AND parent.shipment_id = p.shipment_id
         WHERE p.shipment_id = $1 AND p.company_id = $2
         ORDER BY c.container_number NULLS LAST, p.sequence_no NULLS LAST, p.package_number`, [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT evidence.id, evidence.evidence_type, evidence.document_name, evidence.original_filename,
                evidence.status, evidence.valid_from, evidence.valid_to, evidence.checksum_sha256,
                evidence.file_size_bytes, evidence.mime_type, evidence.uploaded_at, evidence.locked_at,
                evidence.approved_by, evidence.approval_note,
                to_jsonb(carrier) AS carrier_metadata,
                to_jsonb(latest_reconciliation) AS carrier_reconciliation
         FROM evidence_documents evidence
         LEFT JOIN shipment_carrier_documents carrier
           ON carrier.evidence_document_id = evidence.id
          AND carrier.company_id = evidence.company_id
          AND carrier.shipment_id = evidence.shipment_id
         LEFT JOIN LATERAL (
           SELECT reconciliation.* FROM carrier_document_reconciliations reconciliation
           WHERE reconciliation.carrier_document_id = carrier.id
             AND reconciliation.company_id = carrier.company_id
             AND reconciliation.shipment_id = carrier.shipment_id
           ORDER BY reconciliation.reconciled_at DESC, reconciliation.id DESC LIMIT 1
         ) latest_reconciliation ON true
         WHERE evidence.shipment_id = $1 AND evidence.company_id = $2
           AND evidence.evidence_type = ANY($3::text[])
         ORDER BY evidence.created_at DESC`, [shipmentId, companyId, [...CARRIER_EVIDENCE_TYPES, 'origin_support']]
      ),
      this.database.query(
        `SELECT ed.*, r.status AS report_status, r.download_url,
                latest_review.id AS latest_review_id,
                latest_review.reviewer_role AS latest_review_role,
                latest_review.decision AS latest_review_decision,
                latest_review.notes AS latest_review_notes,
                latest_review.reviewed_by AS latest_reviewed_by,
                latest_review.reviewer_name_snapshot AS latest_reviewer_name,
                latest_review.reviewer_email_snapshot AS latest_reviewer_email,
                latest_review.reviewed_at AS latest_reviewed_at,
                latest_review.document_payload_sha256 AS review_payload_sha256,
                latest_review.document_file_sha256 AS review_file_sha256,
                latest_review.source_snapshot_sha256 AS review_source_snapshot_sha256
         FROM export_documents ed
         LEFT JOIN reports r ON r.id = ed.report_id
         LEFT JOIN LATERAL (
           SELECT review.* FROM export_document_reviews review
           WHERE review.export_document_id = ed.id AND review.company_id = ed.company_id
             AND review.shipment_id = ed.shipment_id
           ORDER BY review.reviewed_at DESC, review.id DESC LIMIT 1
         ) latest_review ON true
         WHERE ed.shipment_id = $1 AND ed.company_id = $2
         ORDER BY ed.document_type, ed.version DESC`, [shipmentId, companyId]
      ),
      this.database.query(
        'SELECT * FROM shipment_vn_customs_profiles WHERE shipment_id=$1 AND company_id=$2',
        [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT event.* FROM vn_customs_external_events event
         WHERE event.shipment_id=$1 AND event.company_id=$2
         ORDER BY event.occurred_at DESC, event.created_at DESC, event.id DESC`,
        [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT id, evidence_type, document_name, original_filename, status, valid_from, valid_to,
                checksum_sha256, file_size_bytes, mime_type, uploaded_at, locked_at, approved_by
         FROM evidence_documents
         WHERE shipment_id=$1 AND company_id=$2
           AND evidence_type = ANY($3::text[])
        ORDER BY created_at DESC`,
        [shipmentId, companyId, ['customs_broker_response', 'customs_authority_response', 'customs_declaration']]
      ),
      this.database.query(
        'SELECT * FROM shipment_eu_import_profiles WHERE shipment_id=$1 AND company_id=$2',
        [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT * FROM shipment_eu_import_line_details
         WHERE shipment_id=$1 AND company_id=$2 ORDER BY export_line_id`,
        [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT event.* FROM eu_import_external_events event
         WHERE event.shipment_id=$1 AND event.company_id=$2
         ORDER BY event.occurred_at DESC, event.created_at DESC, event.id DESC`,
        [shipmentId, companyId]
      ),
      this.database.query(
        `SELECT id, evidence_type, document_name, original_filename, status, valid_from, valid_to,
                checksum_sha256, file_size_bytes, mime_type, uploaded_at, locked_at, approved_by
         FROM evidence_documents
         WHERE shipment_id=$1 AND company_id=$2
           AND evidence_type = ANY($3::text[])
         ORDER BY created_at DESC`,
        [shipmentId, companyId, ['eu_declarant_response', 'eu_customs_authority_response', 'eu_import_declaration']]
      )
    ]);
    const snapshot = {
      shipment: {
        id: shipment.id, referenceNumber: shipment.reference_number, status: shipment.status,
        originCountry: shipment.origin_country, destinationCountry: shipment.destination_country,
        totalWeightKg: numberOrNull(shipment.total_weight_kg), totalCo2e: numberOrNull(shipment.total_co2e)
      },
      profile: profileFromRow(profileResult.rows[0]),
      lines: linesResult.rows.map(lineFromRow),
      containers: containersResult.rows.map(containerFromRow),
      packages: packagesResult.rows.map(packageFromRow),
      carrierDocuments: evidenceResult.rows.map(carrierDocumentFromRow),
      vnCustomsProfile: vnCustomsProfileFromRow(vnCustomsProfileResult.rows[0]),
      vnCustomsEvents: vnCustomsEventsResult.rows.map((row) => this._formatVnCustomsEvent(row)),
      vnCustomsEvidence: vnCustomsEvidenceResult.rows.map((row) => ({
        id: row.id, type: row.evidence_type, name: row.original_filename || row.document_name,
        status: row.status, validFrom: dateOnly(row.valid_from), validTo: dateOnly(row.valid_to),
        checksumSha256: row.checksum_sha256 || null, fileSizeBytes: Number(row.file_size_bytes || 0),
        mimeType: row.mime_type || null, uploadedAt: row.uploaded_at, approvedAt: row.locked_at,
        approvedBy: row.approved_by || null
      })),
      euImportProfile: euImportProfileFromRow(euImportProfileResult.rows[0]),
      euImportLineDetails: euImportLineDetailsResult.rows.map(euImportLineDetailFromRow),
      euImportEvents: euImportEventsResult.rows.map((row) => this._formatEuImportEvent(row)),
      euImportEvidence: euImportEvidenceResult.rows.map((row) => ({
        id: row.id, type: row.evidence_type, name: row.original_filename || row.document_name,
        status: row.status, validFrom: dateOnly(row.valid_from), validTo: dateOnly(row.valid_to),
        checksumSha256: row.checksum_sha256 || null, fileSizeBytes: Number(row.file_size_bytes || 0),
        mimeType: row.mime_type || null, uploadedAt: row.uploaded_at, approvedAt: row.locked_at,
        approvedBy: row.approved_by || null
      })),
      documents: documentsResult.rows.map((row) => this._formatDocument(row))
    };
    snapshot.documents = snapshot.documents.map((document) => {
      const currentSnapshotHash = documentSourceSnapshotSha256(snapshot, document.type);
      if (!document.latestReview || document.sourceSnapshotSha256 === currentSnapshotHash) return document;
      return {
        ...document,
        readyToIssue: false,
        latestReview: { ...document.latestReview, decision: 'stale', stale: true }
      };
    });
    return snapshot;
  }

  async upsertProfile(companyId, shipmentId, userId, input = {}) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    const value = (camel, snake = camel) => input[camel] ?? input[snake] ?? null;
    const result = await this.database.query(
      `INSERT INTO shipment_export_profiles (
         company_id, shipment_id, target_market, invoice_number, invoice_date, invoice_issue_place,
         packing_list_number, packing_list_date, po_contract_id,
         incoterm_code, incoterm_location, incoterm_version, currency, payment_terms,
         exporter, importer, consignee, notify_party, exporter_tax_id, importer_eori, importer_vat_id,
         port_of_loading, port_of_discharge, place_of_delivery, vessel_name, voyage_number, carrier_name,
         bill_of_lading_no, container_no, seal_no, customs_declaration_no, freight_amount,
         insurance_amount, discount_amount, surcharge_amount, customs_value_amount, customs_value_basis, transport_mode,
         preferential_origin_claim, metadata, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,
                 $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40::jsonb,$41,$41)
       ON CONFLICT (shipment_id) DO UPDATE SET
         target_market=EXCLUDED.target_market, invoice_number=EXCLUDED.invoice_number,
         invoice_date=EXCLUDED.invoice_date, invoice_issue_place=EXCLUDED.invoice_issue_place,
         packing_list_number=EXCLUDED.packing_list_number, packing_list_date=EXCLUDED.packing_list_date,
         po_contract_id=EXCLUDED.po_contract_id,
         incoterm_code=EXCLUDED.incoterm_code, incoterm_location=EXCLUDED.incoterm_location,
         incoterm_version=EXCLUDED.incoterm_version, currency=EXCLUDED.currency,
         payment_terms=EXCLUDED.payment_terms, exporter=EXCLUDED.exporter, importer=EXCLUDED.importer,
         consignee=EXCLUDED.consignee, notify_party=EXCLUDED.notify_party,
         exporter_tax_id=EXCLUDED.exporter_tax_id, importer_eori=EXCLUDED.importer_eori,
         importer_vat_id=EXCLUDED.importer_vat_id,
         port_of_loading=EXCLUDED.port_of_loading, port_of_discharge=EXCLUDED.port_of_discharge,
         place_of_delivery=EXCLUDED.place_of_delivery, vessel_name=EXCLUDED.vessel_name,
         voyage_number=EXCLUDED.voyage_number, carrier_name=EXCLUDED.carrier_name,
         bill_of_lading_no=EXCLUDED.bill_of_lading_no,
         container_no=EXCLUDED.container_no, seal_no=EXCLUDED.seal_no,
         customs_declaration_no=EXCLUDED.customs_declaration_no, freight_amount=EXCLUDED.freight_amount,
         insurance_amount=EXCLUDED.insurance_amount, discount_amount=EXCLUDED.discount_amount,
         surcharge_amount=EXCLUDED.surcharge_amount, customs_value_amount=EXCLUDED.customs_value_amount,
         customs_value_basis=EXCLUDED.customs_value_basis, transport_mode=EXCLUDED.transport_mode,
         preferential_origin_claim=EXCLUDED.preferential_origin_claim, metadata=EXCLUDED.metadata,
         updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [
        companyId, shipmentId, text(value('targetMarket', 'target_market')) || 'EU',
        text(value('invoiceNumber', 'invoice_number')) || null, text(value('invoiceDate', 'invoice_date')) || null,
        text(value('invoiceIssuePlace', 'invoice_issue_place')) || null,
        text(value('packingListNumber', 'packing_list_number')) || null,
        text(value('packingListDate', 'packing_list_date')) || null,
        text(value('poContractId', 'po_contract_id')) || null, text(value('incotermCode', 'incoterm_code')).toUpperCase() || null,
        text(value('incotermLocation', 'incoterm_location')) || null,
        text(value('incotermVersion', 'incoterm_version')) || 'Incoterms 2020',
        text(value('currency')).toUpperCase() || null, text(value('paymentTerms', 'payment_terms')) || null,
        JSON.stringify(object(value('exporter'))), JSON.stringify(object(value('importer'))),
        JSON.stringify(object(value('consignee'))), JSON.stringify(object(value('notifyParty', 'notify_party'))),
        text(value('exporterTaxId', 'exporter_tax_id')) || null, text(value('importerEori', 'importer_eori')) || null,
        text(value('importerVatId', 'importer_vat_id')) || null,
        text(value('portOfLoading', 'port_of_loading')) || null, text(value('portOfDischarge', 'port_of_discharge')) || null,
        text(value('placeOfDelivery', 'place_of_delivery')) || null, text(value('vesselName', 'vessel_name')) || null,
        text(value('voyageNumber', 'voyage_number')) || null, text(value('carrierName', 'carrier_name')) || null,
        text(value('billOfLadingNo', 'bill_of_lading_no')) || null,
        text(value('containerNo', 'container_no')) || null, text(value('sealNo', 'seal_no')) || null,
        text(value('customsDeclarationNo', 'customs_declaration_no')) || null,
        numberOrNull(value('freightAmount', 'freight_amount')), numberOrNull(value('insuranceAmount', 'insurance_amount')),
        numberOrNull(value('discountAmount', 'discount_amount')), numberOrNull(value('surchargeAmount', 'surcharge_amount')),
        numberOrNull(value('customsValueAmount', 'customs_value_amount')),
        text(value('customsValueBasis', 'customs_value_basis')) || null,
        text(value('transportMode', 'transport_mode')) || null,
        value('preferentialOriginClaim', 'preferential_origin_claim') === true,
        JSON.stringify(object(value('metadata'))), userId
      ]
    );
    return profileFromRow(result.rows[0]);
  }

  async upsertVnCustomsProfile(companyId, shipmentId, userId, input = {}) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    const value = normalizeVnCustomsProfile(input);
    const result = await this.database.query(
      `INSERT INTO shipment_vn_customs_profiles (
         company_id, shipment_id, schema_id, schema_version, ruleset_version, regulatory_basis_version,
         filing_purpose, declarant, customs_broker, customs_office_code, declaration_type_code,
         cargo_classification_code, transport_method_code, exit_customs_office_code, loading_location_code,
         destination_country_code, invoice_classification_code, invoice_payment_method_code, exchange_rate,
         permit_requirement_status, permit_references, inspection_requirement_status, inspection_references,
         tax_treatment, export_duty_rate, export_duty_amount, tax_basis, supporting_documents,
         broker_target_schema_id, broker_target_schema_version, declaration_notes, metadata, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'broker_handoff',$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20::jsonb,$21,$22::jsonb,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31::jsonb,$32,$32
       ) ON CONFLICT (shipment_id) DO UPDATE SET
         schema_id=EXCLUDED.schema_id, schema_version=EXCLUDED.schema_version,
         ruleset_version=EXCLUDED.ruleset_version, regulatory_basis_version=EXCLUDED.regulatory_basis_version,
         filing_purpose='broker_handoff', declarant=EXCLUDED.declarant, customs_broker=EXCLUDED.customs_broker,
         customs_office_code=EXCLUDED.customs_office_code, declaration_type_code=EXCLUDED.declaration_type_code,
         cargo_classification_code=EXCLUDED.cargo_classification_code,
         transport_method_code=EXCLUDED.transport_method_code,
         exit_customs_office_code=EXCLUDED.exit_customs_office_code,
         loading_location_code=EXCLUDED.loading_location_code,
         destination_country_code=EXCLUDED.destination_country_code,
         invoice_classification_code=EXCLUDED.invoice_classification_code,
         invoice_payment_method_code=EXCLUDED.invoice_payment_method_code,
         exchange_rate=EXCLUDED.exchange_rate,
         permit_requirement_status=EXCLUDED.permit_requirement_status,
         permit_references=EXCLUDED.permit_references,
         inspection_requirement_status=EXCLUDED.inspection_requirement_status,
         inspection_references=EXCLUDED.inspection_references,
         tax_treatment=EXCLUDED.tax_treatment, export_duty_rate=EXCLUDED.export_duty_rate,
         export_duty_amount=EXCLUDED.export_duty_amount, tax_basis=EXCLUDED.tax_basis,
         supporting_documents=EXCLUDED.supporting_documents,
         broker_target_schema_id=EXCLUDED.broker_target_schema_id,
         broker_target_schema_version=EXCLUDED.broker_target_schema_version,
         declaration_notes=EXCLUDED.declaration_notes, metadata=EXCLUDED.metadata,
         updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [
        companyId, shipmentId, value.schemaId, value.schemaVersion, value.rulesetVersion,
        value.regulatoryBasisVersion, JSON.stringify(value.declarant), JSON.stringify(value.customsBroker),
        value.customsOfficeCode || null, value.declarationTypeCode || null,
        value.cargoClassificationCode || null, value.transportMethodCode || null,
        value.exitCustomsOfficeCode || null, value.loadingLocationCode || null,
        value.destinationCountryCode || null, value.invoiceClassificationCode || null,
        value.invoicePaymentMethodCode || null, value.exchangeRate,
        value.permitRequirementStatus, JSON.stringify(value.permitReferences),
        value.inspectionRequirementStatus, JSON.stringify(value.inspectionReferences),
        value.taxTreatment, value.exportDutyRate, value.exportDutyAmount, value.taxBasis || null,
        JSON.stringify(value.supportingDocuments), value.brokerTargetSchemaId || null,
        value.brokerTargetSchemaVersion || null, value.declarationNotes || null,
        JSON.stringify(value.metadata), userId
      ]
    );
    return vnCustomsProfileFromRow(result.rows[0]);
  }

  async reconcileVnCustomsHandoff(companyId, shipmentId) {
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (!snapshot) return null;
    const reconciliation = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(snapshot, document)
    });
    return {
      ...reconciliation,
      sourceSnapshotSha256: documentSourceSnapshotSha256(snapshot, 'vn_customs_handoff'),
      schema: VN_CUSTOMS_HANDOFF_SCHEMA
    };
  }

  async getVnCustomsEvents(companyId, shipmentId) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    const result = await this.database.query(
      `SELECT * FROM vn_customs_external_events
       WHERE company_id=$1 AND shipment_id=$2
       ORDER BY occurred_at DESC, created_at DESC, id DESC`,
      [companyId, shipmentId]
    );
    return result.rows.map((row) => this._formatVnCustomsEvent(row));
  }

  async recordVnCustomsEvent(companyId, shipmentId, userId, input = {}) {
    const eventType = text(input.eventType || input.event_type).toLowerCase();
    const exportDocumentId = text(input.exportDocumentId || input.export_document_id);
    const evidenceDocumentId = text(input.evidenceDocumentId || input.evidence_document_id);
    const externalReference = text(input.externalReference || input.external_reference);
    const actorName = text(input.actorName || input.actor_name);
    const occurredAt = text(input.occurredAt || input.occurred_at);
    if (!VN_CUSTOMS_EVENT_TYPES.has(eventType)) return { error: 'VN_CUSTOMS_EVENT_TYPE_INVALID' };
    if (!UUID_REGEX.test(exportDocumentId) || !UUID_REGEX.test(evidenceDocumentId)) {
      return { error: 'VN_CUSTOMS_EVENT_LINK_INVALID' };
    }
    if (!externalReference || !actorName || !occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
      return { error: 'VN_CUSTOMS_EVENT_DETAILS_REQUIRED' };
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const documentResult = await client.query(
        `SELECT id, document_type, status, payload_sha256, file_sha256
         FROM export_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 FOR SHARE`,
        [exportDocumentId, companyId, shipmentId]
      );
      const document = documentResult.rows[0];
      if (!document || document.document_type !== 'vn_customs_handoff') {
        await client.query('ROLLBACK');
        return { error: 'VN_CUSTOMS_HANDOFF_NOT_FOUND' };
      }
      if (document.status !== 'issued' || !document.payload_sha256 || !document.file_sha256) {
        await client.query('ROLLBACK');
        return { error: 'VN_CUSTOMS_HANDOFF_NOT_ISSUED' };
      }
      const evidenceResult = await client.query(
        `SELECT id, evidence_type, status, valid_to, storage_provider, storage_key, checksum_sha256, file_size_bytes
         FROM evidence_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 FOR SHARE`,
        [evidenceDocumentId, companyId, shipmentId]
      );
      const evidence = evidenceResult.rows[0];
      if (!evidence || !['locked', 'third_party_verified'].includes(evidence.status)
        || (evidence.valid_to && new Date(evidence.valid_to) < new Date())) {
        await client.query('ROLLBACK');
        return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_NOT_APPROVED' };
      }
      if (!VN_CUSTOMS_EVENT_EVIDENCE_TYPES[eventType]?.has(evidence.evidence_type)) {
        await client.query('ROLLBACK');
        return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_TYPE_MISMATCH' };
      }
      const fileVerification = await this._verifyVnCustomsEvidenceFile(evidence);
      if (fileVerification.error) {
        await client.query('ROLLBACK');
        return fileVerification;
      }
      const userResult = await client.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
      const recorder = userResult.rows[0];
      if (!recorder || !text(recorder.full_name || recorder.email)) {
        await client.query('ROLLBACK');
        return { error: 'VN_CUSTOMS_EVENT_RECORDER_IDENTITY_REQUIRED' };
      }
      const sourceType = VN_CUSTOMS_AUTHORITY_EVENT_TYPES.has(eventType) ? 'authority' : 'broker';
      const inserted = await client.query(
        `INSERT INTO vn_customs_external_events (
           company_id, shipment_id, export_document_id, event_type, source_type, external_reference,
           message_code, message_text, evidence_document_id, evidence_sha256, evidence_file_size_bytes,
           document_payload_sha256, document_file_sha256, actor_name_snapshot, actor_identifier_snapshot,
           occurred_at, recorded_by, recorder_name_snapshot, recorder_email_snapshot, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
         RETURNING *`,
        [
          companyId, shipmentId, exportDocumentId, eventType, sourceType, externalReference,
          text(input.messageCode || input.message_code) || null,
          text(input.messageText || input.message_text) || null,
          evidenceDocumentId, fileVerification.sha256, fileVerification.fileSizeBytes,
          document.payload_sha256, document.file_sha256, actorName,
          text(input.actorIdentifier || input.actor_identifier) || null,
          new Date(occurredAt).toISOString(), userId, text(recorder.full_name || recorder.email),
          text(recorder.email) || null, JSON.stringify(object(input.metadata))
        ]
      );
      await client.query('COMMIT');
      return this._formatVnCustomsEvent(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async upsertEuImportProfile(companyId, shipmentId, userId, input = {}) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const value = normalizeEuImportProfile(input);
    const result = await this.database.query(
      `INSERT INTO shipment_eu_import_profiles (
         company_id, shipment_id, schema_id, schema_version, ruleset_version, regulatory_basis_version,
         filing_purpose, member_state_code, importer, declarant, representative, representation_type,
         customs_office_code, declaration_dataset_code, additional_declaration_type,
         requested_procedure_code, previous_procedure_code, mode_of_transport_at_border,
         inland_mode_of_transport, border_transport_identity, place_of_goods_code,
         delivery_terms_location, valuation_method_code, exchange_rate, customs_value_currency,
         customs_value_amount, duty_treatment, duty_rate, duty_amount, vat_treatment, vat_rate,
         vat_amount, tax_basis, restriction_status, restriction_references, preference_claim_status,
         preference_references, guarantee_requirement_status, guarantee_references, supporting_documents,
         target_system_schema_id, target_system_schema_version, declaration_notes, metadata, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'declarant_handoff',$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,
         $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
         $31,$32,$33,$34::jsonb,$35,$36::jsonb,$37,$38::jsonb,$39::jsonb,$40,$41,$42,$43::jsonb,$44,$44
       ) ON CONFLICT (shipment_id) DO UPDATE SET
         schema_id=EXCLUDED.schema_id, schema_version=EXCLUDED.schema_version,
         ruleset_version=EXCLUDED.ruleset_version, regulatory_basis_version=EXCLUDED.regulatory_basis_version,
         filing_purpose='declarant_handoff', member_state_code=EXCLUDED.member_state_code,
         importer=EXCLUDED.importer, declarant=EXCLUDED.declarant, representative=EXCLUDED.representative,
         representation_type=EXCLUDED.representation_type, customs_office_code=EXCLUDED.customs_office_code,
         declaration_dataset_code=EXCLUDED.declaration_dataset_code,
         additional_declaration_type=EXCLUDED.additional_declaration_type,
         requested_procedure_code=EXCLUDED.requested_procedure_code,
         previous_procedure_code=EXCLUDED.previous_procedure_code,
         mode_of_transport_at_border=EXCLUDED.mode_of_transport_at_border,
         inland_mode_of_transport=EXCLUDED.inland_mode_of_transport,
         border_transport_identity=EXCLUDED.border_transport_identity,
         place_of_goods_code=EXCLUDED.place_of_goods_code,
         delivery_terms_location=EXCLUDED.delivery_terms_location,
         valuation_method_code=EXCLUDED.valuation_method_code, exchange_rate=EXCLUDED.exchange_rate,
         customs_value_currency=EXCLUDED.customs_value_currency,
         customs_value_amount=EXCLUDED.customs_value_amount, duty_treatment=EXCLUDED.duty_treatment,
         duty_rate=EXCLUDED.duty_rate, duty_amount=EXCLUDED.duty_amount,
         vat_treatment=EXCLUDED.vat_treatment, vat_rate=EXCLUDED.vat_rate, vat_amount=EXCLUDED.vat_amount,
         tax_basis=EXCLUDED.tax_basis, restriction_status=EXCLUDED.restriction_status,
         restriction_references=EXCLUDED.restriction_references,
         preference_claim_status=EXCLUDED.preference_claim_status,
         preference_references=EXCLUDED.preference_references,
         guarantee_requirement_status=EXCLUDED.guarantee_requirement_status,
         guarantee_references=EXCLUDED.guarantee_references,
         supporting_documents=EXCLUDED.supporting_documents,
         target_system_schema_id=EXCLUDED.target_system_schema_id,
         target_system_schema_version=EXCLUDED.target_system_schema_version,
         declaration_notes=EXCLUDED.declaration_notes, metadata=EXCLUDED.metadata,
         updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [
        companyId, shipmentId, value.schemaId, value.schemaVersion, value.rulesetVersion,
        value.regulatoryBasisVersion, value.memberStateCode || null, JSON.stringify(value.importer),
        JSON.stringify(value.declarant), JSON.stringify(value.representative), value.representationType,
        value.customsOfficeCode || null, value.declarationDatasetCode || null,
        value.additionalDeclarationType || null, value.requestedProcedureCode || null,
        value.previousProcedureCode || null, value.modeOfTransportAtBorder || null,
        value.inlandModeOfTransport || null, value.borderTransportIdentity || null,
        value.placeOfGoodsCode || null, value.deliveryTermsLocation || null,
        value.valuationMethodCode || null, value.exchangeRate, value.customsValueCurrency || null,
        value.customsValueAmount, value.dutyTreatment, value.dutyRate, value.dutyAmount,
        value.vatTreatment, value.vatRate, value.vatAmount, value.taxBasis || null,
        value.restrictionStatus, JSON.stringify(value.restrictionReferences),
        value.preferenceClaimStatus, JSON.stringify(value.preferenceReferences),
        value.guaranteeRequirementStatus, JSON.stringify(value.guaranteeReferences),
        JSON.stringify(value.supportingDocuments), value.targetSystemSchemaId || null,
        value.targetSystemSchemaVersion || null, value.declarationNotes || null,
        JSON.stringify(value.metadata), userId
      ]
    );
    return euImportProfileFromRow(result.rows[0]);
  }

  async upsertEuImportLineDetail(companyId, shipmentId, exportLineId, userId, input = {}) {
    if (!UUID_REGEX.test(String(exportLineId || ''))) return null;
    const line = await this.database.query(
      'SELECT id FROM shipment_export_lines WHERE id=$1 AND shipment_id=$2 AND company_id=$3',
      [exportLineId, shipmentId, companyId]
    );
    if (!line.rows[0]) return null;
    const currentResult = await this.database.query(
      'SELECT * FROM shipment_eu_import_line_details WHERE export_line_id=$1 AND shipment_id=$2 AND company_id=$3',
      [exportLineId, shipmentId, companyId]
    );
    const current = euImportLineDetailFromRow(currentResult.rows[0]);
    const merged = normalizeEuImportLineDetail({ ...(current || {}), ...input, exportLineId });
    const changed = !current
      || merged.taricCode !== current.taricCode
      || merged.taricSource !== current.taricSource
      || merged.taricVersion !== current.taricVersion
      || merged.taricEffectiveDate !== current.taricEffectiveDate;
    const confirmed = Boolean(userId) && !changed && merged.taricConfirmed === true
      && Boolean(merged.taricCode && merged.taricSource && merged.taricVersion && merged.taricEffectiveDate);
    const result = await this.database.query(
      `INSERT INTO shipment_eu_import_line_details (
         company_id, shipment_id, export_line_id, taric_code, taric_source, taric_version,
         taric_effective_date, taric_confirmed, taric_confirmed_by, taric_confirmed_at,
         supplementary_unit_code, additional_codes, national_additional_codes, preference_code,
         requested_procedure_code, previous_procedure_code, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17::jsonb)
       ON CONFLICT (shipment_id, export_line_id) DO UPDATE SET
         taric_code=EXCLUDED.taric_code, taric_source=EXCLUDED.taric_source,
         taric_version=EXCLUDED.taric_version, taric_effective_date=EXCLUDED.taric_effective_date,
         taric_confirmed=EXCLUDED.taric_confirmed,
         taric_confirmed_by=CASE WHEN EXCLUDED.taric_confirmed THEN EXCLUDED.taric_confirmed_by ELSE NULL END,
         taric_confirmed_at=CASE WHEN EXCLUDED.taric_confirmed THEN COALESCE(shipment_eu_import_line_details.taric_confirmed_at, now()) ELSE NULL END,
         supplementary_unit_code=EXCLUDED.supplementary_unit_code,
         additional_codes=EXCLUDED.additional_codes,
         national_additional_codes=EXCLUDED.national_additional_codes,
         preference_code=EXCLUDED.preference_code,
         requested_procedure_code=EXCLUDED.requested_procedure_code,
         previous_procedure_code=EXCLUDED.previous_procedure_code,
         metadata=EXCLUDED.metadata, updated_at=now()
       RETURNING *`,
      [
        companyId, shipmentId, exportLineId, merged.taricCode || null, merged.taricSource || null,
        merged.taricVersion || null, merged.taricEffectiveDate, confirmed, confirmed ? userId : null,
        confirmed ? new Date() : null, merged.supplementaryUnitCode || null,
        JSON.stringify(merged.additionalCodes), JSON.stringify(merged.nationalAdditionalCodes),
        merged.preferenceCode || null, merged.requestedProcedureCode || null,
        merged.previousProcedureCode || null, JSON.stringify(merged.metadata)
      ]
    );
    return euImportLineDetailFromRow(result.rows[0]);
  }

  async reconcileEuImportHandoff(companyId, shipmentId) {
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (!snapshot) return null;
    const reconciliation = validateEuImportHandoff(snapshot, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(snapshot, document)
    });
    return {
      ...reconciliation,
      sourceSnapshotSha256: documentSourceSnapshotSha256(snapshot, 'eu_import_handoff'),
      schema: EU_IMPORT_HANDOFF_SCHEMA
    };
  }

  async getEuImportEvents(companyId, shipmentId) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const result = await this.database.query(
      `SELECT * FROM eu_import_external_events
       WHERE company_id=$1 AND shipment_id=$2
       ORDER BY occurred_at DESC, created_at DESC, id DESC`,
      [companyId, shipmentId]
    );
    return result.rows.map((row) => this._formatEuImportEvent(row));
  }

  async recordEuImportEvent(companyId, shipmentId, userId, input = {}) {
    const eventType = text(input.eventType || input.event_type).toLowerCase();
    const exportDocumentId = text(input.exportDocumentId || input.export_document_id);
    const evidenceDocumentId = text(input.evidenceDocumentId || input.evidence_document_id);
    const externalReference = text(input.externalReference || input.external_reference);
    const actorName = text(input.actorName || input.actor_name);
    const occurredAt = text(input.occurredAt || input.occurred_at);
    if (!EU_IMPORT_EVENT_TYPES.has(eventType)) return { error: 'EU_IMPORT_EVENT_TYPE_INVALID' };
    if (!UUID_REGEX.test(exportDocumentId) || !UUID_REGEX.test(evidenceDocumentId)) return { error: 'EU_IMPORT_EVENT_LINK_INVALID' };
    if (!externalReference || !actorName || !occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
      return { error: 'EU_IMPORT_EVENT_DETAILS_REQUIRED' };
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const documentResult = await client.query(
        `SELECT id, document_type, status, payload_sha256, file_sha256 FROM export_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 FOR SHARE`,
        [exportDocumentId, companyId, shipmentId]
      );
      const document = documentResult.rows[0];
      if (!document || document.document_type !== 'eu_import_handoff') {
        await client.query('ROLLBACK');
        return { error: 'EU_IMPORT_HANDOFF_NOT_FOUND' };
      }
      if (document.status !== 'issued' || !document.payload_sha256 || !document.file_sha256) {
        await client.query('ROLLBACK');
        return { error: 'EU_IMPORT_HANDOFF_NOT_ISSUED' };
      }
      const evidenceResult = await client.query(
        `SELECT id, evidence_type, status, valid_to, storage_provider, storage_key, checksum_sha256, file_size_bytes
         FROM evidence_documents WHERE id=$1 AND company_id=$2 AND shipment_id=$3 FOR SHARE`,
        [evidenceDocumentId, companyId, shipmentId]
      );
      const evidence = evidenceResult.rows[0];
      if (!evidence || !['locked', 'third_party_verified'].includes(evidence.status)
        || (evidence.valid_to && new Date(evidence.valid_to) < new Date())) {
        await client.query('ROLLBACK');
        return { error: 'EU_IMPORT_EVENT_EVIDENCE_NOT_APPROVED' };
      }
      if (!EU_IMPORT_EVENT_EVIDENCE_TYPES[eventType]?.has(evidence.evidence_type)) {
        await client.query('ROLLBACK');
        return { error: 'EU_IMPORT_EVENT_EVIDENCE_TYPE_MISMATCH' };
      }
      const verification = await this._verifyEuImportEvidenceFile(evidence);
      if (verification.error) {
        await client.query('ROLLBACK');
        return verification;
      }
      const userResult = await client.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
      const recorder = userResult.rows[0];
      if (!recorder || !text(recorder.full_name || recorder.email)) {
        await client.query('ROLLBACK');
        return { error: 'EU_IMPORT_EVENT_RECORDER_IDENTITY_REQUIRED' };
      }
      const sourceType = EU_IMPORT_AUTHORITY_EVENT_TYPES.has(eventType) ? 'authority' : 'declarant';
      const inserted = await client.query(
        `INSERT INTO eu_import_external_events (
           company_id, shipment_id, export_document_id, event_type, source_type, external_reference,
           message_code, message_text, evidence_document_id, evidence_sha256, evidence_file_size_bytes,
           document_payload_sha256, document_file_sha256, actor_name_snapshot, actor_identifier_snapshot,
           occurred_at, recorded_by, recorder_name_snapshot, recorder_email_snapshot, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
         RETURNING *`,
        [
          companyId, shipmentId, exportDocumentId, eventType, sourceType, externalReference,
          text(input.messageCode || input.message_code) || null,
          text(input.messageText || input.message_text) || null,
          evidenceDocumentId, verification.sha256, verification.fileSizeBytes,
          document.payload_sha256, document.file_sha256, actorName,
          text(input.actorIdentifier || input.actor_identifier) || null,
          new Date(occurredAt).toISOString(), userId, text(recorder.full_name || recorder.email),
          text(recorder.email) || null, JSON.stringify(object(input.metadata))
        ]
      );
      await client.query('COMMIT');
      return this._formatEuImportEvent(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async syncLinesFromShipment(companyId, shipmentId) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    await this.database.query(
      `UPDATE shipment_export_lines line SET
         embedded_co2e_kg = shipment_product.allocated_co2e,
         carbon_snapshot_id = snapshot.id,
         carbon_snapshot_version = snapshot.version,
         carbon_engine_version = snapshot.engine_version,
         carbon_methodology_version = snapshot.methodology_version,
         carbon_factor_registry_version = snapshot.factor_registry_version,
         carbon_gwp_basis = snapshot.gwp_basis,
         carbon_boundary = COALESCE(
           snapshot.payload #>> '{carbonResults,methodology,boundaryType}',
           (snapshot.payload #> '{carbonResults,boundary}')::text
         ),
         carbon_canonical_input_hash = snapshot.canonical_input_hash,
         carbon_factor_snapshot = COALESCE(snapshot.factor_snapshot, '[]'::jsonb),
         carbon_allocation_method = 'shipment_products.allocated_co2e',
         updated_at = now()
       FROM shipment_products shipment_product
       LEFT JOIN LATERAL (
         SELECT assessment.* FROM product_assessment_snapshots assessment
         WHERE assessment.product_id = shipment_product.product_id
           AND assessment.company_id = $2
           AND assessment.is_legacy = false
         ORDER BY assessment.version DESC LIMIT 1
       ) snapshot ON true
       WHERE line.shipment_id = $1 AND line.company_id = $2
         AND shipment_product.shipment_id = line.shipment_id
         AND shipment_product.product_id = line.source_product_id`,
      [shipmentId, companyId]
    );
    await this.database.query(
      `INSERT INTO shipment_export_lines (
         company_id, shipment_id, source_product_id, line_number, sku, goods_description,
         hs_code, origin_country, quantity, unit, net_weight_kg, gross_weight_kg, embedded_co2e_kg,
         style_code, size_label, color_label, lot_number,
         carbon_snapshot_id, carbon_snapshot_version, carbon_engine_version, carbon_methodology_version,
         carbon_factor_registry_version, carbon_gwp_basis, carbon_boundary, carbon_canonical_input_hash,
         carbon_factor_snapshot, carbon_allocation_method
       )
       SELECT $2, sp.shipment_id, p.id,
              ROW_NUMBER() OVER (ORDER BY sp.created_at, sp.id)::integer,
              p.sku, p.name,
              COALESCE(NULLIF(ps.payload->>'hsCode',''), NULLIF(ps.payload->>'hs_code',''), ''),
              COALESCE(NULLIF(ps.payload->>'originCountry',''), NULLIF(ps.payload->>'origin_country',''), s.origin_country),
              sp.quantity, 'pcs', sp.weight_kg, sp.weight_kg, sp.allocated_co2e,
              COALESCE(NULLIF(ps.payload->>'styleCode',''), NULLIF(ps.payload->>'style_code','')),
              COALESCE(NULLIF(ps.payload->>'size',''), NULLIF(ps.payload->>'sizeLabel','')),
              COALESCE(NULLIF(ps.payload->>'color',''), NULLIF(ps.payload->>'colorLabel','')),
              COALESCE(NULLIF(ps.payload->>'lotNumber',''), NULLIF(ps.payload->>'batchNumber','')),
              ps.id, ps.version, ps.engine_version, ps.methodology_version, ps.factor_registry_version,
              ps.gwp_basis,
              COALESCE(ps.payload #>> '{carbonResults,methodology,boundaryType}',
                       (ps.payload #> '{carbonResults,boundary}')::text),
              ps.canonical_input_hash, COALESCE(ps.factor_snapshot, '[]'::jsonb),
              'shipment_products.allocated_co2e'
       FROM shipment_products sp
       JOIN shipments s ON s.id = sp.shipment_id AND s.company_id = $2
       JOIN products p ON p.id = sp.product_id AND p.company_id = $2
       LEFT JOIN LATERAL (
         SELECT assessment.* FROM product_assessment_snapshots assessment
         WHERE assessment.product_id = p.id AND assessment.company_id = $2 AND assessment.is_legacy = false
         ORDER BY assessment.version DESC LIMIT 1
       ) ps ON true
       WHERE sp.shipment_id = $1
       ON CONFLICT (shipment_id, line_number) DO NOTHING`,
      [shipmentId, companyId]
    );
    const result = await this.database.query(
      'SELECT * FROM shipment_export_lines WHERE shipment_id=$1 AND company_id=$2 ORDER BY line_number',
      [shipmentId, companyId]
    );
    return result.rows.map(lineFromRow);
  }

  async createLine(companyId, shipmentId, input, userId = null) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const hsCodeSource = text(input.hsCodeSource || input.hs_code_source);
    const hsCodeRuleset = text(input.hsCodeRuleset || input.hs_code_ruleset);
    const hsCodeEffectiveDate = dateOnly(input.hsCodeEffectiveDate || input.hs_code_effective_date);
    const hsCodeConfirmed = Boolean(userId)
      && (input.hsCodeConfirmed === true || input.hs_code_confirmed === true)
      && Boolean(hsCodeSource && hsCodeRuleset && hsCodeEffectiveDate);
    const result = await this.database.query(
      `INSERT INTO shipment_export_lines (
        company_id, shipment_id, source_product_id, line_number, sku, goods_description, hs_code,
        origin_country, quantity, unit, unit_price, currency, net_weight_kg, gross_weight_kg,
        embedded_co2e_kg, style_code, size_label, color_label, lot_number,
        hs_code_source, hs_code_ruleset, hs_code_effective_date,
        hs_code_confirmed, hs_code_confirmed_by, hs_code_confirmed_at, package_refs, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27::jsonb)
       RETURNING *`,
      [companyId, shipmentId, input.sourceProductId || input.source_product_id || null,
        Number(input.lineNumber || input.line_number), text(input.sku), text(input.goodsDescription || input.goods_description),
        normalizeHsCode(input.hsCode || input.hs_code), text(input.originCountry || input.origin_country),
        numberOrNull(input.quantity), text(input.unit) || 'pcs', numberOrNull(input.unitPrice ?? input.unit_price),
        text(input.currency).toUpperCase() || null, numberOrNull(input.netWeightKg || input.net_weight_kg),
        numberOrNull(input.grossWeightKg || input.gross_weight_kg), numberOrNull(input.embeddedCo2eKg || input.embedded_co2e_kg),
        text(input.styleCode || input.style_code) || null, text(input.sizeLabel || input.size_label) || null,
        text(input.colorLabel || input.color_label) || null, text(input.lotNumber || input.lot_number) || null,
        hsCodeSource || null, hsCodeRuleset || null, hsCodeEffectiveDate,
        hsCodeConfirmed,
        hsCodeConfirmed ? userId : null,
        hsCodeConfirmed ? new Date() : null,
        JSON.stringify(Array.isArray(input.packageRefs) ? input.packageRefs : []), JSON.stringify(object(input.metadata))]
    );
    return lineFromRow(result.rows[0]);
  }

  async updateLine(companyId, shipmentId, lineId, input, userId = null) {
    if (!UUID_REGEX.test(String(lineId || ''))) return null;
    const current = await this.database.query(
      'SELECT * FROM shipment_export_lines WHERE id=$1 AND shipment_id=$2 AND company_id=$3', [lineId, shipmentId, companyId]
    );
    if (!current.rows[0]) return null;
    const merged = { ...lineFromRow(current.rows[0]), ...input };
    const normalizedHsCode = normalizeHsCode(merged.hsCode);
    const hsCodeSource = text(merged.hsCodeSource);
    const hsCodeRuleset = text(merged.hsCodeRuleset);
    const hsCodeEffectiveDate = dateOnly(merged.hsCodeEffectiveDate);
    const hsCodeChanged = normalizedHsCode !== normalizeHsCode(current.rows[0].hs_code)
      || hsCodeSource !== text(current.rows[0].hs_code_source)
      || hsCodeRuleset !== text(current.rows[0].hs_code_ruleset)
      || hsCodeEffectiveDate !== dateOnly(current.rows[0].hs_code_effective_date);
    const carbonChanged = numberOrNull(merged.embeddedCo2eKg) !== numberOrNull(current.rows[0].embedded_co2e_kg);
    // A classification change always invalidates the prior approval. A second explicit save is
    // required so the audit identity/time can never describe a different HS/CN code.
    const hsCodeConfirmed = Boolean(userId) && !hsCodeChanged && merged.hsCodeConfirmed === true
      && Boolean(hsCodeSource && hsCodeRuleset && hsCodeEffectiveDate);
    const result = await this.database.query(
      `UPDATE shipment_export_lines SET line_number=$1, sku=$2, goods_description=$3, hs_code=$4,
         origin_country=$5, quantity=$6, unit=$7, unit_price=$8, currency=$9, net_weight_kg=$10,
         gross_weight_kg=$11, embedded_co2e_kg=$12, style_code=$13, size_label=$14, color_label=$15,
         lot_number=$16, hs_code_source=$17, hs_code_ruleset=$18, hs_code_effective_date=$19,
         hs_code_confirmed=$20,
         hs_code_confirmed_by=CASE WHEN $20 THEN COALESCE($21, hs_code_confirmed_by) ELSE NULL END,
         hs_code_confirmed_at=CASE WHEN $20 THEN COALESCE(hs_code_confirmed_at, now()) ELSE NULL END,
         carbon_snapshot_id=CASE WHEN $22 THEN NULL ELSE carbon_snapshot_id END,
         carbon_snapshot_version=CASE WHEN $22 THEN NULL ELSE carbon_snapshot_version END,
         carbon_engine_version=CASE WHEN $22 THEN NULL ELSE carbon_engine_version END,
         carbon_methodology_version=CASE WHEN $22 THEN NULL ELSE carbon_methodology_version END,
         carbon_factor_registry_version=CASE WHEN $22 THEN NULL ELSE carbon_factor_registry_version END,
         carbon_gwp_basis=CASE WHEN $22 THEN NULL ELSE carbon_gwp_basis END,
         carbon_boundary=CASE WHEN $22 THEN NULL ELSE carbon_boundary END,
         carbon_canonical_input_hash=CASE WHEN $22 THEN NULL ELSE carbon_canonical_input_hash END,
         carbon_factor_snapshot=CASE WHEN $22 THEN '[]'::jsonb ELSE carbon_factor_snapshot END,
         carbon_allocation_method=CASE WHEN $22 THEN NULL ELSE carbon_allocation_method END,
         package_refs=$23::jsonb, metadata=$24::jsonb, updated_at=now()
       WHERE id=$25 AND shipment_id=$26 AND company_id=$27 RETURNING *`,
      [merged.lineNumber, text(merged.sku), text(merged.goodsDescription), normalizedHsCode,
        text(merged.originCountry), numberOrNull(merged.quantity), text(merged.unit), numberOrNull(merged.unitPrice),
        text(merged.currency).toUpperCase() || null, numberOrNull(merged.netWeightKg), numberOrNull(merged.grossWeightKg),
        numberOrNull(merged.embeddedCo2eKg), text(merged.styleCode) || null, text(merged.sizeLabel) || null,
        text(merged.colorLabel) || null, text(merged.lotNumber) || null,
        hsCodeSource || null, hsCodeRuleset || null, hsCodeEffectiveDate, hsCodeConfirmed,
        userId, carbonChanged, JSON.stringify(merged.packageRefs || []), JSON.stringify(merged.metadata || {}),
        lineId, shipmentId, companyId]
    );
    return lineFromRow(result.rows[0]);
  }

  async deleteLine(companyId, shipmentId, lineId) {
    if (!UUID_REGEX.test(String(lineId || ''))) return false;
    const result = await this.database.query(
      'DELETE FROM shipment_export_lines WHERE id=$1 AND shipment_id=$2 AND company_id=$3 RETURNING id',
      [lineId, shipmentId, companyId]
    );
    return Boolean(result.rows[0]);
  }

  async createContainer(companyId, shipmentId, input) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const result = await this.database.query(
      `INSERT INTO shipment_containers (company_id, shipment_id, container_number, seal_number,
         equipment_type, marks_and_numbers, tare_weight_kg, max_gross_weight_kg, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
      [companyId, shipmentId, text(input.containerNumber || input.container_number),
        text(input.sealNumber || input.seal_number), text(input.equipmentType || input.equipment_type),
        text(input.marksAndNumbers || input.marks_and_numbers) || null,
        numberOrNull(input.tareWeightKg ?? input.tare_weight_kg),
        numberOrNull(input.maxGrossWeightKg ?? input.max_gross_weight_kg),
        JSON.stringify(object(input.metadata))]
    );
    return containerFromRow(result.rows[0]);
  }

  async updateContainer(companyId, shipmentId, containerId, input) {
    if (!UUID_REGEX.test(String(containerId || ''))) return null;
    const current = await this.database.query(
      'SELECT * FROM shipment_containers WHERE id=$1 AND shipment_id=$2 AND company_id=$3',
      [containerId, shipmentId, companyId]
    );
    if (!current.rows[0]) return null;
    const merged = { ...containerFromRow(current.rows[0]), ...input };
    const result = await this.database.query(
      `UPDATE shipment_containers SET container_number=$1, seal_number=$2, equipment_type=$3,
         marks_and_numbers=$4, tare_weight_kg=$5, max_gross_weight_kg=$6, metadata=$7::jsonb,
         updated_at=now() WHERE id=$8 AND shipment_id=$9 AND company_id=$10 RETURNING *`,
      [text(merged.containerNumber), text(merged.sealNumber), text(merged.equipmentType),
        text(merged.marksAndNumbers) || null, numberOrNull(merged.tareWeightKg),
        numberOrNull(merged.maxGrossWeightKg), JSON.stringify(object(merged.metadata)),
        containerId, shipmentId, companyId]
    );
    return containerFromRow(result.rows[0]);
  }

  async deleteContainer(companyId, shipmentId, containerId) {
    if (!UUID_REGEX.test(String(containerId || ''))) return false;
    const result = await this.database.query(
      'DELETE FROM shipment_containers WHERE id=$1 AND shipment_id=$2 AND company_id=$3 RETURNING id',
      [containerId, shipmentId, companyId]
    );
    return Boolean(result.rows[0]);
  }

  async createPackage(companyId, shipmentId, input) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const result = await this.database.query(
      `INSERT INTO shipment_packages (company_id, shipment_id, package_number, package_type,
         marks_and_numbers, quantity, net_weight_kg, gross_weight_kg, length_cm, width_cm, height_cm, contents,
         container_id, parent_package_id, sequence_no, weight_measurement_basis, dimension_measurement_basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17) RETURNING *`,
      [companyId, shipmentId, text(input.packageNumber || input.package_number), text(input.packageType || input.package_type),
        text(input.marksAndNumbers || input.marks_and_numbers) || null, Number(input.quantity ?? 1),
        numberOrNull(input.netWeightKg || input.net_weight_kg), numberOrNull(input.grossWeightKg || input.gross_weight_kg),
        numberOrNull(input.lengthCm || input.length_cm), numberOrNull(input.widthCm || input.width_cm),
        numberOrNull(input.heightCm || input.height_cm), JSON.stringify(Array.isArray(input.contents) ? input.contents : []),
        input.containerId || input.container_id || null, input.parentPackageId || input.parent_package_id || null,
        numberOrNull(input.sequenceNo ?? input.sequence_no),
        measurementBasis(input.weightMeasurementBasis || input.weight_measurement_basis),
        measurementBasis(input.dimensionMeasurementBasis || input.dimension_measurement_basis)]
    );
    return this.getPackage(companyId, shipmentId, result.rows[0].id);
  }

  async getPackage(companyId, shipmentId, packageId) {
    const result = await this.database.query(
      `SELECT p.*, c.container_number, c.seal_number, parent.package_number AS parent_package_number
       FROM shipment_packages p
       LEFT JOIN shipment_containers c ON c.id=p.container_id AND c.company_id=p.company_id AND c.shipment_id=p.shipment_id
       LEFT JOIN shipment_packages parent ON parent.id=p.parent_package_id AND parent.company_id=p.company_id AND parent.shipment_id=p.shipment_id
       WHERE p.id=$1 AND p.shipment_id=$2 AND p.company_id=$3`, [packageId, shipmentId, companyId]
    );
    return result.rows[0] ? packageFromRow(result.rows[0]) : null;
  }

  async updatePackage(companyId, shipmentId, packageId, input) {
    if (!UUID_REGEX.test(String(packageId || ''))) return null;
    const current = await this.database.query(
      'SELECT * FROM shipment_packages WHERE id=$1 AND shipment_id=$2 AND company_id=$3', [packageId, shipmentId, companyId]
    );
    if (!current.rows[0]) return null;
    const merged = { ...packageFromRow(current.rows[0]), ...input };
    const result = await this.database.query(
      `UPDATE shipment_packages SET package_number=$1, package_type=$2, marks_and_numbers=$3,
         quantity=$4, net_weight_kg=$5, gross_weight_kg=$6, length_cm=$7, width_cm=$8, height_cm=$9,
         contents=$10::jsonb, container_id=$11, parent_package_id=$12, sequence_no=$13,
         weight_measurement_basis=$14, dimension_measurement_basis=$15,
         updated_at=now() WHERE id=$16 AND shipment_id=$17 AND company_id=$18 RETURNING *`,
      [text(merged.packageNumber), text(merged.packageType), text(merged.marksAndNumbers) || null,
        Number(merged.quantity || 1), numberOrNull(merged.netWeightKg), numberOrNull(merged.grossWeightKg),
        numberOrNull(merged.lengthCm), numberOrNull(merged.widthCm), numberOrNull(merged.heightCm),
        JSON.stringify(merged.contents || []), merged.containerId || null, merged.parentPackageId || null,
        numberOrNull(merged.sequenceNo), measurementBasis(merged.weightMeasurementBasis),
        measurementBasis(merged.dimensionMeasurementBasis), packageId, shipmentId, companyId]
    );
    return result.rows[0] ? this.getPackage(companyId, shipmentId, packageId) : null;
  }

  async deletePackage(companyId, shipmentId, packageId) {
    if (!UUID_REGEX.test(String(packageId || ''))) return false;
    const result = await this.database.query(
      'DELETE FROM shipment_packages WHERE id=$1 AND shipment_id=$2 AND company_id=$3 RETURNING id',
      [packageId, shipmentId, companyId]
    );
    return Boolean(result.rows[0]);
  }

  _carrierColumnValues(rawInput) {
    const input = normalizeCarrierDocument(rawInput);
    return [
      ['document_type', input.documentType], ['contract_level', input.contractLevel],
      ['transport_mode', input.transportMode], ['document_number', input.documentNumber],
      ['issuer_name', input.issuerName], ['issuer_identifier', input.issuerIdentifier || null],
      ['issue_date', input.issueDate], ['issue_place', input.issuePlace || null],
      ['on_board_date', input.onBoardDate], ['shipper', JSON.stringify(input.shipper)],
      ['consignee', JSON.stringify(input.consignee)], ['notify_party', JSON.stringify(input.notifyParty)],
      ['vessel_name', input.vesselName || null], ['voyage_number', input.voyageNumber || null],
      ['flight_number', input.flightNumber || null], ['vehicle_registration', input.vehicleRegistration || null],
      ['train_number', input.trainNumber || null], ['place_of_receipt', input.placeOfReceipt || null],
      ['place_of_loading', input.placeOfLoading || null], ['place_of_discharge', input.placeOfDischarge || null],
      ['place_of_delivery', input.placeOfDelivery || null], ['goods_description', input.goodsDescription || null],
      ['package_count', input.packageCount], ['package_type', input.packageType || null],
      ['marks_and_numbers', input.marksAndNumbers || null], ['gross_weight_kg', input.grossWeightKg],
      ['measurement_cbm', input.measurementCbm], ['container_numbers', JSON.stringify(input.containerNumbers)],
      ['seal_numbers', JSON.stringify(input.sealNumbers)], ['freight_terms', input.freightTerms || null],
      ['payment_terms', input.paymentTerms || null], ['authentication_method', input.authenticationMethod || null],
      ['authentication_reference', input.authenticationReference || null],
      ['authenticity_status', input.authenticityStatus], ['original_status', input.originalStatus],
      ['negotiable', input.negotiable], ['metadata_source', input.metadataSource],
      ['metadata', JSON.stringify(input.metadata)]
    ];
  }

  _carrierDraftError(input) {
    if (!CARRIER_DOCUMENT_TYPES.has(input.documentType)) return 'CARRIER_DOCUMENT_TYPE_INVALID';
    if (!CARRIER_TRANSPORT_MODES.has(input.transportMode) || !text(input.documentNumber)) {
      return 'CARRIER_DOCUMENT_IDENTITY_REQUIRED';
    }
    if (!CARRIER_CONTRACT_LEVELS.has(input.contractLevel)
      || !CARRIER_METADATA_SOURCES.has(input.metadataSource)
      || !CARRIER_AUTHENTICITY_STATUSES.has(input.authenticityStatus)
      || !CARRIER_ORIGINAL_STATUSES.has(input.originalStatus)
      || !CARRIER_FREIGHT_TERMS.has(input.freightTerms)) return 'CARRIER_DOCUMENT_VALUE_INVALID';
    if (input.packageCount !== null && (!Number.isInteger(input.packageCount) || input.packageCount <= 0)) {
      return 'CARRIER_DOCUMENT_VALUE_INVALID';
    }
    if (input.grossWeightKg !== null && input.grossWeightKg <= 0) return 'CARRIER_DOCUMENT_VALUE_INVALID';
    if (input.measurementCbm !== null && input.measurementCbm < 0) return 'CARRIER_DOCUMENT_VALUE_INVALID';
    return null;
  }

  async getCarrierDocument(companyId, shipmentId, carrierDocumentId, queryable = this.database) {
    if (!UUID_REGEX.test(String(carrierDocumentId || ''))) return null;
    const result = await queryable.query(
      `SELECT evidence.id, evidence.evidence_type, evidence.document_name, evidence.original_filename,
              evidence.status, evidence.valid_from, evidence.valid_to, evidence.checksum_sha256,
              evidence.file_size_bytes, evidence.mime_type, evidence.uploaded_at, evidence.locked_at,
              evidence.approved_by, evidence.approval_note,
              to_jsonb(carrier) AS carrier_metadata,
              to_jsonb(latest_reconciliation) AS carrier_reconciliation
       FROM shipment_carrier_documents carrier
       JOIN evidence_documents evidence
         ON evidence.id = carrier.evidence_document_id AND evidence.company_id = carrier.company_id
        AND evidence.shipment_id = carrier.shipment_id
       LEFT JOIN LATERAL (
         SELECT reconciliation.* FROM carrier_document_reconciliations reconciliation
         WHERE reconciliation.carrier_document_id = carrier.id
           AND reconciliation.company_id = carrier.company_id
           AND reconciliation.shipment_id = carrier.shipment_id
         ORDER BY reconciliation.reconciled_at DESC, reconciliation.id DESC LIMIT 1
       ) latest_reconciliation ON true
       WHERE carrier.id=$1 AND carrier.shipment_id=$2 AND carrier.company_id=$3`,
      [carrierDocumentId, shipmentId, companyId]
    );
    return result.rows[0] ? carrierDocumentFromRow(result.rows[0]) : null;
  }

  async createCarrierDocument(companyId, shipmentId, userId, rawInput = {}) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const input = normalizeCarrierDocument(rawInput);
    const inputError = this._carrierDraftError(input);
    if (inputError) return { error: inputError };
    if (!UUID_REGEX.test(input.evidenceDocumentId)) return { error: 'CARRIER_EVIDENCE_NOT_FOUND' };
    const evidence = await this.database.query(
      `SELECT id FROM evidence_documents WHERE id=$1 AND company_id=$2 AND shipment_id=$3
       AND evidence_type=ANY($4::text[])`,
      [input.evidenceDocumentId, companyId, shipmentId, CARRIER_EVIDENCE_TYPES]
    );
    if (!evidence.rows[0]) return { error: 'CARRIER_EVIDENCE_NOT_FOUND' };
    const alreadyLinked = await this.database.query(
      'SELECT id FROM shipment_carrier_documents WHERE evidence_document_id=$1', [input.evidenceDocumentId]
    );
    if (alreadyLinked.rows[0]) return { error: 'CARRIER_EVIDENCE_ALREADY_LINKED' };

    let version = 1;
    if (input.supersedesId) {
      if (!UUID_REGEX.test(input.supersedesId)) return { error: 'CARRIER_SUPERSEDES_NOT_FOUND' };
      const prior = await this.database.query(
        `SELECT id, version FROM shipment_carrier_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 AND status='confirmed'`,
        [input.supersedesId, companyId, shipmentId]
      );
      if (!prior.rows[0]) return { error: 'CARRIER_SUPERSEDES_NOT_FOUND' };
      version = Number(prior.rows[0].version) + 1;
    } else {
      const existing = await this.database.query(
        `SELECT COALESCE(MAX(version),0) AS version FROM shipment_carrier_documents
         WHERE company_id=$1 AND shipment_id=$2 AND document_type=$3 AND document_number=$4`,
        [companyId, shipmentId, input.documentType, input.documentNumber]
      );
      version = Number(existing.rows[0]?.version || 0) + 1;
    }

    const pairs = this._carrierColumnValues(input);
    const columns = ['company_id', 'shipment_id', 'evidence_document_id', 'version', 'supersedes_id', 'created_by', ...pairs.map(([column]) => column)];
    const values = [companyId, shipmentId, input.evidenceDocumentId, version, input.supersedesId, userId, ...pairs.map(([, value]) => value)];
    const jsonColumns = new Set(['shipper', 'consignee', 'notify_party', 'container_numbers', 'seal_numbers', 'metadata']);
    const placeholders = values.map((_value, index) => `$${index + 1}${index >= 6 && jsonColumns.has(pairs[index - 6]?.[0]) ? '::jsonb' : ''}`);
    const result = await this.database.query(
      `INSERT INTO shipment_carrier_documents (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      values
    );
    return this.getCarrierDocument(companyId, shipmentId, result.rows[0].id);
  }

  async updateCarrierDocument(companyId, shipmentId, carrierDocumentId, rawInput = {}) {
    const current = await this.getCarrierDocument(companyId, shipmentId, carrierDocumentId);
    if (!current) return null;
    if (current.structured.status !== 'draft') return { error: 'CARRIER_DOCUMENT_IMMUTABLE' };
    const input = normalizeCarrierDocument({ ...current.structured, ...rawInput,
      evidenceDocumentId: current.id, supersedesId: current.structured.supersedesId });
    const inputError = this._carrierDraftError(input);
    if (inputError) return { error: inputError };
    const pairs = this._carrierColumnValues(input);
    const jsonColumns = new Set(['shipper', 'consignee', 'notify_party', 'container_numbers', 'seal_numbers', 'metadata']);
    const assignments = pairs.map(([column], index) => `${column}=$${index + 1}${jsonColumns.has(column) ? '::jsonb' : ''}`);
    const values = [...pairs.map(([, value]) => value), carrierDocumentId, shipmentId, companyId];
    await this.database.query(
      `UPDATE shipment_carrier_documents SET ${assignments.join(', ')}, updated_at=now()
       WHERE id=$${pairs.length + 1} AND shipment_id=$${pairs.length + 2} AND company_id=$${pairs.length + 3}
         AND status='draft'`, values
    );
    return this.getCarrierDocument(companyId, shipmentId, carrierDocumentId);
  }

  async deleteCarrierDocument(companyId, shipmentId, carrierDocumentId) {
    if (!UUID_REGEX.test(String(carrierDocumentId || ''))) return false;
    const result = await this.database.query(
      `DELETE FROM shipment_carrier_documents WHERE id=$1 AND shipment_id=$2 AND company_id=$3 AND status='draft'
       RETURNING id`, [carrierDocumentId, shipmentId, companyId]
    );
    return Boolean(result.rows[0]);
  }

  async reconcileCarrierDocument(companyId, shipmentId, carrierDocumentId) {
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (!snapshot) return null;
    const document = snapshot.carrierDocuments.find((item) => item.structured?.id === carrierDocumentId);
    if (!document) return null;
    const reconciliation = validateCarrierDocument(snapshot, { ...document.structured, evidence: document });
    const sourceHash = carrierReconciliationSha256(snapshot, document);
    return {
      ...reconciliation,
      rulesetVersion: CARRIER_RULESET_VERSION,
      sourceSnapshotSha256: sourceHash,
      confirmedAndCurrent: document.structured.status === 'confirmed'
        && document.latestReconciliation?.status === 'passed'
        && document.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
        && document.latestReconciliation?.sourceSnapshotSha256 === sourceHash
    };
  }

  async _verifyCarrierEvidenceFile(evidence) {
    if (evidence.storage_provider !== 'local') {
      return { error: 'CARRIER_EVIDENCE_STORAGE_UNSUPPORTED' };
    }
    const storageKey = text(evidence.storage_key);
    if (!storageKey || !/^[a-f0-9]{64}$/i.test(text(evidence.checksum_sha256))
      || Number(evidence.file_size_bytes || 0) <= 0) {
      return { error: 'CARRIER_EVIDENCE_FILE_UNAVAILABLE' };
    }
    const uploadsRoot = path.resolve(this.uploadsRoot);
    const filePath = path.resolve(uploadsRoot, storageKey);
    const relative = path.relative(uploadsRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { error: 'CARRIER_EVIDENCE_FILE_UNAVAILABLE' };
    }
    try {
      const [buffer, stat] = await Promise.all([
        fs.promises.readFile(filePath),
        fs.promises.stat(filePath)
      ]);
      if (!stat.isFile() || buffer.length !== Number(evidence.file_size_bytes)
        || sha256(buffer) !== text(evidence.checksum_sha256).toLowerCase()) {
        return { error: 'CARRIER_EVIDENCE_FILE_TAMPERED' };
      }
      return { buffer, sha256: sha256(buffer), fileSizeBytes: buffer.length };
    } catch (_error) {
      return { error: 'CARRIER_EVIDENCE_FILE_UNAVAILABLE' };
    }
  }

  async _verifyVnCustomsEvidenceFile(evidence) {
    if (evidence.storage_provider !== 'local') {
      return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_STORAGE_UNSUPPORTED' };
    }
    const storageKey = text(evidence.storage_key);
    if (!storageKey || !/^[a-f0-9]{64}$/i.test(text(evidence.checksum_sha256))
      || Number(evidence.file_size_bytes || 0) <= 0) {
      return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
    const uploadsRoot = path.resolve(this.uploadsRoot);
    const filePath = path.resolve(uploadsRoot, storageKey);
    const relative = path.relative(uploadsRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
    try {
      const [buffer, stat] = await Promise.all([fs.promises.readFile(filePath), fs.promises.stat(filePath)]);
      const digest = sha256(buffer);
      if (!stat.isFile() || buffer.length !== Number(evidence.file_size_bytes)
        || digest !== text(evidence.checksum_sha256).toLowerCase()) {
        return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_TAMPERED' };
      }
      return { buffer, sha256: digest, fileSizeBytes: buffer.length };
    } catch (_error) {
      return { error: 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
  }

  async _verifyEuImportEvidenceFile(evidence) {
    if (evidence.storage_provider !== 'local') return { error: 'EU_IMPORT_EVENT_EVIDENCE_STORAGE_UNSUPPORTED' };
    const storageKey = text(evidence.storage_key);
    if (!storageKey || !/^[a-f0-9]{64}$/i.test(text(evidence.checksum_sha256))
      || Number(evidence.file_size_bytes || 0) <= 0) {
      return { error: 'EU_IMPORT_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
    const uploadsRoot = path.resolve(this.uploadsRoot);
    const filePath = path.resolve(uploadsRoot, storageKey);
    const relative = path.relative(uploadsRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { error: 'EU_IMPORT_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
    try {
      const [buffer, stat] = await Promise.all([fs.promises.readFile(filePath), fs.promises.stat(filePath)]);
      const digest = sha256(buffer);
      if (!stat.isFile() || buffer.length !== Number(evidence.file_size_bytes)
        || digest !== text(evidence.checksum_sha256).toLowerCase()) {
        return { error: 'EU_IMPORT_EVENT_EVIDENCE_FILE_TAMPERED' };
      }
      return { buffer, sha256: digest, fileSizeBytes: buffer.length };
    } catch (_error) {
      return { error: 'EU_IMPORT_EVENT_EVIDENCE_FILE_UNAVAILABLE' };
    }
  }

  async _verifyCurrentCarrierEvidence(companyId, shipmentId, snapshot) {
    const carrier = (snapshot?.carrierDocuments || []).find((item) => item.structured?.status === 'confirmed'
      && item.latestReconciliation?.status === 'passed'
      && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
      && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, item));
    if (!carrier) return { error: 'CARRIER_RECONCILIATION_NOT_CURRENT' };
    const result = await this.database.query(
      `SELECT evidence.storage_provider, evidence.storage_key, evidence.checksum_sha256,
              evidence.file_size_bytes
       FROM shipment_carrier_documents carrier
       JOIN evidence_documents evidence ON evidence.id=carrier.evidence_document_id
         AND evidence.company_id=carrier.company_id AND evidence.shipment_id=carrier.shipment_id
       WHERE carrier.id=$1 AND carrier.company_id=$2 AND carrier.shipment_id=$3
         AND carrier.status='confirmed'`,
      [carrier.structured.id, companyId, shipmentId]
    );
    if (!result.rows[0]) return { error: 'CARRIER_EVIDENCE_FILE_UNAVAILABLE' };
    return this._verifyCarrierEvidenceFile(result.rows[0]);
  }

  async _verifyCurrentSupportingExportDocuments(companyId, shipmentId, snapshot) {
    for (const documentType of ['commercial_invoice', 'packing_list']) {
      const document = (snapshot?.documents || []).find((item) => item.type === documentType
        && isCurrentIssuedSupportingDocument(snapshot, item));
      if (!document) return { error: 'VN_CUSTOMS_SUPPORTING_DOCUMENT_NOT_CURRENT', documentType };
      const result = await this.database.query(
        `SELECT storage_provider, storage_key, file_sha256 AS checksum_sha256,
                file_size_bytes
         FROM export_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 AND document_type=$4 AND status='issued'`,
        [document.id, companyId, shipmentId, documentType]
      );
      const row = result.rows[0];
      if (!row) return { error: 'VN_CUSTOMS_SUPPORTING_DOCUMENT_NOT_CURRENT', documentType };
      const verification = await this._verifyVnCustomsEvidenceFile(row);
      if (verification.error) {
        return {
          error: verification.error === 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_TAMPERED'
            ? 'VN_CUSTOMS_SUPPORTING_DOCUMENT_TAMPERED'
            : 'VN_CUSTOMS_SUPPORTING_DOCUMENT_UNAVAILABLE',
          documentType
        };
      }
    }
    return { verified: true };
  }

  async _verifyCurrentEuSupportingDocuments(companyId, shipmentId, snapshot) {
    for (const documentType of ['commercial_invoice', 'packing_list']) {
      const document = (snapshot?.documents || []).find((item) => item.type === documentType
        && isCurrentIssuedSupportingDocument(snapshot, item));
      if (!document) return { error: 'EU_IMPORT_SUPPORTING_DOCUMENT_NOT_CURRENT', documentType };
      const result = await this.database.query(
        `SELECT storage_provider, storage_key, file_sha256 AS checksum_sha256, file_size_bytes
         FROM export_documents
         WHERE id=$1 AND company_id=$2 AND shipment_id=$3 AND document_type=$4 AND status='issued'`,
        [document.id, companyId, shipmentId, documentType]
      );
      const row = result.rows[0];
      if (!row) return { error: 'EU_IMPORT_SUPPORTING_DOCUMENT_NOT_CURRENT', documentType };
      const verification = await this._verifyEuImportEvidenceFile(row);
      if (verification.error) {
        return {
          error: verification.error === 'EU_IMPORT_EVENT_EVIDENCE_FILE_TAMPERED'
            ? 'EU_IMPORT_SUPPORTING_DOCUMENT_TAMPERED'
            : 'EU_IMPORT_SUPPORTING_DOCUMENT_UNAVAILABLE',
          documentType
        };
      }
    }
    return { verified: true };
  }

  async confirmCarrierDocument(companyId, shipmentId, carrierDocumentId, userId, payload = {}) {
    if (payload.metadataConfirmed !== true || !text(payload.confirmationNote)) {
      return { error: 'CARRIER_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED' };
    }
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (!snapshot) return null;
    const document = snapshot.carrierDocuments.find((item) => item.structured?.id === carrierDocumentId);
    if (!document) return null;
    if (document.structured.status !== 'draft') return { error: 'CARRIER_DOCUMENT_IMMUTABLE' };
    const activeConflict = snapshot.carrierDocuments.find((item) => item.structured
      && item.structured.id !== carrierDocumentId
      && item.structured.status === 'confirmed'
      && item.structured.documentType === document.structured.documentType
      && text(item.structured.documentNumber).toUpperCase() === text(document.structured.documentNumber).toUpperCase());
    if (activeConflict && document.structured.supersedesId !== activeConflict.structured.id) {
      return { error: 'CARRIER_REPLACEMENT_LINK_REQUIRED' };
    }
    const reconciliation = validateCarrierDocument(snapshot, { ...document.structured, evidence: document });
    if (reconciliation.status !== 'passed') {
      return { error: 'CARRIER_RECONCILIATION_FAILED', reconciliation: {
        ...reconciliation, rulesetVersion: CARRIER_RULESET_VERSION,
        sourceSnapshotSha256: carrierReconciliationSha256(snapshot, document)
      } };
    }
    const sourceHash = carrierReconciliationSha256(snapshot, document);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT carrier.id, carrier.status, carrier.supersedes_id, evidence.id AS evidence_id,
                evidence.storage_provider, evidence.storage_key, evidence.checksum_sha256,
                evidence.file_size_bytes
         FROM shipment_carrier_documents carrier
         JOIN evidence_documents evidence ON evidence.id=carrier.evidence_document_id
           AND evidence.company_id=carrier.company_id AND evidence.shipment_id=carrier.shipment_id
         WHERE carrier.id=$1 AND carrier.company_id=$2 AND carrier.shipment_id=$3 FOR UPDATE`,
        [carrierDocumentId, companyId, shipmentId]
      );
      if (!locked.rows[0] || locked.rows[0].status !== 'draft') {
        await client.query('ROLLBACK');
        return locked.rows[0] ? { error: 'CARRIER_DOCUMENT_IMMUTABLE' } : null;
      }
      const fileVerification = await this._verifyCarrierEvidenceFile(locked.rows[0]);
      if (fileVerification.error) {
        await client.query('ROLLBACK');
        return fileVerification;
      }
      const user = await client.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
      const actor = user.rows[0];
      if (!actor || !text(actor.full_name || actor.email)) {
        await client.query('ROLLBACK');
        return { error: 'CARRIER_CONFIRMATION_IDENTITY_REQUIRED' };
      }
      if (locked.rows[0].supersedes_id) {
        await client.query(
          `UPDATE shipment_carrier_documents SET status='superseded', updated_at=now()
           WHERE id=$1 AND company_id=$2 AND shipment_id=$3 AND status='confirmed'`,
          [locked.rows[0].supersedes_id, companyId, shipmentId]
        );
      }
      await client.query(
        `UPDATE evidence_documents SET status='locked', locked_at=COALESCE(locked_at,now()),
           locked_by=$1, approved_by=$1, approval_note=$2, updated_at=now()
         WHERE id=$3 AND company_id=$4 AND shipment_id=$5`,
        [userId, text(payload.confirmationNote), locked.rows[0].evidence_id, companyId, shipmentId]
      );
      await client.query(
        `UPDATE shipment_carrier_documents SET status='confirmed', metadata_confirmed_by=$1,
           metadata_confirmer_name_snapshot=$2, metadata_confirmer_email_snapshot=$3,
           metadata_confirmation_note=$4, metadata_confirmed_at=now(), updated_at=now()
         WHERE id=$5 AND company_id=$6 AND shipment_id=$7 AND status='draft'`,
        [userId, text(actor.full_name || actor.email), text(actor.email) || null,
          text(payload.confirmationNote), carrierDocumentId, companyId, shipmentId]
      );
      await client.query(
        `INSERT INTO carrier_document_reconciliations (
           company_id, shipment_id, carrier_document_id, ruleset_version, source_snapshot_sha256,
           status, checks, reconciled_by, reconciler_name_snapshot, reconciler_email_snapshot
         ) VALUES ($1,$2,$3,$4,$5,'passed',$6::jsonb,$7,$8,$9)`,
        [companyId, shipmentId, carrierDocumentId, CARRIER_RULESET_VERSION, sourceHash,
          JSON.stringify(reconciliation.checks), userId, text(actor.full_name || actor.email), text(actor.email) || null]
      );
      await client.query('COMMIT');
      return this.getCarrierDocument(companyId, shipmentId, carrierDocumentId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  _validateSnapshot(snapshot) {
    const profile = snapshot.profile || {};
    const lines = snapshot.lines || [];
    const packages = snapshot.packages || [];
    const containers = snapshot.containers || [];
    const leafPackages = packages.filter((pkg) => text(pkg.packageType).toLowerCase() !== 'pallet');
    const carriers = snapshot.carrierDocuments || [];
    const results = [];
    const need = (type, code, value, pathName, label) => results.push(requirement(
      type, code, text(value) ? 'ready' : 'missing', pathName, text(value) ? null : `${label} is required.`
    ));
    const party = (type, key, value) => {
      need(type, `${key}_name`, value?.name, `profile.${key}.name`, `${key} name`);
      need(type, `${key}_address`, value?.address, `profile.${key}.address`, `${key} address`);
      need(type, `${key}_country`, value?.country, `profile.${key}.country`, `${key} country`);
      if (text(value?.country)) {
        const validCountry = /^[A-Z]{2}$/.test(text(value.country).toUpperCase());
        results.push(requirement(type, `${key}_country_format`, validCountry ? 'ready' : 'invalid', `profile.${key}.country`, validCountry ? null : `${key} country must be a 2-letter ISO code.`));
      }
    };
    ['commercial_invoice', 'packing_list'].forEach((type) => {
      party(type, 'exporter', profile.exporter);
      party(type, type === 'commercial_invoice' ? 'importer' : 'consignee', type === 'commercial_invoice' ? profile.importer : profile.consignee);
      need(type, 'po_contract_id', profile.poContractId, 'profile.poContractId', 'PO/contract ID');
      need(type, 'incoterm', profile.incotermCode, 'profile.incotermCode', 'Incoterm');
      need(type, 'incoterm_location', profile.incotermLocation, 'profile.incotermLocation', 'Incoterm location');
    });
    need('commercial_invoice', 'invoice_number', profile.invoiceNumber, 'profile.invoiceNumber', 'Invoice number');
    need('commercial_invoice', 'invoice_date', profile.invoiceDate, 'profile.invoiceDate', 'Invoice date');
    if (profile.invoiceDate) results.push(requirement('commercial_invoice', 'invoice_date_format', isIsoDate(profile.invoiceDate) ? 'ready' : 'invalid', 'profile.invoiceDate', isIsoDate(profile.invoiceDate) ? null : 'Invoice date must be a valid YYYY-MM-DD date.'));
    need('commercial_invoice', 'invoice_issue_place', profile.invoiceIssuePlace, 'profile.invoiceIssuePlace', 'Invoice issue place');
    need('commercial_invoice', 'exporter_contact', profile.exporter?.contact, 'profile.exporter.contact', 'Exporter contact');
    need('commercial_invoice', 'importer_contact', profile.importer?.contact, 'profile.importer.contact', 'Importer contact');
    need('commercial_invoice', 'currency', profile.currency, 'profile.currency', 'Currency');
    if (text(profile.currency)) {
      const validCurrency = /^[A-Z]{3}$/.test(text(profile.currency).toUpperCase());
      results.push(requirement('commercial_invoice', 'currency_format', validCurrency ? 'ready' : 'invalid', 'profile.currency', validCurrency ? null : 'Currency must be a 3-letter ISO 4217 code.'));
    }
    need('commercial_invoice', 'payment_terms', profile.paymentTerms, 'profile.paymentTerms', 'Payment terms');
    need('commercial_invoice', 'exporter_tax_id', profile.exporterTaxId, 'profile.exporterTaxId', 'Exporter tax ID');
    const destinationCountry = text(snapshot.shipment?.destinationCountry).toUpperCase();
    const euImport = text(profile.targetMarket).toUpperCase() === 'EU' || EU_COUNTRY_CODES.has(destinationCountry);
    if (euImport) {
      need('commercial_invoice', 'importer_eori', profile.importerEori, 'profile.importerEori', 'Importer/declarant EORI for the EU destination');
    }
    if (text(profile.importerEori)) {
      const validEori = /^[A-Z]{2}[A-Z0-9]{1,15}$/i.test(text(profile.importerEori));
      results.push(requirement('commercial_invoice', 'importer_eori_format', validEori ? 'ready' : 'invalid', 'profile.importerEori', validEori ? null : 'Importer EORI must start with a 2-letter country code followed by up to 15 letters/digits.'));
    }
    const vatRequired = profile.metadata?.buyerInstructionRequiresVat === true;
    if (vatRequired) {
      need('commercial_invoice', 'importer_vat_id', profile.importerVatId, 'profile.importerVatId', 'Importer VAT ID required by buyer instruction');
    }
    if (text(profile.importerVatId)) {
      const validVat = /^[A-Z]{2}[A-Z0-9]{2,14}$/i.test(text(profile.importerVatId));
      results.push(requirement('commercial_invoice', 'importer_vat_id_format', validVat ? 'ready' : 'invalid', 'profile.importerVatId', validVat ? null : 'Importer VAT ID must start with a 2-letter country code followed by letters/digits.'));
    }
    if (profile.metadata?.consigneeRequired === true) party('commercial_invoice', 'consignee', profile.consignee);
    need('commercial_invoice', 'transport_mode', profile.transportMode, 'profile.transportMode', 'Transport mode');
    need('commercial_invoice', 'port_of_loading', profile.portOfLoading, 'profile.portOfLoading', 'Port/place of loading');
    need('commercial_invoice', 'port_of_discharge', profile.portOfDischarge, 'profile.portOfDischarge', 'Port/place of discharge');
    need('packing_list', 'packing_list_number', profile.packingListNumber, 'profile.packingListNumber', 'Packing list number');
    need('packing_list', 'packing_list_date', profile.packingListDate, 'profile.packingListDate', 'Packing list date');
    if (profile.packingListDate) results.push(requirement('packing_list', 'packing_list_date_format', isIsoDate(profile.packingListDate) ? 'ready' : 'invalid', 'profile.packingListDate', isIsoDate(profile.packingListDate) ? null : 'Packing list date must be a valid YYYY-MM-DD date.'));
    need('packing_list', 'transport_mode', profile.transportMode, 'profile.transportMode', 'Transport mode');
    need('packing_list', 'carrier_name', profile.carrierName, 'profile.carrierName', 'Carrier/transport company');
    const incoterm = text(profile.incotermCode).toUpperCase();
    if (incoterm) {
      ['commercial_invoice', 'packing_list'].forEach((type) => results.push(requirement(type, 'incoterm_format', INCOTERMS_2020.has(incoterm) ? 'ready' : 'invalid', 'profile.incotermCode', INCOTERMS_2020.has(incoterm) ? null : 'Incoterm must be one of the 11 Incoterms 2020 codes.')));
    }
    const transportMode = text(profile.transportMode).toLowerCase();
    if (transportMode) {
      ['commercial_invoice', 'packing_list'].forEach((type) => results.push(requirement(type, 'transport_mode_format', TRANSPORT_MODES.has(transportMode) ? 'ready' : 'invalid', 'profile.transportMode', TRANSPORT_MODES.has(transportMode) ? null : 'Transport mode is not supported.')));
    }
    ['freightAmount', 'insuranceAmount', 'discountAmount', 'surchargeAmount'].forEach((field) => {
      if (profile[field] === null || profile[field] === undefined || profile[field] === '') return;
      const valid = Number.isFinite(Number(profile[field])) && Number(profile[field]) >= 0;
      results.push(requirement('commercial_invoice', `${field}_nonnegative`, valid ? 'ready' : 'invalid', `profile.${field}`, valid ? null : `${field} must be a non-negative number.`));
    });
    if (['CFR', 'CIF', 'CPT', 'CIP'].includes(incoterm)) {
      const validFreight = profile.freightAmount !== null && Number(profile.freightAmount) >= 0;
      results.push(requirement('commercial_invoice', 'freight_amount', validFreight ? 'ready' : 'missing', 'profile.freightAmount', validFreight ? null : `Freight amount is required for ${incoterm}.`));
    }
    if (['CIF', 'CIP'].includes(incoterm)) {
      const validInsurance = profile.insuranceAmount !== null && Number(profile.insuranceAmount) >= 0;
      results.push(requirement('commercial_invoice', 'insurance_amount', validInsurance ? 'ready' : 'missing', 'profile.insuranceAmount', validInsurance ? null : `Insurance amount is required for ${incoterm}.`));
    }
    results.push(requirement('commercial_invoice', 'lines', lines.length ? 'ready' : 'missing', 'lines', lines.length ? null : 'At least one export line is required.'));
    lines.forEach((line, index) => {
      const prefix = `lines[${index}]`;
      [['goods_description', line.goodsDescription], ['hs_code', line.hsCode], ['origin_country', line.originCountry],
        ['quantity', line.quantity], ['unit', line.unit], ['unit_price', line.unitPrice]].forEach(([key, value]) => {
        const valid = value !== null && value !== undefined && String(value).trim() !== ''
          && (key !== 'unit_price' || Number(value) >= 0)
          && (key !== 'quantity' || Number(value) > 0);
        results.push(requirement('commercial_invoice', `line_${index + 1}_${key}`, valid ? 'ready' : 'missing', `${prefix}.${key}`, valid ? null : `${key} is required for line ${index + 1}.`));
      });
      const normalizedHs = normalizeHsCode(line.hsCode);
      const validHs = normalizedHs.length >= 6 && normalizedHs.length <= 10;
      results.push(requirement('commercial_invoice', `line_${index + 1}_hs_code_format`, validHs ? 'ready' : 'invalid', `${prefix}.hsCode`, validHs ? null : `HS/CN code for line ${index + 1} must contain 6 to 10 digits.`));
      need('commercial_invoice', `line_${index + 1}_hs_code_source`, line.hsCodeSource, `${prefix}.hsCodeSource`, `HS/CN source for line ${index + 1}`);
      need('commercial_invoice', `line_${index + 1}_hs_code_ruleset`, line.hsCodeRuleset, `${prefix}.hsCodeRuleset`, `HS/CN ruleset/version for line ${index + 1}`);
      need('commercial_invoice', `line_${index + 1}_hs_code_effective_date`, line.hsCodeEffectiveDate, `${prefix}.hsCodeEffectiveDate`, `HS/CN effective date for line ${index + 1}`);
      if (line.hsCodeEffectiveDate) results.push(requirement('commercial_invoice', `line_${index + 1}_hs_code_effective_date_format`, isIsoDate(line.hsCodeEffectiveDate) ? 'ready' : 'invalid', `${prefix}.hsCodeEffectiveDate`, isIsoDate(line.hsCodeEffectiveDate) ? null : `HS/CN effective date for line ${index + 1} must be a valid YYYY-MM-DD date.`));
      results.push(requirement('commercial_invoice', `line_${index + 1}_hs_code_confirmed`, line.hsCodeConfirmed ? 'ready' : 'missing', `${prefix}.hsCodeConfirmed`, line.hsCodeConfirmed ? null : `HS/CN code requires explicit confirmation for line ${index + 1}.`));
    });
    results.push(requirement('packing_list', 'lines', lines.length ? 'ready' : 'missing', 'lines', lines.length ? null : 'At least one goods line is required.'));
    lines.forEach((line, index) => {
      [['quantity', line.quantity], ['net_weight_kg', line.netWeightKg], ['gross_weight_kg', line.grossWeightKg]].forEach(([key, value]) => {
        const valid = value !== null && value !== undefined && Number(value) > 0;
        results.push(requirement('packing_list', `line_${index + 1}_${key}`, valid ? 'ready' : 'missing', `lines[${index}].${key}`, valid ? null : `${key} is required for packing line ${index + 1}.`));
      });
    });
    results.push(requirement('packing_list', 'containers', containers.length ? 'ready' : 'missing', 'containers', containers.length ? null : 'At least one container/load unit is required.'));
    containers.forEach((container, index) => {
      [['container_number', container.containerNumber], ['seal_number', container.sealNumber], ['equipment_type', container.equipmentType]]
        .forEach(([key, value]) => results.push(requirement(
          'packing_list', `container_${index + 1}_${key}`, text(value) ? 'ready' : 'missing',
          `containers[${index}].${key}`, text(value) ? null : `${key} is required for container ${index + 1}.`
        )));
      const hasPallet = packages.some((pkg) => pkg.containerId === container.id && text(pkg.packageType).toLowerCase() === 'pallet');
      results.push(requirement('packing_list', `container_${index + 1}_pallet`, hasPallet ? 'ready' : 'missing',
        `containers[${index}]`, hasPallet ? null : `Container ${container.containerNumber || index + 1} requires at least one pallet.`));
      if (container.maxGrossWeightKg !== null && container.maxGrossWeightKg !== undefined && container.maxGrossWeightKg !== '') {
        const cargoGross = leafPackages.filter((pkg) => pkg.containerId === container.id)
          .reduce((sum, pkg) => sum + packageGrossTotal(pkg), 0);
        const loadedGross = cargoGross + Number(container.tareWeightKg || 0);
        const withinLimit = loadedGross <= Number(container.maxGrossWeightKg);
        results.push(requirement('packing_list', `container_${index + 1}_max_gross`, withinLimit ? 'ready' : 'invalid',
          `containers[${index}].maxGrossWeightKg`, withinLimit ? null : `Container ${container.containerNumber || index + 1} loaded gross weight (${loadedGross} kg) exceeds its maximum (${container.maxGrossWeightKg} kg).`));
      }
    });
    results.push(requirement('packing_list', 'packages', leafPackages.length ? 'ready' : 'missing', 'packages', leafPackages.length ? null : 'At least one carton/package is required.'));
    packages.forEach((pkg, index) => {
      [['package_number', pkg.packageNumber], ['package_type', pkg.packageType], ['marks_and_numbers', pkg.marksAndNumbers],
        ['quantity', pkg.quantity], ['net_weight_kg', pkg.netWeightKg], ['gross_weight_kg', pkg.grossWeightKg],
        ['length_cm', pkg.lengthCm], ['width_cm', pkg.widthCm], ['height_cm', pkg.heightCm]].forEach(([key, value]) => {
        const numeric = ['quantity', 'net_weight_kg', 'gross_weight_kg', 'length_cm', 'width_cm', 'height_cm'].includes(key);
        const valid = value !== null && value !== undefined && String(value).trim() !== '' && (!numeric || Number(value) > 0);
        results.push(requirement('packing_list', `package_${index + 1}_${key}`, valid ? 'ready' : 'missing', `packages[${index}].${key}`, valid ? null : `${key} is required for package ${index + 1}.`));
      });
      results.push(requirement('packing_list', `package_${index + 1}_weight_basis`, MEASUREMENT_BASES.has(pkg.weightMeasurementBasis) ? 'ready' : 'invalid', `packages[${index}].weightMeasurementBasis`, MEASUREMENT_BASES.has(pkg.weightMeasurementBasis) ? null : `Weight basis for package ${index + 1} must be per_package or group_total.`));
      results.push(requirement('packing_list', `package_${index + 1}_dimension_basis`, MEASUREMENT_BASES.has(pkg.dimensionMeasurementBasis) ? 'ready' : 'invalid', `packages[${index}].dimensionMeasurementBasis`, MEASUREMENT_BASES.has(pkg.dimensionMeasurementBasis) ? null : `Dimension basis for package ${index + 1} must be per_package or group_total.`));
      const contents = Array.isArray(pkg.contents) ? pkg.contents : [];
      results.push(requirement('packing_list', `package_${index + 1}_sequence`, Number(pkg.sequenceNo) > 0 ? 'ready' : 'missing',
        `packages[${index}].sequenceNo`, Number(pkg.sequenceNo) > 0 ? null : `A positive sequence number is required for package ${pkg.packageNumber || index + 1}.`));
      const isPallet = text(pkg.packageType).toLowerCase() === 'pallet';
      const validContents = isPallet || (contents.length > 0 && contents.every((item) => {
        const ref = text(item?.lineId || item?.sku || item?.lineNumber);
        return ref && Number(item?.quantity) > 0;
      }));
      results.push(requirement('packing_list', `package_${index + 1}_contents`, validContents ? 'ready' : 'missing', `packages[${index}].contents`, validContents ? null : `Product allocation is required for package ${index + 1}.`));
      const container = containers.find((item) => item.id === pkg.containerId);
      results.push(requirement('packing_list', `package_${index + 1}_container`, container ? 'ready' : 'missing',
        `packages[${index}].containerId`, container ? null : `Package ${pkg.packageNumber || index + 1} must reference a container in this shipment.`));
      if (isPallet) {
        results.push(requirement('packing_list', `package_${index + 1}_parent`, pkg.parentPackageId ? 'invalid' : 'ready',
          `packages[${index}].parentPackageId`, pkg.parentPackageId ? 'A pallet cannot be nested under another package.' : null));
      } else {
        const parent = packages.find((item) => item.id === pkg.parentPackageId);
        const validParent = parent && text(parent.packageType).toLowerCase() === 'pallet' && parent.containerId === pkg.containerId;
        results.push(requirement('packing_list', `package_${index + 1}_parent`, validParent ? 'ready' : 'missing',
          `packages[${index}].parentPackageId`, validParent ? null : `Package ${pkg.packageNumber || index + 1} must reference a pallet in the same container.`));
      }
    });
    const currencyMismatch = lines.some((line) => line.currency && profile.currency && line.currency !== profile.currency);
    results.push(requirement('commercial_invoice', 'currency_reconciliation', currencyMismatch ? 'invalid' : 'ready', 'lines[].currency', currencyMismatch ? 'Line currencies must match the invoice currency.' : null));
    const goodsTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const invoiceTotal = goodsTotal + Number(profile.freightAmount || 0) + Number(profile.insuranceAmount || 0)
      + Number(profile.surchargeAmount || 0) - Number(profile.discountAmount || 0);
    results.push(requirement('commercial_invoice', 'invoice_total_nonnegative', invoiceTotal >= 0 ? 'ready' : 'invalid', 'profile.discountAmount', invoiceTotal >= 0 ? null : 'Discount cannot make the invoice total negative.'));
    const customsValue = numberOrNull(profile.customsValueAmount);
    results.push(requirement('commercial_invoice', 'customs_value_amount', customsValue !== null && customsValue >= 0 ? 'ready' : 'missing', 'profile.customsValueAmount', customsValue !== null && customsValue >= 0 ? null : 'A non-negative customs value is required for reconciliation.'));
    need('commercial_invoice', 'customs_value_basis', profile.customsValueBasis, 'profile.customsValueBasis', 'Customs value basis/adjustment explanation');
    if (customsValue !== null) {
      const matchesInvoice = Math.abs(customsValue - invoiceTotal) <= Math.max(0.01, Math.abs(invoiceTotal) * 0.001);
      const explained = text(profile.customsValueBasis);
      results.push(requirement('commercial_invoice', 'customs_value_reconciliation', matchesInvoice || explained ? 'ready' : 'invalid', 'profile.customsValueBasis', matchesInvoice || explained ? null : `Customs value (${customsValue}) differs from invoice total (${invoiceTotal}) and requires an adjustment explanation.`));
    }
    const invalidLineWeight = lines.some((line) => line.netWeightKg !== null && line.grossWeightKg !== null && line.grossWeightKg < line.netWeightKg);
    results.push(requirement('packing_list', 'line_weight_reconciliation', invalidLineWeight ? 'invalid' : 'ready', 'lines[].grossWeightKg', invalidLineWeight ? 'Gross line weight cannot be lower than net weight.' : null));
    const invalidPackageWeight = packages.some((pkg) => pkg.netWeightKg !== null && pkg.grossWeightKg !== null && packageGrossTotal(pkg) < packageNetTotal(pkg));
    results.push(requirement('packing_list', 'package_weight_reconciliation', invalidPackageWeight ? 'invalid' : 'ready', 'packages[].grossWeightKg', invalidPackageWeight ? 'Gross package weight cannot be lower than net weight.' : null));
    if (lines.length && leafPackages.length && lines.every((line) => line.netWeightKg !== null) && leafPackages.every((pkg) => pkg.netWeightKg !== null)) {
      const lineNet = lines.reduce((sum, line) => sum + Number(line.netWeightKg), 0);
      const packageNet = leafPackages.reduce((sum, pkg) => sum + packageNetTotal(pkg), 0);
      const matches = Math.abs(lineNet - packageNet) <= Math.max(0.01, lineNet * 0.001);
      results.push(requirement('packing_list', 'net_weight_cross_document', matches ? 'ready' : 'invalid', 'packages[].netWeightKg', matches ? null : `Line net weight (${lineNet}) does not match package net weight (${packageNet}).`));
    }
    if (lines.length && leafPackages.length && lines.every((line) => line.grossWeightKg !== null) && leafPackages.every((pkg) => pkg.grossWeightKg !== null)) {
      const lineGross = lines.reduce((sum, line) => sum + Number(line.grossWeightKg), 0);
      const packageGross = leafPackages.reduce((sum, pkg) => sum + packageGrossTotal(pkg), 0);
      const matches = Math.abs(lineGross - packageGross) <= Math.max(0.01, lineGross * 0.001);
      results.push(requirement('packing_list', 'gross_weight_cross_document', matches ? 'ready' : 'invalid', 'packages[].grossWeightKg', matches ? null : `Line gross weight (${lineGross}) does not match package gross weight (${packageGross}).`));
    }
    if (lines.length && leafPackages.length) {
      const allocations = new Map();
      let unknownReference = false;
      leafPackages.forEach((pkg) => (Array.isArray(pkg.contents) ? pkg.contents : []).forEach((item) => {
        const line = lines.find((candidate) => candidate.id === item?.lineId || candidate.sku === item?.sku || candidate.lineNumber === Number(item?.lineNumber));
        if (!line) { unknownReference = true; return; }
        allocations.set(line.id, (allocations.get(line.id) || 0) + Number(item.quantity || 0));
      }));
      const allocationMismatch = unknownReference || lines.some((line) => Math.abs(Number(line.quantity) - Number(allocations.get(line.id) || 0)) > 0.0001);
      results.push(requirement('packing_list', 'quantity_allocation_reconciliation', allocationMismatch ? 'invalid' : 'ready', 'packages[].contents', allocationMismatch ? 'Package contents must allocate the full quantity of every shipment line exactly once.' : null));
    }
    const today = new Date().toISOString().slice(0, 10);
    const approvedCarriers = carriers.filter((doc) => doc.structured?.status === 'confirmed'
      && ['locked', 'third_party_verified'].includes(doc.status)
      && doc.approvedBy
      && (!doc.validTo || dateOnly(doc.validTo) >= today)
      && doc.latestReconciliation?.status === 'passed'
      && doc.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
      && doc.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, doc));
    results.push(requirement('carbon_annex', 'carrier_document', approvedCarriers.length ? 'ready' : 'missing', 'carrierDocuments', approvedCarriers.length ? null : 'A structured, confirmed, non-expired and currently reconciled carrier B/L/FBL/AWB/CMR/CIM is required.', true, approvedCarriers.map((doc) => doc.id)));
    need('carbon_annex', 'bill_of_lading_no', profile.billOfLadingNo, 'profile.billOfLadingNo', 'Carrier document number');
    const hasCarbon = lines.length > 0 && lines.every((line) => line.embeddedCo2eKg !== null);
    results.push(requirement('carbon_annex', 'carbon_values', hasCarbon ? 'ready' : 'missing', 'lines[].embeddedCo2eKg', hasCarbon ? null : 'Every line requires server-authoritative embedded CO2e.'));
    lines.forEach((line, index) => {
      const authority = line.carbonAuthority;
      const complete = Boolean(authority?.authoritative && authority.snapshotId && authority.snapshotVersion
        && text(authority.engineVersion) && text(authority.methodologyVersion)
        && text(authority.factorRegistryVersion) && text(authority.gwpBasis)
        && text(authority.boundary) && /^[a-f0-9]{64}$/i.test(text(authority.canonicalInputHash))
        && Array.isArray(authority.factorSnapshot) && authority.factorSnapshot.length > 0
        && text(authority.allocationMethod));
      results.push(requirement('carbon_annex', `line_${index + 1}_carbon_provenance`, complete ? 'ready' : 'missing',
        `lines[${index}].carbonAuthority`, complete ? null : `Carbon line ${index + 1} must be synchronized from a non-legacy authoritative calculation with methodology, boundary and factor provenance.`));
    });
    party('ics2_dataset', 'exporter', profile.exporter);
    party('ics2_dataset', 'importer', profile.importer);
    need('ics2_dataset', 'importer_eori', profile.importerEori, 'profile.importerEori', 'Importer EORI');
    need('ics2_dataset', 'transport_document_no', profile.billOfLadingNo, 'profile.billOfLadingNo', 'Transport document number');
    need('ics2_dataset', 'port_of_loading', profile.portOfLoading, 'profile.portOfLoading', 'Port/place of loading');
    need('ics2_dataset', 'port_of_discharge', profile.portOfDischarge, 'profile.portOfDischarge', 'Port/place of discharge');
    results.push(requirement('ics2_dataset', 'goods_lines', lines.length ? 'ready' : 'missing', 'lines', lines.length ? null : 'Goods lines are required.'));
    results.push(requirement('ics2_dataset', 'carrier_document', approvedCarriers.length ? 'ready' : 'missing', 'carrierDocuments', approvedCarriers.length ? null : 'A structured, confirmed and currently reconciled carrier document is required.', true, approvedCarriers.map((doc) => doc.id)));
    lines.forEach((line, index) => {
      const complete = text(line.goodsDescription) && text(line.hsCode) && text(line.originCountry) && line.grossWeightKg !== null;
      results.push(requirement('ics2_dataset', `goods_line_${index + 1}`, complete ? 'ready' : 'missing', `lines[${index}]`, complete ? null : `ICS2 goods line ${index + 1} requires description, HS code, origin and gross weight.`));
    });
    const vnCustoms = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(snapshot, document)
    });
    vnCustoms.checks.forEach((check) => results.push(requirement(
      'vn_customs_handoff', check.code, check.status, check.fieldPath, check.message,
      true, check.code === 'carrier_document_reconciliation'
        ? approvedCarriers.map((item) => item.id)
        : []
    )));
    const euImportValidation = validateEuImportHandoff(snapshot, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
        && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
        && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(snapshot, item),
      isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(snapshot, document)
    });
    euImportValidation.checks.forEach((check) => results.push(requirement(
      'eu_import_handoff', check.code, check.status, check.fieldPath, check.message,
      true, check.code === 'carrier_document_reconciliation'
        ? approvedCarriers.map((item) => item.id)
        : []
    )));
    const originApplicable = profile.preferentialOriginClaim === true;
    const originEvidence = (snapshot.carrierDocuments || []).filter((doc) => doc.type === 'origin_support' && doc.status === 'locked');
    results.push(requirement('origin_workbook', 'preferential_claim', originApplicable ? (originEvidence.length ? 'ready' : 'missing') : 'not_applicable', 'profile.preferentialOriginClaim', originApplicable && !originEvidence.length ? 'Locked origin evidence is required for a preferential claim.' : null, originApplicable, originEvidence.map((doc) => doc.id)));
    return results;
  }

  async getReadiness(companyId, shipmentId) {
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (!snapshot) return null;
    const requirements = this._validateSnapshot(snapshot);
    const documentTypes = [...DOCUMENT_TYPES].map((type) => {
      const scoped = requirements.filter((item) => item.documentType === type && item.applicable);
      const missing = scoped.filter((item) => !['ready', 'not_applicable'].includes(item.status));
      return {
        type, applicable: scoped.length > 0,
        status: scoped.length === 0 ? 'not_applicable' : (missing.length ? 'blocked' : 'ready'),
        missingFields: missing.map((item) => item.fieldPath).filter(Boolean),
        messages: missing.map((item) => item.message).filter(Boolean)
      };
    });
    const core = documentTypes.filter((item) => CORE_DOCUMENT_TYPES.includes(item.type));
    const readyCount = core.filter((item) => item.status === 'ready').length;
    const total = core.length;
    const hsCodes = snapshot.lines.map((line) => line.hsCode);
    const cbamMatches = hsCodes.filter(isCbamApplicable);
    return {
      shipmentId, rulesetVersion: RULESET_VERSION,
      status: readyCount === total ? 'ready_to_issue' : (readyCount ? 'internal_review' : 'blocked'),
      documentCompleteness: total ? Math.round((readyCount / total) * 100) : 0,
      documents: documentTypes,
      requirements,
      cbam: {
        applicable: cbamMatches.length > 0,
        status: cbamMatches.length ? 'REVIEW_ANNEX_I_MATCH' : 'CBAM_NOT_APPLICABLE',
        matchedHsCodes: cbamMatches,
        rulesetVersion: CBAM_RULESET.version,
        effectiveFrom: CBAM_RULESET.effectiveFrom
      }
    };
  }

  async persistReadiness(companyId, shipmentId, readiness) {
    if (!readiness) return;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM export_requirement_results WHERE company_id=$1 AND shipment_id=$2 AND ruleset_version=$3',
        [companyId, shipmentId, RULESET_VERSION]
      );
      for (const item of readiness.requirements) {
        await client.query(
          `INSERT INTO export_requirement_results (
             company_id, shipment_id, document_type, requirement_code, ruleset_version,
             applicable, status, field_path, message, evidence_document_ids
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [companyId, shipmentId, item.documentType, item.code, RULESET_VERSION,
            item.applicable, item.status, item.fieldPath || null, item.message || null,
            JSON.stringify(item.evidenceDocumentIds || [])]
        );
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async createDocumentJob(companyId, shipmentId, userId, documentType, options = {}) {
    if (!DOCUMENT_TYPES.has(documentType)) {
      const error = new Error('Unsupported export document type.'); error.code = 'INVALID_DOCUMENT_TYPE'; throw error;
    }
    const defaultFormat = documentType === 'ics2_dataset'
      ? 'csv'
      : (['vn_customs_handoff', 'eu_import_handoff'].includes(documentType) ? 'json' : 'xlsx');
    const outputFormat = text(options.outputFormat || options.output_format || options.format || defaultFormat).toLowerCase();
    if (!DOCUMENT_FORMATS[documentType]?.has(outputFormat)) {
      const error = new Error(`Unsupported ${documentType} output format.`);
      error.code = 'INVALID_DOCUMENT_FORMAT';
      throw error;
    }
    const readiness = await this.getReadiness(companyId, shipmentId);
    if (!readiness) return null;
    await this.persistReadiness(companyId, shipmentId, readiness);
    const documentReadiness = readiness.documents.find((item) => item.type === documentType);
    if (!documentReadiness || !['ready', 'not_applicable'].includes(documentReadiness.status) || documentReadiness.status === 'not_applicable') {
      return { blocked: true, readiness };
    }
    const snapshot = await this.getProfile(companyId, shipmentId);
    if (['carbon_annex', 'ics2_dataset', 'vn_customs_handoff', 'eu_import_handoff'].includes(documentType)) {
      const evidenceVerification = await this._verifyCurrentCarrierEvidence(companyId, shipmentId, snapshot);
      if (evidenceVerification.error) {
        return {
          blocked: true,
          code: evidenceVerification.error,
          message: 'Current carrier evidence bytes could not be verified.',
          readiness
        };
      }
    }
    if (documentType === 'vn_customs_handoff') {
      const supportingVerification = await this._verifyCurrentSupportingExportDocuments(companyId, shipmentId, snapshot);
      if (supportingVerification.error) {
        return {
          blocked: true,
          code: supportingVerification.error,
          message: `Current issued ${supportingVerification.documentType || 'supporting'} file could not be verified.`,
          readiness
        };
      }
    }
    if (documentType === 'eu_import_handoff') {
      const supportingVerification = await this._verifyCurrentEuSupportingDocuments(companyId, shipmentId, snapshot);
      if (supportingVerification.error) {
        return {
          blocked: true,
          code: supportingVerification.error,
          message: `Current issued ${supportingVerification.documentType || 'supporting'} file could not be verified.`,
          readiness
        };
      }
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version),0)+1 AS version,
                (ARRAY_AGG(id ORDER BY version DESC))[1] AS previous_id
         FROM export_documents WHERE shipment_id=$1 AND document_type=$2`,
        [shipmentId, documentType]
      );
      const version = Number(versionResult.rows[0].version);
      const reportResult = await client.query(
        `INSERT INTO reports (company_id, report_type, title, target_market, file_format, status, created_by, metadata)
         VALUES ($1, 'export_declaration', $2, 'EU', $3, 'processing', $4, '{}'::jsonb)
         RETURNING id, status`,
        [companyId, `${documentType} - ${snapshot.shipment.referenceNumber || shipmentId} - v${version}`, outputFormat, userId]
      );
      const payload = {
        ...snapshot,
        readiness,
        generatedAt: new Date().toISOString(),
        rulesetVersion: RULESET_VERSION,
        sourceSnapshotSha256: documentSourceSnapshotSha256(snapshot, documentType)
      };
      const payloadHash = sha256(JSON.stringify(payload));
      const documentResult = await client.query(
        `INSERT INTO export_documents (company_id, shipment_id, report_id, document_type, version,
           status, payload, validation_results, payload_sha256, created_by, supersedes_id, output_format)
         VALUES ($1,$2,$3,$4,$5,'ready',$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING *`,
        [companyId, shipmentId, reportResult.rows[0].id, documentType, version,
          JSON.stringify(payload), JSON.stringify(documentReadiness), payloadHash, userId,
          versionResult.rows[0].previous_id || null, outputFormat]
      );
      await client.query('UPDATE reports SET metadata=$1::jsonb WHERE id=$2', [JSON.stringify({
        export_document_id: documentResult.rows[0].id, shipment_id: shipmentId,
        document_type: documentType, document_version: version
      }), reportResult.rows[0].id]);
      await client.query('COMMIT');
      const queue = this.queue || require('../services/reportJobQueue');
      await queue.enqueue({
        type: 'shipment_export_document', reportId: reportResult.rows[0].id,
        exportDocumentId: documentResult.rows[0].id, shipmentId, companyId
      });
      return this._formatDocument({ ...documentResult.rows[0], report_status: 'processing', download_url: null });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  _documentRows(type, payload) {
    const lines = payload.lines || [];
    const packages = payload.packages || [];
    const containers = payload.containers || [];
    const leafPackages = packages.filter((pkg) => text(pkg.packageType).toLowerCase() !== 'pallet');
    const containerNumbers = containers.map((item) => item.containerNumber).filter(Boolean).join('; ');
    if (type === 'vn_customs_handoff') return lines.map((line) => ({
      lineNumber: line.lineNumber,
      sku: line.sku,
      goodsDescription: line.goodsDescription,
      vietnamHsCode: normalizeHsCode(line.hsCode),
      hsSource: line.hsCodeSource,
      hsRuleset: line.hsCodeRuleset,
      hsEffectiveDate: line.hsCodeEffectiveDate,
      originCountry: line.originCountry,
      destinationCountry: payload.vnCustomsProfile?.destinationCountryCode || payload.shipment?.destinationCountry,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      currency: line.currency || payload.profile?.currency,
      lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
      netWeightKg: line.netWeightKg,
      grossWeightKg: line.grossWeightKg,
      packageRefs: JSON.stringify(line.packageRefs || [])
    }));
    if (type === 'eu_import_handoff') return lines.map((line) => {
      const detail = (payload.euImportLineDetails || []).find((item) => item.exportLineId === line.id) || {};
      return {
        lineNumber: line.lineNumber,
        sku: line.sku,
        goodsDescription: line.goodsDescription,
        taricCode: detail.taricCode || '',
        taricSource: detail.taricSource || '',
        taricVersion: detail.taricVersion || '',
        taricEffectiveDate: detail.taricEffectiveDate || '',
        taricConfirmed: detail.taricConfirmed === true,
        taricConfirmedBy: detail.taricConfirmedBy || '',
        taricConfirmedAt: detail.taricConfirmedAt || '',
        supplementaryUnitCode: detail.supplementaryUnitCode || '',
        additionalCodes: JSON.stringify(detail.additionalCodes || []),
        nationalAdditionalCodes: JSON.stringify(detail.nationalAdditionalCodes || []),
        preferenceCode: detail.preferenceCode || '',
        requestedProcedureCode: detail.requestedProcedureCode || payload.euImportProfile?.requestedProcedureCode || '',
        previousProcedureCode: detail.previousProcedureCode || payload.euImportProfile?.previousProcedureCode || '',
        originCountry: line.originCountry,
        quantity: line.quantity,
        unit: line.unit,
        itemValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
        currency: line.currency || payload.profile?.currency,
        netWeightKg: line.netWeightKg,
        grossWeightKg: line.grossWeightKg,
        packageRefs: JSON.stringify(line.packageRefs || [])
      };
    });
    if (type === 'ics2_dataset') return lines.map((line) => ({
      shipmentReference: payload.shipment?.referenceNumber || payload.shipment?.id,
      transportDocumentNo: payload.profile?.billOfLadingNo || '',
      containerNo: containerNumbers,
      consignorName: payload.profile?.exporter?.name || '',
      consignorAddress: payload.profile?.exporter?.address || '',
      consigneeName: payload.profile?.importer?.name || '',
      consigneeAddress: payload.profile?.importer?.address || '',
      importerEori: payload.profile?.importerEori || '',
      placeOfLoading: payload.profile?.portOfLoading || '',
      placeOfDischarge: payload.profile?.portOfDischarge || '',
      goodsDescription: line.goodsDescription,
      hsCode: line.hsCode,
      originCountry: line.originCountry,
      quantity: line.quantity,
      unit: line.unit,
      grossWeightKg: line.grossWeightKg
    }));
    if (type === 'packing_list') return leafPackages.map((pkg) => ({
      containerNumber: pkg.containerNumber, sealNumber: pkg.sealNumber,
      palletNumber: pkg.parentPackageNumber, packageNumber: pkg.packageNumber,
      packageType: pkg.packageType, marks: pkg.marksAndNumbers,
      quantity: pkg.quantity, netWeightKg: packageNetTotal(pkg), grossWeightKg: packageGrossTotal(pkg),
      weightBasis: pkg.weightMeasurementBasis, dimensionBasis: pkg.dimensionMeasurementBasis,
      cbm: packageCbmTotal(pkg),
      dimensions: [pkg.lengthCm, pkg.widthCm, pkg.heightCm].filter((v) => v !== null).join(' x '),
      contents: JSON.stringify(pkg.contents || [])
    }));
    if (type === 'carbon_annex') {
      const carrier = (payload.carrierDocuments || []).find((item) => item.structured?.status === 'confirmed');
      return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, hsCode: line.hsCode, quantity: line.quantity,
      embeddedCo2eKg: line.embeddedCo2eKg, carrierDocumentNo: payload.profile.billOfLadingNo,
      carrierDocumentType: carrier?.structured?.documentType || '', carrierIssuer: carrier?.structured?.issuerName || '',
      carrierFileSha256: carrier?.checksumSha256 || '', containerNo: containerNumbers,
      calculationSnapshot: line.carbonAuthority?.snapshotId || '',
      calculationVersion: line.carbonAuthority?.snapshotVersion || '',
      methodology: line.carbonAuthority?.methodologyVersion || '',
      boundary: line.carbonAuthority?.boundary || '', factorRegistry: line.carbonAuthority?.factorRegistryVersion || '',
      factorProvenance: JSON.stringify(line.carbonAuthority?.factorSnapshot || []),
      gwpBasis: line.carbonAuthority?.gwpBasis || '', allocationMethod: line.carbonAuthority?.allocationMethod || '',
      canonicalInputSha256: line.carbonAuthority?.canonicalInputHash || ''
      }));
    }
    return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, description: line.goodsDescription,
      styleCode: line.styleCode, sizeLabel: line.sizeLabel, colorLabel: line.colorLabel, lotNumber: line.lotNumber,
      hsCode: line.hsCode, hsBasis: [line.hsCodeSource, line.hsCodeRuleset, line.hsCodeEffectiveDate].filter(Boolean).join(' | '),
      originCountry: line.originCountry, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, currency: line.currency || payload.profile.currency,
      lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
      netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg
    }));
  }

  async _buildDocumentBuffer(type, payload, issued, outputFormat = null) {
    const format = outputFormat || (type === 'ics2_dataset' ? 'csv'
      : (['vn_customs_handoff', 'eu_import_handoff'].includes(type) ? 'json' : 'xlsx'));
    if (format === 'pdf') return buildExportDocumentPdf(type, payload, issued);
    if (type === 'vn_customs_handoff' && format === 'json') {
      const reconciliation = validateVnCustomsHandoff(payload, {
        isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
          && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
          && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(payload, item),
        isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(payload, document)
      });
      const dataset = buildVnCustomsHandoffDataset(payload, {
        generatedAt: payload.generatedAt,
        documentVersion: payload.documentVersion,
        sourceSnapshotSha256: payload.sourceSnapshotSha256,
        reconciliation
      });
      return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    }
    if (type === 'eu_import_handoff' && format === 'json') {
      const reconciliation = validateEuImportHandoff(payload, {
        isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed'
          && item.latestReconciliation?.rulesetVersion === CARRIER_RULESET_VERSION
          && item.latestReconciliation?.sourceSnapshotSha256 === carrierReconciliationSha256(payload, item),
        isSupportingDocumentCurrent: (document) => isCurrentIssuedSupportingDocument(payload, document)
      });
      const dataset = buildEuImportHandoffDataset(payload, {
        generatedAt: payload.generatedAt,
        documentVersion: payload.documentVersion,
        sourceSnapshotSha256: payload.sourceSnapshotSha256,
        reconciliation
      });
      return Buffer.from(`${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    }
    const p = payload.profile || {};
    const lines = payload.lines || [];
    const packages = payload.packages || [];
    const containers = payload.containers || [];
    const leafPackages = packages.filter((pkg) => text(pkg.packageType).toLowerCase() !== 'pallet');
    const goodsTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const freight = Number(p.freightAmount || 0);
    const insurance = Number(p.insuranceAmount || 0);
    const discount = Number(p.discountAmount || 0);
    const surcharge = Number(p.surchargeAmount || 0);
    const totalPackages = leafPackages.reduce((sum, pkg) => sum + Number(pkg.quantity || 0), 0);
    const totalQuantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const totalNetKg = leafPackages.reduce((sum, pkg) => sum + packageNetTotal(pkg), 0);
    const totalGrossKg = leafPackages.reduce((sum, pkg) => sum + packageGrossTotal(pkg), 0);
    const totalCbm = leafPackages.reduce((sum, pkg) => sum + packageCbmTotal(pkg), 0);
    const party = (value) => [value?.name, value?.address, value?.country, value?.contact].filter(Boolean).join(' | ');
    const commonMetadata = {
      'Shipment reference': payload.shipment?.referenceNumber || payload.shipment?.id,
      'Document version': payload.documentVersion || '',
      'Ruleset': RULESET_VERSION, 'Control status': 'CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON'
    };
    const metadataByType = {
      commercial_invoice: {
        ...commonMetadata,
        'Invoice number': p.invoiceNumber || '', 'Invoice date': p.invoiceDate || '',
        'Issue place': p.invoiceIssuePlace || '', 'Exporter': party(p.exporter),
        'Exporter tax ID': p.exporterTaxId || '', 'Importer': party(p.importer),
        'Importer EORI': p.importerEori || '', 'Importer VAT ID': p.importerVatId || '',
        'Consignee': party(p.consignee), 'PO / Contract': p.poContractId || '',
        'Incoterm': `${p.incotermCode || ''} ${p.incotermLocation || ''} (${p.incotermVersion || 'Incoterms 2020'})`.trim(),
        'Payment terms': p.paymentTerms || '', 'Transport mode': p.transportMode || '',
        'Loading / discharge': `${p.portOfLoading || ''} / ${p.portOfDischarge || ''}`,
        'Currency': p.currency || '', 'Goods total': goodsTotal, 'Discount': discount,
        'Surcharge': surcharge, 'Freight': freight, 'Insurance': insurance,
        'Invoice total': goodsTotal + freight + insurance + surcharge - discount,
        'Customs value': p.customsValueAmount ?? '', 'Customs value basis': p.customsValueBasis || ''
      },
      packing_list: {
        ...commonMetadata,
        'Packing list number': p.packingListNumber || '', 'Packing list date': p.packingListDate || '',
        'Invoice number': p.invoiceNumber || '', 'Exporter': party(p.exporter), 'Consignee': party(p.consignee),
        'PO / Contract': p.poContractId || '', 'Transport mode': p.transportMode || '',
        'Carrier / transport company': p.carrierName || '',
        'Carrier document no.': p.billOfLadingNo || '',
        'Containers / seals': containers.map((item) => `${item.containerNumber} / ${item.sealNumber}`).join('; '),
        'Total containers': containers.length,
        'Total packages': totalPackages, 'Total quantity': totalQuantity,
        'Total net kg': totalNetKg, 'Total gross kg': totalGrossKg, 'Total CBM': totalCbm
      },
      carbon_annex: {
        ...commonMetadata, 'Carrier document no.': p.billOfLadingNo || '',
        'Containers / seals': containers.map((item) => `${item.containerNumber} / ${item.sealNumber}`).join('; '),
        'Transport mode': p.transportMode || '', 'Total quantity': totalQuantity,
        'Document nature': 'SUPPLEMENTARY CARBON ANNEX - NOT A BILL OF LADING / AWB / CMR / CIM',
        'Authority warning': 'Carrier-issued transport document remains authoritative. WeaveCarbon does not issue it.'
      },
      origin_workbook: {
        ...commonMetadata, 'Exporter': party(p.exporter), 'Invoice number': p.invoiceNumber || '',
        'PO / Contract': p.poContractId || '', 'Preferential claim': p.preferentialOriginClaim === true
      },
      vn_customs_handoff: {
        ...commonMetadata,
        'Dataset nature': 'BROKER HANDOFF - NOT A VNACCS MESSAGE OR CUSTOMS ACCEPTANCE',
        'Internal schema': `${VN_CUSTOMS_HANDOFF_SCHEMA.id}@${VN_CUSTOMS_HANDOFF_SCHEMA.version}`,
        'Regulatory basis version': VN_CUSTOMS_HANDOFF_SCHEMA.regulatoryBasisVersion,
        'Broker target schema': `${payload.vnCustomsProfile?.brokerTargetSchemaId || ''}@${payload.vnCustomsProfile?.brokerTargetSchemaVersion || ''}`,
        'Customs office code': payload.vnCustomsProfile?.customsOfficeCode || '',
        'Declaration type code': payload.vnCustomsProfile?.declarationTypeCode || '',
        'Transport method code': payload.vnCustomsProfile?.transportMethodCode || '',
        'Invoice number': p.invoiceNumber || '',
        'Packing list number': p.packingListNumber || '',
        'Currency / exchange rate': `${p.currency || ''} / ${payload.vnCustomsProfile?.exchangeRate || ''}`,
        'Authority status': 'NOT_SUBMITTED'
      },
      eu_import_handoff: {
        ...commonMetadata,
        'Dataset nature': 'DECLARANT HANDOFF - NOT A SAD, NATIONAL MESSAGE, MRN OR CUSTOMS ACCEPTANCE',
        'Internal schema': `${EU_IMPORT_HANDOFF_SCHEMA.id}@${EU_IMPORT_HANDOFF_SCHEMA.version}`,
        'EUCDM reference version': EU_IMPORT_HANDOFF_SCHEMA.eucdmVersion,
        'Regulatory basis version': EU_IMPORT_HANDOFF_SCHEMA.regulatoryBasisVersion,
        'Target system schema': `${payload.euImportProfile?.targetSystemSchemaId || ''}@${payload.euImportProfile?.targetSystemSchemaVersion || ''}`,
        'Import Member State': payload.euImportProfile?.memberStateCode || '',
        'Declaration dataset': payload.euImportProfile?.declarationDatasetCode || '',
        'Customs office code': payload.euImportProfile?.customsOfficeCode || '',
        'Importer EORI': payload.euImportProfile?.importer?.eori || '',
        'Declarant EORI': payload.euImportProfile?.declarant?.eori || '',
        'Invoice number': p.invoiceNumber || '',
        'Packing list number': p.packingListNumber || '',
        'Authority status': 'NOT_SUBMITTED'
      }
    };
    const metadata = metadataByType[type] || commonMetadata;
    const rows = this._documentRows(type, payload);
    if (type === 'ics2_dataset') {
      const headers = Object.keys(rows[0] || { shipmentReference: '' });
      const actualRows = rows.length ? rows : [{ shipmentReference: payload.shipment?.referenceNumber || payload.shipment?.id }];
      return Buffer.from(`sep=,\r\n${headers.join(',')}\r\n${actualRows.map((row) => headers.map((key) => csvEscape(row[key])).join(',')).join('\r\n')}\r\n`, 'utf8');
    }
    const columnsByType = {
      commercial_invoice: [
        ['lineNumber','Line'],['sku','SKU'],['styleCode','Style'],['sizeLabel','Size'],['colorLabel','Colour'],['lotNumber','Lot'],
        ['description','Description'],['hsCode','HS/CN'],['hsBasis','HS source / ruleset / effective'],['originCountry','Origin'],
        ['quantity','Quantity'],['unit','Unit'],['unitPrice','Unit price'],['currency','Currency'],['lineValue','Line value']
      ],
      packing_list: [
        ['containerNumber','Container'],['sealNumber','Seal'],['palletNumber','Pallet'],
        ['packageNumber','Package'],['packageType','Type'],['marks','Marks'],['quantity','Packages'],
        ['weightBasis','Weight basis'],['netWeightKg','Net kg total'],['grossWeightKg','Gross kg total'],
        ['dimensionBasis','Dimension basis'],['dimensions','L x W x H cm'],['cbm','CBM total'],['contents','Contents']
      ],
      carbon_annex: [
        ['lineNumber','Line'],['sku','SKU'],['hsCode','HS/CN'],['quantity','Quantity'],
        ['embeddedCo2eKg','Embedded kg CO2e'],['carrierDocumentType','Carrier document type'],
        ['carrierDocumentNo','Carrier document'],['carrierIssuer','Carrier issuer'],
        ['carrierFileSha256','Carrier file SHA-256'],['containerNo','Container'],
        ['calculationSnapshot','Calculation snapshot ID'],['calculationVersion','Calculation version'],
        ['methodology','Methodology version'],['boundary','Boundary'],['factorRegistry','Factor registry version'],
        ['factorProvenance','Factor provenance'],['gwpBasis','GWP basis'],['allocationMethod','Allocation method'],
        ['canonicalInputSha256','Canonical input SHA-256']
      ],
      origin_workbook: [
        ['lineNumber','Line'],['sku','SKU'],['description','Description'],['hsCode','HS/CN'],
        ['originCountry','Claimed origin'],['quantity','Quantity'],['unit','Unit']
      ],
      vn_customs_handoff: [
        ['lineNumber','Line'],['sku','SKU'],['goodsDescription','Detailed goods description'],
        ['vietnamHsCode','Vietnam HS (8 digits)'],['hsSource','HS source'],['hsRuleset','HS ruleset'],
        ['hsEffectiveDate','HS effective date'],['originCountry','Origin'],['destinationCountry','Destination'],
        ['quantity','Quantity'],['unit','Customs unit'],['unitPrice','Invoice unit price'],
        ['currency','Currency'],['lineValue','Line value'],['netWeightKg','Net kg'],
        ['grossWeightKg','Gross kg'],['packageRefs','Package references']
      ],
      eu_import_handoff: [
        ['lineNumber','Line'],['sku','SKU'],['goodsDescription','Detailed goods description'],
        ['taricCode','TARIC (10 digits)'],['taricSource','TARIC source'],['taricVersion','TARIC version'],
        ['taricEffectiveDate','TARIC effective date'],['taricConfirmed','TARIC confirmed'],
        ['taricConfirmedBy','Confirmed by'],['taricConfirmedAt','Confirmed at'],
        ['supplementaryUnitCode','Supplementary unit'],['additionalCodes','Additional codes'],
        ['nationalAdditionalCodes','National additional codes'],['preferenceCode','Preference code'],
        ['requestedProcedureCode','Requested procedure'],['previousProcedureCode','Previous procedure'],
        ['originCountry','Origin'],['quantity','Quantity'],['unit','Unit'],['itemValue','Item value'],
        ['currency','Currency'],['netWeightKg','Net kg'],['grossWeightKg','Gross kg'],['packageRefs','Package references']
      ]
    };
    return buildSimpleXlsx({
      title: type.replace(/_/g, ' ').toUpperCase(), sheetName: type,
      metadata, columns: columnsByType[type].map(([key, label]) => ({ key, label })), rows,
      watermark: 'CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON'
    });
  }

  async generateDocumentFile(reportId, exportDocumentId, companyId) {
    const result = await this.database.query(
      `SELECT ed.*, r.file_format FROM export_documents ed JOIN reports r ON r.id=ed.report_id
       WHERE ed.id=$1 AND ed.report_id=$2 AND ed.company_id=$3`, [exportDocumentId, reportId, companyId]
    );
    const document = result.rows[0];
    if (!document) throw new Error('Export document job target not found.');
    const payload = { ...document.payload, documentVersion: document.version };
    const ext = document.output_format || document.file_format
      || (document.document_type === 'ics2_dataset' ? 'csv'
        : (['vn_customs_handoff', 'eu_import_handoff'].includes(document.document_type) ? 'json' : 'xlsx'));
    const buffer = await this._buildDocumentBuffer(document.document_type, payload, false, ext);
    const filename = `${document.document_type}_${document.shipment_id}_v${document.version}.${ext}`;
    const storageKey = `reports/${companyId}/exports/${document.shipment_id}/${filename}`;
    const filePath = path.resolve(this.uploadsRoot, storageKey);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    const storedBuffer = await fs.promises.readFile(filePath);
    const storedStat = await fs.promises.stat(filePath);
    if (!storedStat.isFile() || storedStat.size !== buffer.length) {
      throw new Error('Generated export file failed size verification.');
    }
    const digest = sha256(storedBuffer);
    const mime = ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : (ext === 'pdf' ? 'application/pdf' : (ext === 'json' ? 'application/json' : 'text/csv'));
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE export_documents SET storage_provider='local', storage_key=$1, original_filename=$2,
           mime_type=$3, file_size_bytes=$4, file_sha256=$5, updated_at=now() WHERE id=$6 AND company_id=$7`,
        [storageKey, filename, mime, buffer.length, digest, exportDocumentId, companyId]
      );
      await client.query(
        `UPDATE reports SET status='completed', storage_provider='local', storage_key=$1,
           original_filename=$2, download_url=$3, file_size_bytes=$4, file_format=$5,
           records=$6, generated_at=now(), updated_at=now() WHERE id=$7 AND company_id=$8`,
        [storageKey, filename, `/api/reports/${reportId}/download`, buffer.length, ext,
          Array.isArray(payload.lines) ? payload.lines.length : 0, reportId, companyId]
      );
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    return { storageKey, filename, fileSize: buffer.length, sha256: digest };
  }

  async markDocumentFailed(reportId, exportDocumentId, companyId, error) {
    const message = String(error?.message || error || 'Export document generation failed.').slice(0, 2000);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE export_documents SET status='failed', updated_at=now()
         WHERE id=$1 AND report_id=$2 AND company_id=$3 AND status <> 'issued'`,
        [exportDocumentId, reportId, companyId]
      );
      await client.query(
        `UPDATE reports SET status='failed', error_message=$1, updated_at=now()
         WHERE id=$2 AND company_id=$3 AND status <> 'completed'`,
        [message, reportId, companyId]
      );
      await client.query('COMMIT');
    } catch (updateError) {
      await client.query('ROLLBACK').catch(() => {});
      throw updateError;
    } finally { client.release(); }
  }

  async getDocumentReviews(companyId, shipmentId, documentId) {
    if (!UUID_REGEX.test(String(documentId || ''))) return null;
    const document = await this.database.query(
      'SELECT id FROM export_documents WHERE id=$1 AND shipment_id=$2 AND company_id=$3',
      [documentId, shipmentId, companyId]
    );
    if (!document.rows[0]) return null;
    const result = await this.database.query(
      `SELECT * FROM export_document_reviews
       WHERE export_document_id=$1 AND shipment_id=$2 AND company_id=$3
       ORDER BY reviewed_at DESC, id DESC`,
      [documentId, shipmentId, companyId]
    );
    return result.rows.map((row) => this._formatReview(row));
  }

  async reviewDocument(companyId, shipmentId, documentId, userId, input = {}) {
    if (!UUID_REGEX.test(String(documentId || ''))) return null;
    const documentResult = await this.database.query(
      `SELECT ed.*, r.status AS report_status
       FROM export_documents ed JOIN reports r ON r.id=ed.report_id
       WHERE ed.id=$1 AND ed.shipment_id=$2 AND ed.company_id=$3`,
      [documentId, shipmentId, companyId]
    );
    const document = documentResult.rows[0];
    if (!document) return null;
    const requiredRole = REVIEW_ROLE_BY_DOCUMENT[document.document_type];
    if (!requiredRole) return { blocked: true, code: 'DOCUMENT_REVIEW_NOT_SUPPORTED', message: 'Business review is not configured for this document type.' };
    const reviewerRole = text(input.reviewerRole || input.reviewer_role);
    const decision = text(input.decision).toLowerCase();
    if (reviewerRole !== requiredRole) {
      return { blocked: true, code: 'DOCUMENT_REVIEW_ROLE_INVALID', message: `This document requires the ${requiredRole} reviewer role.` };
    }
    if (!REVIEW_DECISIONS.has(decision)) {
      return { blocked: true, code: 'DOCUMENT_REVIEW_DECISION_INVALID', message: 'Decision must be approved, rejected or changes_requested.' };
    }
    if (document.report_status !== 'completed' || !document.file_sha256 || !document.payload_sha256) {
      return { blocked: true, code: 'DOCUMENT_FILE_NOT_READY', message: 'The generated review file and checksums must exist before review.' };
    }
    if (document.status !== 'ready') {
      return { blocked: true, code: 'DOCUMENT_REVIEW_STATUS_INVALID', message: 'Only a ready, non-issued document can be reviewed.' };
    }
    const currentSnapshot = await this.getProfile(companyId, shipmentId);
    const currentSnapshotHash = documentSourceSnapshotSha256(currentSnapshot, document.document_type);
    const documentSnapshotHash = document.payload?.sourceSnapshotSha256;
    if (!documentSnapshotHash || documentSnapshotHash !== currentSnapshotHash) {
      return { blocked: true, code: 'DOCUMENT_SNAPSHOT_STALE', message: 'Shipment data changed after this review file was generated. Generate a new version before review.' };
    }
    const userResult = await this.database.query(
      'SELECT id, email, full_name FROM users WHERE id=$1', [userId]
    );
    const reviewer = userResult.rows[0];
    if (!reviewer) return { blocked: true, code: 'DOCUMENT_REVIEWER_NOT_FOUND', message: 'Authenticated reviewer identity was not found.' };
    const reviewerName = text(reviewer.full_name) || text(reviewer.email);
    const inserted = await this.database.query(
      `INSERT INTO export_document_reviews (
         company_id, shipment_id, export_document_id, document_type, reviewer_role, decision, notes,
         document_payload_sha256, document_file_sha256, source_snapshot_sha256,
         reviewed_by, reviewer_name_snapshot, reviewer_email_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [companyId, shipmentId, documentId, document.document_type, reviewerRole, decision,
        text(input.notes) || null, document.payload_sha256, document.file_sha256, documentSnapshotHash,
        userId, reviewerName, text(reviewer.email) || null]
    );
    return this._formatReview(inserted.rows[0]);
  }

  async issueDocument(companyId, shipmentId, documentId, userId) {
    if (!UUID_REGEX.test(String(documentId || ''))) return null;
    const result = await this.database.query(
      `SELECT ed.*, r.status AS report_status, r.file_format FROM export_documents ed JOIN reports r ON r.id=ed.report_id
       WHERE ed.id=$1 AND ed.shipment_id=$2 AND ed.company_id=$3`, [documentId, shipmentId, companyId]
    );
    const document = result.rows[0];
    if (!document) return null;
    if (document.status === 'issued') return this._formatDocument(document);
    if (document.report_status !== 'completed') {
      return { blocked: true, code: 'DOCUMENT_FILE_NOT_READY', message: 'Generated file is not ready.' };
    }
    const readiness = await this.getReadiness(companyId, shipmentId);
    const docReadiness = readiness.documents.find((item) => item.type === document.document_type);
    if (!docReadiness || docReadiness.status !== 'ready') return { blocked: true, code: 'DOCUMENT_NOT_READY', readiness };
    const currentSnapshot = await this.getProfile(companyId, shipmentId);
    const currentSnapshotHash = documentSourceSnapshotSha256(currentSnapshot, document.document_type);
    if (!document.payload?.sourceSnapshotSha256 || document.payload.sourceSnapshotSha256 !== currentSnapshotHash) {
      return {
        blocked: true,
        code: 'DOCUMENT_SNAPSHOT_STALE',
        message: 'Shipment data or approved evidence changed after this review file was generated. Generate a new version before issuing.',
        readiness
      };
    }
    if (['carbon_annex', 'ics2_dataset', 'vn_customs_handoff', 'eu_import_handoff'].includes(document.document_type)) {
      const evidenceVerification = await this._verifyCurrentCarrierEvidence(companyId, shipmentId, currentSnapshot);
      if (evidenceVerification.error) {
        return {
          blocked: true,
          code: evidenceVerification.error,
          message: 'Current carrier evidence bytes could not be verified before issue.',
          readiness
        };
      }
    }
    if (document.document_type === 'vn_customs_handoff') {
      const supportingVerification = await this._verifyCurrentSupportingExportDocuments(companyId, shipmentId, currentSnapshot);
      if (supportingVerification.error) {
        return {
          blocked: true,
          code: supportingVerification.error,
          message: `Current issued ${supportingVerification.documentType || 'supporting'} file could not be verified before issue.`,
          readiness
        };
      }
    }
    if (document.document_type === 'eu_import_handoff') {
      const supportingVerification = await this._verifyCurrentEuSupportingDocuments(companyId, shipmentId, currentSnapshot);
      if (supportingVerification.error) {
        return {
          blocked: true,
          code: supportingVerification.error,
          message: `Current issued ${supportingVerification.documentType || 'supporting'} file could not be verified before issue.`,
          readiness
        };
      }
    }
    const requiredReviewRole = REVIEW_ROLE_BY_DOCUMENT[document.document_type];
    if (requiredReviewRole) {
      const reviewResult = await this.database.query(
        `SELECT * FROM export_document_reviews
         WHERE export_document_id=$1 AND shipment_id=$2 AND company_id=$3
         ORDER BY reviewed_at DESC, id DESC LIMIT 1`,
        [documentId, shipmentId, companyId]
      );
      const review = reviewResult.rows[0];
      if (!review) {
        return { blocked: true, code: 'DOCUMENT_REVIEW_REQUIRED', message: `An approved ${requiredReviewRole} review is required before issue.` };
      }
      if (review.decision !== 'approved' || review.reviewer_role !== requiredReviewRole) {
        return { blocked: true, code: 'DOCUMENT_REVIEW_NOT_APPROVED', message: `The latest ${requiredReviewRole} review must approve this exact file.` };
      }
      if (review.document_payload_sha256 !== document.payload_sha256
        || review.document_file_sha256 !== document.file_sha256
        || review.source_snapshot_sha256 !== currentSnapshotHash) {
        return { blocked: true, code: 'DOCUMENT_REVIEW_STALE', message: 'The approval does not match the current payload, file checksum and shipment snapshot.' };
      }
    }
    const ext = document.output_format || document.file_format
      || (document.document_type === 'ics2_dataset' ? 'csv'
        : (['vn_customs_handoff', 'eu_import_handoff'].includes(document.document_type) ? 'json' : 'xlsx'));
    if (!document.storage_key || document.storage_provider !== 'local') {
      return { blocked: true, code: 'DOCUMENT_SOURCE_FILE_MISSING', message: 'The approved local source file is unavailable.' };
    }
    const sourcePath = path.resolve(this.uploadsRoot, document.storage_key);
    const uploadsRoot = path.resolve(this.uploadsRoot);
    if (sourcePath !== uploadsRoot && !sourcePath.startsWith(`${uploadsRoot}${path.sep}`)) {
      return { blocked: true, code: 'DOCUMENT_STORAGE_KEY_INVALID', message: 'The document storage key is outside the controlled uploads directory.' };
    }
    let buffer;
    try {
      buffer = await fs.promises.readFile(sourcePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { blocked: true, code: 'DOCUMENT_SOURCE_FILE_MISSING', message: 'The approved source file no longer exists.' };
      }
      throw error;
    }
    const sourceDigest = sha256(buffer);
    if (sourceDigest !== document.file_sha256 || buffer.length !== Number(document.file_size_bytes)) {
      return { blocked: true, code: 'DOCUMENT_SOURCE_FILE_TAMPERED', message: 'The approved source file checksum or size no longer matches the database record.' };
    }
    const filename = `${document.document_type}_${shipmentId}_v${document.version}_issued.${ext}`;
    const storageKey = `reports/${companyId}/exports/${shipmentId}/${filename}`;
    const filePath = path.resolve(this.uploadsRoot, storageKey);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    const storedBuffer = await fs.promises.readFile(filePath);
    const storedStat = await fs.promises.stat(filePath);
    if (!storedStat.isFile() || storedStat.size !== buffer.length) {
      throw new Error('Issued export file failed size verification.');
    }
    const digest = sha256(storedBuffer);
    if (digest !== sourceDigest) {
      throw new Error('Issued export file no longer matches the approved source checksum.');
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE export_documents SET status='superseded', updated_at=now()
         WHERE company_id=$1 AND shipment_id=$2 AND document_type=$3 AND status='issued' AND id<>$4`,
        [companyId, shipmentId, document.document_type, documentId]
      );
      const updated = await client.query(
        `UPDATE export_documents SET status='issued', approved_by=$1, issued_by=$1, issued_at=now(), storage_key=$2,
           original_filename=$3, mime_type=$4, file_size_bytes=$5, file_sha256=$6, updated_at=now()
         WHERE id=$7 AND company_id=$8 AND shipment_id=$9 RETURNING *`, [userId, storageKey, filename,
          ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : (ext === 'pdf' ? 'application/pdf' : (ext === 'json' ? 'application/json' : 'text/csv')),
          buffer.length, digest, documentId, companyId, shipmentId]
      );
      await client.query(
        `UPDATE reports SET storage_key=$1, original_filename=$2, file_size_bytes=$3,
           generated_at=now(), updated_at=now() WHERE id=$4 AND company_id=$5`,
        [storageKey, filename, buffer.length, document.report_id, companyId]
      );
      await client.query('COMMIT');
      return this._formatDocument({ ...updated.rows[0], report_status: 'completed', download_url: `/api/reports/${document.report_id}/download` });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  _formatDocument(row) {
    const sourceSnapshotHash = row.payload?.sourceSnapshotSha256 || null;
    const reviewMatches = Boolean(row.latest_review_id)
      && row.review_payload_sha256 === row.payload_sha256
      && row.review_file_sha256 === row.file_sha256
      && row.review_source_snapshot_sha256 === sourceSnapshotHash;
    const requiredReviewerRole = REVIEW_ROLE_BY_DOCUMENT[row.document_type] || null;
    const latestReview = row.latest_review_id ? {
      id: row.latest_review_id, reviewerRole: row.latest_review_role,
      decision: reviewMatches ? row.latest_review_decision : 'stale',
      originalDecision: row.latest_review_decision, notes: row.latest_review_notes || '',
      reviewedBy: row.latest_reviewed_by, reviewerName: row.latest_reviewer_name,
      reviewerEmail: row.latest_reviewer_email || null, reviewedAt: row.latest_reviewed_at,
      stale: !reviewMatches
    } : null;
    return {
      id: row.id, shipmentId: row.shipment_id, reportId: row.report_id,
      type: row.document_type, version: Number(row.version), status: row.status,
      outputFormat: row.output_format || row.file_format || null,
      reportStatus: row.report_status || null, validationResults: row.validation_results || {},
      payloadSha256: row.payload_sha256, fileSha256: row.file_sha256,
      filename: row.original_filename, fileSizeBytes: Number(row.file_size_bytes || 0),
      downloadUrl: row.download_url || (row.report_id && row.report_status === 'completed' ? `/api/reports/${row.report_id}/download` : null),
      requiredReviewerRole, latestReview,
      readyToIssue: !requiredReviewerRole || (latestReview?.decision === 'approved' && !latestReview.stale),
      sourceSnapshotSha256: sourceSnapshotHash,
      issuedAt: row.issued_at, createdAt: row.created_at
    };
  }

  _formatVnCustomsEvent(row) {
    return {
      id: row.id,
      shipmentId: row.shipment_id,
      exportDocumentId: row.export_document_id,
      eventType: row.event_type,
      sourceType: row.source_type,
      externalReference: row.external_reference,
      messageCode: row.message_code || '',
      messageText: row.message_text || '',
      evidenceDocumentId: row.evidence_document_id,
      evidenceSha256: row.evidence_sha256,
      evidenceFileSizeBytes: Number(row.evidence_file_size_bytes || 0),
      documentPayloadSha256: row.document_payload_sha256,
      documentFileSha256: row.document_file_sha256,
      actorName: row.actor_name_snapshot,
      actorIdentifier: row.actor_identifier_snapshot || '',
      occurredAt: row.occurred_at,
      recordedBy: row.recorded_by,
      recorderName: row.recorder_name_snapshot,
      recorderEmail: row.recorder_email_snapshot || null,
      metadata: row.metadata || {},
      createdAt: row.created_at
    };
  }

  _formatEuImportEvent(row) {
    return this._formatVnCustomsEvent(row);
  }

  _formatReview(row) {
    return {
      id: row.id, documentId: row.export_document_id, shipmentId: row.shipment_id,
      documentType: row.document_type, reviewerRole: row.reviewer_role, decision: row.decision,
      notes: row.notes || '', reviewedBy: row.reviewed_by, reviewerName: row.reviewer_name_snapshot,
      reviewerEmail: row.reviewer_email_snapshot || null, reviewedAt: row.reviewed_at,
      documentPayloadSha256: row.document_payload_sha256, documentFileSha256: row.document_file_sha256,
      sourceSnapshotSha256: row.source_snapshot_sha256
    };
  }
}

const service = new ExportShipmentService();
module.exports = service;
module.exports.ExportShipmentService = ExportShipmentService;
module.exports.createExportShipmentService = (dependencies) => new ExportShipmentService(dependencies);
module.exports.isCbamApplicable = isCbamApplicable;
module.exports.CBAM_RULESET = CBAM_RULESET;
module.exports.sourceSnapshotSha256 = sourceSnapshotSha256;
module.exports.documentSourceSnapshotSha256 = documentSourceSnapshotSha256;
module.exports.carrierReconciliationSha256 = carrierReconciliationSha256;
module.exports.CARRIER_RULESET_VERSION = CARRIER_RULESET_VERSION;
module.exports.VN_CUSTOMS_HANDOFF_SCHEMA = VN_CUSTOMS_HANDOFF_SCHEMA;
module.exports.EU_IMPORT_HANDOFF_SCHEMA = EU_IMPORT_HANDOFF_SCHEMA;
module.exports.RULESET_VERSION = RULESET_VERSION;
