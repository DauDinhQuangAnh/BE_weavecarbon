const JSZip = require('jszip');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  CARRIER_RULESET_VERSION,
  carrierReconciliationSha256,
  createExportShipmentService,
  isCbamApplicable,
  sourceSnapshotSha256
} = require('../../src/services/exportShipmentService');
const { buildSimpleXlsx } = require('../../src/utils/simpleXlsx');

function readySnapshot(lineCount = 1) {
  const snapshot = {
    shipment: {
      id: 'shipment-1', referenceNumber: 'VN-EU-1', originCountry: 'VN', destinationCountry: 'FR'
    },
    profile: {
      invoiceNumber: 'INV-1', invoiceDate: '2026-09-07', poContractId: 'PO-1',
      invoiceIssuePlace: 'Ho Chi Minh City', packingListNumber: 'PL-1', packingListDate: '2026-09-07',
      incotermCode: 'FOB', incotermLocation: 'Cat Lai', currency: 'USD', paymentTerms: 'Net 30',
      exporterTaxId: '0312345678',
      exporter: { name: 'Exporter', address: 'HCMC', country: 'VN', contact: 'export@example.com' },
      importer: { name: 'Importer', address: 'Paris', country: 'FR', contact: 'import@example.com' },
      consignee: { name: 'Consignee', address: 'Paris', country: 'FR' },
      portOfLoading: 'Cat Lai', portOfDischarge: 'Rotterdam', billOfLadingNo: 'BL-1',
      transportMode: 'sea', discountAmount: 0, surchargeAmount: 0,
      importerEori: 'FR123456789000', carrierName: 'Ocean Carrier',
      customsValueAmount: lineCount * 50, customsValueBasis: 'Invoice transaction value',
      preferentialOriginClaim: false
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`, lineNumber: index + 1, sku: `SKU-${index + 1}`,
      goodsDescription: 'Cotton shirt', hsCode: '62052000', originCountry: 'VN',
      hsCodeSource: 'EU TARIC', hsCodeRuleset: 'TARIC-2026-09', hsCodeEffectiveDate: '2026-09-01',
      hsCodeConfirmed: true, styleCode: 'ST-1', sizeLabel: 'M', colorLabel: 'Blue', lotNumber: 'LOT-1',
      quantity: 10, unit: 'pcs', unitPrice: 5, currency: 'USD',
      netWeightKg: 2, grossWeightKg: 2.2, embeddedCo2eKg: 40,
      carbonAuthority: {
        authoritative: true, snapshotId: `carbon-snapshot-${index + 1}`, snapshotVersion: 1,
        engineVersion: 'engine-v1', methodologyVersion: 'textile-pcf-v2.1',
        factorRegistryVersion: 'factors-v1', gwpBasis: 'IPCC_AR5_100y',
        boundary: 'cradle_to_gate_plus_gate_to_market_extension', canonicalInputHash: 'a'.repeat(64),
        factorSnapshot: [{ id: 'cotton-v1', value: 5 }], allocationMethod: 'shipment_products.allocated_co2e'
      }
    })),
    containers: [{
      id: 'container-1', containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1', equipmentType: '40HC'
    }],
    packages: [{
      id: 'pallet-1', packageNumber: 'PLT-1', packageType: 'pallet', marksAndNumbers: 'PO-1',
      containerId: 'container-1', containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1',
      parentPackageId: null, parentPackageNumber: '', sequenceNo: 1,
      quantity: 1, netWeightKg: lineCount * 2, grossWeightKg: lineCount * 2.2,
      weightMeasurementBasis: 'group_total', dimensionMeasurementBasis: 'group_total',
      lengthCm: 120, widthCm: 100, heightCm: 120, contents: []
    }, {
      id: 'pkg-1', packageNumber: 'CTN-1', packageType: 'carton', marksAndNumbers: 'PO-1',
      containerId: 'container-1', containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1',
      parentPackageId: 'pallet-1', parentPackageNumber: 'PLT-1', sequenceNo: 2,
      quantity: 1, netWeightKg: lineCount * 2, grossWeightKg: lineCount * 2.2,
      weightMeasurementBasis: 'per_package', dimensionMeasurementBasis: 'per_package',
      lengthCm: 60, widthCm: 40, heightCm: 40,
      contents: Array.from({ length: lineCount }, (_, index) => ({ lineNumber: index + 1, quantity: 10 }))
    }],
    vnCustomsProfile: {
      schemaId: 'weavecarbon.vn-export-broker-handoff', schemaVersion: '1.0.0',
      rulesetVersion: 'R04-VN-CUSTOMS-HANDOFF-2026.09.1',
      regulatoryBasisVersion: 'TT38/2015+TT39/2018+TT121/2025@2026-02-01',
      filingPurpose: 'broker_handoff',
      declarant: { name: 'Exporter', taxId: '0312345678', address: 'HCMC', role: 'exporter' },
      customsBroker: { name: 'Broker Co', taxId: '0300000001' },
      customsOfficeCode: '02CI', declarationTypeCode: 'B11', cargoClassificationCode: 'A',
      transportMethodCode: '1', exitCustomsOfficeCode: '02CI', loadingLocationCode: 'VNSGN',
      destinationCountryCode: 'FR', invoiceClassificationCode: 'A', invoicePaymentMethodCode: 'TTR',
      exchangeRate: 25000, permitRequirementStatus: 'not_required', permitReferences: [],
      inspectionRequirementStatus: 'not_required', inspectionReferences: [],
      taxTreatment: 'not_subject', exportDutyRate: null, exportDutyAmount: null, taxBasis: '',
      supportingDocuments: [{ type: 'commercial_invoice' }, { type: 'packing_list' }],
      brokerTargetSchemaId: 'broker.vnaccs-import', brokerTargetSchemaVersion: '2026.1',
      declarationNotes: '', metadata: {}
    },
    carrierDocuments: [{
      id: 'ev-1', type: 'carrier_bill_of_lading', status: 'locked', approvedBy: 'user-1', validTo: null,
      checksumSha256: 'b'.repeat(64), fileSizeBytes: 100,
      structured: {
        id: 'carrier-1', evidenceDocumentId: 'ev-1', documentType: 'bill_of_lading',
        contractLevel: 'direct', transportMode: 'sea', documentNumber: 'BL-1', version: 1,
        status: 'confirmed', issuerName: 'Ocean Carrier', issueDate: '2026-09-07', issuePlace: 'HCMC',
        shipper: { name: 'Exporter' }, consignee: { name: 'Consignee' }, notifyParty: {},
        vesselName: 'MV Green', voyageNumber: 'V001', placeOfLoading: 'Cat Lai',
        placeOfDischarge: 'Rotterdam', goodsDescription: 'Cotton shirts', packageCount: 1,
        packageType: 'carton', marksAndNumbers: 'PO-1', grossWeightKg: lineCount * 2.2,
        measurementCbm: 0.096, containerNumbers: ['TCLU1234567'], sealNumbers: ['SEAL-1'],
        freightTerms: 'prepaid', authenticationMethod: 'carrier digital signature',
        authenticationReference: 'SIG-1', authenticityStatus: 'operator_confirmed',
        originalStatus: 'electronic', negotiable: false, metadataSource: 'manual', metadata: {}
      },
      latestReconciliation: null
    }],
    documents: []
  };
  snapshot.carrierDocuments[0].latestReconciliation = {
    status: 'passed', rulesetVersion: CARRIER_RULESET_VERSION,
    sourceSnapshotSha256: carrierReconciliationSha256(snapshot, snapshot.carrierDocuments[0])
  };
  const supportingSourceHash = sourceSnapshotSha256(snapshot);
  snapshot.documents = [
    {
      id: 'invoice-doc-1', type: 'commercial_invoice', version: 1, status: 'issued',
      payloadSha256: 'c'.repeat(64), fileSha256: 'd'.repeat(64),
      sourceSnapshotSha256: supportingSourceHash, filename: 'invoice.pdf', issuedAt: '2026-09-07T00:00:00Z'
    },
    {
      id: 'packing-doc-1', type: 'packing_list', version: 1, status: 'issued',
      payloadSha256: 'e'.repeat(64), fileSha256: 'f'.repeat(64),
      sourceSnapshotSha256: supportingSourceHash, filename: 'packing.pdf', issuedAt: '2026-09-07T00:00:00Z'
    }
  ];
  return snapshot;
}

describe('shipment export readiness', () => {
  test('verifies the exact carrier evidence bytes before confirmation', async () => {
    const uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weave-carrier-evidence-'));
    const storageKey = 'evidence/company/shipment/carrier.pdf';
    const filePath = path.join(uploadsRoot, storageKey);
    const buffer = Buffer.from('%PDF-1.7\nsynthetic carrier document\n');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    const service = createExportShipmentService({ database: {}, uploadsRoot });

    try {
      await expect(service._verifyCarrierEvidenceFile({
        storage_provider: 'local', storage_key: storageKey,
        checksum_sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        file_size_bytes: buffer.length
      })).resolves.toMatchObject({ fileSizeBytes: buffer.length });
      await fs.promises.appendFile(filePath, 'tampered');
      await expect(service._verifyCarrierEvidenceFile({
        storage_provider: 'local', storage_key: storageKey,
        checksum_sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        file_size_bytes: buffer.length
      })).resolves.toEqual({ error: 'CARRIER_EVIDENCE_FILE_TAMPERED' });
    } finally {
      await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
    }
  });

  test('textile and footwear codes do not trigger CBAM while an Annex-I heading does', () => {
    expect(isCbamApplicable('6109.10.00')).toBe(false);
    expect(isCbamApplicable('6205 20 00')).toBe(false);
    expect(isCbamApplicable('64041900')).toBe(false);
    expect(isCbamApplicable('7601 10 00')).toBe(true);
  });

  test('blocks missing shipment data and never treats document upload alone as export readiness', async () => {
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue({
      shipment: { id: 'shipment-1' }, profile: null, lines: [], packages: [],
      carrierDocuments: [{ id: 'ev-1', status: 'uploaded', type: 'carrier_bill_of_lading' }], documents: []
    });
    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.status).toBe('blocked');
    expect(result.documentCompleteness).toBe(0);
    expect(result.documents.find((item) => item.type === 'carbon_annex').status).toBe('blocked');
  });

  test('evaluates all rows without a 20-line cap', async () => {
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(readySnapshot(25));
    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.status).toBe('ready_to_issue');
    expect(result.requirements.some((item) => item.code === 'line_25_hs_code')).toBe(true);
    expect(result.cbam.status).toBe('CBAM_NOT_APPLICABLE');
  });

  test('changes the immutable source hash when shipment data or approved evidence changes', () => {
    const original = readySnapshot(2);
    const changed = readySnapshot(2);
    changed.lines[1].quantity = 11;
    expect(sourceSnapshotSha256(original)).not.toBe(sourceSnapshotSha256(changed));
    const changedSeal = readySnapshot(2);
    changedSeal.containers[0].sealNumber = 'SEAL-2';
    expect(sourceSnapshotSha256(original)).not.toBe(sourceSnapshotSha256(changedSeal));
    expect(sourceSnapshotSha256(original)).toBe(sourceSnapshotSha256(readySnapshot(2)));
  });

  test('rejects an unsupported output format before queueing work', async () => {
    const service = createExportShipmentService({ database: {} });
    await expect(service.createDocumentJob('company-1', 'shipment-1', 'user-1', 'commercial_invoice', { outputFormat: 'csv' }))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT_FORMAT' });
  });
});

describe('simple XLSX export', () => {
  test('writes every row and an explicit non-issued watermark', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ sku: `SKU-${index + 1}` }));
    const buffer = await buildSimpleXlsx({
      title: 'Commercial Invoice', columns: [{ key: 'sku', label: 'SKU' }], rows
    });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).toContain('DRAFT - NOT FOR CUSTOMS FILING');
    expect(xml).toContain('SKU-25');
  });

  test.each([
    ['commercial_invoice', ['Line value', 'Unit price', 'Invoice total', 'Payment terms', 'Issue place', 'Style', 'Lot']],
    ['packing_list', ['Container', 'Seal', 'Pallet', 'Package', 'Marks', 'Net kg', 'Gross kg', 'L x W x H cm', 'CBM', 'Total quantity']],
    ['carbon_annex', ['Embedded kg CO2e', 'Carrier document', 'Container', 'Methodology version', 'Factor registry version', 'Canonical input SHA-256']]
  ])('uses document-specific columns for %s', async (type, labels) => {
    const service = createExportShipmentService({ database: {} });
    const buffer = await service._buildDocumentBuffer(type, readySnapshot(2), false);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    labels.forEach((label) => expect(xml).toContain(label));
    expect(xml).toContain('CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON');
  });

  test('writes calculated invoice adjustments and package CBM into the workbook', async () => {
    const snapshot = readySnapshot(1);
    snapshot.profile.freightAmount = 11;
    snapshot.profile.insuranceAmount = 5;
    snapshot.profile.surchargeAmount = 3;
    snapshot.profile.discountAmount = 7;
    const service = createExportShipmentService({ database: {} });

    const invoiceZip = await JSZip.loadAsync(await service._buildDocumentBuffer('commercial_invoice', snapshot, false));
    const invoiceXml = await invoiceZip.file('xl/worksheets/sheet1.xml').async('string');
    expect(invoiceXml).toMatch(/Invoice total<\/t><\/is><\/c><c[^>]*><v>62<\/v>/);

    const packingZip = await JSZip.loadAsync(await service._buildDocumentBuffer('packing_list', snapshot, false));
    const packingXml = await packingZip.file('xl/worksheets/sheet1.xml').async('string');
    expect(packingXml).toMatch(/Total CBM<\/t><\/is><\/c><c[^>]*><v>0\.096<\/v>/);
    expect(packingXml).toMatch(/<v>0\.096<\/v>/);
  });

  test('builds an explicitly non-submittable R04 JSON payload pinned to issued support documents', async () => {
    const service = createExportShipmentService({ database: {} });
    const buffer = await service._buildDocumentBuffer('vn_customs_handoff', readySnapshot(2), false, 'json');
    const dataset = JSON.parse(buffer.toString('utf8'));

    expect(dataset).toMatchObject({
      authorityStatus: 'NOT_SUBMITTED',
      notForDirectSubmission: true,
      schema: { id: 'weavecarbon.vn-export-broker-handoff', version: '1.0.0' }
    });
    expect(dataset.goods).toHaveLength(2);
    expect(dataset.supportingDocuments.controlledIssuedDocuments).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'commercial_invoice', fileSha256: 'd'.repeat(64) }),
      expect.objectContaining({ type: 'packing_list', fileSha256: 'f'.repeat(64) })
    ]));
    expect(dataset.reconciliation.status).toBe('passed');
  });

  test.each(['commercial_invoice', 'packing_list'])('creates a printable PDF for %s', async (type) => {
    const service = createExportShipmentService({ database: {} });
    const buffer = await service._buildDocumentBuffer(type, readySnapshot(25), false, 'pdf');
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(20_000);
  });

  test('blocks invoice without confirmed HS and packing list without its own identity', async () => {
    const snapshot = readySnapshot(1);
    snapshot.lines[0].hsCodeConfirmed = false;
    snapshot.profile.packingListNumber = '';
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.documents.find((item) => item.type === 'commercial_invoice').status).toBe('blocked');
    expect(result.documents.find((item) => item.type === 'packing_list').status).toBe('blocked');
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'line_1_hs_code_confirmed', status: 'missing' }),
      expect.objectContaining({ code: 'packing_list_number', status: 'missing' })
    ]));
  });

  test('reconciles gross weight and prevents negative invoice totals', async () => {
    const snapshot = readySnapshot(1);
    snapshot.packages[1].grossWeightKg = 3;
    snapshot.profile.discountAmount = 1000;
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'gross_weight_cross_document', status: 'invalid' }),
      expect.objectContaining({ code: 'invoice_total_nonnegative', status: 'invalid' })
    ]));
  });

  test('blocks a flat package list without tenant-scoped container and pallet links', async () => {
    const snapshot = readySnapshot(1);
    snapshot.containers = [];
    snapshot.packages = [snapshot.packages[1]];
    snapshot.packages[0].containerId = null;
    snapshot.packages[0].parentPackageId = null;
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.getReadiness('company-1', 'shipment-1');

    expect(result.documents.find((item) => item.type === 'packing_list').status).toBe('blocked');
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'containers', status: 'missing' }),
      expect.objectContaining({ code: 'package_1_container', status: 'missing' }),
      expect.objectContaining({ code: 'package_1_parent', status: 'missing' })
    ]));
  });

  test('blocks malformed trade codes and dates before a review file is generated', async () => {
    const snapshot = readySnapshot(1);
    snapshot.profile.invoiceDate = '2026-02-30';
    snapshot.profile.currency = 'US';
    snapshot.profile.incotermCode = 'INVALID';
    snapshot.profile.transportMode = 'teleport';
    snapshot.profile.importerEori = 'INVALID-EORI';
    snapshot.profile.importerVatId = 'FR!';
    snapshot.profile.metadata = { buyerInstructionRequiresVat: true };
    snapshot.profile.exporter.country = 'Vietnam';
    snapshot.lines[0].hsCode = '62';
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.documents.find((item) => item.type === 'commercial_invoice').status).toBe('blocked');
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invoice_date_format', status: 'invalid' }),
      expect.objectContaining({ code: 'currency_format', status: 'invalid' }),
      expect.objectContaining({ code: 'incoterm_format', status: 'invalid' }),
      expect.objectContaining({ code: 'transport_mode_format', status: 'invalid' }),
      expect.objectContaining({ code: 'importer_eori_format', status: 'invalid' }),
      expect.objectContaining({ code: 'importer_vat_id_format', status: 'invalid' }),
      expect.objectContaining({ code: 'exporter_country_format', status: 'invalid' }),
      expect.objectContaining({ code: 'line_1_hs_code_format', status: 'invalid' })
    ]));
  });
});

describe('shipment export persistence safety', () => {
  const companyId = '00000000-0000-4000-8000-000000000001';
  const shipmentId = '00000000-0000-4000-8000-000000000002';
  const lineId = '00000000-0000-4000-8000-000000000003';
  const userId = '00000000-0000-4000-8000-000000000004';

  test('normalizes PostgreSQL DATE values before readiness validation', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId, reference_number: 'VN-EU-1' }] })
        .mockResolvedValueOnce({ rows: [{
          id: 'profile-1', shipment_id: shipmentId, target_market: 'EU',
          invoice_date: new Date('2026-09-09T00:00:00.000Z'),
          packing_list_date: new Date('2026-09-10T00:00:00.000Z')
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    };
    const service = createExportShipmentService({ database });

    const snapshot = await service.getProfile(companyId, shipmentId);

    expect(snapshot.profile.invoiceDate).toBe('2026-09-09');
    expect(snapshot.profile.packingListDate).toBe('2026-09-10');
  });

  test('profile upsert has a bound value for every SQL placeholder', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId }] })
        .mockResolvedValueOnce({ rows: [{ id: 'profile-1', shipment_id: shipmentId, target_market: 'EU' }] })
    };
    const service = createExportShipmentService({ database });

    await service.upsertProfile(companyId, shipmentId, userId, {});

    const [sql, values] = database.query.mock.calls[1];
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(...placeholders)).toBe(values.length);
    expect(values).toHaveLength(41);
  });

  test('Vietnam customs profile upsert has a bound value for every SQL placeholder', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId }] })
        .mockResolvedValueOnce({ rows: [{ id: 'customs-profile-1', shipment_id: shipmentId }] })
    };
    const service = createExportShipmentService({ database });

    await service.upsertVnCustomsProfile(companyId, shipmentId, userId, {});

    const [sql, values] = database.query.mock.calls[1];
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(...placeholders)).toBe(values.length);
    expect(values).toHaveLength(32);
  });

  test('uses the authenticated user for a new HS confirmation', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId }] })
        .mockImplementationOnce(async (_sql, values) => ({
          rows: [{
            id: lineId, shipment_id: shipmentId, line_number: 1, sku: 'SKU-1', goods_description: 'Shirt',
            hs_code: '62052000', origin_country: 'VN', quantity: 1, unit: 'pcs', hs_code_confirmed: values[22],
            hs_code_source: values[19], hs_code_ruleset: values[20], hs_code_effective_date: values[21],
            hs_code_confirmed_by: values[23], hs_code_confirmed_at: values[24]
          }]
        }))
    };
    const service = createExportShipmentService({ database });

    const line = await service.createLine(companyId, shipmentId, {
      lineNumber: 1, sku: 'SKU-1', goodsDescription: 'Shirt', hsCode: '62052000',
      originCountry: 'VN', quantity: 1, hsCodeSource: 'EU TARIC', hsCodeRuleset: 'TARIC-2026-09',
      hsCodeEffectiveDate: '2026-09-01', hsCodeConfirmed: true,
      hsCodeConfirmedBy: '00000000-0000-4000-8000-000000000099'
    }, userId);

    expect(line.hsCodeConfirmed).toBe(true);
    expect(line.hsCodeConfirmedBy).toBe(userId);
  });

  test('invalidates HS confirmation whenever the HS/CN code changes', async () => {
    const currentRow = {
      id: lineId, shipment_id: shipmentId, line_number: 1, sku: 'SKU-1', goods_description: 'Shirt',
      hs_code: '62052000', origin_country: 'VN', quantity: 1, unit: 'pcs', hs_code_confirmed: true,
      hs_code_source: 'EU TARIC', hs_code_ruleset: 'TARIC-2026-09', hs_code_effective_date: '2026-09-01',
      hs_code_confirmed_by: userId, hs_code_confirmed_at: new Date('2026-09-08T00:00:00Z')
    };
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockImplementationOnce(async (_sql, values) => ({ rows: [{
          ...currentRow, hs_code: values[3], hs_code_confirmed: values[19],
          hs_code_confirmed_by: values[19] ? values[20] : null,
          hs_code_confirmed_at: values[19] ? currentRow.hs_code_confirmed_at : null
        }] }))
    };
    const service = createExportShipmentService({ database });

    const line = await service.updateLine(companyId, shipmentId, lineId, {
      hsCode: '62053000', hsCodeSource: 'EU TARIC', hsCodeRuleset: 'TARIC-2026-09',
      hsCodeEffectiveDate: '2026-09-01', hsCodeConfirmed: true
    }, userId);

    expect(line.hsCode).toBe('62053000');
    expect(line.hsCodeConfirmed).toBe(false);
    expect(line.hsCodeConfirmedBy).toBeNull();
  });

  test('requires a complete HS source identity before accepting confirmation', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId }] })
        .mockImplementationOnce(async (_sql, values) => ({ rows: [{
          id: lineId, shipment_id: shipmentId, line_number: 1, sku: 'SKU-1', goods_description: 'Shirt',
          hs_code: '62052000', origin_country: 'VN', quantity: 1, unit: 'pcs', hs_code_confirmed: values[22]
        }] }))
    };
    const service = createExportShipmentService({ database });

    const line = await service.createLine(companyId, shipmentId, {
      lineNumber: 1, sku: 'SKU-1', goodsDescription: 'Shirt', hsCode: '62052000',
      originCountry: 'VN', quantity: 1, hsCodeConfirmed: true
    }, userId);

    expect(line.hsCodeConfirmed).toBe(false);
  });
});

describe('shipment export business review', () => {
  const companyId = '00000000-0000-4000-8000-000000000001';
  const shipmentId = '00000000-0000-4000-8000-000000000002';
  const documentId = '00000000-0000-4000-8000-000000000003';
  const userId = '00000000-0000-4000-8000-000000000004';
  const hash = 'a'.repeat(64);
  const fileHash = 'b'.repeat(64);

  test('pins an approved named review to payload, file and source hashes', async () => {
    const snapshot = readySnapshot(1);
    const sourceHash = sourceSnapshotSha256(snapshot);
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: documentId, shipment_id: shipmentId, company_id: companyId,
        document_type: 'commercial_invoice', status: 'ready', report_status: 'completed',
        payload: { sourceSnapshotSha256: sourceHash }, payload_sha256: hash, file_sha256: fileHash
      }] })
      .mockResolvedValueOnce({ rows: [{ id: userId, email: 'reviewer@example.com', full_name: 'Export Reviewer' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'review-1', export_document_id: documentId, shipment_id: shipmentId,
        document_type: 'commercial_invoice', reviewer_role: 'export_operator', decision: 'approved',
        notes: 'Checked against buyer instruction.', reviewed_by: userId,
        reviewer_name_snapshot: 'Export Reviewer', reviewer_email_snapshot: 'reviewer@example.com',
        document_payload_sha256: hash, document_file_sha256: fileHash,
        source_snapshot_sha256: sourceHash, reviewed_at: new Date('2026-09-09T00:00:00Z')
      }] }) };
    const service = createExportShipmentService({ database });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const review = await service.reviewDocument(companyId, shipmentId, documentId, userId, {
      reviewerRole: 'export_operator', decision: 'approved', notes: 'Checked against buyer instruction.'
    });

    expect(review).toMatchObject({ reviewerName: 'Export Reviewer', decision: 'approved', documentFileSha256: fileHash });
    expect(database.query.mock.calls[2][1]).toEqual(expect.arrayContaining([hash, fileHash, sourceHash, userId]));
  });

  test('blocks issue when the required named review is absent', async () => {
    const snapshot = readySnapshot(1);
    const sourceHash = sourceSnapshotSha256(snapshot);
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: documentId, report_id: 'report-1', shipment_id: shipmentId, company_id: companyId,
        document_type: 'commercial_invoice', status: 'ready', report_status: 'completed', file_format: 'pdf',
        payload: { sourceSnapshotSha256: sourceHash }, payload_sha256: hash, file_sha256: fileHash
      }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const service = createExportShipmentService({ database });
    service.getReadiness = jest.fn().mockResolvedValue({ documents: [{ type: 'commercial_invoice', status: 'ready' }] });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.issueDocument(companyId, shipmentId, documentId, userId);

    expect(result).toMatchObject({ blocked: true, code: 'DOCUMENT_REVIEW_REQUIRED' });
  });

  test('promotes the exact reviewed bytes and checksum when issuing', async () => {
    const snapshot = readySnapshot(1);
    const sourceHash = sourceSnapshotSha256(snapshot);
    const sourceBuffer = Buffer.from('approved exact commercial invoice bytes');
    const exactFileHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    const uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weave-export-issue-'));
    const storageKey = 'reports/company/shipment/commercial_invoice.pdf';
    const sourcePath = path.join(uploadsRoot, storageKey);
    await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.promises.writeFile(sourcePath, sourceBuffer);

    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: documentId, report_id: 'report-1', shipment_id: shipmentId, company_id: companyId,
          document_type: 'commercial_invoice', version: 1, status: 'issued', output_format: 'pdf',
          payload: { sourceSnapshotSha256: sourceHash }, payload_sha256: hash,
          storage_provider: 'local', storage_key: storageKey, file_sha256: exactFileHash,
          file_size_bytes: sourceBuffer.length, issued_at: new Date('2026-09-09T00:00:00Z')
        }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: jest.fn()
    };
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{
          id: documentId, report_id: 'report-1', shipment_id: shipmentId, company_id: companyId,
          document_type: 'commercial_invoice', version: 1, status: 'ready', report_status: 'completed',
          file_format: 'pdf', output_format: 'pdf', payload: { sourceSnapshotSha256: sourceHash },
          payload_sha256: hash, file_sha256: exactFileHash, file_size_bytes: sourceBuffer.length,
          storage_provider: 'local', storage_key: storageKey
        }] })
        .mockResolvedValueOnce({ rows: [{
          reviewer_role: 'export_operator', decision: 'approved', document_payload_sha256: hash,
          document_file_sha256: exactFileHash, source_snapshot_sha256: sourceHash
        }] }),
      connect: jest.fn().mockResolvedValue(client)
    };
    const service = createExportShipmentService({ database, uploadsRoot });
    service.getReadiness = jest.fn().mockResolvedValue({ documents: [{ type: 'commercial_invoice', status: 'ready' }] });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    try {
      const result = await service.issueDocument(companyId, shipmentId, documentId, userId);
      const issuedPath = path.join(uploadsRoot, 'reports', companyId, 'exports', shipmentId, `commercial_invoice_${shipmentId}_v1_issued.pdf`);
      const issuedBuffer = await fs.promises.readFile(issuedPath);

      expect(result.status).toBe('issued');
      expect(issuedBuffer.equals(sourceBuffer)).toBe(true);
      expect(client.query.mock.calls[2][1][5]).toBe(exactFileHash);
    } finally {
      await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
    }
  });

  test('does not multiply grouped package weight or grouped dimensions', async () => {
    const snapshot = readySnapshot(1);
    snapshot.packages[1].quantity = 2;
    snapshot.packages[1].weightMeasurementBasis = 'group_total';
    snapshot.packages[1].dimensionMeasurementBasis = 'group_total';
    const service = createExportShipmentService({ database: {} });
    const [row] = service._documentRows('packing_list', snapshot);

    expect(row.netWeightKg).toBe(2);
    expect(row.grossWeightKg).toBe(2.2);
    expect(row.cbm).toBeCloseTo(0.096);
  });
});
