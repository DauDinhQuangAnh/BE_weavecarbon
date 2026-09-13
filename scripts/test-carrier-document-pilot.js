#!/usr/bin/env node

require('dotenv').config();

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const pool = require('../src/config/database');
const { UPLOADS_ROOT } = require('../src/config/runtime');
const { calculateCarbonFootprint } = require('../src/modules/carbon/core');
const { insertFinalizedProductSnapshot } = require('../src/modules/carbon/calculationSnapshot');
const { createExportShipmentService } = require('../src/services/exportShipmentService');
const { CorporateGhgInventoryService } = require('../src/services/corporateGhgInventoryService');
const { EuTextileEprService } = require('../src/services/euTextileEprService');

const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA';
const result = {
  schemaVersion: 'weavecarbon-carrier-vn-customs-eu-import-ics2-origin-compliance-claims-textile-gpsr-reach-pcf-corporate-ghg-epr-pilot-v13',
  startedAt: new Date().toISOString(),
  status: 'running',
  isolatedDatabaseConfirmed: false,
  productionDataTouched: false,
  checks: [],
  documents: [],
  customsEvents: [],
  euImportEvents: [],
  ics2Events: [],
  environmentalClaims: [],
  textileFibreLabels: [],
  gpsrTechnicalFiles: [],
  gpsrPostMarketEvents: [],
  reachSvhcDossiers: [],
  reachObligationEvents: [],
  pcfStudies: [],
  corporateGhgInventories: [],
  euTextileEprAssessments: []
};

function check(name, details = {}) {
  result.checks.push({ name, status: 'passed', ...details });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function writeResult() {
  const contents = `${JSON.stringify(result, null, 2)}\n`;
  for (const name of [
    'carrier-document-pilot', 'vn-customs-handoff-pilot', 'eu-import-handoff-pilot',
    'ics2-handoff-pilot', 'origin-handoff-pilot', 'compliance-applicability-pilot',
    'environmental-claim-pilot', 'textile-fibre-label-pilot', 'gpsr-technical-file-pilot', 'reach-svhc-dossier-pilot',
    'pcf-study-pilot', 'corporate-ghg-inventory-pilot', 'eu-textile-epr-pilot'
  ]) {
    const directory = path.resolve(__dirname, '..', 'artifacts', name);
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(path.join(directory, 'result.json'), contents, 'utf8');
  }
}

async function requireIsolationConfirmation() {
  const current = await pool.query('SELECT current_database() AS name');
  const databaseName = current.rows[0].name;
  if (process.env.NODE_ENV === 'production') throw new Error('Carrier document pilot refuses NODE_ENV=production.');
  if (process.env.ALLOW_CARRIER_DOCUMENT_PILOT !== '1') {
    throw new Error('Set ALLOW_CARRIER_DOCUMENT_PILOT=1 to run this synthetic-data pilot.');
  }
  if (process.env.CARRIER_PILOT_CONFIRM_ISOLATED !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set CARRIER_PILOT_CONFIRM_ISOLATED=${REQUIRED_CONFIRMATION} after confirming isolation.`);
  }
  if (!process.env.CARRIER_PILOT_DATABASE || process.env.CARRIER_PILOT_DATABASE !== databaseName) {
    throw new Error('CARRIER_PILOT_DATABASE must exactly match current_database().');
  }
  result.isolatedDatabaseConfirmed = true;
  result.database = { name: databaseName };
  check('explicit_isolation_guard_passed');
}

async function insertFixture(runId) {
  const ids = {
    companyId: crypto.randomUUID(),
    otherCompanyId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    productId: crypto.randomUUID(),
    shipmentId: crypto.randomUUID()
  };
  const carbonInput = require('../tests/fixtures/carbon/v1/inputs.json').cases[0].input;
  const carbonResult = calculateCarbonFootprint(carbonInput);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO companies (id, name, business_type, target_markets)
       VALUES ($1,$2,'factory',ARRAY['EU']),($3,$4,'factory',ARRAY['EU'])`,
      [ids.companyId, `Carrier pilot ${runId}`, ids.otherCompanyId, `Other carrier tenant ${runId}`]
    );
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, email_verified)
       VALUES ($1,$2,'synthetic-pilot-no-login','Carrier Metadata Reviewer',true)`,
      [ids.userId, `carrier-reviewer-${runId}@invalid.example`]
    );
    await client.query(
      `INSERT INTO products (id, company_id, sku, name, description, category, weight_kg, status)
       VALUES ($1,$2,$3,'Synthetic cotton shirt','Non-production R03 fixture','textile',0.5,'active')`,
      [ids.productId, ids.companyId, `R03-SKU-${runId}`]
    );
    const snapshot = await insertFinalizedProductSnapshot(client, {
      productId: ids.productId,
      companyId: ids.companyId,
      assessmentPayload: {
        synthetic: true,
        fixtureType: 'carrier_document_pilot',
        hsCode: '62052000',
        originCountry: 'VN',
        styleCode: 'R03-STYLE',
        sizeLabel: 'M',
        colorLabel: 'Natural',
        lotNumber: `LOT-${runId}`
      },
      input: carbonInput,
      result: carbonResult,
      calculatedAt: new Date('2026-09-10T00:00:00.000Z')
    });
    ids.calculationSnapshotId = snapshot.row.snapshot_id;
    await client.query(
      `INSERT INTO shipments (id, company_id, reference_number, origin_country, origin_city,
         destination_country, destination_city, status, total_weight_kg, simulation_enabled)
       VALUES ($1,$2,$3,'VN','Ho Chi Minh City','NL','Rotterdam','pending',55,false)`,
      [ids.shipmentId, ids.companyId, `R03-${runId}`]
    );
    await client.query(
      `INSERT INTO shipment_products (shipment_id, product_id, quantity, weight_kg, allocated_co2e)
       VALUES ($1,$2,100,50,$3)`,
      [ids.shipmentId, ids.productId, carbonResult.reportedTotalKgCO2e * 100]
    );
    await client.query('COMMIT');
    check('authoritative_carbon_fixture_created', {
      calculationSnapshotId: snapshot.row.snapshot_id,
      methodologyVersion: snapshot.row.snapshot_methodology_version,
      factorCount: carbonResult.factorSourceSummary.length
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ...ids, carbonResult };
}

async function insertCarrierEvidence(ids, runId, suffix) {
  const evidenceId = crypto.randomUUID();
  const original = Buffer.from(`%PDF-1.7\nSynthetic carrier-issued B/L ${runId} ${suffix}\n%%EOF\n`);
  const storageKey = `evidence/${ids.companyId}/${ids.shipmentId}/carrier-${suffix}.pdf`;
  const filePath = path.resolve(UPLOADS_ROOT, storageKey);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, original);
  await pool.query(
    `INSERT INTO evidence_documents (
       id, company_id, shipment_id, evidence_type, document_name, source_vendor,
       storage_provider, storage_key, original_filename, mime_type, file_size_bytes,
       checksum_sha256, extracted_json, status, uploaded_by
     ) VALUES ($1,$2,$3,'carrier_bill_of_lading',$4,'Synthetic Ocean Carrier',
       'local',$5,$4,'application/pdf',$6,$7,$8::jsonb,'uploaded',$9)`,
    [evidenceId, ids.companyId, ids.shipmentId, `carrier-${suffix}.pdf`, storageKey,
      original.length, sha256(original), JSON.stringify({ synthetic: true, runId }), ids.userId]
  );
  return { evidenceId, original, filePath };
}

async function insertCustomsEvidence(ids, runId, type, suffix) {
  const evidenceId = crypto.randomUUID();
  const original = Buffer.from(JSON.stringify({ synthetic: true, runId, type, reference: `EXT-${runId}-${suffix}` }, null, 2));
  const storageKey = `evidence/${ids.companyId}/${ids.shipmentId}/customs-${suffix}.json`;
  const filePath = path.resolve(UPLOADS_ROOT, storageKey);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, original);
  await pool.query(
    `INSERT INTO evidence_documents (
       id, company_id, shipment_id, evidence_type, document_name, source_vendor,
       storage_provider, storage_key, original_filename, mime_type, file_size_bytes,
       checksum_sha256, extracted_json, status, uploaded_by, approved_by, locked_at
     ) VALUES ($1,$2,$3,$4,$5,'Synthetic customs authority',
       'local',$6,$5,'application/json',$7,$8,$9::jsonb,'locked',$10,$10,now())`,
    [evidenceId, ids.companyId, ids.shipmentId, type, `customs-${suffix}.json`, storageKey,
      original.length, sha256(original), JSON.stringify({ synthetic: true, runId }), ids.userId]
  );
  return { evidenceId, original, filePath };
}

async function insertOriginEvidence(ids, runId) {
  const evidenceId = crypto.randomUUID();
  const original = Buffer.from(JSON.stringify({
    synthetic: true, runId, supplier: 'Synthetic Yarn Supplier',
    materialReference: `YARN-${runId}`, declaredStatus: 'non_originating',
    warning: 'Synthetic test evidence; not a supplier declaration or proof of origin.'
  }, null, 2));
  const storageKey = `evidence/${ids.companyId}/${ids.shipmentId}/origin-support.json`;
  const filePath = path.resolve(UPLOADS_ROOT, storageKey);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, original);
  await pool.query(
    `INSERT INTO evidence_documents (
       id, company_id, shipment_id, evidence_type, document_name, source_vendor,
       storage_provider, storage_key, original_filename, mime_type, file_size_bytes,
       checksum_sha256, extracted_json, status, uploaded_by, approved_by, locked_at
     ) VALUES ($1,$2,$3,'origin_support',$4,'Synthetic Yarn Supplier',
       'local',$5,$4,'application/json',$6,$7,$8::jsonb,'locked',$9,$9,now())`,
    [evidenceId, ids.companyId, ids.shipmentId, 'origin-support.json', storageKey,
      original.length, sha256(original), JSON.stringify({ synthetic: true, runId }), ids.userId]
  );
  return { evidenceId, original, filePath };
}

async function insertEprAuthorityEvidence(ids, runId) {
  const evidenceId = crypto.randomUUID();
  const original = Buffer.from(JSON.stringify({ synthetic: true, runId, type: 'epr_authority_response',
    registrationNumber: `SYNTHETIC-NL-EPR-${runId}`,
    warning: 'Synthetic isolated receipt; not a real authority registration.' }, null, 2));
  const storageKey = `evidence/${ids.companyId}/${ids.shipmentId}/epr-authority-response.json`;
  const filePath = path.resolve(UPLOADS_ROOT, storageKey);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, original);
  await pool.query(
    `INSERT INTO evidence_documents (
       id, company_id, shipment_id, evidence_type, document_name, source_vendor,
       storage_provider, storage_key, original_filename, mime_type, file_size_bytes,
       checksum_sha256, extracted_json, status, uploaded_by, approved_by, locked_at
     ) VALUES ($1,$2,$3,'epr_authority_response','epr-authority-response.json','Synthetic EPR Authority',
       'local',$4,'epr-authority-response.json','application/json',$5,$6,$7::jsonb,'locked',$8,$8,now())`,
    [evidenceId, ids.companyId, ids.shipmentId, storageKey, original.length, sha256(original),
      JSON.stringify({ synthetic: true, runId }), ids.userId]
  );
  return { evidenceId, original, filePath };
}

function carrierMetadata(ids, runId, evidenceDocumentId, sealNumber, supersedesId = null) {
  return {
    evidenceDocumentId,
    documentType: 'bill_of_lading',
    contractLevel: 'direct',
    transportMode: 'sea',
    documentNumber: `BL-${runId}`,
    issuerName: 'Synthetic Ocean Carrier',
    issuerIdentifier: 'SCAC-SYNX',
    issueDate: '2026-09-10',
    issuePlace: 'Ho Chi Minh City, Vietnam',
    onBoardDate: '2026-09-10',
    shipper: { name: 'Synthetic Vietnam Exporter', address: 'Ho Chi Minh City', country: 'VN' },
    consignee: { name: 'Synthetic EU Consignee', address: 'Rotterdam', country: 'NL' },
    notifyParty: { name: 'Synthetic EU Importer' },
    vesselName: 'MV SYNTHETIC GREEN',
    voyageNumber: 'R03-001',
    placeOfReceipt: 'Ho Chi Minh City, Vietnam',
    placeOfLoading: 'Cat Lai, Vietnam',
    placeOfDischarge: 'Rotterdam, Netherlands',
    placeOfDelivery: 'Rotterdam, Netherlands',
    goodsDescription: '100 synthetic cotton shirts',
    packageCount: 1,
    packageType: 'carton',
    marksAndNumbers: `PO-${runId}`,
    grossWeightKg: 55,
    measurementCbm: 0.144,
    containerNumbers: ['TCLU1234567'],
    sealNumbers: [sealNumber],
    freightTerms: 'prepaid',
    paymentTerms: 'Freight prepaid',
    authenticationMethod: 'Carrier digital signature',
    authenticationReference: `SIG-${runId}-${sealNumber}`,
    authenticityStatus: 'operator_confirmed',
    originalStatus: 'electronic',
    negotiable: false,
    metadataSource: 'manual',
    metadata: { synthetic: true, manuallyComparedToCarrierPdf: true },
    supersedesId
  };
}

async function inspectCarbonAnnex(filePath, expected) {
  const buffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const worksheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  expected.forEach((value) => assert.ok(worksheet.includes(value), `Carbon Annex is missing ${value}.`));
  return { buffer, worksheet };
}

async function run() {
  await requireIsolationConfirmation();
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const ids = await insertFixture(runId);
  let service;
  const queue = { enqueue: async (job) => service.generateDocumentFile(job.reportId, job.exportDocumentId, job.companyId) };
  service = createExportShipmentService({ database: pool, uploadsRoot: UPLOADS_ROOT, queue });

  await service.upsertProfile(ids.companyId, ids.shipmentId, ids.userId, {
    targetMarket: 'EU',
    invoiceNumber: `INV-${runId}`,
    invoiceDate: '2026-09-10',
    invoiceIssuePlace: 'Ho Chi Minh City, Vietnam',
    packingListNumber: `PL-${runId}`,
    packingListDate: '2026-09-10',
    poContractId: `PO-${runId}`,
    incotermCode: 'FOB',
    incotermLocation: 'Cat Lai, Vietnam',
    currency: 'USD',
    paymentTerms: 'T/T 30 days',
    exporter: { name: 'Synthetic Vietnam Exporter', address: 'Ho Chi Minh City', country: 'VN', contact: 'export@invalid.example' },
    importer: { name: 'Synthetic EU Importer', address: 'Rotterdam', country: 'NL', contact: 'import@invalid.example' },
    consignee: { name: 'Synthetic EU Consignee', address: 'Rotterdam', country: 'NL' },
    notifyParty: { name: 'Synthetic EU Importer', address: 'Rotterdam', country: 'NL' },
    exporterTaxId: '0312345678',
    importerEori: 'NL123456789012',
    portOfLoading: 'Cat Lai, Vietnam',
    portOfDischarge: 'Rotterdam, Netherlands',
    placeOfDelivery: 'Rotterdam, Netherlands',
    vesselName: 'MV SYNTHETIC GREEN',
    voyageNumber: 'R03-001',
    carrierName: 'Synthetic Ocean Carrier',
    billOfLadingNo: `BL-${runId}`,
    containerNo: 'TCLU1234567',
    sealNo: 'SEAL-ORIGINAL',
    customsValueAmount: 500,
    customsValueBasis: 'Invoice transaction value; synthetic pilot only',
    transportMode: 'sea',
    preferentialOriginClaim: true,
    metadata: { synthetic: true, fixtureType: 'carrier_document_pilot' }
  });

  const lines = await service.syncLinesFromShipment(ids.companyId, ids.shipmentId);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].carbonAuthority.authoritative, true);
  assert.ok(lines[0].carbonAuthority.factorSnapshot.length > 0);
  check('shipment_line_synchronized_with_carbon_provenance', {
    snapshotId: lines[0].carbonAuthority.snapshotId,
    canonicalInputHash: lines[0].carbonAuthority.canonicalInputHash
  });
  await service.updateLine(ids.companyId, ids.shipmentId, lines[0].id, {
    goodsDescription: 'Synthetic cotton shirt for controlled R04 pilot',
    hsCode: '62052000', originCountry: 'VN', quantity: 100, unit: 'PCE', unitPrice: 5,
    currency: 'USD', netWeightKg: 50, grossWeightKg: 55,
    hsCodeSource: 'Synthetic AHTN fixture', hsCodeRuleset: 'AHTN-2022-PILOT',
    hsCodeEffectiveDate: '2026-01-01', hsCodeConfirmed: true
  }, ids.userId);
  // Changing the code or its classification provenance deliberately clears any
  // prior approval. Confirm the now-stable classification in a separate action,
  // matching the production two-step review control.
  const confirmedLine = await service.updateLine(ids.companyId, ids.shipmentId, lines[0].id, {
    hsCodeConfirmed: true
  }, ids.userId);
  assert.equal(confirmedLine.hsCodeConfirmed, true);
  check('hs_classification_confirmed_after_separate_review_action');

  const container = await service.createContainer(ids.companyId, ids.shipmentId, {
    containerNumber: 'TCLU1234567', sealNumber: 'SEAL-ORIGINAL', equipmentType: '40HC',
    marksAndNumbers: `PO-${runId}`, tareWeightKg: 3800, maxGrossWeightKg: 30480
  });
  const pallet = await service.createPackage(ids.companyId, ids.shipmentId, {
    packageNumber: 'PLT-001', packageType: 'pallet', marksAndNumbers: `PO-${runId}`,
    quantity: 1, netWeightKg: 50, grossWeightKg: 55, lengthCm: 120, widthCm: 100, heightCm: 60,
    weightMeasurementBasis: 'group_total', dimensionMeasurementBasis: 'group_total',
    contents: [], containerId: container.id, sequenceNo: 1
  });
  await service.createPackage(ids.companyId, ids.shipmentId, {
    packageNumber: 'CTN-001', packageType: 'carton', marksAndNumbers: `PO-${runId}`,
    quantity: 1, netWeightKg: 50, grossWeightKg: 55, lengthCm: 60, widthCm: 40, heightCm: 60,
    weightMeasurementBasis: 'per_package', dimensionMeasurementBasis: 'per_package',
    contents: [{ lineId: lines[0].id, lineNumber: 1, sku: lines[0].sku, quantity: 100 }],
    containerId: container.id, parentPackageId: pallet.id, sequenceNo: 2
  });

  const firstEvidence = await insertCarrierEvidence(ids, runId, 'v1');
  const firstDraft = await service.createCarrierDocument(
    ids.companyId, ids.shipmentId, ids.userId,
    carrierMetadata(ids, runId, firstEvidence.evidenceId, 'SEAL-ORIGINAL')
  );
  assert.equal(firstDraft.structured.status, 'draft');
  const firstReconciliation = await service.reconcileCarrierDocument(ids.companyId, ids.shipmentId, firstDraft.structured.id);
  assert.equal(firstReconciliation.status, 'passed');
  check('draft_metadata_reconciles_all_carrier_totals', { checkCount: firstReconciliation.checks.length });

  await fs.promises.appendFile(firstEvidence.filePath, 'tampered');
  const tampered = await service.confirmCarrierDocument(ids.companyId, ids.shipmentId, firstDraft.structured.id, ids.userId, {
    metadataConfirmed: true,
    confirmationNote: 'Synthetic reviewer compared every required field with carrier PDF.'
  });
  assert.equal(tampered.error, 'CARRIER_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(firstEvidence.filePath, firstEvidence.original);
  check('tampered_carrier_bytes_block_confirmation');

  const firstConfirmed = await service.confirmCarrierDocument(ids.companyId, ids.shipmentId, firstDraft.structured.id, ids.userId, {
    metadataConfirmed: true,
    confirmationNote: 'Synthetic reviewer compared every required field with carrier PDF.'
  });
  assert.equal(firstConfirmed.structured.status, 'confirmed');
  assert.equal(firstConfirmed.latestReconciliation.status, 'passed');
  assert.equal((await pool.query('SELECT status FROM evidence_documents WHERE id=$1', [firstEvidence.evidenceId])).rows[0].status, 'locked');
  assert.equal(await service.getCarrierDocument(ids.otherCompanyId, ids.shipmentId, firstDraft.structured.id), null);
  assert.equal(await service.deleteCarrierDocument(ids.companyId, ids.shipmentId, firstDraft.structured.id), false);
  await assert.rejects(
    pool.query('UPDATE shipment_carrier_documents SET issuer_name=$1 WHERE id=$2', ['Mutated issuer', firstDraft.structured.id]),
    /immutable/i
  );
  check('confirmed_metadata_is_immutable_and_tenant_isolated');

  const issuedSupport = {};
  for (const [type, reviewerRole] of [
    ['commercial_invoice', 'export_operator'],
    ['packing_list', 'warehouse_reviewer']
  ]) {
    const draft = await service.createDocumentJob(ids.companyId, ids.shipmentId, ids.userId, type, { outputFormat: 'xlsx' });
    const blockers = draft.readiness?.documents?.find((item) => item.type === type)?.requirements
      ?.filter((item) => item.status !== 'ready')
      ?.map((item) => `${item.code}:${item.status}`) || [];
    assert.ok(!draft.blocked, `${type} support document generation was blocked: ${blockers.join(', ') || draft.code || 'unknown'}.`);
    const review = await service.reviewDocument(ids.companyId, ids.shipmentId, draft.id, ids.userId, {
      reviewerRole,
      decision: 'approved',
      notes: 'Synthetic R04 dependency review; not a real trade approval.'
    });
    assert.equal(review.decision, 'approved');
    const issued = await service.issueDocument(ids.companyId, ids.shipmentId, draft.id, ids.userId);
    assert.equal(issued.status, 'issued');
    issuedSupport[type] = issued;
    result.documents.push({ type, id: issued.id, version: issued.version, status: issued.status, sha256: issued.fileSha256 });
  }
  check('current_issued_invoice_and_packing_list_pinned_for_r04');

  await service.upsertVnCustomsProfile(ids.companyId, ids.shipmentId, ids.userId, {
    declarant: {
      name: 'Synthetic Vietnam Exporter', taxId: '0312345678', address: 'Ho Chi Minh City',
      country: 'VN', role: 'exporter'
    },
    customsBroker: { name: 'Synthetic Customs Broker', taxId: '0300000001', code: 'SYNBROKER' },
    customsOfficeCode: '02CI', declarationTypeCode: 'B11', cargoClassificationCode: 'A',
    transportMethodCode: '1', exitCustomsOfficeCode: '02CI', loadingLocationCode: 'VNSGN',
    destinationCountryCode: 'NL', invoiceClassificationCode: 'A', invoicePaymentMethodCode: 'TTR',
    exchangeRate: 25000, permitRequirementStatus: 'not_required', permitReferences: [],
    inspectionRequirementStatus: 'not_required', inspectionReferences: [],
    taxTreatment: 'not_subject', taxBasis: 'Synthetic apparel fixture; human confirmation still required',
    supportingDocuments: [
      { type: 'commercial_invoice', documentId: issuedSupport.commercial_invoice.id },
      { type: 'packing_list', documentId: issuedSupport.packing_list.id }
    ],
    brokerTargetSchemaId: 'synthetic-broker.vnaccs-import', brokerTargetSchemaVersion: '2026.1',
    declarationNotes: 'Synthetic isolated technical pilot; never submit to an authority.'
  });
  const customsReconciliation = await service.reconcileVnCustomsHandoff(ids.companyId, ids.shipmentId);
  assert.equal(customsReconciliation.status, 'passed');
  assert.ok(customsReconciliation.checks.some((item) => item.code === 'commercial_invoice_issued_current' && item.status === 'ready'));
  assert.ok(customsReconciliation.checks.some((item) => item.code === 'packing_list_issued_current' && item.status === 'ready'));
  check('r04_reconciles_current_r01_r02_r03', { checkCount: customsReconciliation.checks.length });

  const customsDraft = await service.createDocumentJob(
    ids.companyId, ids.shipmentId, ids.userId, 'vn_customs_handoff', { outputFormat: 'json' }
  );
  assert.ok(!customsDraft.blocked, 'R04 JSON generation was blocked.');
  const customsRow = (await pool.query('SELECT * FROM export_documents WHERE id=$1', [customsDraft.id])).rows[0];
  const customsBytes = await fs.promises.readFile(path.resolve(UPLOADS_ROOT, customsRow.storage_key));
  assert.equal(sha256(customsBytes), customsRow.file_sha256);
  const customsDataset = JSON.parse(customsBytes.toString('utf8'));
  assert.equal(customsDataset.authorityStatus, 'NOT_SUBMITTED');
  assert.equal(customsDataset.notForDirectSubmission, true);
  assert.match(customsDataset.warning, /not a VNACCS message/i);
  assert.equal(customsDataset.goods.length, 1);
  assert.deepEqual(
    customsDataset.supportingDocuments.controlledIssuedDocuments.map((item) => item.type).sort(),
    ['commercial_invoice', 'packing_list']
  );
  const unreviewedCustomsIssue = await service.issueDocument(ids.companyId, ids.shipmentId, customsDraft.id, ids.userId);
  assert.equal(unreviewedCustomsIssue.code, 'DOCUMENT_REVIEW_REQUIRED');
  const customsReview = await service.reviewDocument(ids.companyId, ids.shipmentId, customsDraft.id, ids.userId, {
    reviewerRole: 'customs_declaration_reviewer', decision: 'approved',
    notes: 'Synthetic broker-handoff mapping review; no authority submission.'
  });
  assert.equal(customsReview.decision, 'approved');
  const issuedCustoms = await service.issueDocument(ids.companyId, ids.shipmentId, customsDraft.id, ids.userId);
  assert.equal(issuedCustoms.status, 'issued');
  result.documents.push({ type: 'vn_customs_handoff', id: issuedCustoms.id, version: issuedCustoms.version, status: issuedCustoms.status, sha256: issuedCustoms.fileSha256 });
  check('r04_json_reviewed_and_issued_without_authority_claim');

  const wrongEvidence = await service.recordVnCustomsEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedCustoms.id, eventType: 'authority_accepted',
    externalReference: `AUTH-${runId}-WRONG`, evidenceDocumentId: firstEvidence.evidenceId,
    actorName: 'Synthetic customs authority', occurredAt: '2026-09-10T02:00:00.000Z'
  });
  assert.equal(wrongEvidence.error, 'VN_CUSTOMS_EVENT_EVIDENCE_TYPE_MISMATCH');
  check('authority_claim_blocked_for_wrong_evidence_type');

  const authorityEvidence = await insertCustomsEvidence(ids, runId, 'customs_authority_response', 'accepted');
  await fs.promises.appendFile(authorityEvidence.filePath, 'tampered');
  const tamperedEvent = await service.recordVnCustomsEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedCustoms.id, eventType: 'authority_accepted',
    externalReference: `AUTH-${runId}`, evidenceDocumentId: authorityEvidence.evidenceId,
    actorName: 'Synthetic customs authority', occurredAt: '2026-09-10T02:00:00.000Z'
  });
  assert.equal(tamperedEvent.error, 'VN_CUSTOMS_EVENT_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(authorityEvidence.filePath, authorityEvidence.original);
  const acceptedEvent = await service.recordVnCustomsEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedCustoms.id, eventType: 'authority_accepted',
    externalReference: `AUTH-${runId}`, messageCode: 'ACCEPTED-SYNTHETIC',
    messageText: 'Synthetic isolated acceptance evidence.', evidenceDocumentId: authorityEvidence.evidenceId,
    actorName: 'Synthetic customs authority', actorIdentifier: 'SYNTH-AUTH',
    occurredAt: '2026-09-10T02:00:00.000Z'
  });
  assert.equal(acceptedEvent.sourceType, 'authority');
  assert.equal(acceptedEvent.evidenceSha256, sha256(authorityEvidence.original));
  assert.equal(acceptedEvent.documentFileSha256, issuedCustoms.fileSha256);
  result.customsEvents.push(acceptedEvent);
  await assert.rejects(
    pool.query('UPDATE vn_customs_external_events SET message_text=$1 WHERE id=$2', ['mutated', acceptedEvent.id]),
    /append-only/i
  );
  assert.equal(await service.getVnCustomsEvents(ids.otherCompanyId, ids.shipmentId), null);
  check('authority_event_is_evidence_backed_append_only_and_tenant_isolated');

  await service.upsertEuImportProfile(ids.companyId, ids.shipmentId, ids.userId, {
    memberStateCode: 'NL',
    importer: { name: 'Synthetic EU Importer', address: 'Rotterdam, Netherlands', eori: 'NL123456789012' },
    declarant: { name: 'Synthetic EU Declarant', address: 'Rotterdam, Netherlands', eori: 'NL123456789013' },
    representative: {}, representationType: 'none', customsOfficeCode: 'NL000123',
    declarationDatasetCode: 'H1', additionalDeclarationType: 'A', requestedProcedureCode: '40',
    previousProcedureCode: '00', modeOfTransportAtBorder: '1', inlandModeOfTransport: '3',
    borderTransportIdentity: 'MV SYNTHETIC GREEN', placeOfGoodsCode: 'NLRTM-SYNTH',
    deliveryTermsLocation: 'Cat Lai, Vietnam', valuationMethodCode: '1', exchangeRate: 1,
    customsValueCurrency: 'USD', customsValueAmount: 500,
    dutyTreatment: 'not_subject', vatTreatment: 'not_subject',
    taxBasis: 'Synthetic technical fixture; no legal tariff decision',
    restrictionStatus: 'not_required', restrictionReferences: [],
    preferenceClaimStatus: 'no_claim', preferenceReferences: [],
    guaranteeRequirementStatus: 'not_required', guaranteeReferences: [],
    supportingDocuments: [
      { type: 'commercial_invoice', documentId: issuedSupport.commercial_invoice.id },
      { type: 'packing_list', documentId: issuedSupport.packing_list.id },
      { type: 'carrier_document', documentId: firstDraft.structured.id }
    ],
    targetSystemSchemaId: 'synthetic-nl-declarant.delta-import',
    targetSystemSchemaVersion: '2026.09-pilot',
    declarationNotes: 'Synthetic isolated R05 handoff; never submit to an authority.'
  });
  const firstTaricSave = await service.upsertEuImportLineDetail(
    ids.companyId, ids.shipmentId, lines[0].id, ids.userId,
    {
      taricCode: '6205200010', taricSource: 'Synthetic TARIC fixture', taricVersion: '2026-09-12-pilot',
      taricEffectiveDate: '2026-09-12', taricConfirmed: true, additionalCodes: [],
      nationalAdditionalCodes: [], requestedProcedureCode: '40', previousProcedureCode: '00'
    }
  );
  assert.equal(firstTaricSave.taricConfirmed, false);
  const confirmedTaric = await service.upsertEuImportLineDetail(
    ids.companyId, ids.shipmentId, lines[0].id, ids.userId,
    {
      taricCode: '6205200010', taricSource: 'Synthetic TARIC fixture', taricVersion: '2026-09-12-pilot',
      taricEffectiveDate: '2026-09-12', taricConfirmed: true, additionalCodes: [],
      nationalAdditionalCodes: [], requestedProcedureCode: '40', previousProcedureCode: '00'
    }
  );
  assert.equal(confirmedTaric.taricConfirmed, true);
  assert.equal(confirmedTaric.taricConfirmedBy, ids.userId);
  check('r05_taric_requires_separate_confirmation_action');

  const euImportReconciliation = await service.reconcileEuImportHandoff(ids.companyId, ids.shipmentId);
  assert.equal(euImportReconciliation.status, 'passed');
  assert.ok(euImportReconciliation.checks.some((item) => item.code === 'line_1_taric10' && item.status === 'ready'));
  assert.ok(euImportReconciliation.checks.some((item) => item.code === 'carrier_document_reconciliation' && item.status === 'ready'));
  check('r05_reconciles_current_r01_r02_r03_and_taric', { checkCount: euImportReconciliation.checks.length });

  const euImportDraft = await service.createDocumentJob(
    ids.companyId, ids.shipmentId, ids.userId, 'eu_import_handoff', { outputFormat: 'json' }
  );
  assert.ok(!euImportDraft.blocked, 'R05 JSON generation was blocked.');
  const euImportRow = (await pool.query('SELECT * FROM export_documents WHERE id=$1', [euImportDraft.id])).rows[0];
  const euImportBytes = await fs.promises.readFile(path.resolve(UPLOADS_ROOT, euImportRow.storage_key));
  assert.equal(sha256(euImportBytes), euImportRow.file_sha256);
  const euImportDataset = JSON.parse(euImportBytes.toString('utf8'));
  assert.equal(euImportDataset.authorityStatus, 'NOT_SUBMITTED');
  assert.equal(euImportDataset.notForDirectSubmission, true);
  assert.equal(euImportDataset.eucdmReferenceVersion, '7.0.11');
  assert.match(euImportDataset.warning, /not a SAD.*MRN/i);
  assert.equal(euImportDataset.goods.length, 1);
  assert.equal(euImportDataset.goods[0].taricConfirmed, true);
  const unreviewedEuIssue = await service.issueDocument(ids.companyId, ids.shipmentId, euImportDraft.id, ids.userId);
  assert.equal(unreviewedEuIssue.code, 'DOCUMENT_REVIEW_REQUIRED');
  const euImportReview = await service.reviewDocument(ids.companyId, ids.shipmentId, euImportDraft.id, ids.userId, {
    reviewerRole: 'eu_import_declaration_reviewer', decision: 'approved',
    notes: 'Synthetic EU declarant-handoff mapping review; no authority submission.'
  });
  assert.equal(euImportReview.decision, 'approved');
  const issuedEuImport = await service.issueDocument(ids.companyId, ids.shipmentId, euImportDraft.id, ids.userId);
  assert.equal(issuedEuImport.status, 'issued');
  result.documents.push({ type: 'eu_import_handoff', id: issuedEuImport.id, version: issuedEuImport.version, status: issuedEuImport.status, sha256: issuedEuImport.fileSha256 });
  check('r05_json_reviewed_and_issued_without_authority_claim');

  const wrongEuEvidence = await service.recordEuImportEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedEuImport.id, eventType: 'authority_accepted',
    externalReference: `EU-AUTH-${runId}-WRONG`, evidenceDocumentId: firstEvidence.evidenceId,
    actorName: 'Synthetic EU customs authority', occurredAt: '2026-09-12T02:00:00.000Z'
  });
  assert.equal(wrongEuEvidence.error, 'EU_IMPORT_EVENT_EVIDENCE_TYPE_MISMATCH');
  const euAuthorityEvidence = await insertCustomsEvidence(ids, runId, 'eu_customs_authority_response', 'eu-accepted');
  await fs.promises.appendFile(euAuthorityEvidence.filePath, 'tampered');
  const tamperedEuEvent = await service.recordEuImportEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedEuImport.id, eventType: 'authority_accepted',
    externalReference: `EU-AUTH-${runId}`, evidenceDocumentId: euAuthorityEvidence.evidenceId,
    actorName: 'Synthetic EU customs authority', occurredAt: '2026-09-12T02:00:00.000Z'
  });
  assert.equal(tamperedEuEvent.error, 'EU_IMPORT_EVENT_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(euAuthorityEvidence.filePath, euAuthorityEvidence.original);
  const acceptedEuEvent = await service.recordEuImportEvent(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedEuImport.id, eventType: 'authority_accepted', externalReference: `EU-AUTH-${runId}`,
    messageCode: 'ACCEPTED-SYNTHETIC', messageText: 'Synthetic isolated EU acceptance evidence.',
    evidenceDocumentId: euAuthorityEvidence.evidenceId, actorName: 'Synthetic EU customs authority',
    actorIdentifier: 'SYNTH-EU-AUTH', occurredAt: '2026-09-12T02:00:00.000Z'
  });
  assert.equal(acceptedEuEvent.sourceType, 'authority');
  assert.equal(acceptedEuEvent.evidenceSha256, sha256(euAuthorityEvidence.original));
  assert.equal(acceptedEuEvent.documentFileSha256, issuedEuImport.fileSha256);
  result.euImportEvents.push(acceptedEuEvent);
  await assert.rejects(
    pool.query('UPDATE eu_import_external_events SET message_text=$1 WHERE id=$2', ['mutated', acceptedEuEvent.id]),
    /append-only/i
  );
  assert.equal(await service.getEuImportEvents(ids.otherCompanyId, ids.shipmentId), null);
  check('r05_authority_event_is_evidence_backed_append_only_and_tenant_isolated');

  await service.upsertIcs2Profile(ids.companyId, ids.shipmentId, ids.userId, {
    transportMode: 'sea', messageDatasetCode: 'F11', filingRole: 'carrier', filingArrangement: 'multiple',
    localReferenceNumber: `ICS2-LRN-${runId}`,
    sender: {
      name: 'Synthetic Ocean Carrier', address: 'Rotterdam, Netherlands', country: 'NL',
      eori: 'NL123456789014'
    },
    declarant: {
      name: 'Synthetic ICS2 Filer', address: 'Rotterdam, Netherlands', country: 'NL',
      eori: 'NL123456789015'
    },
    representative: {}, customsOfficeFirstEntry: 'NL000123', firstEntryCountry: 'NL',
    estimatedArrivalAt: '2026-09-20T08:00:00.000Z', itineraryCountries: ['VN', 'NL'],
    conveyanceReference: 'R03-001', containerIndicator: true,
    masterTransportDocument: { type: 'N705', number: `BL-${runId}` },
    activeBorderTransportMeans: {
      identificationType: 'IMO', identificationNumber: '9876543', nationality: 'PA'
    },
    seals: ['SEAL-ORIGINAL'], paymentMethodCode: 'A',
    targetSystemSchemaId: 'synthetic-filer.ics2-r3-f11', targetSystemSchemaVersion: '2026.09-pilot',
    technicalPackageId: 'ICS2-EO-CTSS-R2-R3', technicalPackageVersion: 'synthetic-v3.30',
    messageNamespace: 'urn:wco:datamodel:eu:ics2:2',
    houseConsignments: [{
      id: `HOUSE-${runId}`, transportDocumentType: 'N703',
      transportDocumentNumber: `HBL-${runId}`, ucr: `UCR-${runId}`,
      consignor: { name: 'Synthetic Vietnam Exporter', address: 'Ho Chi Minh City', country: 'VN' },
      consignee: { name: 'Synthetic EU Consignee', address: 'Rotterdam', country: 'NL' },
      buyer: { name: 'Synthetic EU Importer', address: 'Rotterdam', country: 'NL' },
      seller: { name: 'Synthetic Vietnam Exporter', address: 'Ho Chi Minh City', country: 'VN' },
      destinationCountry: 'NL', placeOfDelivery: 'Rotterdam, Netherlands',
      grossMassKg: 55, packageCount: 1, goodsLineIds: [lines[0].id],
      metadata: { synthetic: true }
    }],
    filingNotes: 'Synthetic isolated R06 filer handoff; never submit to STI or a customs authority.',
    metadata: { synthetic: true, fixtureType: 'ics2_handoff_pilot' }
  });
  const ics2Reconciliation = await service.reconcileIcs2Handoff(ids.companyId, ids.shipmentId);
  assert.equal(ics2Reconciliation.status, 'ready');
  assert.ok(ics2Reconciliation.checks.some((item) => item.code === 'dataset_mode_compatibility' && item.status === 'ready'));
  assert.ok(ics2Reconciliation.checks.some((item) => item.code === 'carrier_document_reconciliation' && item.status === 'ready'));
  check('r06_reconciles_master_house_goods_packages_and_current_carrier', {
    checkCount: ics2Reconciliation.checks.length
  });

  const ics2Draft = await service.createDocumentJob(
    ids.companyId, ids.shipmentId, ids.userId, 'ics2_dataset', { outputFormat: 'json' }
  );
  assert.ok(!ics2Draft.blocked, 'R06 JSON generation was blocked.');
  const ics2Row = (await pool.query('SELECT * FROM export_documents WHERE id=$1', [ics2Draft.id])).rows[0];
  const ics2Bytes = await fs.promises.readFile(path.resolve(UPLOADS_ROOT, ics2Row.storage_key));
  assert.equal(sha256(ics2Bytes), ics2Row.file_sha256);
  const ics2Dataset = JSON.parse(ics2Bytes.toString('utf8'));
  assert.equal(ics2Dataset.datasetNature, 'ICS2_FILER_HANDOFF_NOT_FOR_DIRECT_SUBMISSION');
  assert.equal(ics2Dataset.authorityStatus, 'NOT_SUBMITTED');
  assert.equal(ics2Dataset.notForDirectSubmission, true);
  assert.equal(ics2Dataset.filing.messageDatasetCode, 'F11');
  assert.equal(ics2Dataset.filing.houseConsignments.length, 1);
  assert.equal(ics2Dataset.filing.houseConsignments[0].goodsItems.length, 1);
  assert.equal(ics2Dataset.filing.houseConsignments[0].goodsItems[0].hsCode, '62052000');
  assert.equal(Object.prototype.hasOwnProperty.call(ics2Dataset, 'mrn'), false);
  const unreviewedIcs2Issue = await service.issueDocument(ids.companyId, ids.shipmentId, ics2Draft.id, ids.userId);
  assert.equal(unreviewedIcs2Issue.code, 'DOCUMENT_REVIEW_REQUIRED');
  const ics2Review = await service.reviewDocument(ids.companyId, ids.shipmentId, ics2Draft.id, ids.userId, {
    reviewerRole: 'ics2_filing_reviewer', decision: 'approved',
    notes: 'Synthetic filer-handoff mapping review; no ENS submission or authority registration.'
  });
  assert.equal(ics2Review.decision, 'approved');
  const issuedIcs2 = await service.issueDocument(ids.companyId, ids.shipmentId, ics2Draft.id, ids.userId);
  assert.equal(issuedIcs2.status, 'issued');
  result.documents.push({
    type: 'ics2_dataset', id: issuedIcs2.id, version: issuedIcs2.version,
    status: issuedIcs2.status, sha256: issuedIcs2.fileSha256
  });
  check('r06_json_reviewed_and_issued_without_ens_or_mrn_claim');

  const wrongIcs2Evidence = await service.recordIcs2Event(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedIcs2.id, eventType: 'authority_registered',
    externalReference: `ICS2-AUTH-${runId}-WRONG`, evidenceDocumentId: firstEvidence.evidenceId,
    actorName: 'Synthetic ICS2 authority', occurredAt: '2026-09-12T03:00:00.000Z'
  });
  assert.equal(wrongIcs2Evidence.error, 'ICS2_EVENT_EVIDENCE_TYPE_MISMATCH');
  const ics2AuthorityEvidence = await insertCustomsEvidence(ids, runId, 'ics2_customs_response', 'ics2-registered');
  await fs.promises.appendFile(ics2AuthorityEvidence.filePath, 'tampered');
  const tamperedIcs2Event = await service.recordIcs2Event(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedIcs2.id, eventType: 'authority_registered',
    externalReference: `ICS2-AUTH-${runId}`, evidenceDocumentId: ics2AuthorityEvidence.evidenceId,
    actorName: 'Synthetic ICS2 authority', occurredAt: '2026-09-12T03:00:00.000Z'
  });
  assert.equal(tamperedIcs2Event.error, 'ICS2_EVENT_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(ics2AuthorityEvidence.filePath, ics2AuthorityEvidence.original);
  const registeredIcs2Event = await service.recordIcs2Event(ids.companyId, ids.shipmentId, ids.userId, {
    exportDocumentId: issuedIcs2.id, eventType: 'authority_registered',
    externalReference: `ICS2-AUTH-${runId}`, messageCode: 'REGISTERED-SYNTHETIC',
    messageText: 'Synthetic isolated authority registration evidence.',
    evidenceDocumentId: ics2AuthorityEvidence.evidenceId, actorName: 'Synthetic ICS2 authority',
    actorIdentifier: 'SYNTH-ICS2-AUTH', occurredAt: '2026-09-12T03:00:00.000Z'
  });
  assert.equal(registeredIcs2Event.sourceType, 'authority');
  assert.equal(registeredIcs2Event.evidenceSha256, sha256(ics2AuthorityEvidence.original));
  assert.equal(registeredIcs2Event.documentFileSha256, issuedIcs2.fileSha256);
  result.ics2Events.push(registeredIcs2Event);
  await assert.rejects(
    pool.query('UPDATE ics2_external_events SET message_text=$1 WHERE id=$2', ['mutated', registeredIcs2Event.id]),
    /append-only/i
  );
  assert.equal(await service.getIcs2Events(ids.otherCompanyId, ids.shipmentId), null);
  check('r06_authority_event_is_evidence_backed_append_only_and_tenant_isolated');

  const originEvidence = await insertOriginEvidence(ids, runId);
  await service.upsertOriginProfile(ids.companyId, ids.shipmentId, ids.userId, {
    claimType: 'certificate_application', invoiceTotalEur: 500,
    exporterAuthorizationType: 'none', exporterAuthorizationReference: '',
    territorialityConfirmed: true, nonAlterationConfirmed: true,
    insufficientProcessingExcluded: true,
    lineAssessments: [{
      exportLineId: lines[0].id,
      ruleCode: 'CH62_GENERAL_WEAVING_AND_MAKING_UP',
      ruleSourcePage: 'Annex II, Chapter 62 synthetic pilot reference',
      specialistRuleText: '', productionProcesses: ['weaving', 'making_up_including_cutting'],
      exWorksPrice: 500, nonOriginatingMaterialValue: 150,
      materials: [{
        id: `MAT-${runId}`, reference: `YARN-${runId}`, description: 'Synthetic cotton yarn',
        hsCode: '5205', supplierName: 'Synthetic Yarn Supplier', originCountry: 'IN',
        originStatus: 'non_originating', cumulationBasis: 'none', value: 150, weightKg: 40,
        evidenceDocumentId: originEvidence.evidenceId,
        isUpperAssemblyAffixedToSole: null,
        notes: 'Synthetic BOM row; requires qualified origin-specialist validation.'
      }]
    }],
    notes: 'Synthetic isolated R07 handoff; not proof of origin.',
    metadata: { synthetic: true, fixtureType: 'origin_handoff_pilot' }
  });
  const originReconciliation = await service.reconcileOriginHandoff(ids.companyId, ids.shipmentId);
  assert.equal(originReconciliation.status, 'ready_for_specialist_review');
  assert.ok(originReconciliation.checks.some((item) => item.code === 'line_1_rule_execution' && item.status === 'ready'));
  assert.ok(originReconciliation.checks.some((item) => item.code === 'line_1_material_1_evidence' && item.status === 'ready'));
  assert.equal(await service.reconcileOriginHandoff(ids.otherCompanyId, ids.shipmentId), null);
  check('r07_reconciles_rule_bom_value_and_locked_evidence', {
    checkCount: originReconciliation.checks.length
  });

  await fs.promises.appendFile(originEvidence.filePath, 'tampered');
  const tamperedOriginDraft = await service.createDocumentJob(
    ids.companyId, ids.shipmentId, ids.userId, 'origin_workbook', { outputFormat: 'json' }
  );
  assert.equal(tamperedOriginDraft.code, 'ORIGIN_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(originEvidence.filePath, originEvidence.original);
  check('tampered_origin_evidence_blocks_generation');

  const originDraft = await service.createDocumentJob(
    ids.companyId, ids.shipmentId, ids.userId, 'origin_workbook', { outputFormat: 'json' }
  );
  assert.ok(!originDraft.blocked, 'R07 JSON generation was blocked.');
  const originRow = (await pool.query('SELECT * FROM export_documents WHERE id=$1', [originDraft.id])).rows[0];
  const originBytes = await fs.promises.readFile(path.resolve(UPLOADS_ROOT, originRow.storage_key));
  assert.equal(sha256(originBytes), originRow.file_sha256);
  const originDataset = JSON.parse(originBytes.toString('utf8'));
  assert.equal(originDataset.datasetNature, 'EVFTA_ORIGIN_SUPPORT_HANDOFF_NOT_PROOF_OF_ORIGIN');
  assert.equal(originDataset.notProofOfOrigin, true);
  assert.equal(originDataset.proofOfOriginStatus, 'NOT_ISSUED');
  assert.equal(originDataset.preferentialTreatmentStatus, 'NOT_GRANTED');
  assert.equal(originDataset.specialistReviewRequired, true);
  assert.equal(Object.prototype.hasOwnProperty.call(originDataset, 'eur1Number'), false);
  const unreviewedOriginIssue = await service.issueDocument(
    ids.companyId, ids.shipmentId, originDraft.id, ids.userId
  );
  assert.equal(unreviewedOriginIssue.code, 'DOCUMENT_REVIEW_REQUIRED');
  const wrongOriginReview = await service.reviewDocument(
    ids.companyId, ids.shipmentId, originDraft.id, ids.userId,
    { reviewerRole: 'export_operator', decision: 'approved', notes: 'Wrong role test.' }
  );
  assert.equal(wrongOriginReview.code, 'DOCUMENT_REVIEW_ROLE_INVALID');
  const originReview = await service.reviewDocument(
    ids.companyId, ids.shipmentId, originDraft.id, ids.userId,
    {
      reviewerRole: 'origin_specialist_reviewer', decision: 'approved',
      notes: 'Synthetic control review only; not a legal origin determination.'
    }
  );
  assert.equal(originReview.decision, 'approved');
  await fs.promises.appendFile(originEvidence.filePath, 'tampered-again');
  const tamperedOriginIssue = await service.issueDocument(
    ids.companyId, ids.shipmentId, originDraft.id, ids.userId
  );
  assert.equal(tamperedOriginIssue.code, 'ORIGIN_EVIDENCE_FILE_TAMPERED');
  await fs.promises.writeFile(originEvidence.filePath, originEvidence.original);
  const issuedOrigin = await service.issueDocument(
    ids.companyId, ids.shipmentId, originDraft.id, ids.userId
  );
  assert.equal(issuedOrigin.status, 'issued');
  result.documents.push({
    type: 'origin_workbook', id: issuedOrigin.id, version: issuedOrigin.version,
    status: issuedOrigin.status, sha256: issuedOrigin.fileSha256,
    proofOfOriginStatus: originDataset.proofOfOriginStatus
  });
  check('r07_json_reviewed_and_locked_without_proof_or_preference_claim');

  const applicability = await service.evaluateComplianceApplicability(
    ids.companyId, ids.shipmentId, ids.userId, {
      assessmentDate: '2026-09-13', productCategory: 'apparel', intendedUse: 'everyday wear',
      consumerGroup: 'adults', importerRole: 'EU importer', salesChannels: ['retail', 'online'],
      consumerProduct: true, placedOnEuMarket: true, textileFibrePercent: 100,
      materialFacts: [{
        reference: `TRIM-${runId}`, description: 'Synthetic animal-origin trim', hsCode: '4205',
        originCountry: 'IN', percentageByWeight: 1, animalOrigin: true, substancesScreened: false
      }],
      notes: 'Synthetic R20 applicability input; not a legal determination.'
    }
  );
  assert.equal(applicability.status, 'specialist_review_required');
  assert.equal(applicability.rulesetCoverage, 'limited');
  assert.equal(applicability.input.products[0].taricCode, '6205200010');
  assert.ok(applicability.result.matches.some((item) =>
    item.code === 'EU_TEXTILE_FIBRE_LABEL_SCOPE' && item.decision === 'requirements_identified'
  ));
  assert.ok(applicability.result.matches.some((item) =>
    item.code === 'EU_REACH_SUBSTANCE_SCREEN' && item.decision === 'specialist_review_required'
  ));
  assert.equal(await service.listComplianceApplicabilityEvaluations(ids.otherCompanyId, ids.shipmentId), null);
  check('r20_source_versioned_applicability_is_explainable_and_tenant_isolated');

  const evidenceFreeReview = await service.reviewComplianceApplicability(
    ids.companyId, ids.shipmentId, applicability.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'confirmed_for_internal_planning',
      notes: 'Synthetic specialist review without evidence must fail.'
    }
  );
  assert.equal(evidenceFreeReview.code, 'COMPLIANCE_REVIEW_EVIDENCE_REQUIRED');
  const wrongApplicabilityRole = await service.reviewComplianceApplicability(
    ids.companyId, ids.shipmentId, applicability.id, ids.userId, {
      reviewerRole: 'export_operator', decision: 'confirmed_for_internal_planning',
      notes: 'Wrong role test.', evidenceDocumentIds: [originEvidence.evidenceId]
    }
  );
  assert.equal(wrongApplicabilityRole.code, 'COMPLIANCE_REVIEW_ROLE_INVALID');
  const applicabilityReview = await service.reviewComplianceApplicability(
    ids.companyId, ids.shipmentId, applicability.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'confirmed_for_internal_planning',
      notes: 'Synthetic internal-planning review only; source versions require rechecking.',
      evidenceDocumentIds: [originEvidence.evidenceId]
    }
  );
  assert.equal(applicabilityReview.inputSha256, applicability.inputSha256);
  assert.equal(applicabilityReview.resultSha256, applicability.resultSha256);
  assert.equal(applicabilityReview.evidenceSnapshot[0].id, originEvidence.evidenceId);
  await assert.rejects(
    pool.query('UPDATE compliance_applicability_evaluations SET status=$1 WHERE id=$2', [
      'not_applicable', applicability.id
    ]),
    /append-only and immutable/i
  );
  check('r20_specialist_review_is_hash_bound_evidence_backed_and_immutable');

  const prohibitedClaim = await service.createEnvironmentalClaimDossier(
    ids.companyId, ids.shipmentId, ids.userId, {
      claimReference: `GREEN-${runId}`, exactClaimText: 'Green product', publicCommunication: true,
      channel: 'website', marketCodes: ['DE'], languageCode: 'de-DE', communicationStart: '2026-09-27',
      subjectType: 'sku', subjectReference: `SKU-${runId}`, scopeStatement: 'Whole product.',
      claimKind: 'generic_environmental', specificationText: 'Generic whole-product claim.',
      claimScopeMode: 'entire_subject', actualCoverage: 'aspect_only', recognizedExcellentPerformance: false,
      methodology: { standard: 'Synthetic pilot method', version: '1.0', calculationSha256: 'a'.repeat(64), datasetReferences: ['synthetic-dataset'] },
      uncertaintyStatement: 'Synthetic uncertainty.', updateTriggers: ['method changes'],
      withdrawalTriggers: ['evidence expires'], evidenceDocumentIds: [originEvidence.evidenceId]
    }
  );
  assert.equal(prohibitedClaim.automatedStatus, 'blocked_prohibited');
  assert.ok(prohibitedClaim.result.findings.some((item) =>
    item.code === 'GENERIC_CLAIM_RECOGNISED_PERFORMANCE_REQUIRED'
  ));
  const prohibitedApproval = await service.reviewEnvironmentalClaimDossier(
    ids.companyId, ids.shipmentId, prohibitedClaim.id, ids.userId, {
      reviewerRole: 'legal_claim_reviewer', decision: 'approved_for_publication',
      notes: 'Synthetic prohibited-claim approval must fail.'
    }
  );
  assert.equal(prohibitedApproval.code, 'ENVIRONMENTAL_CLAIM_NOT_READY');
  check('r18_prohibited_generic_and_overbroad_claims_are_blocked');

  const controlledClaim = await service.createEnvironmentalClaimDossier(
    ids.companyId, ids.shipmentId, ids.userId, {
      claimReference: `PCF-${runId}`,
      exactClaimText: 'This SKU records 20% lower cradle-to-gate CO2e than the named synthetic baseline.',
      publicCommunication: true, channel: 'website', marketCodes: ['DE'], languageCode: 'de-DE',
      communicationStart: '2026-09-27', communicationEnd: '2027-06-30',
      subjectType: 'sku', subjectReference: `SKU-${runId}`,
      scopeStatement: 'One synthetic SKU; cradle-to-gate boundary only.', claimKind: 'specific_environmental',
      specificationText: '20% against synthetic 2025 baseline using the recorded method and dataset.',
      claimScopeMode: 'specific_aspect', actualCoverage: 'aspect_only',
      methodology: {
        standard: 'Synthetic internal PCF method', version: '1.0', pcr: '',
        calculationSha256: 'c'.repeat(64),
        datasetReferences: ['synthetic-carbon-snapshot'], factorReferences: ['synthetic-factor-registry']
      },
      limitations: ['Synthetic data only'], exclusions: ['Use phase'], uncertaintyStatement: 'Synthetic uncertainty ±15%.',
      qualifiers: ['Cradle-to-gate only'], updateTriggers: ['method, dataset or factor changes'],
      withdrawalTriggers: ['evidence expires, is revoked or calculation changes'],
      evidenceDocumentIds: [originEvidence.evidenceId], notes: 'Synthetic legal-control pilot; not a real public claim.'
    }
  );
  assert.equal(controlledClaim.automatedStatus, 'ready_for_legal_review');
  const wrongClaimRole = await service.reviewEnvironmentalClaimDossier(
    ids.companyId, ids.shipmentId, controlledClaim.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'approved_for_publication', notes: 'Wrong role test.'
    }
  );
  assert.equal(wrongClaimRole.code, 'ENVIRONMENTAL_CLAIM_REVIEW_ROLE_INVALID');
  const claimReview = await service.reviewEnvironmentalClaimDossier(
    ids.companyId, ids.shipmentId, controlledClaim.id, ids.userId, {
      reviewerRole: 'legal_claim_reviewer', decision: 'approved_for_publication',
      notes: 'Synthetic exact-text/scope approval for lifecycle testing only.'
    }
  );
  assert.equal(claimReview.inputSha256, controlledClaim.inputSha256);
  assert.equal(claimReview.resultSha256, controlledClaim.resultSha256);
  const claimRegister = await service.listEnvironmentalClaimDossiers(ids.companyId, ids.shipmentId);
  const reopenedClaim = claimRegister.find((item) => item.id === controlledClaim.id);
  assert.equal(reopenedClaim.publicationStatus, 'approved_scheduled');
  assert.equal(await service.listEnvironmentalClaimDossiers(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(
    pool.query('UPDATE environmental_claim_dossiers SET automated_status=$1 WHERE id=$2', [
      'internal_draft', controlledClaim.id
    ]),
    /append-only and immutable/i
  );
  result.environmentalClaims.push({
    id: controlledClaim.id, claimReference: controlledClaim.claimReference, revision: controlledClaim.revision,
    publicationStatus: reopenedClaim.publicationStatus, inputSha256: controlledClaim.inputSha256,
    resultSha256: controlledClaim.resultSha256
  });
  check('r18_claim_revision_is_tenant_isolated_hash_bound_evidence_backed_and_immutable');

  const incompleteTextileLabel = await service.createTextileFibreLabelSpecification(
    ids.companyId, ids.shipmentId, ids.userId, {
      specificationReference: `LABEL-BLOCKED-${runId}`, assessmentDate: '2026-09-13',
      productReference: `R03-SKU-${runId}`, productCategory: 'woven shirt', specialProductCategory: 'standard',
      textileFibrePercent: 100, marketCodes: ['DE'],
      components: [{ componentReference: 'shell', componentName: 'Shell', weightPercent: 100,
        mainLining: false, fibres: [{ fibreCode: 'marketing-bamboo', percentage: 100 }] }],
      animalOriginPresence: 'present',
      languageLabels: [{ marketCode: 'DE', languageCode: 'de-DE', labelText: 'Marketing fibre 100%',
        animalOriginStatementIncluded: false, operatorApproved: true }],
      economicOperator: { role: 'importer', name: 'Synthetic Importer GmbH', address: 'Berlin' },
      placement: { method: 'sewn', durable: true, easilyLegible: true, visible: true,
        accessible: true, securelyAttached: true, onlineBeforePurchase: false },
      evidenceDocumentIds: [originEvidence.evidenceId], notes: 'Synthetic blocked R08 fixture.'
    }
  );
  assert.equal(incompleteTextileLabel.automatedStatus, 'needs_information');
  assert.ok(incompleteTextileLabel.result.findings.some((item) => item.code === 'ANNEX_I_FIBRE_NAME_INVALID'));
  assert.ok(incompleteTextileLabel.result.findings.some((item) => item.code === 'ANIMAL_ORIGIN_STATEMENT_REQUIRED'));
  const incompleteApproval = await service.reviewTextileFibreLabelSpecification(
    ids.companyId, ids.shipmentId, incompleteTextileLabel.id, ids.userId, {
      reviewerRole: 'textile_label_reviewer', decision: 'approved_for_internal_artwork',
      notes: 'Synthetic incomplete artwork approval must fail.'
    }
  );
  assert.equal(incompleteApproval.code, 'TEXTILE_LABEL_NOT_READY');
  check('r08_invalid_fibre_animal_origin_and_online_artwork_are_blocked');

  const controlledTextileLabel = await service.createTextileFibreLabelSpecification(
    ids.companyId, ids.shipmentId, ids.userId, {
      specificationReference: `LABEL-SHIRT-${runId}`, assessmentDate: '2026-09-13',
      productReference: `R03-SKU-${runId}`, productCategory: 'woven shirt', specialProductCategory: 'standard',
      textileFibrePercent: 100, marketCodes: ['DE'],
      components: [
        { componentReference: 'shell', componentName: 'Shell', weightPercent: 80, mainLining: false,
          fibres: [{ fibreCode: '5', percentage: 80 }, { fibreCode: '35', percentage: 20 }] },
        { componentReference: 'main-lining', componentName: 'Main lining', weightPercent: 20, mainLining: true,
          fibres: [{ fibreCode: '35', percentage: 100 }] }
      ],
      animalOriginPresence: 'absent',
      languageLabels: [{ marketCode: 'DE', languageCode: 'de-DE',
        labelText: 'Oberstoff: 80% Baumwolle, 20% Polyester; Hauptfutter: 100% Polyester',
        animalOriginStatementIncluded: false, operatorApproved: true }],
      economicOperator: { role: 'importer', name: 'Synthetic Importer GmbH', address: 'Berlin' },
      placement: { method: 'sewn', durable: true, easilyLegible: true, visible: true,
        accessible: true, securelyAttached: true, onlineBeforePurchase: true },
      evidenceDocumentIds: [originEvidence.evidenceId], notes: 'Synthetic R08 control pilot; not market artwork.'
    }
  );
  assert.equal(controlledTextileLabel.automatedStatus, 'ready_for_label_review');
  assert.match(controlledTextileLabel.result.englishPreview, /80% cotton, 20% polyester/);
  const wrongTextileRole = await service.reviewTextileFibreLabelSpecification(
    ids.companyId, ids.shipmentId, controlledTextileLabel.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'approved_for_internal_artwork', notes: 'Wrong role test.'
    }
  );
  assert.equal(wrongTextileRole.code, 'TEXTILE_LABEL_REVIEW_ROLE_INVALID');
  const textileReview = await service.reviewTextileFibreLabelSpecification(
    ids.companyId, ids.shipmentId, controlledTextileLabel.id, ids.userId, {
      reviewerRole: 'textile_label_reviewer', decision: 'approved_for_internal_artwork',
      notes: 'Synthetic component, language, placement and evidence review for internal artwork only.'
    }
  );
  assert.equal(textileReview.inputSha256, controlledTextileLabel.inputSha256);
  assert.equal(textileReview.resultSha256, controlledTextileLabel.resultSha256);
  const textileRegister = await service.listTextileFibreLabelSpecifications(ids.companyId, ids.shipmentId);
  const reopenedTextileLabel = textileRegister.find((item) => item.id === controlledTextileLabel.id);
  assert.equal(reopenedTextileLabel.artworkStatus, 'approved_for_internal_artwork');
  assert.equal(await service.listTextileFibreLabelSpecifications(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(
    pool.query('UPDATE textile_fibre_label_specifications SET automated_status=$1 WHERE id=$2', [
      'needs_information', controlledTextileLabel.id
    ]),
    /append-only and immutable/i
  );
  result.textileFibreLabels.push({
    id: controlledTextileLabel.id, specificationReference: controlledTextileLabel.specificationReference,
    revision: controlledTextileLabel.revision, artworkStatus: reopenedTextileLabel.artworkStatus,
    inputSha256: controlledTextileLabel.inputSha256, resultSha256: controlledTextileLabel.resultSha256
  });
  check('r08_label_revision_is_tenant_isolated_hash_bound_evidence_backed_and_immutable');

  const incompleteGpsrFile = await service.createGpsrTechnicalFileRevision(
    ids.companyId, ids.shipmentId, ids.userId, {
      fileReference: `GPSR-BLOCKED-${runId}`, assessmentDate: '2026-09-13', firstPlacedOnMarketDate: '2026-09-13',
      consumerProduct: true, placedOnEuMarket: true, marketCodes: ['DE'], harmonisationCoverage: 'none',
      product: { brand: 'Synthetic', name: 'Cotton shirt', model: 'WC-BLOCKED', batchNumber: `LOT-${runId}`,
        description: 'Synthetic shirt', essentialCharacteristics: 'Textile garment',
        productImageEvidenceId: originEvidence.evidenceId, packagingImageEvidenceId: originEvidence.evidenceId },
      intendedUse: 'Adult garment', foreseeableMisuse: 'Use near an open flame', vulnerableGroups: ['children'],
      operators: {
        manufacturer: { name: 'Synthetic Maker VN', postalAddress: 'HCMC, Vietnam', electronicAddress: 'maker@invalid.example', euEstablished: false },
        importer: { name: 'Synthetic Importer GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'importer@invalid.example', euEstablished: true },
        responsiblePerson: { name: 'Synthetic Safety GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'gpsr@invalid.example', euEstablished: true }
      },
      risks: [], standards: [], warnings: [],
      onlineOffer: { enabled: true, manufacturerDisplayed: false, responsiblePersonDisplayed: false,
        productImageDisplayed: false, identifiersDisplayed: false, warningsDisplayed: false, offerUrl: '' },
      seriesProductionProcedure: 'Synthetic lot control.', complaintChannel: 'safety@invalid.example',
      postMarketPlan: 'Synthetic complaint and incident review.', retentionUntil: '2036-09-13',
      evidenceDocumentIds: [originEvidence.evidenceId]
    }
  );
  assert.equal(incompleteGpsrFile.automatedStatus, 'needs_information');
  assert.ok(incompleteGpsrFile.result.findings.some((item) => item.code === 'RISK_ANALYSIS_REQUIRED'));
  assert.ok(incompleteGpsrFile.result.findings.some((item) => item.code === 'DISTANCE_SALE_INFORMATION_INCOMPLETE'));
  const incompleteGpsrApproval = await service.reviewGpsrTechnicalFile(
    ids.companyId, ids.shipmentId, incompleteGpsrFile.id, ids.userId, {
      reviewerRole: 'product_safety_reviewer', decision: 'approved_for_internal_release',
      notes: 'Synthetic incomplete-file approval must fail.'
    }
  );
  assert.equal(incompleteGpsrApproval.code, 'GPSR_FILE_NOT_READY');
  check('r10_incomplete_risk_and_distance_sale_file_is_blocked');

  const controlledGpsrFile = await service.createGpsrTechnicalFileRevision(
    ids.companyId, ids.shipmentId, ids.userId, {
      fileReference: `GPSR-SHIRT-${runId}`, assessmentDate: '2026-09-13', firstPlacedOnMarketDate: '2026-09-13',
      consumerProduct: true, placedOnEuMarket: true, marketCodes: ['DE'], harmonisationCoverage: 'none',
      applicableSectorRules: ['Regulation (EU) No 1007/2011'],
      product: { brand: 'Synthetic WeaveCarbon', name: 'Cotton shirt', model: `WC-${runId}`, type: 'woven shirt',
        batchNumber: `LOT-${runId}`, serialNumber: '', otherIdentifier: `R03-SKU-${runId}`,
        description: 'Synthetic adult woven shirt', essentialCharacteristics: 'Cotton/polyester shell, polyester lining and buttons',
        composition: 'Shell 80% cotton/20% polyester; lining 100% polyester', packagingDescription: 'Recyclable paper sleeve',
        productImageEvidenceId: originEvidence.evidenceId, packagingImageEvidenceId: originEvidence.evidenceId },
      intendedUse: 'Adult upper-body garment for everyday wear',
      foreseeableMisuse: 'Use near an open flame; detached button accessible to a child', vulnerableGroups: ['children'],
      operators: {
        manufacturer: { name: 'Synthetic Maker VN', postalAddress: 'HCMC, Vietnam', electronicAddress: 'maker@invalid.example', euEstablished: false },
        importer: { name: 'Synthetic Importer GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'importer@invalid.example', euEstablished: true },
        responsiblePerson: { name: 'Synthetic Safety GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'gpsr@invalid.example', euEstablished: true }
      },
      risks: [{ hazardId: 'H-BUTTON', hazardCategory: 'mechanical', hazardDescription: 'Loose button may be swallowed',
        affectedGroups: ['children'], foreseeableScenario: 'A button detaches during use and reaches a child', likelihood: 2,
        severity: 3, mitigation: 'Lot-based button pull testing and seam inspection', residualLikelihood: 1,
        residualSeverity: 3, verificationEvidenceIds: [originEvidence.evidenceId] }],
      standards: [{ reference: 'SYNTHETIC-BUTTON-PULL', title: 'Synthetic button pull protocol', version: '1.0', applicationExtent: 'full' }],
      warnings: [{ marketCode: 'DE', languageCode: 'de-DE', text: 'Von offenem Feuer fernhalten.', location: 'packaging', operatorApproved: true }],
      onlineOffer: { enabled: true, manufacturerDisplayed: true, responsiblePersonDisplayed: true,
        productImageDisplayed: true, identifiersDisplayed: true, warningsDisplayed: true,
        offerUrl: `https://invalid.example/products/WC-${runId}` },
      seriesProductionProcedure: 'Pull-test each lot, quarantine failures and revise this file after material or supplier changes.',
      complaintChannel: 'safety@invalid.example',
      postMarketPlan: 'Review complaints monthly; escalate serious incidents immediately; document corrective actions and recalls.',
      retentionUntil: '2036-09-13', evidenceDocumentIds: [originEvidence.evidenceId],
      notes: 'Synthetic R10 lifecycle pilot; not a product-safety certification.'
    }
  );
  assert.equal(controlledGpsrFile.automatedStatus, 'ready_for_safety_review');
  assert.equal(controlledGpsrFile.result.minimumRetentionUntil, '2036-09-13');
  const wrongGpsrRole = await service.reviewGpsrTechnicalFile(
    ids.companyId, ids.shipmentId, controlledGpsrFile.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'approved_for_internal_release', notes: 'Wrong role test.'
    }
  );
  assert.equal(wrongGpsrRole.code, 'GPSR_REVIEW_ROLE_INVALID');
  const gpsrReview = await service.reviewGpsrTechnicalFile(
    ids.companyId, ids.shipmentId, controlledGpsrFile.id, ids.userId, {
      reviewerRole: 'product_safety_reviewer', decision: 'approved_for_internal_release',
      notes: 'Synthetic risk, operator, Article 19, evidence and retention review for internal release only.'
    }
  );
  assert.equal(gpsrReview.inputSha256, controlledGpsrFile.inputSha256);
  assert.equal(gpsrReview.resultSha256, controlledGpsrFile.resultSha256);
  const gpsrRegister = await service.listGpsrTechnicalFiles(ids.companyId, ids.shipmentId);
  const reopenedGpsrFile = gpsrRegister.find((item) => item.id === controlledGpsrFile.id);
  assert.equal(reopenedGpsrFile.safetyFileStatus, 'approved_for_internal_release');
  assert.equal(await service.listGpsrTechnicalFiles(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(
    pool.query('UPDATE gpsr_technical_file_revisions SET automated_status=$1 WHERE id=$2', [
      'needs_information', controlledGpsrFile.id
    ]), /append-only and immutable/i
  );
  result.gpsrTechnicalFiles.push({
    id: controlledGpsrFile.id, fileReference: controlledGpsrFile.fileReference, revision: controlledGpsrFile.revision,
    safetyFileStatus: reopenedGpsrFile.safetyFileStatus, inputSha256: controlledGpsrFile.inputSha256,
    resultSha256: controlledGpsrFile.resultSha256
  });
  check('r10_file_is_tenant_isolated_hash_bound_evidence_backed_and_immutable');

  const incident = await service.recordGpsrPostMarketEvent(
    ids.companyId, ids.shipmentId, controlledGpsrFile.id, ids.userId, {
      eventType: 'safety_incident', eventReference: `INC-${runId}`, occurredAt: '2026-09-13T09:00:00Z',
      summary: 'Synthetic serious incident without consumer personal data.', severity: 'serious',
      evidenceDocumentId: originEvidence.evidenceId, consumerPersonalDataIncluded: false
    }
  );
  assert.equal(incident.safetyBusinessGatewayNotificationRequired, true);
  const unprovenGateway = await service.recordGpsrPostMarketEvent(
    ids.companyId, ids.shipmentId, controlledGpsrFile.id, ids.userId, {
      eventType: 'safety_business_gateway_notification', eventReference: `SBG-MISSING-${runId}`,
      occurredAt: '2026-09-13T10:00:00Z', summary: 'Synthetic unproven gateway claim.', severity: 'serious'
    }
  );
  assert.equal(unprovenGateway.code, 'GPSR_GATEWAY_PROOF_REQUIRED');
  const gateway = await service.recordGpsrPostMarketEvent(
    ids.companyId, ids.shipmentId, controlledGpsrFile.id, ids.userId, {
      eventType: 'safety_business_gateway_notification', eventReference: `SBG-${runId}`,
      occurredAt: '2026-09-13T10:00:00Z', summary: 'Synthetic external filing receipt recorded.', severity: 'serious',
      externalReference: `SYNTHETIC-SBG-RECEIPT-${runId}`, evidenceDocumentId: originEvidence.evidenceId,
      consumerPersonalDataIncluded: false
    }
  );
  assert.equal(gateway.externalReference, `SYNTHETIC-SBG-RECEIPT-${runId}`);
  const postMarketEvents = await service.listGpsrPostMarketEvents(ids.companyId, ids.shipmentId, controlledGpsrFile.id);
  assert.equal(postMarketEvents.length, 2);
  assert.equal(await service.listGpsrPostMarketEvents(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(
    pool.query('UPDATE gpsr_post_market_events SET summary=$1 WHERE id=$2', ['tampered', incident.id]),
    /append-only and immutable/i
  );
  result.gpsrPostMarketEvents.push(...postMarketEvents.map((item) => ({
    id: item.id, eventReference: item.eventReference, eventType: item.eventType, severity: item.severity,
    externalReference: item.externalReference, safetyBusinessGatewayNotificationRequired: item.safetyBusinessGatewayNotificationRequired
  })));
  check('r10_serious_incident_requires_gateway_follow_up_and_gateway_claim_requires_external_proof');

  const blockedReach = await service.createReachSvhcDossierRevision(
    ids.companyId, ids.shipmentId, ids.userId, {
      dossierReference: `REACH-BLOCKED-${runId}`, assessmentDate: '2026-09-13', productReference: `R03-SKU-${runId}`,
      productName: 'Synthetic cotton shirt', articleCategory: 'consumer clothing', consumerArticle: true,
      placedOnEuMarket: true, marketCodes: ['DE'], euActorRole: 'importer', articleLevelAssessmentConfirmed: false,
      candidateListSnapshotDate: '2026-02-04', candidateListEntryCount: 252, reachConsolidatedDate: '2026-06-22',
      components: [{ componentReference: 'button', componentName: 'Button', articleReference: `BUTTON-${runId}`,
        homogeneousMaterialReference: `RESIN-${runId}`, materialName: 'Synthetic resin', materialLocation: 'Front closure',
        substances: [{ substanceName: 'n-hexane', casNumber: '110-54-3', candidateListStatus: 'included',
          candidateInclusionDate: '2026-02-04', concentrationPercentWw: 0.2, annualTonnage: null, location: 'Button resin',
          evidenceBasis: 'laboratory_test', detectionLimit: null, detectionLimitUnit: '', safeUseInstructions: [],
          article7Exemption: '', evidenceDocumentIds: [originEvidence.evidenceId], restrictionAssessments: [] }] }],
      supplierDeclarationEvidenceIds: [originEvidence.evidenceId], notes: 'Synthetic blocked R11 fixture.'
    }
  );
  assert.equal(blockedReach.automatedStatus, 'needs_information');
  assert.ok(blockedReach.result.findings.some((item) => item.code === 'ARTICLE_LEVEL_ASSESSMENT_REQUIRED'));
  assert.ok(blockedReach.result.findings.some((item) => item.code === 'CHEMICAL_SOURCE_VERSION_MISMATCH'));
  assert.ok(blockedReach.result.findings.some((item) => item.code === 'SAFE_USE_INFORMATION_REQUIRED'));
  const blockedReachApproval = await service.reviewReachSvhcDossier(
    ids.companyId, ids.shipmentId, blockedReach.id, ids.userId, {
      reviewerRole: 'chemical_compliance_reviewer', decision: 'approved_for_internal_release',
      notes: 'Synthetic incomplete dossier approval must fail.'
    }
  );
  assert.equal(blockedReachApproval.code, 'REACH_DOSSIER_NOT_READY');
  check('r11_wrong_source_article_level_and_missing_safe_use_are_blocked');

  const controlledReach = await service.createReachSvhcDossierRevision(
    ids.companyId, ids.shipmentId, ids.userId, {
      dossierReference: `REACH-SHIRT-${runId}`, assessmentDate: '2026-09-13', productReference: `R03-SKU-${runId}`,
      productName: 'Synthetic cotton shirt', articleCategory: 'consumer clothing', consumerArticle: true,
      placedOnEuMarket: true, marketCodes: ['DE'], euActorRole: 'importer', articleLevelAssessmentConfirmed: true,
      candidateListSnapshotDate: '2026-02-04', candidateListEntryCount: 253, reachConsolidatedDate: '2026-06-22',
      components: [{ componentReference: 'button', componentName: 'Button', articleReference: `BUTTON-${runId}`,
        homogeneousMaterialReference: `RESIN-${runId}`, materialName: 'Synthetic resin', materialLocation: 'Front closure',
        substances: [{ substanceName: 'n-hexane', casNumber: '110-54-3', ecNumber: '203-777-6',
          candidateListStatus: 'included', candidateInclusionDate: '2026-02-04', concentrationPercentWw: 0.2,
          annualTonnage: 0.2, location: 'Button resin', evidenceBasis: 'laboratory_test', detectionLimit: 0.01,
          detectionLimitUnit: 'percent_w_w', safeUseInstructions: [{ marketCode: 'DE', languageCode: 'de-DE',
            text: 'Nicht verbrennen; bei der Entsorgung örtliche Hinweise beachten.', operatorApproved: true }],
          article7Exemption: 'none', evidenceDocumentIds: [originEvidence.evidenceId],
          restrictionAssessments: [{ entryNumber: '72', scopeDecision: 'not_applies',
            scopeRationale: 'n-hexane is not listed in Appendix 12 for this recorded source snapshot.',
            legalLimit: null, limitUnit: '', measuredValue: null, prohibitedWhen: '', testMethod: '', exemptionClaimed: false,
            evidenceDocumentIds: [originEvidence.evidenceId] }] }] }],
      supplierDeclarationEvidenceIds: [originEvidence.evidenceId],
      notes: 'Synthetic R11 control pilot; not a REACH certificate or ECHA submission.'
    }
  );
  assert.equal(controlledReach.automatedStatus, 'ready_for_chemical_review');
  assert.ok(controlledReach.result.obligations.some((item) => item.code === 'ARTICLE_33_COMMUNICATION_REQUIRED'));
  assert.ok(controlledReach.result.obligations.some((item) => item.code === 'SCIP_NOTIFICATION_ASSESSMENT_REQUIRED'));
  const wrongReachRole = await service.reviewReachSvhcDossier(
    ids.companyId, ids.shipmentId, controlledReach.id, ids.userId, {
      reviewerRole: 'compliance_specialist', decision: 'approved_for_internal_release', notes: 'Wrong role.'
    }
  );
  assert.equal(wrongReachRole.code, 'REACH_REVIEW_ROLE_INVALID');
  const reachReview = await service.reviewReachSvhcDossier(
    ids.companyId, ids.shipmentId, controlledReach.id, ids.userId, {
      reviewerRole: 'chemical_compliance_reviewer', decision: 'approved_for_internal_release',
      notes: 'Synthetic source, article, substance, threshold, safe-use and evidence review for internal release only.'
    }
  );
  assert.equal(reachReview.inputSha256, controlledReach.inputSha256);
  assert.equal(reachReview.resultSha256, controlledReach.resultSha256);
  const reachRegister = await service.listReachSvhcDossiers(ids.companyId, ids.shipmentId);
  const reopenedReach = reachRegister.find((item) => item.id === controlledReach.id);
  assert.equal(reopenedReach.releaseStatus, 'approved_for_internal_release');
  assert.equal(await service.listReachSvhcDossiers(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(pool.query('UPDATE reach_svhc_dossier_revisions SET automated_status=$1 WHERE id=$2', [
    'needs_information', controlledReach.id
  ]), /append-only and immutable/i);
  result.reachSvhcDossiers.push({ id: controlledReach.id, dossierReference: controlledReach.dossierReference,
    revision: controlledReach.revision, releaseStatus: reopenedReach.releaseStatus,
    inputSha256: controlledReach.inputSha256, resultSha256: controlledReach.resultSha256 });
  check('r11_dossier_is_tenant_isolated_hash_bound_evidence_backed_and_immutable');

  const consumerRequest = await service.recordReachObligationEvent(
    ids.companyId, ids.shipmentId, controlledReach.id, ids.userId, {
      eventType: 'consumer_request_received', eventReference: `REACH-REQ-${runId}`, occurredAt: '2026-09-13T00:00:00Z',
      summary: 'Synthetic opaque consumer request reference without personal data.', consumerPersonalDataIncluded: false
    }
  );
  assert.equal(String(consumerRequest.responseDueAt), '2026-10-28T00:00:00.000Z');
  const unprovenScip = await service.recordReachObligationEvent(
    ids.companyId, ids.shipmentId, controlledReach.id, ids.userId, {
      eventType: 'scip_notification', eventReference: `SCIP-MISSING-${runId}`, occurredAt: '2026-09-13T01:00:00Z',
      summary: 'Synthetic unproven SCIP claim.'
    }
  );
  assert.equal(unprovenScip.code, 'REACH_EXTERNAL_PROOF_REQUIRED');
  const scip = await service.recordReachObligationEvent(
    ids.companyId, ids.shipmentId, controlledReach.id, ids.userId, {
      eventType: 'scip_notification', eventReference: `SCIP-${runId}`, occurredAt: '2026-09-13T01:00:00Z',
      summary: 'Synthetic external SCIP receipt recorded.', externalReference: `SYNTHETIC-SCIP-${runId}`,
      evidenceDocumentId: originEvidence.evidenceId, consumerPersonalDataIncluded: false
    }
  );
  assert.equal(scip.externalReference, `SYNTHETIC-SCIP-${runId}`);
  const reachEvents = await service.listReachObligationEvents(ids.companyId, ids.shipmentId, controlledReach.id);
  assert.equal(reachEvents.length, 2);
  assert.equal(await service.listReachObligationEvents(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(pool.query('UPDATE reach_obligation_events SET summary=$1 WHERE id=$2', ['tampered', scip.id]),
    /append-only and immutable/i);
  result.reachObligationEvents.push(...reachEvents.map((item) => ({ id: item.id, eventReference: item.eventReference,
    eventType: item.eventType, responseDueAt: item.responseDueAt, externalReference: item.externalReference })));
  check('r11_consumer_deadline_and_external_scip_proof_are_enforced');

  const pcfSnapshots = await service.listPcfCalculationSnapshots(ids.companyId, ids.shipmentId);
  const pcfSnapshot = pcfSnapshots.find((item) => item.id === ids.calculationSnapshotId);
  assert.equal(pcfSnapshot.canonicalInputHash.length, 64);
  assert.equal(pcfSnapshot.reportedTotalKgCO2e, ids.carbonResult.reportedTotalKgCO2e);
  const pcfBase = {
    studyDate: '2026-09-13', calculationSnapshotId: ids.calculationSnapshotId,
    productReference: `R03-SKU-${runId}`, productName: 'Synthetic cotton shirt',
    reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-09-13',
    intendedApplication: 'Internal buyer data review', intendedAudience: 'Buyer sustainability team',
    comparativeAssertion: false,
    functionalUnit: { quantity: 1, unit: 'piece', description: 'One finished synthetic cotton shirt' },
    referenceFlow: { amount: 0.5, unit: 'kg finished product', basis: 'Measured unit mass' },
    boundaryType: 'cradle_to_gate_plus_gate_to_market_extension',
    includedStages: ids.carbonResult.boundary.includedStages,
    processMap: [{ processReference: `MAT-${runId}`, processName: 'Material and shipment model', stage: 'materials',
      included: true, dataSource: 'Synthetic source records and frozen factor snapshot',
      evidenceDocumentIds: [originEvidence.evidenceId] }],
    excludedProcesses: [{ processName: 'Use and end-of-life', rationale: 'Outside declared partial CFP boundary.', estimatedImpactPercent: 0 }],
    cutoff: { massPercent: 1, energyPercent: 1, environmentalSignificanceApplied: true,
      rationale: 'Mass, energy and potential climate significance screened; no significant known flow omitted.' },
    pcr: { status: 'not_identified', name: '', publisher: '', version: '', validFrom: null, validTo: null,
      rationale: 'No product-category rule identified in this synthetic pilot; practitioner confirmation required.' },
    allocation: { required: false, method: '', rationale: 'No multifunctional process modeled.',
      hierarchyJustification: '', sensitivityPerformed: false, sensitivitySummary: '' },
    recyclingModel: { method: 'cut-off', rationale: 'Recycled-input burdens follow the factor dataset; end-of-life is excluded.' },
    dataQualityAssessment: 'Technological, geographical, temporal, completeness and reliability dimensions reviewed.',
    dataImprovementPlan: 'Replace proxy factors and supplier estimates with primary records when available.',
    uncertaintyAssessment: { method: 'rss_fallback', parameter: 'Factor and activity-data ranges.',
      scenario: 'Transport and sourcing alternatives.', model: 'Partial-boundary model limitations.',
      sensitivityScenarios: ['Replace proxy factors', 'Vary transport distance'] },
    landUseChangeMethod: 'Not modeled; disclosed separately as unavailable.',
    biogenicCarbonTreatment: 'Reported separately and never netted against fossil GWP.',
    evidenceDocumentIds: [originEvidence.evidenceId], externalAssuranceRecordId: null,
    limitations: 'Climate-only partial CFP; use and end-of-life excluded; not independently verified.',
    notes: 'Synthetic R12 control pilot; not ISO certification, EPD, PEF or assurance.'
  };
  const blockedPcf = await service.createPcfStudyRevision(ids.companyId, ids.shipmentId, ids.userId, {
    ...pcfBase, studyReference: `PCF-BLOCKED-${runId}`, comparativeAssertion: true,
    processMap: [], cutoff: { massPercent: 1, energyPercent: 1, environmentalSignificanceApplied: false, rationale: '' },
    dataQualityAssessment: '', uncertaintyAssessment: { method: 'rss_fallback', parameter: '', scenario: '', model: '', sensitivityScenarios: [] }
  });
  assert.equal(blockedPcf.automatedStatus, 'needs_information');
  assert.ok(blockedPcf.result.findings.some((item) => item.code === 'PCF_COMPARATIVE_ASSERTION_BLOCKED'));
  assert.ok(blockedPcf.result.findings.some((item) => item.code === 'PCF_CUTOFF_CRITERIA_INCOMPLETE'));
  assert.ok(blockedPcf.result.findings.some((item) => item.code === 'PCF_UNCERTAINTY_INCOMPLETE'));
  const blockedPcfApproval = await service.reviewPcfStudy(ids.companyId, ids.shipmentId, blockedPcf.id, ids.userId, {
    reviewerRole: 'pcf_practitioner_reviewer', decision: 'approved_for_internal_report', notes: 'Must fail.'
  });
  assert.equal(blockedPcfApproval.code, 'PCF_STUDY_NOT_CURRENT');
  check('r12_incomplete_scope_reproducibility_and_comparison_are_blocked');

  const invalidAssurancePcf = await service.createPcfStudyRevision(ids.companyId, ids.shipmentId, ids.userId, {
    ...pcfBase, studyReference: `PCF-ASSURANCE-BLOCKED-${runId}`, externalAssuranceRecordId: crypto.randomUUID()
  });
  assert.equal(invalidAssurancePcf.automatedStatus, 'needs_information');
  assert.ok(invalidAssurancePcf.result.findings.some((item) => item.code === 'PCF_ASSURANCE_INVALID'));
  assert.equal(invalidAssurancePcf.result.claimStatus, 'not_independently_verified');
  check('r12_verified_language_requires_authentic_assurance');

  const controlledPcf = await service.createPcfStudyRevision(ids.companyId, ids.shipmentId, ids.userId, {
    ...pcfBase, studyReference: `PCF-SHIRT-${runId}`
  });
  assert.equal(controlledPcf.automatedStatus, 'practitioner_review_required');
  assert.equal(controlledPcf.result.calculation.reportedTotalKgCO2e, controlledPcf.result.calculation.reproducedTotalKgCO2e);
  assert.equal(controlledPcf.result.claimStatus, 'not_independently_verified');
  const wrongPcfRole = await service.reviewPcfStudy(ids.companyId, ids.shipmentId, controlledPcf.id, ids.userId, {
    reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_report', notes: 'Wrong role.'
  });
  assert.equal(wrongPcfRole.code, 'PCF_REVIEW_ROLE_INVALID');
  const pcfReview = await service.reviewPcfStudy(ids.companyId, ids.shipmentId, controlledPcf.id, ids.userId, {
    reviewerRole: 'pcf_practitioner_reviewer', decision: 'approved_for_internal_report',
    notes: 'Synthetic goal, scope, boundary, calculation, data quality, uncertainty and evidence review for internal reporting only.'
  });
  assert.equal(pcfReview.inputSha256, controlledPcf.inputSha256);
  assert.equal(pcfReview.resultSha256, controlledPcf.resultSha256);
  assert.equal(pcfReview.calculationCanonicalInputHash, pcfSnapshot.canonicalInputHash);
  const pcfRegister = await service.listPcfStudies(ids.companyId, ids.shipmentId);
  const reopenedPcf = pcfRegister.find((item) => item.id === controlledPcf.id);
  assert.equal(reopenedPcf.studyStatus, 'approved_for_internal_report');
  assert.equal(await service.listPcfStudies(ids.otherCompanyId, ids.shipmentId), null);
  await assert.rejects(pool.query('UPDATE pcf_study_revisions SET automated_status=$1 WHERE id=$2', [
    'needs_information', controlledPcf.id
  ]), /append-only and immutable/i);
  result.pcfStudies.push({ id: controlledPcf.id, studyReference: controlledPcf.studyReference,
    revision: controlledPcf.revision, studyStatus: reopenedPcf.studyStatus,
    calculationCanonicalInputHash: controlledPcf.calculationCanonicalInputHash,
    inputSha256: controlledPcf.inputSha256, resultSha256: controlledPcf.resultSha256 });
  check('r12_study_is_calculation_hash_and_evidence_bound');

  await pool.query(
    `INSERT INTO electricity_invoices (company_id, facility_name, billing_period, kwh,
       emission_factor_kg_per_kwh, emission_factor_source, status, evidence_document_id, created_by)
     VALUES ($1,'Main Facility','2026-09',1000,0.4,'Synthetic Vietnam grid factor 2023','verified',$2,$3)`,
    [ids.companyId, originEvidence.evidenceId, ids.userId]
  );
  await pool.query(
    `INSERT INTO fuel_invoices (company_id, billing_period, fuel_type, quantity_liters,
       emission_factor_kg_per_liter, scope1_co2e_kg, status, evidence_document_id, created_by)
     VALUES ($1,'2026-09','diesel',100,2.5,250,'reviewed',$2,$3)`,
    [ids.companyId, originEvidence.evidenceId, ids.userId]
  );
  const ghgService = new CorporateGhgInventoryService(pool);
  const ghgDecisions = (categories, quantified) => categories.map((category) => ({
    category,
    status: quantified.includes(category) ? 'quantified' : 'not_relevant',
    rationale: quantified.includes(category) ? 'Included from reviewed invoice activity.' : 'Screened and not relevant.'
  }));
  const ghgBase = {
    inventoryDate: '2026-09-13', reportingEntityName: `Carrier pilot ${runId}`,
    reportingPeriodStart: '2026-09-01', reportingPeriodEnd: '2026-09-30',
    intendedUse: 'Synthetic internal management inventory control pilot.',
    organizationalBoundary: { approach: 'operational_control', description: 'All synthetic operations under operational control.',
      entities: [{ reference: 'ENTITY-1', name: `Carrier pilot ${runId}`, ownershipPercent: 100,
        included: true, rationale: 'Synthetic parent reporting entity.' }] },
    facilities: [{ reference: 'FAC-1', name: 'Main Facility', country: 'VN', included: true,
      rationale: 'Synthetic facility under operational control.', evidenceDocumentIds: [originEvidence.evidenceId] }],
    defaultFuelFacilityReference: 'FAC-1',
    operationalBoundary: {
      scope1: ghgDecisions(['stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions'], ['stationary_combustion']),
      scope2: ghgDecisions(['purchased_electricity', 'purchased_steam', 'purchased_heat', 'purchased_cooling'], ['purchased_electricity']),
      scope3Claim: 'not_included', scope3: []
    },
    gasCoverage: ['CO2', 'CH4', 'N2O', 'HFCs', 'PFCs', 'SF6', 'NF3'].map((gas) => ({
      gas, status: gas === 'CO2' ? 'quantified' : 'not_relevant',
      rationale: gas === 'CO2' ? 'CO2e factors applied.' : 'Screened; no relevant synthetic source.'
    })),
    baseYear: { year: 2025, emissionsKgCo2e: null,
      recalculationPolicy: 'Recalculate for structural or methodology changes above the significance threshold.',
      significanceThresholdPercent: 5, structuralChanges: 'None recorded.' },
    scope2Accounting: { marketBasedApplicable: false, locationBasedFactorVersion: 'Synthetic Vietnam grid EF 2023',
      gwpBasis: 'IPCC AR6 100-year', marketBasedMethod: '', contractualInstrumentEvidenceIds: [] },
    fuelFactorMetadata: [{ fuelType: 'diesel', source: 'Synthetic DEFRA-compatible conversion factor',
      version: '2025-pilot', gwpBasis: 'IPCC AR6 100-year' }],
    additionalSources: [], dataCompletenessPercent: 100,
    dataQualityAssessment: 'Source, period, factor provenance and representativeness reviewed.',
    dataImprovementPlan: 'Replace all synthetic values with primary facility records before real use.',
    uncertaintyAssessment: 'Qualitative activity-data and emission-factor uncertainty documented.',
    biogenicCo2Kg: 0, removalsCo2Kg: 0, offsetsRetiredKgCo2e: 20, exclusions: [],
    evidenceDocumentIds: [originEvidence.evidenceId],
    assurance: { verifiedLanguageRequested: false, providerName: '', level: '', statementDate: null, evidenceDocumentId: null },
    limitations: 'Synthetic internal Scope 1 and Scope 2 inventory; Scope 3 excluded; no independent assurance.',
    notes: 'R13 synthetic pilot; not certification or a public claim.'
  };
  const blockedGhg = await ghgService.createRevision(ids.companyId, ids.userId, {
    ...ghgBase, inventoryReference: `GHG-BLOCKED-${runId}`,
    operationalBoundary: { ...ghgBase.operationalBoundary, scope1: ghgBase.operationalBoundary.scope1.slice(0, 3) },
    scope2Accounting: { ...ghgBase.scope2Accounting, marketBasedApplicable: true },
    assurance: { verifiedLanguageRequested: true, providerName: 'Synthetic claimant', level: 'limited_assurance',
      statementDate: '2026-09-13', evidenceDocumentId: originEvidence.evidenceId }
  });
  assert.equal(blockedGhg.automatedStatus, 'needs_information');
  assert.ok(blockedGhg.result.findings.some((item) => item.code === 'GHG_OPERATIONAL_BOUNDARY_INCOMPLETE'));
  assert.ok(blockedGhg.result.findings.some((item) => item.code === 'GHG_SCOPE2_DUAL_REPORTING_INCOMPLETE'));
  assert.ok(blockedGhg.result.findings.some((item) => item.code === 'GHG_ASSURANCE_INVALID'));
  check('r13_incomplete_boundary_dual_scope2_and_assurance_are_blocked');

  const controlledGhg = await ghgService.createRevision(ids.companyId, ids.userId, {
    ...ghgBase, inventoryReference: `GHG-${runId}`
  });
  assert.equal(controlledGhg.automatedStatus, 'inventory_review_required');
  assert.deepEqual(controlledGhg.result.totals, {
    scope1KgCo2e: 250, scope2LocationBasedKgCo2e: 400, scope2MarketBasedKgCo2e: null,
    scope3KgCo2e: null, biogenicCo2Kg: 0, removalsCo2Kg: 0, offsetsRetiredKgCo2e: 20,
    grossScope1AndLocationScope2KgCo2e: 650
  });
  assert.equal(controlledGhg.result.activitySourceCount, 2);
  check('r13_gross_scope_totals_reproduce_without_offset_netting');

  const wrongGhgRole = await ghgService.review(ids.companyId, controlledGhg.id, ids.userId, {
    reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_report', notes: 'Wrong role.'
  });
  assert.equal(wrongGhgRole.code, 'GHG_REVIEW_ROLE_INVALID');
  const ghgReview = await ghgService.review(ids.companyId, controlledGhg.id, ids.userId, {
    reviewerRole: 'corporate_ghg_inventory_reviewer', decision: 'approved_for_internal_report',
    notes: 'Synthetic organizational boundary, operational boundary, source factors, completeness and uncertainty reviewed.'
  });
  assert.equal(ghgReview.reviewerName, 'Carrier Metadata Reviewer');
  assert.equal(ghgReview.inputSha256, controlledGhg.inputSha256);
  assert.equal(ghgReview.activitySnapshotSha256, controlledGhg.activitySnapshotSha256);
  assert.equal(ghgReview.resultSha256, controlledGhg.resultSha256);
  const ghgRegister = await ghgService.list(ids.companyId);
  assert.equal(ghgRegister.find((item) => item.id === controlledGhg.id).inventoryStatus, 'approved_for_internal_report');
  assert.deepEqual(await ghgService.list(ids.otherCompanyId), []);
  await assert.rejects(pool.query('UPDATE corporate_ghg_inventory_revisions SET automated_status=$1 WHERE id=$2', [
    'needs_information', controlledGhg.id
  ]), /append-only and immutable/i);
  result.corporateGhgInventories.push({ id: controlledGhg.id, inventoryReference: controlledGhg.inventoryReference,
    revision: controlledGhg.revision, inventoryStatus: 'approved_for_internal_report', inputSha256: controlledGhg.inputSha256,
    activitySnapshotSha256: controlledGhg.activitySnapshotSha256, resultSha256: controlledGhg.resultSha256,
    totals: controlledGhg.result.totals });
  check('r13_inventory_is_tenant_isolated_hash_bound_named_reviewed_and_immutable');

  const eprService = new EuTextileEprService(pool);
  const eprActor = { name: 'Synthetic Circular Textiles PRO',
    address: { street: '1 Circular Road', postalCode: '1000AA', city: 'Amsterdam', country: 'NL' },
    email: 'pro@invalid.example', phone: '', website: 'https://invalid.example/pro',
    nationalIdentificationCode: `PRO-NL-${runId}`, tradeRegisterNumber: `PRO-TRADE-${runId}`,
    taxIdentificationNumber: `PRO-TAX-${runId}`, mandateEvidenceIds: [originEvidence.evidenceId] };
  const eprBase = {
    assessmentDate: '2026-09-13', memberState: 'NL', reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31',
    intendedUse: 'Synthetic internal EU textile EPR planning and shipment reconciliation.',
    producer: { legalName: `Carrier pilot ${runId}`, trademarks: ['Synthetic Weave'], brandNames: ['Synthetic Weave'],
      address: { street: '1 Factory Road', postalCode: '700000', city: 'Ho Chi Minh City', country: 'VN' },
      email: 'epr@invalid.example', phone: '', website: 'https://invalid.example', contactPoint: 'Synthetic compliance team',
      nationalIdentificationCode: `VN-ID-${runId}`, tradeRegisterNumber: `VN-TRADE-${runId}`,
      taxIdentificationNumber: `VN-TAX-${runId}`, establishedCountry: 'VN', role: 'distance_seller', employeeCount: 20,
      annualTurnoverEur: 3000000, annualBalanceSheetEur: 2500000, suppliesUsedGoodsOnly: false,
      selfEmployedTailorCustomizedOnly: false, derivedFromUsedWasteOnly: false },
    authorizedRepresentative: { ...eprActor, applicable: false,
      nationalRuleBasis: 'Synthetic NL adapter records that the national authorised-representative rule remains unconfirmed.',
      mandateEvidenceIds: [] },
    producerResponsibilityOrganisation: eprActor, cnCodes: ['62052000'],
    memberStateRule: { adapterId: 'NL-EPR-SYNTHETIC-PLANNING', version: '2026-09-pilot',
      sourceUrl: 'https://eur-lex.europa.eu/eli/dir/2025/1892/oj', effectiveFrom: null, schemeStatus: 'unknown',
      competentAuthorityName: '', registerUrl: '', reportingSchedule: '', feeMethodStatus: 'pending',
      reviewEvidenceIds: [originEvidence.evidenceId] },
    declaredMarketRows: [{ cnCode: '62052000', quantity: 100, unit: 'PCE', weightKg: 50,
      productDescription: 'Synthetic cotton shirts' }], truthStatementConfirmed: true,
    evidenceDocumentIds: [originEvidence.evidenceId],
    limitations: 'Synthetic EU-core planning record. National registration, fee, reporting and submission rules are not encoded.',
    notes: 'R17 synthetic pilot; not a real registration, submission or payment.'
  };
  const blockedEpr = await eprService.createRevision(ids.companyId, ids.userId, {
    ...eprBase, assessmentReference: `EPR-BLOCKED-${runId}`, cnCodes: ['95030000'], truthStatementConfirmed: false,
    declaredMarketRows: [{ ...eprBase.declaredMarketRows[0], cnCode: '95030000', weightKg: 5 }]
  });
  assert.equal(blockedEpr.automatedStatus, 'needs_information');
  assert.ok(blockedEpr.result.findings.some((item) => item.code === 'EPR_CN_OUTSIDE_ANNEX_IVC'));
  assert.ok(blockedEpr.result.findings.some((item) => item.code === 'EPR_MARKET_VOLUME_MISMATCH'));
  assert.ok(blockedEpr.result.findings.some((item) => item.code === 'EPR_TRUTH_STATEMENT_REQUIRED'));
  check('r17_out_of_scope_unreconciled_and_unconfirmed_dossiers_are_blocked');

  const controlledEpr = await eprService.createRevision(ids.companyId, ids.userId, {
    ...eprBase, assessmentReference: `EPR-NL-${runId}`
  });
  assert.equal(controlledEpr.automatedStatus, 'specialist_review_required');
  assert.deepEqual(controlledEpr.result.totals, { declaredQuantity: 100, declaredWeightKg: 50,
    systemQuantity: 100, systemWeightKg: 50 });
  assert.equal(controlledEpr.result.reconciliation[0].status, 'matched');
  assert.equal(controlledEpr.result.registrationStatus, 'not_externally_confirmed');
  const wrongEprRole = await eprService.review(ids.companyId, controlledEpr.id, ids.userId, {
    reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_planning', notes: 'Wrong role.'
  });
  assert.equal(wrongEprRole.code, 'EPR_REVIEW_ROLE_INVALID');
  const eprReview = await eprService.review(ids.companyId, controlledEpr.id, ids.userId, {
    reviewerRole: 'eu_epr_specialist', decision: 'approved_for_internal_planning',
    notes: 'Synthetic producer role, Annex IVc scope, PRO mandate, national-adapter limitation and market-volume reconciliation reviewed.'
  });
  assert.equal(eprReview.reviewerName, 'Carrier Metadata Reviewer');
  assert.equal(eprReview.inputSha256, controlledEpr.inputSha256);
  assert.equal(eprReview.shipmentSnapshotSha256, controlledEpr.shipmentSnapshotSha256);
  check('r17_annex_ivc_market_quantity_and_weight_reconcile_to_shipment_ledger');

  const wrongEprEvidence = await eprService.recordExternalEvent(ids.companyId, controlledEpr.id, ids.userId, {
    eventType: 'authority_registration_confirmed', externalReference: `NL-EPR-WRONG-${runId}`,
    actorName: 'Synthetic EPR Authority', occurredAt: '2026-09-13T08:00:00Z', evidenceDocumentId: originEvidence.evidenceId
  });
  assert.equal(wrongEprEvidence.code, 'EPR_EXTERNAL_EVENT_EVIDENCE_TYPE_MISMATCH');
  const eprAuthorityEvidence = await insertEprAuthorityEvidence(ids, runId);
  const eprEvent = await eprService.recordExternalEvent(ids.companyId, controlledEpr.id, ids.userId, {
    eventType: 'authority_registration_confirmed', externalReference: `SYNTHETIC-NL-EPR-${runId}`,
    actorName: 'Synthetic EPR Authority', occurredAt: '2026-09-13T08:00:00Z',
    evidenceDocumentId: eprAuthorityEvidence.evidenceId
  });
  assert.equal(eprEvent.inputSha256, controlledEpr.inputSha256);
  assert.equal(eprEvent.shipmentSnapshotSha256, controlledEpr.shipmentSnapshotSha256);
  const eprRegister = await eprService.list(ids.companyId);
  const reopenedEpr = eprRegister.find((item) => item.id === controlledEpr.id);
  assert.equal(reopenedEpr.assessmentStatus, 'external_evidence_recorded');
  assert.deepEqual(reopenedEpr.externalMilestones, ['authority_registration_confirmed']);
  assert.deepEqual(await eprService.list(ids.otherCompanyId), []);
  await assert.rejects(pool.query('UPDATE eu_textile_epr_external_events SET actor_name=$1 WHERE id=$2', [
    'tampered', eprEvent.id
  ]), /append-only and immutable/i);
  result.euTextileEprAssessments.push({ id: controlledEpr.id, assessmentReference: controlledEpr.assessmentReference,
    revision: controlledEpr.revision, assessmentStatus: reopenedEpr.assessmentStatus,
    inputSha256: controlledEpr.inputSha256, shipmentSnapshotSha256: controlledEpr.shipmentSnapshotSha256,
    resultSha256: controlledEpr.resultSha256, totals: controlledEpr.result.totals,
    externalReference: eprEvent.externalReference, externalEvidenceSha256: eprEvent.evidenceSnapshot[0].checksumSha256 });
  check('r17_external_status_is_typed_evidence_backed_tenant_isolated_and_immutable');

  const firstReadiness = await service.getReadiness(ids.companyId, ids.shipmentId);
  assert.equal(firstReadiness.documents.find((item) => item.type === 'carbon_annex').status, 'ready');
  const firstAnnex = await service.createDocumentJob(ids.companyId, ids.shipmentId, ids.userId, 'carbon_annex', { outputFormat: 'xlsx' });
  const firstDocument = (await pool.query('SELECT * FROM export_documents WHERE id=$1', [firstAnnex.id])).rows[0];
  const firstWorkbook = await inspectCarbonAnnex(path.resolve(UPLOADS_ROOT, firstDocument.storage_key), [
    'SUPPLEMENTARY CARBON ANNEX', 'Carrier document type', 'Methodology version',
    'Factor provenance', 'Canonical input SHA-256', ids.carbonResult.methodologyVersion
  ]);
  assert.equal(sha256(firstWorkbook.buffer), firstDocument.file_sha256);
  const firstIssued = await service.issueDocument(ids.companyId, ids.shipmentId, firstAnnex.id, ids.userId);
  assert.equal(firstIssued.status, 'issued');
  result.documents.push({ id: firstAnnex.id, version: firstIssued.version, status: firstIssued.status, sha256: firstIssued.fileSha256 });
  check('carbon_annex_generated_and_issued_with_provenance');

  await pool.query('UPDATE shipment_containers SET seal_number=$1 WHERE id=$2', ['SEAL-REPLACEMENT', container.id]);
  const staleReadiness = await service.getReadiness(ids.companyId, ids.shipmentId);
  assert.equal(staleReadiness.documents.find((item) => item.type === 'carbon_annex').status, 'blocked');
  check('shipment_change_invalidates_prior_reconciliation');

  const secondEvidence = await insertCarrierEvidence(ids, runId, 'v2');
  const secondDraft = await service.createCarrierDocument(
    ids.companyId, ids.shipmentId, ids.userId,
    carrierMetadata(ids, runId, secondEvidence.evidenceId, 'SEAL-REPLACEMENT', firstDraft.structured.id)
  );
  assert.equal(secondDraft.structured.version, 2);
  const secondConfirmed = await service.confirmCarrierDocument(ids.companyId, ids.shipmentId, secondDraft.structured.id, ids.userId, {
    metadataConfirmed: true,
    confirmationNote: 'Synthetic replacement checked after carrier seal amendment.'
  });
  assert.equal(secondConfirmed.structured.status, 'confirmed');
  assert.equal((await service.getCarrierDocument(ids.companyId, ids.shipmentId, firstDraft.structured.id)).structured.status, 'superseded');
  const restoredReadiness = await service.getReadiness(ids.companyId, ids.shipmentId);
  assert.equal(restoredReadiness.documents.find((item) => item.type === 'carbon_annex').status, 'ready');
  check('replacement_version_restores_current_reconciliation', { version: secondConfirmed.structured.version });
}

(async () => {
  try {
    await run();
    result.status = 'passed';
    result.completedAt = new Date().toISOString();
    await writeResult();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.status = 'failed';
    result.completedAt = new Date().toISOString();
    result.error = { name: error.name, message: error.message, code: error.code || null };
    await writeResult().catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
