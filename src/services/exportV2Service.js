const crypto = require('crypto');
const pool = require('../config/database');

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

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
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
    rawPayload: payload
  };
}

class ExportV2Service {
  async getConfiguration(companyId) {
    const result = await pool.query(
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

    const result = await pool.query(
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
    const result = await pool.query(
      `
        SELECT p.id, p.sku, p.name, p.category, p.weight_kg, p.total_co2e, s.payload
        FROM products p
        LEFT JOIN product_assessment_snapshots s ON s.product_id = p.id
        WHERE p.company_id = $1 AND p.status <> 'archived'
        ORDER BY p.created_at ASC
        LIMIT 200
      `,
      [companyId]
    );
    return result.rows.map(normalizeProduct);
  }

  async buildCommercialInvoice(companyId) {
    const cfg = await this.getConfiguration(companyId);
    const products = await this.listProductsForExport(companyId);
    const header = [
      'Line',
      'SKU',
      'HS Code (CN)',
      'Description',
      'Qty (pcs)',
      'Embedded Carbon Intensity (kg CO2e/pc)',
      'Embedded Carbon Total (kg CO2e)',
      'PO / Contract',
      'Customs Declaration No',
      'B/L No'
    ];
    const rows = products.map((product, index) => [
      index + 1,
      product.sku,
      product.hsCode,
      product.name,
      product.quantity,
      product.kgPerUnit.toFixed(4),
      (product.kgPerUnit * product.quantity).toFixed(4),
      cfg.poContractId,
      cfg.customsDeclarationNo,
      cfg.billOfLadingNo
    ]);
    return { filename: `commercial_invoice_carbon_${cfg.poContractId}.csv`, csv: toCsv([header, ...rows]) };
  }

  async buildPackingList(companyId) {
    const cfg = await this.getConfiguration(companyId);
    const products = await this.listProductsForExport(companyId);
    const header = [
      'Carton No',
      'SKU',
      'Pcs / Carton',
      'Net Weight (kg)',
      'Embedded Carbon / Carton (kg CO2e)',
      'Container No',
      'B/L No'
    ];
    const rows = [];
    let cartonNo = 1;
    for (const product of products) {
      const pcsPerCarton = 40;
      const cartons = Math.ceil(product.quantity / pcsPerCarton);
      for (let i = 0; i < cartons; i += 1) {
        const pcs = Math.min(pcsPerCarton, product.quantity - i * pcsPerCarton);
        rows.push([
          `CTN-${String(cartonNo).padStart(4, '0')}`,
          product.sku,
          pcs,
          (pcs * product.weightKg).toFixed(3),
          (pcs * product.kgPerUnit).toFixed(3),
          cfg.containerNo,
          cfg.billOfLadingNo
        ]);
        cartonNo += 1;
      }
    }
    return { filename: `packing_list_carbon_${cfg.containerNo}.csv`, csv: toCsv([header, ...rows]) };
  }

  async buildBillOfLading(companyId) {
    const cfg = await this.getConfiguration(companyId);
    const products = await this.listProductsForExport(companyId);
    const totals = products.reduce(
      (acc, product) => {
        acc.units += product.quantity;
        acc.netWeight += product.quantity * product.weightKg;
        acc.embeddedTonnes += product.totalTonnes;
        return acc;
      },
      { units: 0, netWeight: 0, embeddedTonnes: 0 }
    );
    return {
      filename: `bill_of_lading_carbon_${cfg.billOfLadingNo}.csv`,
      csv: toCsv([
        ['B/L Field', 'Value'],
        ['B/L No', cfg.billOfLadingNo],
        ['Container No', cfg.containerNo],
        ['Customs Declaration No', cfg.customsDeclarationNo],
        ['PO / Contract', cfg.poContractId],
        ['Consignee / Buyer Brand', cfg.buyerBrand],
        ['Total Units', totals.units],
        ['Total Net Weight (kg)', totals.netWeight.toFixed(3)],
        ['Total Embedded Emissions (tCO2e)', totals.embeddedTonnes.toFixed(4)],
        ['Methodology', 'Ecoinvent v3.10; DEFRA 2024; ISO 14067; Bo TN&MT VN']
      ])
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

    const cfg = await this.getConfiguration(companyId);
    const gtin = overrides.gtin || `0894001${product.sku.replace(/\D/g, '').padStart(6, '0').slice(0, 6)}07`;
    const payload = {
      standard: cfg.barcodeStandard,
      sku: product.sku,
      gtin,
      productName: product.name,
      hsCode: product.hsCode,
      embeddedKgPerUnit: Number(product.kgPerUnit.toFixed(4)),
      embeddedTonnesBatch: Number(product.totalTonnes.toFixed(4)),
      customsDeclarationNo: cfg.customsDeclarationNo,
      poContractId: cfg.poContractId,
      billOfLadingNo: cfg.billOfLadingNo,
      containerNo: cfg.containerNo,
      evidenceLookupCode: product.evidenceLookupCode,
      evidenceHashes: [],
      issuedAt: new Date().toISOString()
    };
    const payloadSha256 = sha256Json(payload);
    const decentralizedUrl =
      overrides.decentralizedUrl ||
      `https://dpp.weavecarbon.local/01/${encodeURIComponent(gtin)}?sku=${encodeURIComponent(product.sku)}&hash=${payloadSha256.slice(0, 16)}`;

    const result = await pool.query(
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
    const result = await pool.query(
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
        embeddedTonnesBatch: Number(product.totalTonnes.toFixed(4))
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
