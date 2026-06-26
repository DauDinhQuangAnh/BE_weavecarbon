const PDFDocument = require('pdfkit');
const pool = require('../config/database');

const BRAND = '#1a7a4a';
const BRAND_LIGHT = '#e8f5ee';
const MUTED = '#666666';
const DARK = '#1a1a1a';
const RED = '#d32f2f';
const COL_GAP = 6;

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(val, decimals = 2) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n.toFixed(decimals) : '—';
}

function fmtDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('vi-VN'); } catch { return String(val).slice(0, 10); }
}

function nowStr() {
  return new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ── PDF drawing primitives ────────────────────────────────────────────────────

function addPageHeader(doc, title, subtitle, companyName) {
  // Green top bar
  doc.rect(0, 0, doc.page.width, 52).fill(BRAND);

  // Title
  doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
     .text('WeaveCarbon', 40, 14)
     .fontSize(10).font('Helvetica')
     .text('Carbon Intelligence Platform', 40, 33);

  // Report title block (right side)
  doc.fontSize(9).font('Helvetica')
     .text(nowStr(), 0, 18, { align: 'right', width: doc.page.width - 40 });

  // Title section
  doc.fillColor(DARK).fontSize(18).font('Helvetica-Bold')
     .text(title, 40, 72);

  if (subtitle) {
    doc.fillColor(MUTED).fontSize(10).font('Helvetica')
       .text(subtitle, 40, 96);
  }

  if (companyName) {
    doc.fillColor(BRAND).fontSize(10).font('Helvetica-Bold')
       .text(companyName, 40, subtitle ? 112 : 96);
  }

  doc.moveDown(0.5);
  doc.moveTo(40, subtitle ? 130 : 114).lineTo(doc.page.width - 40, subtitle ? 130 : 114)
     .strokeColor(BRAND).lineWidth(1).stroke();
  doc.y = (subtitle ? 138 : 122);
}

function addSectionTitle(doc, text) {
  doc.moveDown(0.8);
  doc.rect(40, doc.y, doc.page.width - 80, 20).fill(BRAND_LIGHT);
  doc.fillColor(BRAND).fontSize(10).font('Helvetica-Bold')
     .text(text, 46, doc.y - 16);
  doc.moveDown(0.3);
}

function addKpi(doc, label, value, unit = '') {
  const x = doc.x;
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label, x, doc.y);
  doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
     .text(`${value} ${unit}`.trim(), x, doc.y);
  doc.moveDown(0.2);
}

function addKpiRow(doc, items) {
  const startY = doc.y + 4;
  const colW = (doc.page.width - 80) / items.length;
  items.forEach((item, i) => {
    const cx = 40 + i * colW;
    doc.rect(cx, startY, colW - 4, 42).fill(BRAND_LIGHT).stroke('#d0e8d8');
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
       .text(item.label, cx + 6, startY + 4, { width: colW - 12 });
    doc.fillColor(BRAND).fontSize(14).font('Helvetica-Bold')
       .text(item.value, cx + 6, startY + 15, { width: colW - 12 });
    if (item.unit) {
      doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
         .text(item.unit, cx + 6, startY + 30, { width: colW - 12 });
    }
  });
  doc.y = startY + 50;
}

/**
 * Draw a table. columns = [{label, key, width}], rows = array of objects
 */
function drawTable(doc, columns, rows, options = {}) {
  const startX = options.x || 40;
  const tableW = options.width || (doc.page.width - 80);
  const rowH = options.rowH || 18;
  const headerH = options.headerH || 20;
  const fontSize = options.fontSize || 8;
  const maxRows = options.maxRows || 200;
  const displayRows = rows.slice(0, maxRows);

  // Auto distribute widths if not set
  const totalFixed = columns.reduce((s, c) => s + (c.width || 0), 0);
  const autoCount = columns.filter(c => !c.width).length;
  const autoW = autoCount ? (tableW - totalFixed) / autoCount : 0;
  const cols = columns.map(c => ({ ...c, w: c.width || autoW }));

  let y = doc.y;

  // Check space
  const needed = headerH + displayRows.length * rowH + 10;
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    y = 50;
  }

  // Header row
  doc.rect(startX, y, tableW, headerH).fill(BRAND);
  let cx = startX;
  cols.forEach(col => {
    doc.fillColor('#ffffff').fontSize(fontSize).font('Helvetica-Bold')
       .text(col.label, cx + COL_GAP, y + 5, { width: col.w - COL_GAP * 2, ellipsis: true });
    cx += col.w;
  });
  y += headerH;

  // Data rows
  displayRows.forEach((row, i) => {
    if (y + rowH > doc.page.height - 60) {
      doc.addPage();
      y = 50;
      // Repeat header
      doc.rect(startX, y, tableW, headerH).fill(BRAND);
      let hx = startX;
      cols.forEach(col => {
        doc.fillColor('#ffffff').fontSize(fontSize).font('Helvetica-Bold')
           .text(col.label, hx + COL_GAP, y + 5, { width: col.w - COL_GAP * 2, ellipsis: true });
        hx += col.w;
      });
      y += headerH;
    }

    const bg = i % 2 === 0 ? '#ffffff' : '#f8fcfa';
    doc.rect(startX, y, tableW, rowH).fill(bg);

    cx = startX;
    cols.forEach(col => {
      const val = col.format ? col.format(row[col.key], row) : (row[col.key] ?? '—');
      const color = col.color ? col.color(row[col.key], row) : DARK;
      doc.fillColor(color).fontSize(fontSize).font('Helvetica')
         .text(String(val), cx + COL_GAP, y + 5, { width: col.w - COL_GAP * 2, ellipsis: true });
      cx += col.w;
    });

    // bottom border
    doc.moveTo(startX, y + rowH).lineTo(startX + tableW, y + rowH)
       .strokeColor('#e0e0e0').lineWidth(0.5).stroke();
    y += rowH;
  });

  // Outer border
  doc.rect(startX, doc.y, tableW, y - doc.y).strokeColor('#c0d8c8').lineWidth(0.5).stroke();
  doc.y = y + 6;

  if (rows.length > maxRows) {
    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text(`... và ${rows.length - maxRows} dòng nữa (xem export CSV để có đầy đủ)`, startX, doc.y);
    doc.moveDown(0.3);
  }
}

function addFooter(doc, reportType, methodology) {
  const y = doc.page.height - 44;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
     .text(`Phương pháp luận: ${methodology}`, 40, y + 6, { width: doc.page.width - 80 })
     .text(`WeaveCarbon — Báo cáo ${reportType} — Tạo tự động ${nowStr()}`, 40, y + 18, { width: doc.page.width - 80 });
}

function addDisclaimer(doc) {
  addSectionTitle(doc, 'Tuyên bố miễn trừ trách nhiệm');
  doc.fillColor(MUTED).fontSize(8).font('Helvetica')
     .text(
       'Báo cáo này được tạo tự động từ dữ liệu nhập bởi người dùng. Đây là ước tính tiền-kiểm tra (pre-audit), ' +
       'không phải chứng chỉ chính thức và cần đơn vị thẩm tra độc lập để sử dụng trong giao dịch thương mại. ' +
       'Hệ số phát thải: Ecoinvent v3.10 · DEFRA 2025 · IEA 2023 · Higg MSI 2023 · SAC Higg FEM.',
       40, doc.y, { width: doc.page.width - 80 }
     );
}

// ── Report generators ─────────────────────────────────────────────────────────

async function generateProductCarbonPdf(doc, companyId) {
  const client = await pool.connect();
  try {
    const [companyRes, productsRes] = await Promise.all([
      client.query('SELECT name, business_type FROM companies WHERE id = $1', [companyId]),
      client.query(`
        SELECT sku, name, category, weight_kg,
               total_co2e, materials_co2e, production_co2e,
               transport_co2e, packaging_co2e,
               data_confidence_score, status, created_at
        FROM products
        WHERE company_id = $1 AND status <> 'archived'
        ORDER BY total_co2e DESC NULLS LAST
      `, [companyId])
    ]);

    const company = companyRes.rows[0] || {};
    const rows = productsRes.rows;
    const totalCo2 = rows.reduce((s, r) => s + parseFloat(r.total_co2e || 0), 0);
    const avgConf = rows.length
      ? (rows.reduce((s, r) => s + parseFloat(r.data_confidence_score || 50), 0) / rows.length).toFixed(0)
      : 0;

    addPageHeader(doc,
      'Báo cáo PCF Sản phẩm',
      'ISO 14067:2018 · Bóc tách Scope 1 / 2 / 3 theo từng SKU',
      company.name
    );

    addKpiRow(doc, [
      { label: 'Tổng sản phẩm', value: rows.length, unit: 'SKU' },
      { label: 'Tổng phát thải', value: fmtNum(totalCo2, 1), unit: 'kg CO₂e' },
      { label: 'Bình quân / SKU', value: rows.length ? fmtNum(totalCo2 / rows.length, 2) : '—', unit: 'kg CO₂e/SKU' },
      { label: 'Độ tin cậy TB', value: avgConf + '%', unit: 'Confidence Score' },
    ]);

    addSectionTitle(doc, 'Danh sách phát thải theo SKU');

    drawTable(doc, [
      { label: 'SKU', key: 'sku', width: 80 },
      { label: 'Tên sản phẩm', key: 'name', width: 120 },
      { label: 'KL (kg)', key: 'weight_kg', format: v => fmtNum(v, 3), width: 56 },
      { label: 'Vật liệu', key: 'materials_co2e', format: v => fmtNum(v), width: 62 },
      { label: 'SX (S1/S2)', key: 'production_co2e', format: v => fmtNum(v), width: 62 },
      { label: 'Vận chuyển', key: 'transport_co2e', format: v => fmtNum(v), width: 62 },
      { label: 'Bao bì', key: 'packaging_co2e', format: v => fmtNum(v), width: 50 },
      { label: 'Tổng CO₂e', key: 'total_co2e', format: v => fmtNum(v),
        color: (v) => parseFloat(v) > 10 ? RED : BRAND, width: 62 },
    ], rows);

    addDisclaimer(doc);
    addFooter(doc, 'PCF Sản phẩm', 'ISO 14067:2018 · GHG Protocol Product Standard · Ecoinvent v3.10 · Higg MSI 2023');
    return rows.length;
  } finally {
    client.release();
  }
}

async function generateBatchExportPdf(doc, companyId) {
  const client = await pool.connect();
  try {
    const [companyRes, shipmentsRes] = await Promise.all([
      client.query('SELECT name FROM companies WHERE id = $1', [companyId]),
      client.query(`
        SELECT s.id, s.reference_number, s.status, s.origin_country,
               s.destination_country, s.transport_mode, s.total_co2e,
               s.total_distance_km, s.created_at,
               COUNT(sp.product_id)::int AS product_count
        FROM shipments s
        LEFT JOIN shipment_products sp ON sp.shipment_id = s.id
        WHERE s.company_id = $1 AND s.status <> 'cancelled'
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `, [companyId])
    ]);

    const company = companyRes.rows[0] || {};
    const rows = shipmentsRes.rows;
    const totalCo2 = rows.reduce((s, r) => s + parseFloat(r.total_co2e || 0), 0);
    const totalDist = rows.reduce((s, r) => s + parseFloat(r.total_distance_km || 0), 0);

    addPageHeader(doc,
      'Báo cáo Lô Xuất khẩu',
      'CBAM-ready · Phát thải vận chuyển phân bổ theo lô hàng',
      company.name
    );

    addKpiRow(doc, [
      { label: 'Tổng lô hàng', value: rows.length, unit: 'shipments' },
      { label: 'Tổng CO₂e vận chuyển', value: fmtNum(totalCo2, 1), unit: 'kg CO₂e' },
      { label: 'Tổng quãng đường', value: fmtNum(totalDist, 0), unit: 'km' },
      { label: 'TB / lô hàng', value: rows.length ? fmtNum(totalCo2 / rows.length, 2) : '—', unit: 'kg CO₂e/lô' },
    ]);

    addSectionTitle(doc, 'Chi tiết từng lô hàng');

    drawTable(doc, [
      { label: 'Mã tham chiếu', key: 'reference_number', width: 100 },
      { label: 'Trạng thái', key: 'status', width: 70 },
      { label: 'Xuất phát', key: 'origin_country', width: 70 },
      { label: 'Đích đến', key: 'destination_country', width: 70 },
      { label: 'Phương tiện', key: 'transport_mode', width: 70 },
      { label: 'Khoảng cách (km)', key: 'total_distance_km', format: v => fmtNum(v, 0), width: 70 },
      { label: 'SP', key: 'product_count', width: 40 },
      { label: 'CO₂e (kg)', key: 'total_co2e', format: v => fmtNum(v), width: 65 },
    ], rows);

    addSectionTitle(doc, 'Phương pháp tính phát thải vận chuyển');
    doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
       .text(
         'Phát thải vận chuyển được tính theo công thức: CO₂e = Khoảng cách (km) × Khối lượng (t) × Hệ số phát thải (kg CO₂e / t·km). ' +
         'Hệ số phát thải: Đường biển 0.013 · Đường hàng không 0.602 · Đường bộ 0.062 · Đường sắt 0.028 (DEFRA 2025).',
         40, doc.y, { width: doc.page.width - 80 }
       );

    addDisclaimer(doc);
    addFooter(doc, 'Lô Xuất khẩu', 'DEFRA 2025 Transport Factors · GHG Protocol Scope 3 Cat. 9 · IMO MEPC');
    return rows.length;
  } finally {
    client.release();
  }
}

async function generateFacilityEmissionPdf(doc, companyId) {
  const client = await pool.connect();
  try {
    const [companyRes, elecRes, fuelRes] = await Promise.all([
      client.query('SELECT name FROM companies WHERE id = $1', [companyId]),
      client.query(`
        SELECT facility_name, billing_period, kwh,
               emission_factor_kg_per_kwh, emission_factor_source,
               scope2_co2e_kg, status
        FROM electricity_invoices WHERE company_id = $1
        ORDER BY billing_period DESC
      `, [companyId]),
      client.query(`
        SELECT billing_period, fuel_type, quantity_liters,
               emission_factor_kg_per_liter, scope1_co2e_kg, status
        FROM fuel_invoices WHERE company_id = $1
        ORDER BY billing_period DESC
      `, [companyId])
    ]);

    const company = companyRes.rows[0] || {};
    const elec = elecRes.rows;
    const fuels = fuelRes.rows;
    const totalScope1 = fuels.reduce((s, r) => s + parseFloat(r.scope1_co2e_kg || 0), 0);
    const totalScope2 = elec.reduce((s, r) => s + parseFloat(r.scope2_co2e_kg || 0), 0);
    const totalKwh = elec.reduce((s, r) => s + parseFloat(r.kwh || 0), 0);

    addPageHeader(doc,
      'Báo cáo Phát thải Cơ sở',
      'GHG Protocol · Scope 1 (nhiên liệu) & Scope 2 (điện lưới)',
      company.name
    );

    addKpiRow(doc, [
      { label: 'Scope 1 (nhiên liệu)', value: fmtNum(totalScope1, 1), unit: 'kg CO₂e' },
      { label: 'Scope 2 (điện lưới)', value: fmtNum(totalScope2, 1), unit: 'kg CO₂e' },
      { label: 'Tổng Scope 1+2', value: fmtNum(totalScope1 + totalScope2, 1), unit: 'kg CO₂e' },
      { label: 'Tổng điện tiêu thụ', value: fmtNum(totalKwh, 0), unit: 'kWh' },
    ]);

    addSectionTitle(doc, 'Hóa đơn điện — Scope 2');

    if (elec.length === 0) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text('Chưa có hóa đơn điện. Tải chứng từ tại trang Chứng từ.', 40, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(doc, [
        { label: 'Cơ sở', key: 'facility_name', width: 110 },
        { label: 'Kỳ', key: 'billing_period', width: 80 },
        { label: 'kWh', key: 'kwh', format: v => fmtNum(v, 0), width: 70 },
        { label: 'EF (kg/kWh)', key: 'emission_factor_kg_per_kwh', format: v => fmtNum(v, 4), width: 80 },
        { label: 'Nguồn EF', key: 'emission_factor_source', width: 100 },
        { label: 'CO₂e (kg)', key: 'scope2_co2e_kg', format: v => fmtNum(v), width: 75 },
      ], elec);
    }

    addSectionTitle(doc, 'Hóa đơn nhiên liệu — Scope 1');

    if (fuels.length === 0) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text('Chưa có hóa đơn nhiên liệu.', 40, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(doc, [
        { label: 'Kỳ', key: 'billing_period', width: 80 },
        { label: 'Loại nhiên liệu', key: 'fuel_type', width: 90 },
        { label: 'Lượng (L)', key: 'quantity_liters', format: v => fmtNum(v, 1), width: 80 },
        { label: 'EF (kg/L)', key: 'emission_factor_kg_per_liter', format: v => fmtNum(v, 4), width: 80 },
        { label: 'CO₂e (kg)', key: 'scope1_co2e_kg', format: v => fmtNum(v), width: 80 },
        { label: 'Trạng thái', key: 'status', width: 70 },
      ], fuels);
    }

    addDisclaimer(doc);
    addFooter(doc, 'Phát thải Cơ sở', 'GHG Protocol Corporate Standard · DEFRA 2025 · EVN EF 2024 (Bộ TN&MT VN)');
    return elec.length + fuels.length;
  } finally {
    client.release();
  }
}

async function generateCompliancePdf(doc, companyId) {
  const client = await pool.connect();
  try {
    const [companyRes, evidenceRes, gapRes, productsRes] = await Promise.all([
      client.query('SELECT name, target_markets FROM companies WHERE id = $1', [companyId]),
      client.query(`
        SELECT evidence_type, document_name, status, created_at
        FROM evidence_documents WHERE company_id = $1
        ORDER BY created_at DESC LIMIT 100
      `, [companyId]),
      client.query(`
        SELECT gap_type, description, severity, status, created_at
        FROM data_gaps WHERE company_id = $1
        ORDER BY severity DESC, created_at DESC LIMIT 50
      `, [companyId]).catch(() => ({ rows: [] })),
      client.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE total_co2e IS NOT NULL AND total_co2e > 0)::int AS with_co2
        FROM products WHERE company_id = $1 AND status <> 'archived'
      `, [companyId])
    ]);

    const company = companyRes.rows[0] || {};
    const evidence = evidenceRes.rows;
    const gaps = gapRes.rows;
    const pStats = productsRes.rows[0] || {};
    const markets = Array.isArray(company.target_markets) ? company.target_markets.join(', ') : '—';

    const verified = evidence.filter(e => ['verified', 'cross_checked', 'source_matched'].includes(e.status)).length;
    const pending = evidence.filter(e => ['uploaded', 'ocr_parsed', 'pending'].includes(e.status)).length;
    const highGaps = gaps.filter(g => g.severity === 'high').length;

    addPageHeader(doc,
      'Sẵn sàng Tuân thủ',
      'EU CBAM · EUDR · TT 01/2022 · Phân tích khoảng trống dữ liệu',
      company.name
    );

    // Company info
    addSectionTitle(doc, 'Thông tin doanh nghiệp');
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(`Thị trường mục tiêu: ${markets}`, 40, doc.y)
       .moveDown(0.2)
       .text(`Ngày tạo báo cáo: ${nowStr()}`)
       .moveDown(0.5);

    addKpiRow(doc, [
      { label: 'Tổng sản phẩm', value: pStats.total || 0, unit: 'SKU' },
      { label: 'SKU có CO₂e', value: pStats.with_co2 || 0, unit: 'SKU' },
      { label: 'Chứng từ đã xác minh', value: verified, unit: 'tài liệu' },
      { label: 'Khoảng trống nghiêm trọng', value: highGaps, unit: 'mục', },
    ]);

    // Checklist CBAM readiness
    addSectionTitle(doc, 'Kiểm tra sẵn sàng CBAM / EUDR');
    const checks = [
      { label: 'Có dữ liệu sản phẩm (SKU)', ok: (pStats.total || 0) > 0 },
      { label: 'SKU có hệ số CO₂e', ok: (pStats.with_co2 || 0) > 0 },
      { label: 'Có hóa đơn điện (Scope 2)', ok: false },
      { label: 'Có chứng từ xác minh', ok: verified > 0 },
      { label: 'Không có khoảng trống nghiêm trọng', ok: highGaps === 0 },
    ];

    // Check electricity
    const elecCheck = await client.query('SELECT COUNT(*) FROM electricity_invoices WHERE company_id = $1', [companyId]);
    checks[2].ok = parseInt(elecCheck.rows[0].count) > 0;

    checks.forEach(c => {
      doc.fillColor(c.ok ? BRAND : RED).fontSize(9).font('Helvetica-Bold')
         .text(c.ok ? '✓' : '✗', 40, doc.y, { continued: true, width: 20 })
         .fillColor(DARK).font('Helvetica')
         .text(`  ${c.label}`, { continued: false });
      doc.moveDown(0.2);
    });

    // Evidence table
    addSectionTitle(doc, 'Danh sách chứng từ');

    if (evidence.length === 0) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text('Chưa có chứng từ nào được tải lên.', 40, doc.y);
      doc.moveDown(0.5);
    } else {
      drawTable(doc, [
        { label: 'Loại', key: 'evidence_type', width: 100 },
        { label: 'Tên tài liệu', key: 'document_name', width: 180 },
        { label: 'Trạng thái', key: 'status', width: 100,
          color: (v) => ['verified', 'cross_checked', 'source_matched'].includes(v) ? BRAND : RED },
        { label: 'Ngày tải', key: 'created_at', format: fmtDate, width: 80 },
      ], evidence, { maxRows: 50 });
    }

    // Data gaps
    if (gaps.length > 0) {
      addSectionTitle(doc, 'Khoảng trống dữ liệu');
      drawTable(doc, [
        { label: 'Loại', key: 'gap_type', width: 100 },
        { label: 'Mô tả', key: 'description', width: 200 },
        { label: 'Mức độ', key: 'severity', width: 80,
          color: (v) => v === 'high' ? RED : (v === 'medium' ? '#e65100' : BRAND) },
        { label: 'Trạng thái', key: 'status', width: 80 },
      ], gaps);
    }

    addDisclaimer(doc);
    addFooter(doc, 'Sẵn sàng Tuân thủ', 'EU CBAM Regulation 2023/956 · EUDR 2023/1115 · TT 01/2022/TT-BCT');
    return evidence.length;
  } finally {
    client.release();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const GENERATORS = {
  product_carbon: generateProductCarbonPdf,
  batch_export: generateBatchExportPdf,
  facility_emission: generateFacilityEmissionPdf,
  compliance: generateCompliancePdf,
  // aliases used by old createReport flow
  carbon_audit: generateProductCarbonPdf,
  sustainability: generateProductCarbonPdf,
};

/**
 * Generate a PDF for the given reportType + companyId.
 * Returns { buffer: Buffer, recordCount: number }
 */
async function generatePdf(reportType, companyId) {
  const generator = GENERATORS[reportType];
  if (!generator) throw new Error(`Unknown PDF report type: ${reportType}`);

  const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true });
  const chunks = [];

  doc.on('data', chunk => chunks.push(chunk));

  const endPromise = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const recordCount = await generator(doc, companyId);
  doc.end();
  await endPromise;

  return { buffer: Buffer.concat(chunks), recordCount: recordCount || 0 };
}

module.exports = { generatePdf };
