const { createReportsService } = require('../../../src/modules/reports');
const { createExportV2Service } = require('../../../src/services/exportV2Service');

const productRow = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'SKU-1',
  name: 'Authoritative Tee',
  category: 'tshirt',
  weight_kg: '0.2',
  total_co2e: '4.577',
  materials_co2e: '2.864',
  production_co2e: '1.591',
  transport_co2e: '0.106',
  packaging_co2e: '0.016',
  snapshot_id: '22222222-2222-4222-8222-222222222222',
  snapshot_version: 7,
  snapshot_calculated_at: '2026-08-31T00:00:00.000Z',
  snapshot_engine_version: 'scope-quality-rss-1.0.0',
  snapshot_methodology_version: 'textile-pcf-2.1.0',
  snapshot_factor_registry_version: 'factors-v1:test',
  snapshot_gwp_basis: 'IPCC_AR5_100y',
  snapshot_canonical_input_hash: 'a'.repeat(64),
  snapshot_is_legacy: false,
  payload: {
    quantity: 10,
    carbonResults: {
      perProduct: {
        materials: 999999,
        production: 999999,
        energy: 0,
        transport: 999999,
        packaging: 999999,
        total: 999999
      },
      totalBatch: { total: 45.77 },
      scope1: 0.2,
      scope2: 1.391,
      scope3: 2.986,
      methodologyVersion: 'textile-pcf-2.1.0'
    }
  }
};

describe('official carbon output identity', () => {
  test('DPP prototype refuses fabricated identifiers and private URLs', async () => {
    const database = {
      query: jest.fn((sql) => {
        const text = String(sql);
        if (text.includes('FROM products p')) return Promise.resolve({ rows: [productRow] });
        if (text.includes('FROM export_configurations')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      })
    };
    const exports = createExportV2Service({ database });
    await expect(exports.createDppLock('company-1', 'user-1', productRow.id, {}))
      .rejects.toMatchObject({ code: 'VALID_GTIN_REQUIRED' });
    await expect(exports.createDppLock('company-1', 'user-1', productRow.id, {
      gtin: '4006381333931', decentralizedUrl: 'https://dpp.weavecarbon.local/item',
      operatorId: 'OP-1', facilityId: 'FAC-1'
    })).rejects.toMatchObject({ code: 'PUBLIC_DPP_URL_REQUIRED' });
    await expect(exports.createDppLock('company-1', 'user-1', productRow.id, {
      gtin: '4006381333931', decentralizedUrl: 'https://172.20.0.5/item',
      operatorId: 'OP-1', facilityId: 'FAC-1'
    })).rejects.toMatchObject({ code: 'PUBLIC_DPP_URL_REQUIRED' });
  });

  test('report and DPP ignore client totals and carry one server calculation reference', async () => {
    const reportDatabase = {
      query: jest.fn((sql) => {
        const text = String(sql);
        if (text.includes('FROM report_templates')) {
          return Promise.resolve({ rows: [{ id: 'template-1', version: '2.0' }] });
        }
        if (text.includes('INNER JOIN latest_product_assessment_snapshots')) {
          return Promise.resolve({ rows: [productRow] });
        }
        if (text.includes('INSERT INTO report_snapshots')) {
          return Promise.resolve({
            rows: [{ id: 'report-1', sku: productRow.sku, snapshot_type: 'weave_carbon_v2' }]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    };
    const reports = createReportsService({ database: reportDatabase });
    const report = await reports.createV2Snapshot('company-1', 'user-1', {
      productId: productRow.id,
      payload: {
        sku: { id: productRow.id, sku: productRow.sku },
        totals: { pcfKgPerUnit: 999999, batchTonnes: 999999 },
        breakdownRows: [{ stage: 'tampered', kgCo2e: 999999 }]
      }
    });

    const exportDatabase = {
      query: jest.fn((sql, params) => {
        const text = String(sql);
        if (text.includes('FROM export_configurations')) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes('FROM products p')) {
          return Promise.resolve({ rows: [productRow] });
        }
        if (text.includes('FROM evidence_documents')) {
          return Promise.resolve({ rows: [{ evidence_type: 'pcf_source', checksum_sha256: 'b'.repeat(64) }] });
        }
        if (text.includes('INSERT INTO dpp_locks')) {
          const payload = JSON.parse(params[5]);
          return Promise.resolve({
            rows: [{
              id: 'dpp-1',
              product_id: productRow.id,
              sku: productRow.sku,
              gtin: payload.gtin,
              barcode_standard: 'GS1-Digital',
              payload,
              payload_sha256: params[6],
              decentralized_url: params[7],
              status: 'prototype',
              locked_at: '2026-08-31T00:01:00.000Z'
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    };
    const exports = createExportV2Service({ database: exportDatabase });
    const dpp = await exports.createDppLock(
      'company-1',
      'user-1',
      productRow.id,
      {
        embeddedKgPerUnit: 999999,
        gtin: '4006381333931',
        decentralizedUrl: 'https://weavecarbon.com/dpp/4006381333931',
        operatorId: 'VN-OPERATOR-1',
        facilityId: 'VN-FACILITY-1'
      }
    );

    expect(report.payload.totals.pcfKgPerUnit).toBe(4.577);
    expect(report.payload.breakdownRows.map((row) => row.kgCo2e)).not.toContain(999999);
    expect(dpp.payload.embeddedKgPerUnit).toBe(4.577);
    expect(dpp.payload.carbonResults.perProduct.total).toBe(4.577);
    expect(report.carbonAuthority).toEqual(dpp.carbonAuthority);
    expect(report.carbonAuthority).toEqual({
      authoritative: true,
      source: 'product_assessment_snapshot',
      calculationId: productRow.snapshot_id,
      calculationVersion: 7,
      calculatedAt: productRow.snapshot_calculated_at,
      engineVersion: productRow.snapshot_engine_version,
      methodologyVersion: productRow.snapshot_methodology_version,
      factorRegistryVersion: productRow.snapshot_factor_registry_version,
      gwpBasis: productRow.snapshot_gwp_basis,
      canonicalInputHash: productRow.snapshot_canonical_input_hash,
      legacy: false
    });
  });
});
