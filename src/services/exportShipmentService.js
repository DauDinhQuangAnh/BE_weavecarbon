const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { UPLOADS_ROOT } = require('../config/runtime');
const { buildSimpleXlsx } = require('../utils/simpleXlsx');
const { buildExportDocumentPdf } = require('./exportDocumentPdf');

const RULESET_VERSION = 'VN-EU-TEXTILE-2026.09.2';
const DOCUMENT_TYPES = new Set([
  'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset'
]);
const DOCUMENT_FORMATS = {
  commercial_invoice: new Set(['xlsx', 'pdf']),
  packing_list: new Set(['xlsx', 'pdf']),
  carbon_annex: new Set(['xlsx']),
  origin_workbook: new Set(['xlsx']),
  ics2_dataset: new Set(['csv'])
};
const CORE_DOCUMENT_TYPES = ['commercial_invoice', 'packing_list', 'carbon_annex', 'ics2_dataset'];
const CARRIER_EVIDENCE_TYPES = ['bill_of_lading', 'carrier_bill_of_lading', 'air_waybill', 'awb', 'cmr'];
const INCOTERMS_2020 = new Set(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);
const TRANSPORT_MODES = new Set(['sea', 'air', 'road', 'rail', 'multimodal']);
const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);
const REVIEW_ROLE_BY_DOCUMENT = {
  commercial_invoice: 'export_operator',
  packing_list: 'warehouse_reviewer'
};
const REVIEW_DECISIONS = new Set(['approved', 'rejected', 'changes_requested']);
const MEASUREMENT_BASES = new Set(['per_package', 'group_total']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const [profileResult, linesResult, containersResult, packagesResult, evidenceResult, documentsResult] = await Promise.all([
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
        `SELECT id, evidence_type, document_name, original_filename, status, valid_from, valid_to,
                checksum_sha256, uploaded_at, locked_at, approved_by, approval_note
         FROM evidence_documents
         WHERE shipment_id = $1 AND company_id = $2 AND evidence_type = ANY($3::text[])
         ORDER BY created_at DESC`, [shipmentId, companyId, [...CARRIER_EVIDENCE_TYPES, 'origin_support']]
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
      carrierDocuments: evidenceResult.rows.map((row) => ({
        id: row.id, type: row.evidence_type, name: row.original_filename || row.document_name,
        status: row.status, validFrom: row.valid_from, validTo: row.valid_to,
        checksumSha256: row.checksum_sha256, uploadedAt: row.uploaded_at, approvedAt: row.locked_at,
        approvedBy: row.approved_by, approvalNote: row.approval_note
      })),
      documents: documentsResult.rows.map((row) => this._formatDocument(row))
    };
    const currentSnapshotHash = sourceSnapshotSha256(snapshot);
    snapshot.documents = snapshot.documents.map((document) => {
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

  async syncLinesFromShipment(companyId, shipmentId) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    await this.database.query(
      `INSERT INTO shipment_export_lines (
         company_id, shipment_id, source_product_id, line_number, sku, goods_description,
         hs_code, origin_country, quantity, unit, net_weight_kg, gross_weight_kg, embedded_co2e_kg,
         style_code, size_label, color_label, lot_number
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
              COALESCE(NULLIF(ps.payload->>'lotNumber',''), NULLIF(ps.payload->>'batchNumber',''))
       FROM shipment_products sp
       JOIN shipments s ON s.id = sp.shipment_id AND s.company_id = $2
       JOIN products p ON p.id = sp.product_id AND p.company_id = $2
       LEFT JOIN product_assessment_snapshots ps ON ps.product_id = p.id
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
         package_refs=$22::jsonb, metadata=$23::jsonb, updated_at=now()
       WHERE id=$24 AND shipment_id=$25 AND company_id=$26 RETURNING *`,
      [merged.lineNumber, text(merged.sku), text(merged.goodsDescription), normalizedHsCode,
        text(merged.originCountry), numberOrNull(merged.quantity), text(merged.unit), numberOrNull(merged.unitPrice),
        text(merged.currency).toUpperCase() || null, numberOrNull(merged.netWeightKg), numberOrNull(merged.grossWeightKg),
        numberOrNull(merged.embeddedCo2eKg), text(merged.styleCode) || null, text(merged.sizeLabel) || null,
        text(merged.colorLabel) || null, text(merged.lotNumber) || null,
        hsCodeSource || null, hsCodeRuleset || null, hsCodeEffectiveDate, hsCodeConfirmed,
        userId, JSON.stringify(merged.packageRefs || []), JSON.stringify(merged.metadata || {}),
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
    const approvedCarriers = carriers.filter((doc) => ['locked', 'third_party_verified'].includes(doc.status) && doc.approvedBy && (!doc.validTo || new Date(doc.validTo) >= new Date(new Date().toISOString().slice(0, 10))));
    results.push(requirement('carbon_annex', 'carrier_document', approvedCarriers.length ? 'ready' : 'missing', 'carrierDocuments', approvedCarriers.length ? null : 'An approved, non-expired carrier B/L/AWB/CMR is required.', true, approvedCarriers.map((doc) => doc.id)));
    need('carbon_annex', 'bill_of_lading_no', profile.billOfLadingNo, 'profile.billOfLadingNo', 'Carrier document number');
    const hasCarbon = lines.length > 0 && lines.every((line) => line.embeddedCo2eKg !== null);
    results.push(requirement('carbon_annex', 'carbon_values', hasCarbon ? 'ready' : 'missing', 'lines[].embeddedCo2eKg', hasCarbon ? null : 'Every line requires server-authoritative embedded CO2e.'));
    party('ics2_dataset', 'exporter', profile.exporter);
    party('ics2_dataset', 'importer', profile.importer);
    need('ics2_dataset', 'importer_eori', profile.importerEori, 'profile.importerEori', 'Importer EORI');
    need('ics2_dataset', 'transport_document_no', profile.billOfLadingNo, 'profile.billOfLadingNo', 'Transport document number');
    need('ics2_dataset', 'port_of_loading', profile.portOfLoading, 'profile.portOfLoading', 'Port/place of loading');
    need('ics2_dataset', 'port_of_discharge', profile.portOfDischarge, 'profile.portOfDischarge', 'Port/place of discharge');
    results.push(requirement('ics2_dataset', 'goods_lines', lines.length ? 'ready' : 'missing', 'lines', lines.length ? null : 'Goods lines are required.'));
    results.push(requirement('ics2_dataset', 'carrier_document', approvedCarriers.length ? 'ready' : 'missing', 'carrierDocuments', approvedCarriers.length ? null : 'An approved carrier document is required.', true, approvedCarriers.map((doc) => doc.id)));
    lines.forEach((line, index) => {
      const complete = text(line.goodsDescription) && text(line.hsCode) && text(line.originCountry) && line.grossWeightKg !== null;
      results.push(requirement('ics2_dataset', `goods_line_${index + 1}`, complete ? 'ready' : 'missing', `lines[${index}]`, complete ? null : `ICS2 goods line ${index + 1} requires description, HS code, origin and gross weight.`));
    });
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
    const defaultFormat = documentType === 'ics2_dataset' ? 'csv' : 'xlsx';
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
        sourceSnapshotSha256: sourceSnapshotSha256(snapshot)
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
    if (type === 'carbon_annex') return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, hsCode: line.hsCode, quantity: line.quantity,
      embeddedCo2eKg: line.embeddedCo2eKg, carrierDocumentNo: payload.profile.billOfLadingNo,
      containerNo: containerNumbers
    }));
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
    const format = outputFormat || (type === 'ics2_dataset' ? 'csv' : 'xlsx');
    if (format === 'pdf') return buildExportDocumentPdf(type, payload, issued);
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
        'Transport mode': p.transportMode || '', 'Total quantity': totalQuantity
      },
      origin_workbook: {
        ...commonMetadata, 'Exporter': party(p.exporter), 'Invoice number': p.invoiceNumber || '',
        'PO / Contract': p.poContractId || '', 'Preferential claim': p.preferentialOriginClaim === true
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
        ['embeddedCo2eKg','Embedded kg CO2e'],['carrierDocumentNo','Carrier document'],['containerNo','Container']
      ],
      origin_workbook: [
        ['lineNumber','Line'],['sku','SKU'],['description','Description'],['hsCode','HS/CN'],
        ['originCountry','Claimed origin'],['quantity','Quantity'],['unit','Unit']
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
    const ext = document.output_format || document.file_format || (document.document_type === 'ics2_dataset' ? 'csv' : 'xlsx');
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
      : (ext === 'pdf' ? 'application/pdf' : 'text/csv');
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
    if (!requiredRole) return { blocked: true, code: 'DOCUMENT_REVIEW_NOT_SUPPORTED', message: 'Business review is currently required only for Commercial Invoice and Packing List.' };
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
    const currentSnapshotHash = sourceSnapshotSha256(currentSnapshot);
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
    const currentSnapshotHash = sourceSnapshotSha256(currentSnapshot);
    if (!document.payload?.sourceSnapshotSha256 || document.payload.sourceSnapshotSha256 !== currentSnapshotHash) {
      return {
        blocked: true,
        code: 'DOCUMENT_SNAPSHOT_STALE',
        message: 'Shipment data or approved evidence changed after this review file was generated. Generate a new version before issuing.',
        readiness
      };
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
    const ext = document.output_format || document.file_format || (document.document_type === 'ics2_dataset' ? 'csv' : 'xlsx');
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
          ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : (ext === 'pdf' ? 'application/pdf' : 'text/csv'),
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
module.exports.RULESET_VERSION = RULESET_VERSION;
