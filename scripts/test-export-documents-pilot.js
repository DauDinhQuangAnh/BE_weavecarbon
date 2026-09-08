#!/usr/bin/env node

require('dotenv').config();

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const pool = require('../src/config/database');
const { UPLOADS_ROOT } = require('../src/config/runtime');
const { createExportShipmentService } = require('../src/services/exportShipmentService');

const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA';
const LINE_COUNT = 25;
const result = {
  schemaVersion: 'weavecarbon-export-documents-pilot-v1',
  startedAt: new Date().toISOString(),
  status: 'running',
  isolatedDatabaseConfirmed: false,
  productionDataTouched: false,
  checks: [],
  documents: []
};

function check(name, details = {}) {
  result.checks.push({ name, status: 'passed', ...details });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function writeResult() {
  const artifactDir = path.resolve(__dirname, '..', 'artifacts', 'export-pilot');
  await fs.promises.mkdir(artifactDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(artifactDir, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );
  return artifactDir;
}

async function requireIsolationConfirmation() {
  const current = await pool.query('SELECT current_database() AS name');
  const databaseName = current.rows[0].name;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Export document pilot refuses to run with NODE_ENV=production.');
  }
  if (process.env.ALLOW_EXPORT_DOCUMENT_PILOT !== '1') {
    throw new Error('Set ALLOW_EXPORT_DOCUMENT_PILOT=1 to run this synthetic-data pilot.');
  }
  if (process.env.EXPORT_PILOT_CONFIRM_ISOLATED !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set EXPORT_PILOT_CONFIRM_ISOLATED=${REQUIRED_CONFIRMATION} after confirming isolation.`);
  }
  if (!process.env.EXPORT_PILOT_DATABASE || process.env.EXPORT_PILOT_DATABASE !== databaseName) {
    throw new Error('EXPORT_PILOT_DATABASE must exactly match current_database().');
  }
  result.isolatedDatabaseConfirmed = true;
  result.database = { name: databaseName };
  check('explicit_isolation_guard_passed');
}

async function insertFixture(runId) {
  const companyId = crypto.randomUUID();
  const otherCompanyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const shipmentId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO companies (id, name, business_type, target_markets)
       VALUES ($1, $2, 'factory', ARRAY['EU']), ($3, $4, 'factory', ARRAY['EU'])`,
      [companyId, `Synthetic export pilot ${runId}`, otherCompanyId, `Synthetic other tenant ${runId}`]
    );
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'Synthetic export reviewer')`,
      [userId, `export-pilot-${runId}@invalid.example`, 'synthetic-pilot-no-login']
    );
    await client.query(
      `INSERT INTO shipments (
         id, company_id, reference_number, origin_country, origin_city,
         destination_country, destination_city, status, total_weight_kg, simulation_enabled
       ) VALUES ($1,$2,$3,'VN','Ho Chi Minh City','NL','Rotterdam','pending',$4,false)`,
      [shipmentId, companyId, `VN-EU-PILOT-${runId}`, LINE_COUNT * 12]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { companyId, otherCompanyId, userId, shipmentId };
}

async function inspectWorkbook(filePath, requiredValues) {
  const buffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/worksheets/sheet1.xml').async('string');
  requiredValues.forEach((value) => assert.ok(workbook.includes(String(value)), `Workbook is missing ${value}.`));
  assert.ok(workbook.includes('ISSUED'), 'Workbook is not visibly issued.');
  assert.ok(!workbook.includes('DRAFT - NOT FOR CUSTOMS FILING'), 'Issued workbook retained a draft watermark.');
  return { buffer, workbook };
}

async function run() {
  await requireIsolationConfirmation();
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const ids = await insertFixture(runId);
  let service;
  const queue = {
    enqueue: async (job) => service.generateDocumentFile(job.reportId, job.exportDocumentId, job.companyId)
  };
  service = createExportShipmentService({ database: pool, queue, uploadsRoot: UPLOADS_ROOT });

  await service.upsertProfile(ids.companyId, ids.shipmentId, ids.userId, {
    targetMarket: 'EU',
    invoiceNumber: `INV-${runId}`,
    invoiceDate: '2026-09-09',
    invoiceIssuePlace: 'Ho Chi Minh City, Vietnam',
    packingListNumber: `PL-${runId}`,
    packingListDate: '2026-09-09',
    poContractId: `PO-${runId}`,
    incotermCode: 'CIF',
    incotermLocation: 'Port of Rotterdam, Netherlands',
    currency: 'USD',
    paymentTerms: 'T/T 30 days from bill of lading date',
    exporter: { name: 'Synthetic Vietnam Textile Exporter Co., Ltd.', address: 'Ho Chi Minh City', country: 'VN', contact: 'export@invalid.example' },
    importer: { name: 'Synthetic EU Importer B.V.', address: 'Rotterdam', country: 'NL', contact: 'import@invalid.example' },
    consignee: { name: 'Synthetic EU Warehouse B.V.', address: 'Rotterdam', country: 'NL' },
    exporterTaxId: '0312345678',
    importerEori: 'NL123456789012',
    portOfLoading: 'Cat Lai, Vietnam',
    portOfDischarge: 'Rotterdam, Netherlands',
    placeOfDelivery: 'Rotterdam, Netherlands',
    vesselName: 'SYNTHETIC VESSEL',
    voyageNumber: 'PILOT-001',
    billOfLadingNo: `SYNTHETIC-BL-${runId}`,
    containerNo: 'TCLU1234567',
    sealNo: 'SYNTHETIC-SEAL-001',
    freightAmount: 1250,
    insuranceAmount: 125,
    discountAmount: 50,
    surchargeAmount: 75,
    transportMode: 'sea',
    preferentialOriginClaim: false,
    metadata: { fixtureType: 'export_documents_pilot', synthetic: true }
  });

  const lines = [];
  for (let index = 1; index <= LINE_COUNT; index += 1) {
    const hsCode = index % 3 === 0 ? '64041900' : (index % 2 === 0 ? '62052000' : '61091000');
    lines.push(await service.createLine(ids.companyId, ids.shipmentId, {
      lineNumber: index,
      sku: `PILOT-SKU-${String(index).padStart(3, '0')}`,
      goodsDescription: index % 3 === 0 ? 'Synthetic footwear sample' : 'Synthetic apparel sample',
      hsCode,
      originCountry: 'VN',
      quantity: 11,
      unit: 'pcs',
      unitPrice: 10 + index,
      currency: 'USD',
      netWeightKg: 11,
      grossWeightKg: 12,
      embeddedCo2eKg: 20 + index,
      styleCode: `STYLE-${index}`,
      sizeLabel: index % 2 === 0 ? 'M' : 'L',
      colorLabel: index % 2 === 0 ? 'Blue' : 'Natural',
      lotNumber: `LOT-${runId}`,
      hsCodeConfirmed: true,
      metadata: { synthetic: true }
    }, ids.userId));
  }
  assert.equal(lines.length, LINE_COUNT);

  let packageSequence = 0;
  for (const line of lines) {
    const allocations = [
      { suffix: 'FULL', quantity: 10, net: 10, gross: 10.9 },
      { suffix: 'PARTIAL', quantity: 1, net: 1, gross: 1.1 }
    ];
    for (const allocation of allocations) {
      packageSequence += 1;
      await service.createPackage(ids.companyId, ids.shipmentId, {
        packageNumber: `CTN-${String(packageSequence).padStart(3, '0')}`,
        packageType: 'carton',
        marksAndNumbers: `TCLU1234567 / ${allocation.suffix}`,
        quantity: 1,
        netWeightKg: allocation.net,
        grossWeightKg: allocation.gross,
        lengthCm: allocation.suffix === 'FULL' ? 60 : 40,
        widthCm: 40,
        heightCm: allocation.suffix === 'FULL' ? 40 : 20,
        contents: [{ lineId: line.id, lineNumber: line.lineNumber, sku: line.sku, quantity: allocation.quantity }]
      });
    }
  }
  check('real_like_fixture_created', { lineCount: LINE_COUNT, packageCount: packageSequence, partialCartonCount: LINE_COUNT });

  const readiness = await service.getReadiness(ids.companyId, ids.shipmentId);
  const invoiceReadiness = readiness.documents.find((item) => item.type === 'commercial_invoice');
  const packingReadiness = readiness.documents.find((item) => item.type === 'packing_list');
  assert.equal(invoiceReadiness.status, 'ready');
  assert.equal(packingReadiness.status, 'ready');
  assert.equal(readiness.cbam.status, 'CBAM_NOT_APPLICABLE');
  assert.ok(readiness.requirements.some((item) => item.code === `line_${LINE_COUNT}_hs_code`));
  assert.ok(readiness.requirements.every((item) => !['commercial_invoice', 'packing_list'].includes(item.documentType)
    || ['ready', 'not_applicable'].includes(item.status)));
  check('readiness_and_reconciliation_passed', {
    invoiceStatus: invoiceReadiness.status,
    packingListStatus: packingReadiness.status,
    cbamStatus: readiness.cbam.status
  });

  const artifactDir = await writeResult();
  const issued = {};
  for (const type of ['commercial_invoice', 'packing_list']) {
    const draft = await service.createDocumentJob(ids.companyId, ids.shipmentId, ids.userId, type);
    assert.ok(!draft.blocked, `${type} generation was blocked.`);
    const issuedDocument = await service.issueDocument(ids.companyId, ids.shipmentId, draft.id, ids.userId);
    assert.equal(issuedDocument.status, 'issued');
    const stored = await pool.query(
      `SELECT ed.*, r.status AS report_status, r.file_format
       FROM export_documents ed JOIN reports r ON r.id=ed.report_id
       WHERE ed.id=$1 AND ed.company_id=$2`,
      [draft.id, ids.companyId]
    );
    const row = stored.rows[0];
    const filePath = path.resolve(UPLOADS_ROOT, row.storage_key);
    const required = type === 'commercial_invoice'
      ? ['PILOT-SKU-025', 'Invoice total', `INV-${runId}`]
      : ['CTN-050', 'Total CBM', `PL-${runId}`, 'PARTIAL'];
    const { buffer } = await inspectWorkbook(filePath, required);
    assert.equal(row.file_sha256, sha256(buffer));
    assert.equal(Number(row.file_size_bytes), buffer.length);
    assert.equal(row.mime_type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(row.report_status, 'completed');
    const artifactName = `${type}_${ids.shipmentId}_issued.xlsx`;
    await fs.promises.copyFile(filePath, path.join(artifactDir, artifactName));
    issued[type] = { id: row.id, filePath, artifactName, sha256: row.file_sha256, fileSizeBytes: buffer.length };
    result.documents.push({ type, id: row.id, version: Number(row.version), artifactName, sha256: row.file_sha256, fileSizeBytes: buffer.length });
  }
  check('issued_files_verified', { documentCount: result.documents.length });

  const crossTenant = await service.getProfile(ids.otherCompanyId, ids.shipmentId);
  assert.equal(crossTenant, null);
  check('cross_tenant_read_denied');

  await assert.rejects(
    pool.query(`UPDATE export_documents SET payload='{}'::jsonb WHERE id=$1`, [issued.commercial_invoice.id]),
    /immutable/i
  );
  check('issued_document_mutation_blocked');

  const staleDraft = await service.createDocumentJob(ids.companyId, ids.shipmentId, ids.userId, 'commercial_invoice');
  const lastLine = lines[lines.length - 1];
  await service.updateLine(ids.companyId, ids.shipmentId, lastLine.id, { unitPrice: 999 }, ids.userId);
  const staleIssue = await service.issueDocument(ids.companyId, ids.shipmentId, staleDraft.id, ids.userId);
  assert.equal(staleIssue.blocked, true);
  assert.equal(staleIssue.code, 'DOCUMENT_SNAPSHOT_STALE');
  const firstInvoice = await pool.query('SELECT status FROM export_documents WHERE id=$1', [issued.commercial_invoice.id]);
  assert.equal(firstInvoice.rows[0].status, 'issued');
  check('stale_snapshot_issue_blocked_without_superseding_current_issue');

  result.status = 'passed';
  result.fixture = { ...ids, runId, lineCount: LINE_COUNT, packageCount: packageSequence };
  result.finishedAt = new Date().toISOString();
  await writeResult();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run()
  .catch(async (error) => {
    result.status = 'failed';
    result.error = error.message;
    result.finishedAt = new Date().toISOString();
    await writeResult().catch(() => {});
    console.error('[export-documents-pilot] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end().catch(() => {}));
