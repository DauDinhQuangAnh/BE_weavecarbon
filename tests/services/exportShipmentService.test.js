const JSZip = require('jszip');
const { createExportShipmentService, isCbamApplicable, sourceSnapshotSha256 } = require('../../src/services/exportShipmentService');
const { buildSimpleXlsx } = require('../../src/utils/simpleXlsx');

function readySnapshot(lineCount = 1) {
  return {
    shipment: { id: 'shipment-1', referenceNumber: 'VN-EU-1' },
    profile: {
      invoiceNumber: 'INV-1', invoiceDate: '2026-09-07', poContractId: 'PO-1',
      incotermCode: 'FOB', incotermLocation: 'Cat Lai', currency: 'USD', paymentTerms: 'Net 30',
      exporterTaxId: '0312345678',
      exporter: { name: 'Exporter', address: 'HCMC, Vietnam' },
      importer: { name: 'Importer', address: 'Paris, France' },
      consignee: { name: 'Consignee', address: 'Paris, France' },
      portOfLoading: 'Cat Lai', portOfDischarge: 'Rotterdam', billOfLadingNo: 'BL-1',
      importerEori: 'FR123456789000',
      preferentialOriginClaim: false
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`, lineNumber: index + 1, sku: `SKU-${index + 1}`,
      goodsDescription: 'Cotton shirt', hsCode: '62052000', originCountry: 'VN',
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
    ['commercial_invoice', ['Line value', 'Unit price', 'Invoice total', 'Payment terms']],
    ['packing_list', ['Package', 'Marks', 'Net kg', 'Gross kg', 'L x W x H cm', 'Contents']],
    ['carbon_annex', ['Embedded kg CO2e', 'Carrier document', 'Container']]
  ])('uses document-specific columns for %s', async (type, labels) => {
    const service = createExportShipmentService({ database: {} });
    const buffer = await service._buildDocumentBuffer(type, readySnapshot(2), false);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    labels.forEach((label) => expect(xml).toContain(label));
    expect(xml).toContain('READY FOR INTERNAL REVIEW - NOT ISSUED');
  });
});
