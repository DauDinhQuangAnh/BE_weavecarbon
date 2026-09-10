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

const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA';
const result = {
  schemaVersion: 'weavecarbon-carrier-and-vn-customs-handoff-pilot-v2',
  startedAt: new Date().toISOString(),
  status: 'running',
  isolatedDatabaseConfirmed: false,
  productionDataTouched: false,
  checks: [],
  documents: [],
  customsEvents: []
};

function check(name, details = {}) {
  result.checks.push({ name, status: 'passed', ...details });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function writeResult() {
  const contents = `${JSON.stringify(result, null, 2)}\n`;
  for (const name of ['carrier-document-pilot', 'vn-customs-handoff-pilot']) {
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
    preferentialOriginClaim: false,
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
