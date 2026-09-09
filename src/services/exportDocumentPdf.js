const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'BeVietnamPro-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'BeVietnamPro-Bold.ttf');
const GREEN = '#315b28';
const LIGHT_GREEN = '#eef4eb';
const DARK = '#142014';
const MUTED = '#5f6c5c';
const BORDER = '#cdd8c9';
const PAGE_MARGIN = 36;

function clean(value) {
  return String(value ?? '').trim();
}

function money(value, currency = '') {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

function quantity(value, digits = 3) {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function partyLines(party = {}) {
  return [party.name, party.address, party.country, party.contact].map(clean).filter(Boolean);
}

function addBrandHeader(doc, title, reference, issued) {
  const width = doc.page.width;
  doc.save().opacity(1).fillOpacity(1).strokeOpacity(1);
  doc.rect(0, 0, width, 48).fill(GREEN);
  doc.fillColor('#ffffff').font('Bold').fontSize(16).text('WEAVECARBON', PAGE_MARGIN, 13);
  doc.font('Regular').fontSize(8).text('Shipment export document control', PAGE_MARGIN, 31);
  doc.font('Bold').fontSize(15).text(title, width - 330, 12, { width: 294, align: 'right' });
  doc.font('Regular').fontSize(8).text(reference, width - 330, 32, { width: 294, align: 'right' });
  doc.fillColor(GREEN).font('Bold').fontSize(8)
    .text('CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON', PAGE_MARGIN, 58, {
      width: width - PAGE_MARGIN * 2,
      align: 'right'
    });
  doc.restore();
  doc.y = 76;
}

function addKeyValues(doc, entries, columns = 3) {
  const gap = 10;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const colWidth = (width - gap * (columns - 1)) / columns;
  const startY = doc.y;
  const groups = Array.from({ length: columns }, () => []);
  entries.forEach((entry, index) => groups[index % columns].push(entry));
  let maxBottom = startY;
  groups.forEach((group, column) => {
    let y = startY;
    const x = PAGE_MARGIN + column * (colWidth + gap);
    group.forEach(([label, value]) => {
      doc.fillColor(MUTED).font('Bold').fontSize(6.8).text(label.toUpperCase(), x, y, { width: colWidth });
      const display = clean(value) || '-';
      const height = Math.max(11, doc.heightOfString(display, { width: colWidth }));
      doc.fillColor(DARK).font('Regular').fontSize(8.5).text(display, x, y + 9, { width: colWidth });
      y += height + 15;
    });
    maxBottom = Math.max(maxBottom, y);
  });
  doc.y = maxBottom + 2;
}

function addPartyBoxes(doc, leftTitle, leftParty, rightTitle, rightParty) {
  const gap = 12;
  const width = (doc.page.width - PAGE_MARGIN * 2 - gap) / 2;
  const linesLeft = partyLines(leftParty);
  const linesRight = partyLines(rightParty);
  const textHeight = Math.max(
    doc.heightOfString(linesLeft.join('\n') || '-', { width: width - 16 }),
    doc.heightOfString(linesRight.join('\n') || '-', { width: width - 16 })
  );
  const height = Math.max(58, textHeight + 30);
  const startY = doc.y;
  [[leftTitle, linesLeft, PAGE_MARGIN], [rightTitle, linesRight, PAGE_MARGIN + width + gap]].forEach(([title, lines, x]) => {
    doc.roundedRect(x, startY, width, height, 4).fillAndStroke(LIGHT_GREEN, BORDER);
    doc.fillColor(GREEN).font('Bold').fontSize(7.5).text(title, x + 8, startY + 7, { width: width - 16, lineBreak: false });
    doc.fillColor(DARK).font('Regular').fontSize(8.2).text(lines.join('\n') || '-', x + 8, startY + 21, {
      width: width - 16,
      lineGap: 1
    });
  });
  doc.y = startY + height + 10;
}

function wrappedLines(doc, value, width) {
  const paragraphs = (clean(value) || '-').split(/\r?\n/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let current = '';
    words.forEach((word) => {
      if (doc.widthOfString(word) > width) {
        if (current) { lines.push(current); current = ''; }
        let chunk = '';
        [...word].forEach((character) => {
          const candidate = `${chunk}${character}`;
          if (!chunk || doc.widthOfString(candidate) <= width) chunk = candidate;
          else { lines.push(chunk); chunk = character; }
        });
        current = chunk;
        return;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (!current || doc.widthOfString(candidate) <= width) current = candidate;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
  });
  return lines;
}

function tableRowHeight(doc, columns, row) {
  return Math.max(18, ...columns.map((column) => wrappedLines(doc, row[column.key], column.width - 8).length * 9 + 8));
}

function drawTableHeader(doc, columns, y) {
  let x = PAGE_MARGIN;
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.save();
  doc.rect(x, y, totalWidth, 28).fill(GREEN);
  columns.forEach((column) => {
    doc.fillColor('#ffffff').font('Bold').fontSize(6.2);
    wrappedLines(doc, column.label, column.width - 8).slice(0, 2).forEach((line, lineIndex) => {
      doc.text(line, x + 4, y + 6 + lineIndex * 7.5, { width: column.width - 8, align: column.align || 'left', lineBreak: false });
    });
    x += column.width;
  });
  doc.restore();
  return y + 28;
}

function drawTable(doc, title, columns, rows, pageTitle, reference, issued) {
  doc.fillColor(GREEN).font('Bold').fontSize(10).text(title, PAGE_MARGIN, doc.y);
  let y = doc.y + 16;
  y = drawTableHeader(doc, columns, y);
  rows.forEach((row, index) => {
    doc.font('Regular').fontSize(7.2);
    const rowHeight = tableRowHeight(doc, columns, row);
    if (y + rowHeight > doc.page.height - 72) {
      doc.addPage();
      addBrandHeader(doc, pageTitle, reference, issued);
      y = drawTableHeader(doc, columns, doc.y);
    }
    const background = index % 2 ? '#f8faf7' : '#ffffff';
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    doc.save();
    doc.rect(PAGE_MARGIN, y, totalWidth, rowHeight).fillAndStroke(background, BORDER);
    let x = PAGE_MARGIN;
    columns.forEach((column) => {
      const value = clean(row[column.key]) || '-';
      doc.fillColor(DARK).font('Regular').fontSize(7.2);
      wrappedLines(doc, value, column.width - 8).forEach((line, lineIndex) => {
        doc.text(line, x + 4, y + 4 + lineIndex * 9, { width: column.width - 8, align: column.align || 'left', lineBreak: false });
      });
      x += column.width;
    });
    doc.restore();
    y += rowHeight;
    doc.x = PAGE_MARGIN;
    doc.y = y;
  });
  doc.y = y + 10;
}

function ensureVerticalSpace(doc, requiredHeight, pageTitle, reference, issued) {
  if (doc.y + requiredHeight <= doc.page.height - 62) return;
  doc.addPage();
  addBrandHeader(doc, pageTitle, reference, issued);
}

function leafPackages(payload) {
  return (payload.packages || []).filter((item) => clean(item.packageType).toLowerCase() !== 'pallet');
}

function packageFactor(item, field) {
  const basis = field === 'weight' ? item.weightMeasurementBasis : item.dimensionMeasurementBasis;
  return basis === 'group_total' ? 1 : Number(item.quantity || 1);
}

function invoiceRows(payload) {
  const currency = payload.profile?.currency || '';
  return (payload.lines || []).map((line) => ({
    line: line.lineNumber,
    sku: line.sku,
    description: [line.goodsDescription, line.styleCode, line.sizeLabel, line.colorLabel, line.lotNumber].filter(Boolean).join(' / '),
    hs: line.hsCode,
    hsBasis: [line.hsCodeSource, line.hsCodeRuleset, line.hsCodeEffectiveDate].filter(Boolean).join(' | '),
    origin: line.originCountry,
    quantity: quantity(line.quantity),
    unit: line.unit,
    price: money(line.unitPrice, currency),
    value: money(Number(line.quantity || 0) * Number(line.unitPrice || 0), currency)
  }));
}

function packingRows(payload) {
  return leafPackages(payload).map((item) => ({
    container: item.containerNumber,
    seal: item.sealNumber,
    pallet: item.parentPackageNumber,
    package: item.packageNumber,
    type: item.packageType,
    marks: item.marksAndNumbers,
    count: quantity(item.quantity, 0),
    weightBasis: item.weightMeasurementBasis === 'group_total' ? 'Group total' : 'Per package',
    net: quantity(Number(item.netWeightKg || 0) * packageFactor(item, 'weight')),
    gross: quantity(Number(item.grossWeightKg || 0) * packageFactor(item, 'weight')),
    dimensionBasis: item.dimensionMeasurementBasis === 'group_total' ? 'Group total' : 'Per package',
    dimensions: [item.lengthCm, item.widthCm, item.heightCm].map(quantity).join(' x '),
    cbm: quantity(packageFactor(item, 'dimension') * Number(item.lengthCm || 0) * Number(item.widthCm || 0) * Number(item.heightCm || 0) / 1_000_000),
    contents: (item.contents || []).map((content) => `${content.sku || `Line ${content.lineNumber}`}: ${quantity(content.quantity)}`).join('; ')
  }));
}

function addInvoiceTotals(doc, payload) {
  const profile = payload.profile || {};
  const currency = profile.currency || '';
  const goods = (payload.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const entries = [
    ['Goods total', goods],
    ['Freight', Number(profile.freightAmount || 0)],
    ['Insurance', Number(profile.insuranceAmount || 0)],
    ['Surcharge', Number(profile.surchargeAmount || 0)],
    ['Discount', -Number(profile.discountAmount || 0)]
  ];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const x = doc.page.width - PAGE_MARGIN - 230;
  let y = doc.y;
  entries.forEach(([label, value]) => {
    doc.fillColor(MUTED).font('Regular').fontSize(8).text(label, x, y, { width: 105, lineBreak: false });
    doc.fillColor(DARK).font('Regular').text(money(value, currency), x + 105, y, { width: 125, align: 'right', lineBreak: false });
    y += 12;
  });
  doc.moveTo(x, y).lineTo(x + 230, y).strokeColor(GREEN).stroke();
  y += 7;
  doc.fillColor(GREEN).font('Bold').fontSize(10).text('INVOICE TOTAL', x, y, { width: 105, lineBreak: false });
  doc.text(money(total, currency), x + 105, y, { width: 125, align: 'right', lineBreak: false });
  doc.y = y + 24;
}

function addPackingTotals(doc, payload) {
  const packages = leafPackages(payload);
  const totals = {
    packages: packages.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    quantity: (payload.lines || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    net: packages.reduce((sum, item) => sum + Number(item.netWeightKg || 0) * packageFactor(item, 'weight'), 0),
    gross: packages.reduce((sum, item) => sum + Number(item.grossWeightKg || 0) * packageFactor(item, 'weight'), 0),
    cbm: packages.reduce((sum, item) => sum + packageFactor(item, 'dimension') * Number(item.lengthCm || 0) * Number(item.widthCm || 0) * Number(item.heightCm || 0) / 1_000_000, 0)
  };
  const labels = [
    ['Containers', (payload.containers || []).length], ['Packages', totals.packages], ['Goods quantity', totals.quantity],
    ['Net weight', `${quantity(totals.net)} kg`], ['Gross weight', `${quantity(totals.gross)} kg`], ['Volume', `${quantity(totals.cbm)} CBM`]
  ];
  const boxWidth = (doc.page.width - PAGE_MARGIN * 2 - 25) / labels.length;
  const startY = doc.y;
  labels.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * (boxWidth + 5);
    doc.roundedRect(x, startY, boxWidth, 38, 3).fillAndStroke(LIGHT_GREEN, BORDER);
    doc.fillColor(MUTED).font('Bold').fontSize(6.5).text(label.toUpperCase(), x + 5, startY + 6, { width: boxWidth - 10, lineBreak: false });
    doc.fillColor(GREEN).font('Bold').fontSize(10).text(clean(value), x + 5, startY + 19, { width: boxWidth - 10, lineBreak: false });
  });
  doc.y = startY + 50;
}

function addFootersAndWatermarks(doc, issued) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const width = doc.page.width;
    const height = doc.page.height;
    doc.save().opacity(0.055).fillColor(GREEN).font('Bold').fontSize(30)
      .rotate(-25, { origin: [width / 2, height / 2] })
      .text('CONTROLLED COPY', width / 2 - 210, height / 2 - 20, { width: 420, align: 'center', lineBreak: false })
      .restore();
    doc.moveTo(PAGE_MARGIN, height - 55).lineTo(width - PAGE_MARGIN, height - 55).strokeColor(BORDER).stroke();
    doc.fillColor(MUTED).font('Regular').fontSize(6.8)
      .text('Generated from an immutable shipment snapshot. Verify against signed commercial and carrier records.', PAGE_MARGIN, height - 49, { width: width - PAGE_MARGIN * 2 - 70, lineBreak: false });
    doc.text(`Page ${index - range.start + 1} / ${range.count}`, width - PAGE_MARGIN - 70, height - 49, { width: 70, align: 'right', lineBreak: false });
  }
}

async function buildExportDocumentPdf(type, payload, issued = false) {
  if (!['commercial_invoice', 'packing_list'].includes(type)) {
    throw new Error('PDF output is supported only for Commercial Invoice and Packing List.');
  }
  const profile = payload.profile || {};
  const shipmentRef = payload.shipment?.referenceNumber || payload.shipment?.id || '';
  const title = type === 'commercial_invoice' ? 'COMMERCIAL INVOICE' : 'PACKING LIST';
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN, bufferPages: true, compress: true });
  doc.registerFont('Regular', FONT_REGULAR);
  doc.registerFont('Bold', FONT_BOLD);
  doc.font('Regular');
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  addBrandHeader(doc, title, `Shipment ${shipmentRef} | Version ${payload.documentVersion || '-'}`, issued);
  if (type === 'commercial_invoice') {
    addPartyBoxes(doc, 'EXPORTER / SELLER', profile.exporter, 'IMPORTER / BUYER', profile.importer);
    addKeyValues(doc, [
      ['Invoice number', profile.invoiceNumber], ['Invoice date', profile.invoiceDate], ['Issue place', profile.invoiceIssuePlace],
      ['PO / Contract', profile.poContractId], ['Payment terms', profile.paymentTerms], ['Exporter tax ID', profile.exporterTaxId],
      ['Importer EORI / VAT', [profile.importerEori, profile.importerVatId].filter(Boolean).join(' / ')],
      ['Incoterm', `${profile.incotermCode || ''} ${profile.incotermLocation || ''}`], ['Currency', profile.currency],
      ['Customs value / basis', `${money(profile.customsValueAmount, profile.currency)} | ${profile.customsValueBasis || ''}`],
      ['Transport', `${profile.transportMode || ''} | ${profile.portOfLoading || ''} -> ${profile.portOfDischarge || ''}`]
    ]);
    drawTable(doc, 'GOODS', [
      { key: 'line', label: '#', width: 25, align: 'right' }, { key: 'sku', label: 'SKU', width: 66 },
      { key: 'description', label: 'DESCRIPTION / STYLE / SIZE / COLOUR / LOT', width: 150 },
      { key: 'hs', label: 'HS/CN', width: 62 }, { key: 'hsBasis', label: 'HS SOURCE / RULESET / DATE', width: 94 },
      { key: 'origin', label: 'ORIGIN', width: 40 },
      { key: 'quantity', label: 'QTY', width: 45, align: 'right' }, { key: 'unit', label: 'UNIT', width: 38 },
      { key: 'price', label: 'UNIT PRICE', width: 86, align: 'right' }, { key: 'value', label: 'LINE VALUE', width: 90, align: 'right' }
    ], invoiceRows(payload), title, shipmentRef, issued);
    ensureVerticalSpace(doc, 92, title, shipmentRef, issued);
    addInvoiceTotals(doc, payload);
  } else {
    addPartyBoxes(doc, 'EXPORTER', profile.exporter, 'CONSIGNEE', profile.consignee);
    addKeyValues(doc, [
      ['Packing list number', profile.packingListNumber], ['Packing list date', profile.packingListDate], ['Invoice number', profile.invoiceNumber],
      ['PO / Contract', profile.poContractId], ['Carrier / transport company', profile.carrierName], ['Carrier document', profile.billOfLadingNo],
      ['Transport mode', profile.transportMode],
      ['Port / place of loading', profile.portOfLoading], ['Port / place of discharge', profile.portOfDischarge], ['Place of delivery', profile.placeOfDelivery]
    ]);
    drawTable(doc, 'CONTAINER - PALLET - CARTON LEDGER', [
      { key: 'container', label: 'CONTAINER', width: 76 }, { key: 'seal', label: 'SEAL', width: 65 },
      { key: 'pallet', label: 'PALLET', width: 58 }, { key: 'package', label: 'PACKAGE', width: 58 },
      { key: 'type', label: 'TYPE', width: 39 }, { key: 'marks', label: 'MARKS', width: 62 },
      { key: 'count', label: 'COUNT', width: 38, align: 'right' }, { key: 'weightBasis', label: 'WT BASIS', width: 45 },
      { key: 'net', label: 'NET KG TOTAL', width: 45, align: 'right' },
      { key: 'gross', label: 'GROSS KG TOTAL', width: 49, align: 'right' }, { key: 'dimensionBasis', label: 'DIM BASIS', width: 45 },
      { key: 'dimensions', label: 'L X W X H CM', width: 66 },
      { key: 'cbm', label: 'CBM TOTAL', width: 40, align: 'right' }, { key: 'contents', label: 'CONTENTS', width: 66 }
    ], packingRows(payload), title, shipmentRef, issued);
    ensureVerticalSpace(doc, 72, title, shipmentRef, issued);
    addPackingTotals(doc, payload);
  }

  ensureVerticalSpace(doc, 12, title, shipmentRef, issued);
  doc.fillColor(MUTED).font('Regular').fontSize(7.5)
    .text('Document control: values come from an immutable shipment snapshot. Review and issue status are controlled in WeaveCarbon; carrier records remain authoritative.', PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
  addFootersAndWatermarks(doc, issued);
  doc.end();
  await completed;
  return Buffer.concat(chunks);
}

module.exports = { buildExportDocumentPdf };
