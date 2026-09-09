#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildExportDocumentPdf } = require('../src/services/exportDocumentPdf');

function buildFixture() {
  const containers = [1, 2].map((number) => ({
    id: `container-${number}`,
    containerNumber: `TCLU123456${number}`,
    sealNumber: `SEAL-EU-00${number}`,
    equipmentType: '40HC'
  }));
  const pallets = containers.map((container, index) => ({
    id: `pallet-${index + 1}`,
    packageNumber: `PLT-${String(index + 1).padStart(2, '0')}`,
    packageType: 'pallet',
    containerId: container.id,
    containerNumber: container.containerNumber,
    sealNumber: container.sealNumber,
    parentPackageId: null,
    parentPackageNumber: '',
    marksAndNumbers: `PO-EU-2026 / PALLET ${index + 1}`,
    quantity: 1,
    netWeightKg: 125,
    grossWeightKg: 137.5,
    lengthCm: 120,
    widthCm: 100,
    heightCm: 180,
    contents: []
  }));
  const lines = Array.from({ length: 25 }, (_, index) => ({
    id: `line-${index + 1}`,
    lineNumber: index + 1,
    sku: `EU-SKU-${String(index + 1).padStart(3, '0')}`,
    goodsDescription: index % 3 === 2 ? 'Synthetic low-cut textile upper footwear for layout verification' : 'Synthetic knitted cotton crew-neck T-shirt for layout verification',
    styleCode: `STYLE-${1000 + index + 1}`,
    sizeLabel: index % 2 ? 'M' : 'L',
    colorLabel: index % 2 ? 'Navy blue' : 'Natural white',
    lotNumber: 'LOT-2026-09-A',
    hsCode: index % 3 === 2 ? '64041900' : '61091000',
    originCountry: 'VN',
    quantity: 10,
    unit: 'pcs',
    unitPrice: 12.5 + index,
    currency: 'USD',
    netWeightKg: 10,
    grossWeightKg: 11
  }));
  const cartons = lines.map((line, index) => {
    const hierarchyIndex = index % 2;
    return {
      id: `carton-${index + 1}`,
      packageNumber: `CTN-${String(index + 1).padStart(3, '0')}`,
      packageType: 'carton',
      containerId: containers[hierarchyIndex].id,
      containerNumber: containers[hierarchyIndex].containerNumber,
      sealNumber: containers[hierarchyIndex].sealNumber,
      parentPackageId: pallets[hierarchyIndex].id,
      parentPackageNumber: pallets[hierarchyIndex].packageNumber,
      marksAndNumbers: `PO-EU-2026 / ${line.sku}`,
      quantity: 1,
      netWeightKg: 10,
      grossWeightKg: 11,
      lengthCm: 60,
      widthCm: 40,
      heightCm: 40,
      contents: [{ lineNumber: line.lineNumber, sku: line.sku, quantity: line.quantity }]
    };
  });
  return {
    shipment: { id: 'synthetic-shipment', referenceNumber: 'VN-EU-PDF-QA-2026-09' },
    profile: {
      invoiceNumber: 'INV-QA-2026-09-001', invoiceDate: '2026-09-09', invoiceIssuePlace: 'Ho Chi Minh City, Vietnam',
      packingListNumber: 'PL-QA-2026-09-001', packingListDate: '2026-09-09', poContractId: 'PO-EU-2026',
      paymentTerms: 'T/T 30 days from bill of lading date', exporterTaxId: '0312345678', currency: 'USD',
      incotermCode: 'CIF', incotermLocation: 'Port of Rotterdam, Netherlands', transportMode: 'Sea',
      portOfLoading: 'Cat Lai Port, Vietnam', portOfDischarge: 'Port of Rotterdam, Netherlands',
      placeOfDelivery: 'Rotterdam Distribution Centre, Netherlands', billOfLadingNo: 'SYNTHETIC-BL-QA-001',
      freightAmount: 1250, insuranceAmount: 125, surchargeAmount: 75, discountAmount: 50,
      exporter: { name: 'Synthetic Vietnam Textile Exporter Co., Ltd.', address: '123 Export Industrial Road, Ho Chi Minh City', country: 'VN', contact: 'export@invalid.example | +84 28 0000 0000' },
      importer: { name: 'Synthetic EU Importer B.V.', address: '10 Importhaven, Rotterdam', country: 'NL', contact: 'import@invalid.example | +31 10 000 0000' },
      consignee: { name: 'Synthetic EU Distribution Warehouse B.V.', address: '20 Warehouse Park, Rotterdam', country: 'NL', contact: 'warehouse@invalid.example' }
    },
    lines,
    containers,
    packages: [...pallets, ...cartons],
    documentVersion: 1
  };
}

async function run() {
  const outputDir = path.resolve(__dirname, '..', 'output', 'pdf');
  await fs.promises.mkdir(outputDir, { recursive: true });
  const fixture = buildFixture();
  for (const type of ['commercial_invoice', 'packing_list']) {
    const buffer = await buildExportDocumentPdf(type, fixture, false);
    const output = path.join(outputDir, `${type}_two_container_qa.pdf`);
    await fs.promises.writeFile(output, buffer);
    process.stdout.write(`${output} ${buffer.length} bytes\n`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
