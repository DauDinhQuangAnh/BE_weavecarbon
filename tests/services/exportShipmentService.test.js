const JSZip = require('jszip');
const { createExportShipmentService, isCbamApplicable, sourceSnapshotSha256 } = require('../../src/services/exportShipmentService');
const { buildSimpleXlsx } = require('../../src/utils/simpleXlsx');

function readySnapshot(lineCount = 1) {
  return {
    shipment: { id: 'shipment-1', referenceNumber: 'VN-EU-1' },
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
      importerEori: 'FR123456789000',
      preferentialOriginClaim: false
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`, lineNumber: index + 1, sku: `SKU-${index + 1}`,
      goodsDescription: 'Cotton shirt', hsCode: '62052000', originCountry: 'VN',
      hsCodeConfirmed: true, styleCode: 'ST-1', sizeLabel: 'M', colorLabel: 'Blue', lotNumber: 'LOT-1',
      quantity: 10, unit: 'pcs', unitPrice: 5, currency: 'USD',
      netWeightKg: 2, grossWeightKg: 2.2, embeddedCo2eKg: 40
    })),
    packages: [{
      id: 'pkg-1', packageNumber: 'CTN-1', packageType: 'carton', marksAndNumbers: 'PO-1',
      quantity: 1, netWeightKg: lineCount * 2, grossWeightKg: lineCount * 2.2,
      lengthCm: 60, widthCm: 40, heightCm: 40,
      contents: Array.from({ length: lineCount }, (_, index) => ({ lineNumber: index + 1, quantity: 10 }))
    }],
    carrierDocuments: [{ id: 'ev-1', type: 'carrier_bill_of_lading', status: 'locked', approvedBy: 'user-1', validTo: null }],
    documents: []
  };
}

describe('shipment export readiness', () => {
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
    expect(sourceSnapshotSha256(original)).toBe(sourceSnapshotSha256(readySnapshot(2)));
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
    ['packing_list', ['Package', 'Marks', 'Net kg', 'Gross kg', 'L x W x H cm', 'CBM', 'Total quantity']],
    ['carbon_annex', ['Embedded kg CO2e', 'Carrier document', 'Container']]
  ])('uses document-specific columns for %s', async (type, labels) => {
    const service = createExportShipmentService({ database: {} });
    const buffer = await service._buildDocumentBuffer(type, readySnapshot(2), false);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    labels.forEach((label) => expect(xml).toContain(label));
    expect(xml).toContain('READY FOR INTERNAL REVIEW - NOT ISSUED');
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
    snapshot.packages[0].grossWeightKg = 3;
    snapshot.profile.discountAmount = 1000;
    const service = createExportShipmentService({ database: {} });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const result = await service.getReadiness('company-1', 'shipment-1');
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'gross_weight_cross_document', status: 'invalid' }),
      expect.objectContaining({ code: 'invoice_total_nonnegative', status: 'invalid' })
    ]));
  });

  test('blocks malformed trade codes and dates before a review file is generated', async () => {
    const snapshot = readySnapshot(1);
    snapshot.profile.invoiceDate = '2026-02-30';
    snapshot.profile.currency = 'US';
    snapshot.profile.incotermCode = 'INVALID';
    snapshot.profile.transportMode = 'teleport';
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
    expect(values).toHaveLength(37);
  });

  test('uses the authenticated user for a new HS confirmation', async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: shipmentId }] })
        .mockImplementationOnce(async (_sql, values) => ({
          rows: [{
            id: lineId, shipment_id: shipmentId, line_number: 1, sku: 'SKU-1', goods_description: 'Shirt',
            hs_code: '62052000', origin_country: 'VN', quantity: 1, unit: 'pcs', hs_code_confirmed: values[19],
            hs_code_confirmed_by: values[20], hs_code_confirmed_at: values[21]
          }]
        }))
    };
    const service = createExportShipmentService({ database });

    const line = await service.createLine(companyId, shipmentId, {
      lineNumber: 1, sku: 'SKU-1', goodsDescription: 'Shirt', hsCode: '62052000',
      originCountry: 'VN', quantity: 1, hsCodeConfirmed: true,
      hsCodeConfirmedBy: '00000000-0000-4000-8000-000000000099'
    }, userId);

    expect(line.hsCodeConfirmed).toBe(true);
    expect(line.hsCodeConfirmedBy).toBe(userId);
  });

  test('invalidates HS confirmation whenever the HS/CN code changes', async () => {
    const currentRow = {
      id: lineId, shipment_id: shipmentId, line_number: 1, sku: 'SKU-1', goods_description: 'Shirt',
      hs_code: '62052000', origin_country: 'VN', quantity: 1, unit: 'pcs', hs_code_confirmed: true,
      hs_code_confirmed_by: userId, hs_code_confirmed_at: new Date('2026-09-08T00:00:00Z')
    };
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [currentRow] })
        .mockImplementationOnce(async (_sql, values) => ({ rows: [{
          ...currentRow, hs_code: values[3], hs_code_confirmed: values[16],
          hs_code_confirmed_by: values[16] ? values[17] : null,
          hs_code_confirmed_at: values[16] ? currentRow.hs_code_confirmed_at : null
        }] }))
    };
    const service = createExportShipmentService({ database });

    const line = await service.updateLine(companyId, shipmentId, lineId, {
      hsCode: '62053000', hsCodeConfirmed: true
    }, userId);

    expect(line.hsCode).toBe('62053000');
    expect(line.hsCodeConfirmed).toBe(false);
    expect(line.hsCodeConfirmedBy).toBeNull();
  });
});
