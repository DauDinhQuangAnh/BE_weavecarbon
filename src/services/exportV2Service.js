const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const pool = require('../config/database');
const {
  buildAuthoritativeCarbonResult,
  buildCarbonAuthorityReference
} = require('../modules/carbon');

const EXPORT_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../templates/export/Weave_Carbon_Export_Production_Template_Production.xlsx'
);

const DEFAULT_EXPORT_CONFIG = {
  customsDeclarationNo: '106429381040',
  poContractId: 'PO-2026-TXT-099',
  billOfLadingNo: 'ONEVNHAN260411',
  containerNo: 'ONEU1234567',
  barcodeStandard: 'GS1-Digital',
  buyerBrand: 'H&M Group',
  buyerWebhookUrl: 'https://api.hm-group.com/sustainability/v1/ingest'
};

const HS_CODE_BY_CATEGORY = {
  tshirt: '61091000',
  polo: '61051000',
  shirt: '62052000',
  pants: '62034231',
  shorts: '62034390',
  dress: '62044300',
  jacket: '61012000',
  sweater: '61101100',
  shoes: '64041900',
  bag: '42029200',
  accessories: '62171000',
  other: '62000000'
};

function sha256Json(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function normalizeConfig(row) {
  if (!row) return DEFAULT_EXPORT_CONFIG;
  return {
    customsDeclarationNo: row.customs_declaration_no || DEFAULT_EXPORT_CONFIG.customsDeclarationNo,
    poContractId: row.po_contract_id || DEFAULT_EXPORT_CONFIG.poContractId,
    billOfLadingNo: row.bill_of_lading_no || DEFAULT_EXPORT_CONFIG.billOfLadingNo,
    containerNo: row.container_no || DEFAULT_EXPORT_CONFIG.containerNo,
    barcodeStandard: row.barcode_standard || DEFAULT_EXPORT_CONFIG.barcodeStandard,
    buyerBrand: row.buyer_brand || DEFAULT_EXPORT_CONFIG.buyerBrand,
    buyerWebhookUrl: row.buyer_webhook_url || DEFAULT_EXPORT_CONFIG.buyerWebhookUrl,
    metadata: row.metadata || {}
  };
}

function asNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function numberOrBlank(value) {
  const number = asNumber(value, NaN);
  return Number.isFinite(number) ? number : '';
}

function round(value, digits = 4) {
  const number = asNumber(value, 0);
  return Number(number.toFixed(digits));
}

function ensureExportTemplateAvailable() {
  if (!fs.existsSync(EXPORT_TEMPLATE_PATH)) {
    const error = new Error('Export XLSX template was not found.');
    error.code = 'TEMPLATE_EXPORT_FAILED';
    throw error;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function loadTemplateZip() {
  ensureExportTemplateAvailable();
  const buffer = await fs.promises.readFile(EXPORT_TEMPLATE_PATH);
  return JSZip.loadAsync(buffer);
}

function getCellStyle(cellXml) {
  const style = cellXml.match(/\ss="([^"]+)"/);
  return style ? ` s="${style[1]}"` : '';
}

function getCellFormula(cellXml) {
  const formula = cellXml.match(/<x:f[^>]*>[\s\S]*?<\/x:f>/);
  return formula ? formula[0] : '';
}

function buildCellXml(ref, style, value, formula = '') {
  if (formula) {
    return `<x:c r="${ref}"${style} t="n">${formula}</x:c>`;
  }
  if (value === '' || value === null || value === undefined) {
    return `<x:c r="${ref}"${style} />`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<x:c r="${ref}"${style} t="n"><x:v>${value}</x:v></x:c>`;
  }
  return `<x:c r="${ref}"${style} t="str"><x:v>${escapeXml(value)}</x:v></x:c>`;
}

function replaceCellValue(sheetXml, ref, value, options = {}) {
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<x:c\\b(?=[^>]*\\br="${escapedRef}")[^>]*/>|<x:c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>[\\s\\S]*?<\\/x:c>`);
  const match = sheetXml.match(regex);
  if (!match) return sheetXml;
  const original = match[0];
  const style = getCellStyle(original);
  const formula = options.keepFormula ? getCellFormula(original) : '';
  return sheetXml.replace(regex, buildCellXml(ref, style, value, formula));
}

function setXmlCell(sheetXml, ref, value) {
  return replaceCellValue(sheetXml, ref, value);
}

function clearXmlCells(sheetXml, rowNumber, columns) {
  let next = sheetXml;
  for (const column of columns) {
    next = setXmlCell(next, `${column}${rowNumber}`, '');
  }
  return next;
}

function clearFormulaCache(sheetXml, rowNumber, columns) {
  let next = sheetXml;
  for (const column of columns) {
    next = replaceCellValue(next, `${column}${rowNumber}`, '', { keepFormula: true });
  }
  return next;
}

async function readSheetXml(zip, sheetPath) {
  const file = zip.file(sheetPath);
  if (!file) {
    const error = new Error(`${sheetPath} was not found in export template.`);
    error.code = 'TEMPLATE_EXPORT_FAILED';
    throw error;
  }
  return file.async('string');
}

function writeSheetXml(zip, sheetPath, xml) {
  zip.file(sheetPath, xml);
}

async function finalizeTemplateZip(zip) {
  const workbookFile = zip.file('xl/workbook.xml');
  if (workbookFile) {
    let workbookXml = await workbookFile.async('string');
    workbookXml = workbookXml.replace(/<x:calcPr[^>]*\/>|<x:calcPr[^>]*>[\s\S]*?<\/x:calcPr>|<calcPr[^>]*\/>|<calcPr[^>]*>[\s\S]*?<\/calcPr>/g, '');
    if (workbookXml.includes('</x:workbook>')) {
      workbookXml = workbookXml.replace(
        '</x:workbook>',
        '<x:calcPr calcId="999999" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" /></x:workbook>'
      );
    } else {
      workbookXml = workbookXml.replace(
        '</workbook>',
        '<calcPr calcId="999999" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" /></workbook>'
      );
    }
    zip.file('xl/workbook.xml', workbookXml);
  }
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function getInputNumber(payload, keys, fallback = '') {
  for (const key of keys) {
    const value = payload[key];
    const number = numberOrBlank(value);
    if (number !== '') return number;
  }
  return fallback;
}

function getPcsPerCarton(product) {
  return Math.max(1, Math.trunc(getInputNumber(product.rawPayload, ['pcsPerCarton', 'pcs_per_carton', 'cartonQty', 'carton_qty'], 40)));
}

function getUnitPrice(product) {
  return getInputNumber(product.rawPayload, ['unitPrice', 'unit_price', 'priceUsd', 'price_usd'], '');
}

function getCurrency(cfg, product) {
  return (
    product.rawPayload.currency ||
    cfg.metadata?.currency ||
    cfg.metadata?.invoiceCurrency ||
    'USD'
  );
}

function getProductDppUrl(ctx, product) {
  const bySku = ctx.dppLocksBySku.get(product.sku);
  return bySku?.decentralizedUrl || ctx.defaultDppUrl || '';
}

function normalizeTransportLeg(product, leg, index, embeddedKgForLeg) {
  const payload = asObject(leg);
  const mode = payload.mode || payload.transportMode || payload.transport_mode || 'Transport leg';
  const origin = payload.origin || payload.from || '';
  const destination = payload.destination || payload.to || '';
  const distanceKm = numberOrBlank(payload.distanceKm ?? payload.distance_km ?? payload.distance);
  const cargoWeightT = numberOrBlank(payload.cargoWeightT ?? payload.cargo_weight_t ?? payload.weightTonnes ?? payload.weight_tonnes);
  const factor = numberOrBlank(payload.kgCo2ePerTkm ?? payload.kg_co2e_per_tkm ?? payload.emissionFactor ?? payload.emission_factor ?? payload.factor);
  const factorKey = payload.factorKey || payload.factor_key || payload.defraKey || payload.defra_key || mode;

  return {
    routeLeg: payload.routeLeg || payload.route_leg || `${index + 1}. ${mode}`,
    origin,
    destination,
    mode,
    cargoWeightT: cargoWeightT === '' ? round((product.quantity * product.weightKg) / 1000, 4) : cargoWeightT,
    distanceKm,
    factorKey,
    factor,
    embeddedKg: embeddedKgForLeg,
    notes: payload.notes || ''
  };
}

function getBillOfLadingRows(products) {
  const rows = [];
  for (const product of products) {
    const embeddedKg = product.kgPerUnit * product.quantity;
    if (product.transportLegs.length) {
      product.transportLegs.forEach((leg, index) => {
        rows.push(normalizeTransportLeg(product, leg, index, index === 0 ? round(embeddedKg, 4) : ''));
      });
    } else {
      rows.push({
        routeLeg: `${product.sku} embedded product carbon`,
        origin: '',
        destination: '',
        mode: 'Logistics data pending',
        cargoWeightT: round((product.quantity * product.weightKg) / 1000, 4),
        distanceKm: '',
        factorKey: '',
        factor: '',
        embeddedKg: round(embeddedKg, 4),
        notes: 'Missing route/factor data; logistics carbon is intentionally left blank.'
      });
    }
  }
  return rows.slice(0, 20);
}

function fillCommonMetadataXml(sheetXml, cfg, ctx, options = {}) {
  let xml = sheetXml;
  const exporterName = cfg.metadata?.exporterName || cfg.metadata?.factoryName || 'Weave Carbon Exporter';
  const exporterAddress = cfg.metadata?.exporterAddress || cfg.metadata?.factoryAddress || '';
  const buyerAddress = cfg.metadata?.buyerAddress || '';
  const issuedDate = cfg.metadata?.issuedDate || new Date().toISOString().slice(0, 10);

  xml = setXmlCell(xml, 'B5', exporterName);
  xml = setXmlCell(xml, 'B6', exporterAddress);
  xml = setXmlCell(xml, 'I5', cfg.buyerBrand);
  xml = setXmlCell(xml, 'I6', buyerAddress);
  xml = setXmlCell(xml, 'B10', options.documentNo || `${options.prefix || 'DOC'}-${cfg.poContractId}`);
  xml = setXmlCell(xml, 'E10', issuedDate);
  xml = setXmlCell(xml, 'E11', cfg.poContractId);
  xml = setXmlCell(xml, 'I11', cfg.customsDeclarationNo);
  xml = setXmlCell(xml, 'L11', cfg.billOfLadingNo);
  xml = setXmlCell(xml, 'B12', cfg.containerNo);
  xml = setXmlCell(xml, 'B14', ctx.auditReference);
  xml = setXmlCell(xml, 'I14', ctx.defaultDppUrl);
  return xml;
}

function fillCommercialInvoiceXml(sheetXml, ctx) {
  const { cfg, products } = ctx;
  let xml = fillCommonMetadataXml(sheetXml, cfg, ctx, {
    prefix: 'CI',
    documentNo: cfg.metadata?.commercialInvoiceNo
  });

  for (let row = 18; row <= 37; row += 1) {
    xml = clearXmlCells(xml, row, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'M']);
    xml = clearFormulaCache(xml, row, ['H', 'K', 'L']);
  }

  products.slice(0, 20).forEach((product, index) => {
    const row = 18 + index;
    xml = setXmlCell(xml, `A${row}`, index + 1);
    xml = setXmlCell(xml, `B${row}`, product.sku);
    xml = setXmlCell(xml, `C${row}`, product.name);
    xml = setXmlCell(xml, `D${row}`, product.hsCode);
    xml = setXmlCell(xml, `E${row}`, product.quantity);
    xml = setXmlCell(xml, `F${row}`, product.rawPayload.unit || product.rawPayload.uom || 'pcs');
    xml = setXmlCell(xml, `G${row}`, getUnitPrice(product));
    xml = setXmlCell(xml, `I${row}`, getCurrency(cfg, product));
    xml = setXmlCell(xml, `J${row}`, round(product.kgPerUnit, 4));
    xml = setXmlCell(xml, `M${row}`, getProductDppUrl(ctx, product));
  });

  return xml;
}

function fillPackingListXml(sheetXml, ctx) {
  const { cfg, products } = ctx;
  let xml = fillCommonMetadataXml(sheetXml, cfg, ctx, {
    prefix: 'PL',
    documentNo: cfg.metadata?.packingListNo
  });

  for (let row = 18; row <= 37; row += 1) {
    xml = clearXmlCells(xml, row, ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'N']);
    xml = clearFormulaCache(xml, row, ['G', 'L', 'M']);
  }
  for (let row = 43; row <= 48; row += 1) {
    xml = setXmlCell(xml, `A${row}`, '');
  }

  products.slice(0, 20).forEach((product, index) => {
    const row = 18 + index;
    const pcsPerCarton = getPcsPerCarton(product);
    const cartons = Math.max(1, Math.ceil(product.quantity / pcsPerCarton));
    const netWeightKg = product.quantity * product.weightKg;
    const grossWeightKg = getInputNumber(product.rawPayload, ['grossWeightKg', 'gross_weight_kg'], netWeightKg || '');
    const cbm = getInputNumber(product.rawPayload, ['cbm', 'cartonCbm', 'carton_cbm'], '');
    const note = product.rawPayload.packingNotes || product.rawPayload.packing_notes || (grossWeightKg === netWeightKg && netWeightKg ? 'Gross weight fallback equals net weight; update actual carton data if available.' : '');

    xml = setXmlCell(xml, `A${row}`, index + 1);
    xml = setXmlCell(xml, `B${row}`, product.sku);
    xml = setXmlCell(xml, `C${row}`, cartons === 1 ? 'CTN-0001' : `CTN-0001-${String(cartons).padStart(4, '0')}`);
    xml = setXmlCell(xml, `D${row}`, cfg.containerNo);
    xml = setXmlCell(xml, `E${row}`, pcsPerCarton);
    xml = setXmlCell(xml, `F${row}`, cartons);
    xml = setXmlCell(xml, `H${row}`, grossWeightKg === '' ? '' : round(grossWeightKg, 3));
    xml = setXmlCell(xml, `I${row}`, round(netWeightKg, 3));
    xml = setXmlCell(xml, `J${row}`, cbm === '' ? '' : round(cbm, 3));
    xml = setXmlCell(xml, `K${row}`, round(product.kgPerUnit * pcsPerCarton, 4));
    xml = setXmlCell(xml, `N${row}`, note);
  });

  const containers = [...new Set([cfg.containerNo, ...products.map((product) => product.rawPayload.containerNo || product.rawPayload.container_no).filter(Boolean)])].slice(0, 6);
  containers.forEach((containerNo, index) => {
    xml = setXmlCell(xml, `A${43 + index}`, containerNo);
  });

  return xml;
}

function fillBillOfLadingXml(sheetXml, ctx) {
  const { cfg, products } = ctx;
  let xml = fillCommonMetadataXml(sheetXml, cfg, ctx, {
    prefix: 'BL',
    documentNo: cfg.billOfLadingNo
  });

  for (let row = 18; row <= 37; row += 1) {
    xml = clearXmlCells(xml, row, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'P']);
    xml = clearFormulaCache(xml, row, ['L', 'N', 'O']);
  }

  getBillOfLadingRows(products).forEach((leg, index) => {
    const row = 18 + index;
    xml = setXmlCell(xml, `A${row}`, index + 1);
    xml = setXmlCell(xml, `B${row}`, cfg.billOfLadingNo);
    xml = setXmlCell(xml, `C${row}`, cfg.containerNo);
    xml = setXmlCell(xml, `D${row}`, leg.routeLeg);
    xml = setXmlCell(xml, `E${row}`, leg.origin);
    xml = setXmlCell(xml, `F${row}`, leg.destination);
    xml = setXmlCell(xml, `G${row}`, leg.mode);
    xml = setXmlCell(xml, `H${row}`, leg.cargoWeightT);
    xml = setXmlCell(xml, `I${row}`, leg.distanceKm);
    xml = setXmlCell(xml, `J${row}`, leg.factorKey);
    xml = setXmlCell(xml, `K${row}`, leg.factor);
    xml = setXmlCell(xml, `M${row}`, leg.embeddedKg);
    xml = setXmlCell(xml, `P${row}`, leg.notes);
  });

  return xml;
}

async function buildTemplateDocumentBuffer(ctx, sheetPath, fillSheetXml) {
  const zip = await loadTemplateZip();
  const sheetXml = await readSheetXml(zip, sheetPath);
  writeSheetXml(zip, sheetPath, fillSheetXml(sheetXml, ctx));
  return finalizeTemplateZip(zip);
}

function normalizeProduct(row) {
  const payload = asObject(row.payload);
  const carbonResults = asObject(payload.carbonResults || payload.carbon_results);
  const perProduct = asObject(carbonResults.perProduct || carbonResults.per_product);
  const quantity = Math.max(1, Math.trunc(asNumber(payload.quantity, 1)));
  const category = row.category || payload.productType || payload.product_type || 'other';
  const hsCode =
    payload.hsCode ||
    payload.hs_code ||
    payload.cnCode ||
    payload.cn_code ||
    HS_CODE_BY_CATEGORY[String(category).toLowerCase()] ||
    HS_CODE_BY_CATEGORY.other;
  const kgPerUnit = asNumber(row.total_co2e, asNumber(perProduct.total, 0));
  const authoritativeCarbonResults = buildAuthoritativeCarbonResult(row);
  const carbonAuthority = buildCarbonAuthorityReference(row);

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category,
    hsCode: String(hsCode),
    quantity,
    weightKg: asNumber(row.weight_kg, asNumber(payload.weightPerUnit, 0) / 1000),
    kgPerUnit,
    totalTonnes: (kgPerUnit * quantity) / 1000,
    materials: Array.isArray(payload.materials) ? payload.materials : [],
    energySources: Array.isArray(payload.energySources) ? payload.energySources : [],
    transportLegs: Array.isArray(payload.transportLegs) ? payload.transportLegs : [],
    evidenceLookupCode: payload.evidenceLookupCode || payload.evidence_lookup_code || null,
    rawPayload: payload,
    carbonResults: authoritativeCarbonResults,
    carbonAuthority
  };
}

class ExportV2Service {
  constructor({ database = pool } = {}) {
    this.database = database;
  }

  async getConfiguration(companyId) {
    const result = await this.database.query(
      `
        SELECT *
        FROM export_configurations
        WHERE company_id = $1
      `,
      [companyId]
    );
    return normalizeConfig(result.rows[0]);
  }

  async upsertConfiguration(companyId, userId, input) {
    const current = await this.getConfiguration(companyId);
    const next = {
      ...current,
      ...input
    };

    const result = await this.database.query(
      `
        INSERT INTO export_configurations (
          company_id,
          customs_declaration_no,
          po_contract_id,
          bill_of_lading_no,
          container_no,
          barcode_standard,
          buyer_brand,
          buyer_webhook_url,
          metadata,
          created_by,
          updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
        ON CONFLICT (company_id) DO UPDATE SET
          customs_declaration_no = EXCLUDED.customs_declaration_no,
          po_contract_id = EXCLUDED.po_contract_id,
          bill_of_lading_no = EXCLUDED.bill_of_lading_no,
          container_no = EXCLUDED.container_no,
          barcode_standard = EXCLUDED.barcode_standard,
          buyer_brand = EXCLUDED.buyer_brand,
          buyer_webhook_url = EXCLUDED.buyer_webhook_url,
          metadata = EXCLUDED.metadata,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *
      `,
      [
        companyId,
        next.customsDeclarationNo,
        next.poContractId,
        next.billOfLadingNo,
        next.containerNo,
        next.barcodeStandard,
        next.buyerBrand,
        next.buyerWebhookUrl,
        JSON.stringify(next.metadata || {}),
        userId
      ]
    );

    return normalizeConfig(result.rows[0]);
  }

  async listProductsForExport(companyId) {
    const result = await this.database.query(
      `
        SELECT
          p.id,
          p.sku,
          p.name,
          p.category,
          p.weight_kg,
          p.total_co2e,
          p.materials_co2e,
          p.production_co2e,
          p.transport_co2e,
          p.packaging_co2e,
          s.id AS snapshot_id,
          s.version AS snapshot_version,
          s.payload,
          s.updated_at AS snapshot_updated_at
        FROM products p
        INNER JOIN product_assessment_snapshots s ON s.product_id = p.id
        WHERE p.company_id = $1 AND p.status <> 'archived'
        ORDER BY p.created_at ASC
        LIMIT 200
      `,
      [companyId]
    );
    return result.rows.map(normalizeProduct);
  }

  async listLatestDppLocks(companyId) {
    const result = await this.database.query(
      `
        SELECT DISTINCT ON (sku) *
        FROM dpp_locks
        WHERE company_id = $1
        ORDER BY sku, locked_at DESC, updated_at DESC
      `,
      [companyId]
    );
    return result.rows.map((row) => this._formatDppLock(row));
  }

  async buildExportWorkbookContext(companyId) {
    const cfg = await this.getConfiguration(companyId);
    const products = await this.listProductsForExport(companyId);
    const dppLocks = await this.listLatestDppLocks(companyId);
    const dppLocksBySku = new Map(dppLocks.map((lock) => [lock.sku, lock]));
    const firstLock = dppLocks[0];
    const defaultDppUrl = firstLock?.decentralizedUrl || cfg.metadata?.dppUrl || cfg.metadata?.dppQrUrl || '';
    const payloadSha256 =
      firstLock?.payloadSha256 ||
      sha256Json({
        type: 'weave-carbon-export-documents',
        cfg,
        products: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          hsCode: product.hsCode,
          quantity: product.quantity,
          kgPerUnit: product.kgPerUnit,
          carbonAuthority: product.carbonAuthority
        }))
      });
    const calculationReferences = products.map((product) => ({
      sku: product.sku,
      ...product.carbonAuthority
    }));
    const visibleReferences = calculationReferences
      .slice(0, 5)
      .map((item) => `${item.calculationId}:v${item.calculationVersion}`)
      .join(',');
    const auditReference = `${visibleReferences}${
      calculationReferences.length > 5 ? `,+${calculationReferences.length - 5}` : ''
    } | bundle:${payloadSha256}`;

    return {
      cfg,
      products,
      dppLocks,
      dppLocksBySku,
      defaultDppUrl,
      payloadSha256,
      calculationReferences,
      auditReference
    };
  }

  async buildCommercialInvoice(companyId) {
    const ctx = await this.buildExportWorkbookContext(companyId);
    return {
      filename: `commercial_invoice_carbon_${ctx.cfg.poContractId}.xlsx`,
      buffer: await buildTemplateDocumentBuffer(ctx, 'xl/worksheets/sheet1.xml', fillCommercialInvoiceXml)
    };
  }

  async buildPackingList(companyId) {
    const ctx = await this.buildExportWorkbookContext(companyId);
    return {
      filename: `packing_list_carbon_${ctx.cfg.containerNo}.xlsx`,
      buffer: await buildTemplateDocumentBuffer(ctx, 'xl/worksheets/sheet2.xml', fillPackingListXml)
    };
  }

  async buildBillOfLading(companyId) {
    const ctx = await this.buildExportWorkbookContext(companyId);
    return {
      filename: `bill_of_lading_carbon_${ctx.cfg.billOfLadingNo}.xlsx`,
      buffer: await buildTemplateDocumentBuffer(ctx, 'xl/worksheets/sheet3.xml', fillBillOfLadingXml)
    };
  }

  async createDppLock(companyId, userId, skuOrProductId, overrides = {}) {
    const products = await this.listProductsForExport(companyId);
    const product = products.find(
      (item) => item.id === skuOrProductId || item.sku === skuOrProductId
    );
    if (!product) {
      return null;
    }
    if (!product.carbonAuthority) {
      const error = new Error('A server-authoritative product calculation is required.');
      error.code = 'AUTHORITATIVE_CARBON_REQUIRED';
      error.statusCode = 409;
      throw error;
    }

    const cfg = await this.getConfiguration(companyId);
    const gtin = overrides.gtin || `0894001${product.sku.replace(/\D/g, '').padStart(6, '0').slice(0, 6)}07`;
    const payload = {
      standard: cfg.barcodeStandard,
      sku: product.sku,
      gtin,
      productName: product.name,
      hsCode: product.hsCode,
      cnCode: product.hsCode,
      embeddedKgPerUnit: Number(product.kgPerUnit.toFixed(4)),
      embeddedTonnesBatch: Number(product.totalTonnes.toFixed(4)),
      fiberComposition: product.materials.map((material) => ({
        name: material.materialType || material.material_type || material.type || 'material',
        ratio: asNumber(material.percentage, 0)
      })),
      supplyGapPenaltyRatio: 0,
      customsDeclarationNo: cfg.customsDeclarationNo,
      poContractId: cfg.poContractId,
      billOfLadingNo: cfg.billOfLadingNo,
      containerNo: cfg.containerNo,
      evidenceLookupCode: product.evidenceLookupCode,
      evidenceHashes: [],
      carbonAuthority: product.carbonAuthority,
      carbonResults: product.carbonResults,
      issuedAt: new Date().toISOString()
    };
    const payloadSha256 = sha256Json(payload);
    const decentralizedUrl =
      overrides.decentralizedUrl ||
      `https://dpp.weavecarbon.local/01/${encodeURIComponent(gtin)}?sku=${encodeURIComponent(product.sku)}&hash=${payloadSha256.slice(0, 16)}`;

    const result = await this.database.query(
      `
        INSERT INTO dpp_locks (
          company_id,
          product_id,
          sku,
          gtin,
          barcode_standard,
          payload,
          payload_sha256,
          decentralized_url,
          locked_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (company_id, sku, payload_sha256) DO UPDATE SET
          payload = EXCLUDED.payload,
          decentralized_url = EXCLUDED.decentralized_url,
          updated_at = now()
        RETURNING *
      `,
      [
        companyId,
        product.id,
        product.sku,
        gtin,
        cfg.barcodeStandard,
        JSON.stringify(payload),
        payloadSha256,
        decentralizedUrl,
        userId
      ]
    );

    return this._formatDppLock(result.rows[0]);
  }

  async getDppLock(companyId, id) {
    const result = await this.database.query(
      'SELECT * FROM dpp_locks WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    return result.rows[0] ? this._formatDppLock(result.rows[0]) : null;
  }

  async buildBuyerWebhookPayload(companyId) {
    const cfg = await this.getConfiguration(companyId);
    const products = await this.listProductsForExport(companyId);
    return {
      buyerBrand: cfg.buyerBrand,
      targetUrl: cfg.buyerWebhookUrl,
      poContractId: cfg.poContractId,
      billOfLadingNo: cfg.billOfLadingNo,
      containerNo: cfg.containerNo,
      shipment: products.map((product) => ({
        sku: product.sku,
        hsCode: product.hsCode,
        units: product.quantity,
        embeddedKgPerUnit: Number(product.kgPerUnit.toFixed(4)),
        embeddedTonnesBatch: Number(product.totalTonnes.toFixed(4)),
        carbonAuthority: product.carbonAuthority
      })),
      calculationManifest: products.map((product) => ({
        sku: product.sku,
        carbonAuthority: product.carbonAuthority
      })),
      totals: {
        units: products.reduce((sum, product) => sum + product.quantity, 0),
        embeddedTonnes: Number(products.reduce((sum, product) => sum + product.totalTonnes, 0).toFixed(4))
      },
      generatedAt: new Date().toISOString()
    };
  }

  _formatDppLock(row) {
    return {
      id: row.id,
      productId: row.product_id,
      sku: row.sku,
      gtin: row.gtin,
      barcodeStandard: row.barcode_standard,
      payload: row.payload,
      carbonAuthority: row.payload?.carbonAuthority || null,
      payloadSha256: row.payload_sha256,
      decentralizedUrl: row.decentralized_url,
      status: row.status,
      lockedAt: row.locked_at,
      qrSvgStorageKey: row.qr_svg_storage_key,
      qrPngStorageKey: row.qr_png_storage_key
    };
  }
}

module.exports = new ExportV2Service();
module.exports.ExportV2Service = ExportV2Service;
module.exports.createExportV2Service = (dependencies) => new ExportV2Service(dependencies);
