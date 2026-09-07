const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { UPLOADS_ROOT } = require('../config/runtime');
const { buildSimpleXlsx } = require('../utils/simpleXlsx');

const RULESET_VERSION = 'VN-EU-TEXTILE-2026.09';
const DOCUMENT_TYPES = new Set([
  'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset'
]);
const CORE_DOCUMENT_TYPES = ['commercial_invoice', 'packing_list', 'carbon_annex', 'ics2_dataset'];
const CARRIER_EVIDENCE_TYPES = ['bill_of_lading', 'carrier_bill_of_lading', 'air_waybill', 'awb', 'cmr'];
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
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sourceSnapshotSha256(snapshot) {
  return sha256(JSON.stringify({
    shipment: snapshot?.shipment || null,
    profile: snapshot?.profile || null,
    lines: snapshot?.lines || [],
    packages: snapshot?.packages || [],
    carrierDocuments: snapshot?.carrierDocuments || []
  }));
}
function normalizeHsCode(value) { return text(value).replace(/[^0-9]/g, ''); }
function isCbamApplicable(hsCode) {
  const normalized = normalizeHsCode(hsCode);
  return Boolean(normalized && CBAM_RULESET.prefixes.some((prefix) => normalized.startsWith(prefix)));
}
function csvEscape(value) {
  const result = String(value ?? '');
  return /[",\r\n]/.test(result) ? `"${result.replace(/"/g, '""')}"` : result;
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    targetMarket: row.target_market,
    invoiceNumber: row.invoice_number || '',
    invoiceDate: row.invoice_date || null,
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
    quantity: Number(row.quantity), netWeightKg: numberOrNull(row.net_weight_kg),
    grossWeightKg: numberOrNull(row.gross_weight_kg), lengthCm: numberOrNull(row.length_cm),
    widthCm: numberOrNull(row.width_cm), heightCm: numberOrNull(row.height_cm),
    contents: row.contents || []
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
    const [profileResult, linesResult, packagesResult, evidenceResult, documentsResult] = await Promise.all([
      this.database.query('SELECT * FROM shipment_export_profiles WHERE shipment_id = $1 AND company_id = $2', [shipmentId, companyId]),
      this.database.query('SELECT * FROM shipment_export_lines WHERE shipment_id = $1 AND company_id = $2 ORDER BY line_number', [shipmentId, companyId]),
      this.database.query('SELECT * FROM shipment_packages WHERE shipment_id = $1 AND company_id = $2 ORDER BY package_number', [shipmentId, companyId]),
      this.database.query(
        `SELECT id, evidence_type, document_name, original_filename, status, valid_from, valid_to,
                checksum_sha256, uploaded_at, locked_at, approved_by, approval_note
         FROM evidence_documents
         WHERE shipment_id = $1 AND company_id = $2 AND evidence_type = ANY($3::text[])
         ORDER BY created_at DESC`, [shipmentId, companyId, [...CARRIER_EVIDENCE_TYPES, 'origin_support']]
      ),
      this.database.query(
        `SELECT ed.*, r.status AS report_status, r.download_url
         FROM export_documents ed LEFT JOIN reports r ON r.id = ed.report_id
         WHERE ed.shipment_id = $1 AND ed.company_id = $2
         ORDER BY ed.document_type, ed.version DESC`, [shipmentId, companyId]
      )
    ]);
    return {
      shipment: {
        id: shipment.id, referenceNumber: shipment.reference_number, status: shipment.status,
        originCountry: shipment.origin_country, destinationCountry: shipment.destination_country,
        totalWeightKg: numberOrNull(shipment.total_weight_kg), totalCo2e: numberOrNull(shipment.total_co2e)
      },
      profile: profileFromRow(profileResult.rows[0]),
      lines: linesResult.rows.map(lineFromRow),
      packages: packagesResult.rows.map(packageFromRow),
      carrierDocuments: evidenceResult.rows.map((row) => ({
        id: row.id, type: row.evidence_type, name: row.original_filename || row.document_name,
        status: row.status, validFrom: row.valid_from, validTo: row.valid_to,
        checksumSha256: row.checksum_sha256, uploadedAt: row.uploaded_at, approvedAt: row.locked_at,
        approvedBy: row.approved_by, approvalNote: row.approval_note
      })),
      documents: documentsResult.rows.map((row) => this._formatDocument(row))
    };
  }

  async upsertProfile(companyId, shipmentId, userId, input = {}) {
    const shipment = await this._assertShipment(companyId, shipmentId);
    if (!shipment) return null;
    const value = (camel, snake = camel) => input[camel] ?? input[snake] ?? null;
    const result = await this.database.query(
      `INSERT INTO shipment_export_profiles (
         company_id, shipment_id, target_market, invoice_number, invoice_date, po_contract_id,
         incoterm_code, incoterm_location, incoterm_version, currency, payment_terms,
         exporter, importer, consignee, notify_party, exporter_tax_id, importer_eori,
         port_of_loading, port_of_discharge, place_of_delivery, vessel_name, voyage_number,
         bill_of_lading_no, container_no, seal_no, customs_declaration_no, freight_amount,
         insurance_amount, preferential_origin_claim, metadata, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31,$31)
       ON CONFLICT (shipment_id) DO UPDATE SET
         target_market=EXCLUDED.target_market, invoice_number=EXCLUDED.invoice_number,
         invoice_date=EXCLUDED.invoice_date, po_contract_id=EXCLUDED.po_contract_id,
         incoterm_code=EXCLUDED.incoterm_code, incoterm_location=EXCLUDED.incoterm_location,
         incoterm_version=EXCLUDED.incoterm_version, currency=EXCLUDED.currency,
         payment_terms=EXCLUDED.payment_terms, exporter=EXCLUDED.exporter, importer=EXCLUDED.importer,
         consignee=EXCLUDED.consignee, notify_party=EXCLUDED.notify_party,
         exporter_tax_id=EXCLUDED.exporter_tax_id, importer_eori=EXCLUDED.importer_eori,
         port_of_loading=EXCLUDED.port_of_loading, port_of_discharge=EXCLUDED.port_of_discharge,
         place_of_delivery=EXCLUDED.place_of_delivery, vessel_name=EXCLUDED.vessel_name,
         voyage_number=EXCLUDED.voyage_number, bill_of_lading_no=EXCLUDED.bill_of_lading_no,
         container_no=EXCLUDED.container_no, seal_no=EXCLUDED.seal_no,
         customs_declaration_no=EXCLUDED.customs_declaration_no, freight_amount=EXCLUDED.freight_amount,
         insurance_amount=EXCLUDED.insurance_amount,
         preferential_origin_claim=EXCLUDED.preferential_origin_claim, metadata=EXCLUDED.metadata,
         updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [
        companyId, shipmentId, text(value('targetMarket', 'target_market')) || 'EU',
        text(value('invoiceNumber', 'invoice_number')) || null, text(value('invoiceDate', 'invoice_date')) || null,
        text(value('poContractId', 'po_contract_id')) || null, text(value('incotermCode', 'incoterm_code')).toUpperCase() || null,
        text(value('incotermLocation', 'incoterm_location')) || null,
        text(value('incotermVersion', 'incoterm_version')) || 'Incoterms 2020',
        text(value('currency')).toUpperCase() || null, text(value('paymentTerms', 'payment_terms')) || null,
        JSON.stringify(object(value('exporter'))), JSON.stringify(object(value('importer'))),
        JSON.stringify(object(value('consignee'))), JSON.stringify(object(value('notifyParty', 'notify_party'))),
        text(value('exporterTaxId', 'exporter_tax_id')) || null, text(value('importerEori', 'importer_eori')) || null,
        text(value('portOfLoading', 'port_of_loading')) || null, text(value('portOfDischarge', 'port_of_discharge')) || null,
        text(value('placeOfDelivery', 'place_of_delivery')) || null, text(value('vesselName', 'vessel_name')) || null,
        text(value('voyageNumber', 'voyage_number')) || null, text(value('billOfLadingNo', 'bill_of_lading_no')) || null,
        text(value('containerNo', 'container_no')) || null, text(value('sealNo', 'seal_no')) || null,
        text(value('customsDeclarationNo', 'customs_declaration_no')) || null,
        numberOrNull(value('freightAmount', 'freight_amount')), numberOrNull(value('insuranceAmount', 'insurance_amount')),
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
         hs_code, origin_country, quantity, unit, net_weight_kg, gross_weight_kg, embedded_co2e_kg
       )
       SELECT $2, sp.shipment_id, p.id,
              ROW_NUMBER() OVER (ORDER BY sp.created_at, sp.id)::integer,
              p.sku, p.name,
              COALESCE(NULLIF(ps.payload->>'hsCode',''), NULLIF(ps.payload->>'hs_code',''), ''),
              COALESCE(NULLIF(ps.payload->>'originCountry',''), NULLIF(ps.payload->>'origin_country',''), s.origin_country),
              sp.quantity, 'pcs', sp.weight_kg, sp.weight_kg, sp.allocated_co2e
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

  async createLine(companyId, shipmentId, input) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const result = await this.database.query(
      `INSERT INTO shipment_export_lines (
        company_id, shipment_id, source_product_id, line_number, sku, goods_description, hs_code,
        origin_country, quantity, unit, unit_price, currency, net_weight_kg, gross_weight_kg,
        embedded_co2e_kg, package_refs, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
       RETURNING *`,
      [companyId, shipmentId, input.sourceProductId || input.source_product_id || null,
        Number(input.lineNumber || input.line_number), text(input.sku), text(input.goodsDescription || input.goods_description),
        normalizeHsCode(input.hsCode || input.hs_code), text(input.originCountry || input.origin_country),
        numberOrNull(input.quantity), text(input.unit) || 'pcs', numberOrNull(input.unitPrice ?? input.unit_price),
        text(input.currency).toUpperCase() || null, numberOrNull(input.netWeightKg || input.net_weight_kg),
        numberOrNull(input.grossWeightKg || input.gross_weight_kg), numberOrNull(input.embeddedCo2eKg || input.embedded_co2e_kg),
        JSON.stringify(Array.isArray(input.packageRefs) ? input.packageRefs : []), JSON.stringify(object(input.metadata))]
    );
    return lineFromRow(result.rows[0]);
  }

  async updateLine(companyId, shipmentId, lineId, input) {
    if (!UUID_REGEX.test(String(lineId || ''))) return null;
    const current = await this.database.query(
      'SELECT * FROM shipment_export_lines WHERE id=$1 AND shipment_id=$2 AND company_id=$3', [lineId, shipmentId, companyId]
    );
    if (!current.rows[0]) return null;
    const merged = { ...lineFromRow(current.rows[0]), ...input };
    const result = await this.database.query(
      `UPDATE shipment_export_lines SET line_number=$1, sku=$2, goods_description=$3, hs_code=$4,
         origin_country=$5, quantity=$6, unit=$7, unit_price=$8, currency=$9, net_weight_kg=$10,
         gross_weight_kg=$11, embedded_co2e_kg=$12, package_refs=$13::jsonb, metadata=$14::jsonb, updated_at=now()
       WHERE id=$15 AND shipment_id=$16 AND company_id=$17 RETURNING *`,
      [merged.lineNumber, text(merged.sku), text(merged.goodsDescription), normalizeHsCode(merged.hsCode),
        text(merged.originCountry), numberOrNull(merged.quantity), text(merged.unit), numberOrNull(merged.unitPrice),
        text(merged.currency).toUpperCase() || null, numberOrNull(merged.netWeightKg), numberOrNull(merged.grossWeightKg),
        numberOrNull(merged.embeddedCo2eKg), JSON.stringify(merged.packageRefs || []), JSON.stringify(merged.metadata || {}),
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

  async createPackage(companyId, shipmentId, input) {
    if (!(await this._assertShipment(companyId, shipmentId))) return null;
    const result = await this.database.query(
      `INSERT INTO shipment_packages (company_id, shipment_id, package_number, package_type,
         marks_and_numbers, quantity, net_weight_kg, gross_weight_kg, length_cm, width_cm, height_cm, contents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *`,
      [companyId, shipmentId, text(input.packageNumber || input.package_number), text(input.packageType || input.package_type),
        text(input.marksAndNumbers || input.marks_and_numbers) || null, Number(input.quantity ?? 1),
        numberOrNull(input.netWeightKg || input.net_weight_kg), numberOrNull(input.grossWeightKg || input.gross_weight_kg),
        numberOrNull(input.lengthCm || input.length_cm), numberOrNull(input.widthCm || input.width_cm),
        numberOrNull(input.heightCm || input.height_cm), JSON.stringify(Array.isArray(input.contents) ? input.contents : [])]
    );
    return packageFromRow(result.rows[0]);
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
         contents=$10::jsonb, updated_at=now() WHERE id=$11 AND shipment_id=$12 AND company_id=$13 RETURNING *`,
      [text(merged.packageNumber), text(merged.packageType), text(merged.marksAndNumbers) || null,
        Number(merged.quantity || 1), numberOrNull(merged.netWeightKg), numberOrNull(merged.grossWeightKg),
        numberOrNull(merged.lengthCm), numberOrNull(merged.widthCm), numberOrNull(merged.heightCm),
        JSON.stringify(merged.contents || []), packageId, shipmentId, companyId]
    );
    return packageFromRow(result.rows[0]);
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
    const carriers = snapshot.carrierDocuments || [];
    const results = [];
    const need = (type, code, value, pathName, label) => results.push(requirement(
      type, code, text(value) ? 'ready' : 'missing', pathName, text(value) ? null : `${label} is required.`
    ));
    const party = (type, key, value) => {
      need(type, `${key}_name`, value?.name, `profile.${key}.name`, `${key} name`);
      need(type, `${key}_address`, value?.address, `profile.${key}.address`, `${key} address`);
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
    need('commercial_invoice', 'currency', profile.currency, 'profile.currency', 'Currency');
    need('commercial_invoice', 'payment_terms', profile.paymentTerms, 'profile.paymentTerms', 'Payment terms');
    need('commercial_invoice', 'exporter_tax_id', profile.exporterTaxId, 'profile.exporterTaxId', 'Exporter tax ID');
    const incoterm = text(profile.incotermCode).toUpperCase();
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
    });
    results.push(requirement('packing_list', 'lines', lines.length ? 'ready' : 'missing', 'lines', lines.length ? null : 'At least one goods line is required.'));
    lines.forEach((line, index) => {
      [['quantity', line.quantity], ['net_weight_kg', line.netWeightKg], ['gross_weight_kg', line.grossWeightKg]].forEach(([key, value]) => {
        const valid = value !== null && value !== undefined && Number(value) > 0;
        results.push(requirement('packing_list', `line_${index + 1}_${key}`, valid ? 'ready' : 'missing', `lines[${index}].${key}`, valid ? null : `${key} is required for packing line ${index + 1}.`));
      });
    });
    results.push(requirement('packing_list', 'packages', packages.length ? 'ready' : 'missing', 'packages', packages.length ? null : 'At least one package is required.'));
    packages.forEach((pkg, index) => {
      [['package_number', pkg.packageNumber], ['package_type', pkg.packageType], ['marks_and_numbers', pkg.marksAndNumbers],
        ['quantity', pkg.quantity], ['net_weight_kg', pkg.netWeightKg], ['gross_weight_kg', pkg.grossWeightKg],
        ['length_cm', pkg.lengthCm], ['width_cm', pkg.widthCm], ['height_cm', pkg.heightCm]].forEach(([key, value]) => {
        const numeric = ['quantity', 'net_weight_kg', 'gross_weight_kg', 'length_cm', 'width_cm', 'height_cm'].includes(key);
        const valid = value !== null && value !== undefined && String(value).trim() !== '' && (!numeric || Number(value) > 0);
        results.push(requirement('packing_list', `package_${index + 1}_${key}`, valid ? 'ready' : 'missing', `packages[${index}].${key}`, valid ? null : `${key} is required for package ${index + 1}.`));
      });
      const contents = Array.isArray(pkg.contents) ? pkg.contents : [];
      const validContents = contents.length > 0 && contents.every((item) => {
        const ref = text(item?.lineId || item?.sku || item?.lineNumber);
        return ref && Number(item?.quantity) > 0;
      });
      results.push(requirement('packing_list', `package_${index + 1}_contents`, validContents ? 'ready' : 'missing', `packages[${index}].contents`, validContents ? null : `Product allocation is required for package ${index + 1}.`));
    });
    const currencyMismatch = lines.some((line) => line.currency && profile.currency && line.currency !== profile.currency);
    results.push(requirement('commercial_invoice', 'currency_reconciliation', currencyMismatch ? 'invalid' : 'ready', 'lines[].currency', currencyMismatch ? 'Line currencies must match the invoice currency.' : null));
    const invalidLineWeight = lines.some((line) => line.netWeightKg !== null && line.grossWeightKg !== null && line.grossWeightKg < line.netWeightKg);
    results.push(requirement('packing_list', 'line_weight_reconciliation', invalidLineWeight ? 'invalid' : 'ready', 'lines[].grossWeightKg', invalidLineWeight ? 'Gross line weight cannot be lower than net weight.' : null));
    const invalidPackageWeight = packages.some((pkg) => pkg.netWeightKg !== null && pkg.grossWeightKg !== null && pkg.grossWeightKg < pkg.netWeightKg);
    results.push(requirement('packing_list', 'package_weight_reconciliation', invalidPackageWeight ? 'invalid' : 'ready', 'packages[].grossWeightKg', invalidPackageWeight ? 'Gross package weight cannot be lower than net weight.' : null));
    if (lines.length && packages.length && lines.every((line) => line.netWeightKg !== null) && packages.every((pkg) => pkg.netWeightKg !== null)) {
      const lineNet = lines.reduce((sum, line) => sum + Number(line.netWeightKg), 0);
      const packageNet = packages.reduce((sum, pkg) => sum + Number(pkg.netWeightKg) * Number(pkg.quantity || 1), 0);
      const matches = Math.abs(lineNet - packageNet) <= Math.max(0.01, lineNet * 0.001);
      results.push(requirement('packing_list', 'net_weight_cross_document', matches ? 'ready' : 'invalid', 'packages[].netWeightKg', matches ? null : `Line net weight (${lineNet}) does not match package net weight (${packageNet}).`));
    }
    if (lines.length && packages.length) {
      const allocations = new Map();
      let unknownReference = false;
      packages.forEach((pkg) => (Array.isArray(pkg.contents) ? pkg.contents : []).forEach((item) => {
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

  async createDocumentJob(companyId, shipmentId, userId, documentType) {
    if (!DOCUMENT_TYPES.has(documentType)) {
      const error = new Error('Unsupported export document type.'); error.code = 'INVALID_DOCUMENT_TYPE'; throw error;
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
      const format = documentType === 'ics2_dataset' ? 'csv' : 'xlsx';
      const reportResult = await client.query(
        `INSERT INTO reports (company_id, report_type, title, target_market, file_format, status, created_by, metadata)
         VALUES ($1, 'export_declaration', $2, 'EU', $3, 'processing', $4, '{}'::jsonb)
         RETURNING id, status`,
        [companyId, `${documentType} - ${snapshot.shipment.referenceNumber || shipmentId} - v${version}`, format, userId]
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
           status, payload, validation_results, payload_sha256, created_by, supersedes_id)
         VALUES ($1,$2,$3,$4,$5,'ready',$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING *`,
        [companyId, shipmentId, reportResult.rows[0].id, documentType, version,
          JSON.stringify(payload), JSON.stringify(documentReadiness), payloadHash, userId,
          versionResult.rows[0].previous_id || null]
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
    if (type === 'ics2_dataset') return lines.map((line) => ({
      shipmentReference: payload.shipment?.referenceNumber || payload.shipment?.id,
      transportDocumentNo: payload.profile?.billOfLadingNo || '',
      containerNo: payload.profile?.containerNo || '',
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
    if (type === 'packing_list') return packages.map((pkg) => ({
      packageNumber: pkg.packageNumber, packageType: pkg.packageType, marks: pkg.marksAndNumbers,
      quantity: pkg.quantity, netWeightKg: pkg.netWeightKg, grossWeightKg: pkg.grossWeightKg,
      dimensions: [pkg.lengthCm, pkg.widthCm, pkg.heightCm].filter((v) => v !== null).join(' x '),
      contents: JSON.stringify(pkg.contents || [])
    }));
    if (type === 'carbon_annex') return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, hsCode: line.hsCode, quantity: line.quantity,
      embeddedCo2eKg: line.embeddedCo2eKg, carrierDocumentNo: payload.profile.billOfLadingNo,
      containerNo: payload.profile.containerNo
    }));
    return lines.map((line) => ({
      lineNumber: line.lineNumber, sku: line.sku, description: line.goodsDescription,
      hsCode: line.hsCode, originCountry: line.originCountry, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, currency: line.currency || payload.profile.currency,
      lineValue: Number(line.quantity || 0) * Number(line.unitPrice || 0),
      netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg
    }));
  }

  async _buildDocumentBuffer(type, payload, issued) {
    const p = payload.profile || {};
    const lines = payload.lines || [];
    const packages = payload.packages || [];
    const goodsTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
    const freight = Number(p.freightAmount || 0);
    const insurance = Number(p.insuranceAmount || 0);
    const metadata = {
      'Shipment reference': payload.shipment?.referenceNumber || payload.shipment?.id,
      'Document version': payload.documentVersion || '', 'Invoice number': p.invoiceNumber || '',
      'PO / Contract': p.poContractId || '', 'Incoterm': `${p.incotermCode || ''} ${p.incotermLocation || ''}`.trim(),
      'Carrier document no.': p.billOfLadingNo || '', 'Container / Seal': `${p.containerNo || ''} / ${p.sealNo || ''}`,
      'Payment terms': p.paymentTerms || '', 'Exporter tax ID': p.exporterTaxId || '',
      'Goods total': goodsTotal, 'Freight': freight, 'Insurance': insurance,
      'Invoice total': goodsTotal + freight + insurance,
      'Total packages': packages.reduce((sum, pkg) => sum + Number(pkg.quantity || 0), 0),
      'Total net kg': packages.reduce((sum, pkg) => sum + Number(pkg.netWeightKg || 0) * Number(pkg.quantity || 1), 0),
      'Total gross kg': packages.reduce((sum, pkg) => sum + Number(pkg.grossWeightKg || 0) * Number(pkg.quantity || 1), 0),
      'Ruleset': RULESET_VERSION, 'Issued status': issued ? 'ISSUED' : 'READY FOR INTERNAL REVIEW'
    };
    const rows = this._documentRows(type, payload);
    if (type === 'ics2_dataset') {
      const headers = Object.keys(rows[0] || { shipmentReference: '' });
      const actualRows = rows.length ? rows : [{ shipmentReference: payload.shipment?.referenceNumber || payload.shipment?.id }];
      return Buffer.from(`sep=,\r\n${headers.join(',')}\r\n${actualRows.map((row) => headers.map((key) => csvEscape(row[key])).join(',')).join('\r\n')}\r\n`, 'utf8');
    }
    const columnsByType = {
      commercial_invoice: [
        ['lineNumber','Line'],['sku','SKU'],['description','Description'],['hsCode','HS/CN'],['originCountry','Origin'],
        ['quantity','Quantity'],['unit','Unit'],['unitPrice','Unit price'],['currency','Currency'],['lineValue','Line value']
      ],
      packing_list: [
        ['packageNumber','Package'],['packageType','Type'],['marks','Marks'],['quantity','Packages'],
        ['netWeightKg','Net kg'],['grossWeightKg','Gross kg'],['dimensions','L x W x H cm'],['contents','Contents']
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
      watermark: issued ? `ISSUED ${new Date().toISOString()}` : 'READY FOR INTERNAL REVIEW - NOT ISSUED'
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
    const buffer = await this._buildDocumentBuffer(document.document_type, payload, false);
    const ext = document.document_type === 'ics2_dataset' ? 'csv' : 'xlsx';
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
    const mime = ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
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

  async issueDocument(companyId, shipmentId, documentId, userId) {
    if (!UUID_REGEX.test(String(documentId || ''))) return null;
    const result = await this.database.query(
      `SELECT ed.*, r.status AS report_status FROM export_documents ed JOIN reports r ON r.id=ed.report_id
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
    const payload = { ...document.payload, documentVersion: document.version };
    const buffer = await this._buildDocumentBuffer(document.document_type, payload, true);
    const ext = document.document_type === 'ics2_dataset' ? 'csv' : 'xlsx';
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
           original_filename=$3, file_size_bytes=$4, file_sha256=$5, updated_at=now()
         WHERE id=$6 AND company_id=$7 AND shipment_id=$8 RETURNING *`, [userId, storageKey, filename, buffer.length, digest, documentId, companyId, shipmentId]
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
    return {
      id: row.id, shipmentId: row.shipment_id, reportId: row.report_id,
      type: row.document_type, version: Number(row.version), status: row.status,
      reportStatus: row.report_status || null, validationResults: row.validation_results || {},
      payloadSha256: row.payload_sha256, fileSha256: row.file_sha256,
      filename: row.original_filename, fileSizeBytes: Number(row.file_size_bytes || 0),
      downloadUrl: row.download_url || (row.report_id && row.report_status === 'completed' ? `/api/reports/${row.report_id}/download` : null),
      issuedAt: row.issued_at, createdAt: row.created_at
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
