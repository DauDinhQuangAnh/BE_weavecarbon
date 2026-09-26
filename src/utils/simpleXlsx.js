const JSZip = require('jszip');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellXml(value, ref, style = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function buildRows(title, metadata, columns, rows, watermark, printLayout) {
  const output = [];
  let rowNumber = 1;
  const addRow = (values, style = 0, height = null) => {
    const cells = values.map((value, index) => cellXml(value, `${columnName(index)}${rowNumber}`, style)).join('');
    output.push(`<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`);
    rowNumber += 1;
  };

  addRow([title], 1);
  addRow([watermark], 2);
  const widths = columns.map((_, index) => printLayout?.widths?.[index] || 20);
  const heightFor = (value, width) => String(value ?? '').split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, width - 2))), 0) * 15 + 4;
  Object.entries(metadata || {}).forEach(([key, value]) => addRow([key, value ?? ''], printLayout ? 4 : 0,
    printLayout ? Math.min(409, Math.max(heightFor(key, widths[0]), heightFor(value, widths.slice(1).reduce((a, b) => a + b, 0)))) : null));
  rowNumber += 1;
  addRow(columns.map((column) => column.label), printLayout ? 5 : 3, printLayout ? 45 : null);
  rows.forEach((row) => addRow(columns.map((column) => row[column.key] ?? ''), printLayout ? 4 : 0,
    printLayout ? Math.min(409, Math.max(...columns.map((column, index) => heightFor(row[column.key], widths[index])))) : null));
  return output.join('');
}

async function buildSimpleXlsx({ title, sheetName = 'Export', metadata = {}, columns, rows, watermark = 'DRAFT - NOT FOR CUSTOMS FILING', printLayout = null }) {
  const zip = new JSZip();
  const headerRow = Object.keys(metadata).length + 4;
  const lastColumn = columnName(columns.length - 1);
  const lastRow = headerRow + rows.length;
  const sheetReference = escapeXml(`'${sheetName.slice(0, 31).replace(/'/g, "''")}'`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>
  ${printLayout ? `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${sheetReference}!$A$1:$${lastColumn}$${lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">${sheetReference}!$${headerRow}:$${headerRow}</definedName></definedNames>` : ''}
</workbook>`);
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.folder('xl').file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4"><font/><font><b/><sz val="16"/><color rgb="FF1B4332"/></font><font><b/><color rgb="FFC00000"/></font><font><b/><color rgb="FFFFFFFF"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B4332"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="6"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/><xf fontId="3" fillId="2" applyFont="1" applyFill="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="3" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
</styleSheet>`);
  const sheetRows = buildRows(title, metadata, columns, rows, watermark, printLayout);
  const mergeRefs = printLayout ? [
    `A1:${lastColumn}1`, `A2:${lastColumn}2`,
    ...Object.keys(metadata).map((_, index) => `B${index + 3}:${lastColumn}${index + 3}`)
  ] : [];
  zip.folder('xl').folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${printLayout ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${columns.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${printLayout?.widths?.[index] || 20}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${sheetRows}</sheetData><autoFilter ref="A${Object.keys(metadata || {}).length + 4}:${columnName(columns.length - 1)}${Object.keys(metadata || {}).length + rows.length + 4}"/>
  ${printLayout ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` : ''}
</worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildSimpleXlsx };

