const fs = require('fs');
const path = require('path');
const { buildExportDocumentPdf } = require('../src/services/exportDocumentPdf');

function fixture() {
  const lines = Array.from({ length: 25 }, (_, index) => ({
    lineNumber: index + 1,
    sku: `SKU-${String(index + 1).padStart(3, '0')}`,
    goodsDescription: `Organic cotton woven shirt - long sleeve export quality line ${index + 1}`,
    styleCode: `WC-${1000 + index}`,
    sizeLabel: ['S', 'M', 'L', 'XL'][index % 4],
    colorLabel: ['Navy', 'White', 'Olive'][index % 3],
    lotNumber: `LOT-2609-${index + 1}`,
    hsCode: '62052000',
    hsCodeSource: 'EU TARIC',
    hsCodeRuleset: 'TARIC-2026-09',
    hsCodeEffectiveDate: '2026-09-01',
    originCountry: 'VN',
    quantity: 40,
    unit: 'pcs',
    unitPrice: 12.5,
    currency: 'EUR',
    netWeightKg: 10,
    grossWeightKg: 11
  }));
  const packages = [{
    id: 'pallet-1', packageNumber: 'PLT-001', packageType: 'pallet', marksAndNumbers: 'PO-EU-2026-09',
    containerId: 'container-1', containerNumber: 'MSCU1234567', sealNumber: 'SEAL260901',
    parentPackageId: null, parentPackageNumber: '', sequenceNo: 1, quantity: 1,
    netWeightKg: 250, grossWeightKg: 275, weightMeasurementBasis: 'group_total',
    lengthCm: 120, widthCm: 100, heightCm: 180, dimensionMeasurementBasis: 'group_total', contents: []
  }, ...Array.from({ length: 25 }, (_, index) => ({
    id: `carton-${index + 1}`, packageNumber: `CTN-${String(index + 1).padStart(3, '0')}`,
    packageType: 'carton', marksAndNumbers: `PO-EU-2026-09 / ${index + 1}/25`,
    containerId: 'container-1', containerNumber: 'MSCU1234567', sealNumber: 'SEAL260901',
    parentPackageId: 'pallet-1', parentPackageNumber: 'PLT-001', sequenceNo: index + 2,
    quantity: 2, netWeightKg: 5, grossWeightKg: 5.5, weightMeasurementBasis: 'per_package',
    lengthCm: 60, widthCm: 40, heightCm: 35, dimensionMeasurementBasis: 'per_package',
    contents: [{ lineNumber: index + 1, quantity: 40 }]
  }))];
  return {
    shipment: { id: 'qa-shipment', referenceNumber: 'VN-EU-QA-2026-001' },
    profile: {
      invoiceNumber: 'INV-WC-2026-001', invoiceDate: '2026-09-09', invoiceIssuePlace: 'Ho Chi Minh City, Vietnam',
      packingListNumber: 'PL-WC-2026-001', packingListDate: '2026-09-09', poContractId: 'PO-EU-2026-09',
      exporter: { name: 'WeaveCarbon Textile Export Co., Ltd.', address: '123 Nguyen Van Linh, Ho Chi Minh City', country: 'VN', contact: 'export@weavecarbon.com' },
      importer: { name: 'EU Sustainable Apparel GmbH', address: 'Friedrichstrasse 100, Berlin', country: 'DE', contact: 'import@example.eu' },
      consignee: { name: 'Rotterdam Distribution Centre B.V.', address: 'Maasvlakte 2, Rotterdam', country: 'NL', contact: 'receiving@example.eu' },
      exporterTaxId: '0312345678', importerEori: 'DE123456789012345', importerVatId: 'DE123456789',
      incotermCode: 'CIF', incotermLocation: 'Rotterdam', incotermVersion: 'Incoterms 2020',
      currency: 'EUR', paymentTerms: '30 days from B/L date', freightAmount: 850, insuranceAmount: 125,
      discountAmount: 0, surchargeAmount: 0, customsValueAmount: 13475,
      customsValueBasis: 'Transaction value including freight and insurance', transportMode: 'sea',
      carrierName: 'QA Ocean Carrier', billOfLadingNo: 'BL-QA-2609001',
      portOfLoading: 'Cat Lai, Vietnam', portOfDischarge: 'Rotterdam, Netherlands'
    },
    lines,
    containers: [{ id: 'container-1', containerNumber: 'MSCU1234567', sealNumber: 'SEAL260901', equipmentType: '40HC' }],
    packages,
    documentVersion: 1
  };
}

async function main() {
  const payload = fixture();
  const outputDir = path.resolve(__dirname, '..', 'output', 'pdf');
  await fs.promises.mkdir(outputDir, { recursive: true });
  const outputs = [
    ['commercial_invoice', 'commercial-invoice-r01-qa.pdf'],
    ['packing_list', 'packing-list-r02-qa.pdf']
  ];
  for (const [type, filename] of outputs) {
    const buffer = await buildExportDocumentPdf(type, payload, false);
    await fs.promises.writeFile(path.join(outputDir, filename), buffer);
  }
  process.stdout.write(`${outputDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
