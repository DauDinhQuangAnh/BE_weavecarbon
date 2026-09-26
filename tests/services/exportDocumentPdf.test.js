const PDFDocument = require('pdfkit');
const { buildExportDocumentPdf } = require('../../src/services/exportDocumentPdf');

function invoice() {
  return {
    shipment: { referenceNumber: 'R01-REVIEW' }, documentVersion: 2,
    profile: {
      invoiceNumber: 'INV-REVIEW', invoiceDate: '2026-09-26',
      exporter: { name: 'Seller', address: 'HCMC', country: 'VN' },
      importer: { name: 'Buyer', address: 'Paris', country: 'FR' },
      consignee: { name: 'Different receiving company', address: 'Receiving warehouse', country: 'DE' },
      currency: 'USD', incotermCode: 'FOB', incotermLocation: 'Cat Lai', incotermVersion: 'Incoterms 2020',
      packingListNumber: 'PL-REVIEW', billOfLadingNo: 'BL-REVIEW', customsDeclarationNo: 'CUSTOMS-REVIEW',
      placeOfDelivery: 'Berlin warehouse', carrierName: 'Review Carrier',
      vesselName: 'Review Vessel', voyageNumber: 'VOY-REVIEW',
      freightAmount: 0, insuranceAmount: 0, discountAmount: 0, surchargeAmount: 0,
    },
    lines: [{ lineNumber: 1, sku: 'PRECISION', goodsDescription: 'Precision-priced fabric',
      quantity: 1.2345, unitPrice: 0.123456, unit: 'kg', hsCode: '62052000', originCountry: 'VN' }],
  };
}

describe('Commercial Invoice PDF content and pagination', () => {
  let textCalls;
  beforeEach(() => {
    textCalls = [];
    const original = PDFDocument.prototype.text;
    jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (value, x, y, options) {
      textCalls.push({ value: String(value), x, y, pageHeight: this.page.height, options });
      return original.call(this, value, x, y, options);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('prints the consignee, linked references and Incoterms edition', async () => {
    await buildExportDocumentPdf('commercial_invoice', invoice());
    const content = textCalls.map((call) => call.value).join('\n');
    for (const value of ['Different receiving company', 'Receiving warehouse', 'PL-REVIEW',
      'BL-REVIEW', 'CUSTOMS-REVIEW', 'Berlin warehouse', 'Review Carrier', 'Review Vessel',
      'VOY-REVIEW', 'Incoterms 2020']) expect(content).toContain(value);
  });

  test('preserves stored quantity and unit-price precision, including sub-cent line amounts', async () => {
    const payload = invoice();
    payload.lines.push({ ...payload.lines[0], lineNumber: 2, quantity: 1, unitPrice: 0.015 });
    await buildExportDocumentPdf('commercial_invoice', payload);
    const content = textCalls.map((call) => call.value).join('\n');
    expect(content).toContain('1.2345');
    expect(content).toContain('0.123456 USD');
    expect(content).toContain('0.152406432 USD');
    expect(content).toContain('0.015 USD');
    expect(content).toContain('0.167406432 USD');
  });

  test('splits oversized descriptions across pages without drawing through the footer', async () => {
    const payload = invoice();
    payload.lines[0].goodsDescription = Array.from({ length: 300 }, (_, i) => `detail${i}`).join(' ');
    const buffer = await buildExportDocumentPdf('commercial_invoice', payload);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const descriptionCalls = textCalls.filter((call) => /detail\d/.test(call.value));
    expect(descriptionCalls.map((call) => call.value).join(' ')).toContain('detail299');
    expect(descriptionCalls.every((call) => call.y >= 76 && call.y < call.pageHeight - 62)).toBe(true);
  });
});
