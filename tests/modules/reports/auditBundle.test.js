const JSZip = require('jszip');
const {
  buildAuditBundleArchive,
  sha256
} = require('../../../src/modules/reports/auditBundle');

const evidenceBuffer = Buffer.from('locked source document');
const input = {
  bundle: {
    id: 'bundle-1', version: 1, company_id: 'company-1', created_at: '2026-09-08T00:00:00.000Z'
  },
  product: { id: 'product-1', sku: 'SKU/01', name: 'Tee' },
  snapshot: {
    id: 'snapshot-1', version: 2, calculated_at: '2026-09-08T00:00:00.000Z',
    engine_version: 'engine-v1', methodology_version: 'method-v1',
    factor_registry_version: 'factors-v1', gwp_basis: 'AR5', canonical_input_hash: 'a'.repeat(64),
    payload: {
      carbonInput: { unitMassKg: 0.2 },
      carbonResults: {
        calculationTermsSchemaVersion: 'carbon-contribution-terms-v1',
        calculationTerms: [{
          stage: 'materials', activity: 0.2, activityUnit: 'kg',
          factorId: 'cotton', factorVersionId: 'cotton:v1', factorValue: 10,
          factorUnit: 'kgCO2e/kg', kgCo2e: 2
        }]
      }
    }
  },
  evidenceFiles: [{
    evidence_document_id: 'evidence-1', evidence_type: 'material_invoice',
    original_filename: '../invoice?.pdf', mime_type: 'application/pdf',
    file_size_bytes: evidenceBuffer.length, checksum_sha256: sha256(evidenceBuffer),
    reporting_period_start: '2026-01-01', reporting_period_end: '2026-01-31',
    buffer: evidenceBuffer
  }]
};

describe('server Audit Pack archive', () => {
  test('creates a verifiable manifest, calculation snapshot and evidence file', async () => {
    const result = await buildAuditBundleArchive(input);
    const repeated = await buildAuditBundleArchive(input);
    expect(result.bundleSha256).toBe(sha256(result.buffer));
    expect(repeated.bundleSha256).toBe(result.bundleSha256);
    expect(result.manifest.assuranceStatus).toBe('not_verified');
    expect(result.manifest.manifestSha256).toBe(result.manifestSha256);
    const zip = await JSZip.loadAsync(result.buffer);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      'manifest.json', 'calculation.json', 'evidence/index.json',
      'evidence/evidence-1/_invoice_.pdf'
    ]));
    expect(await zip.file('evidence/evidence-1/_invoice_.pdf').async('nodebuffer'))
      .toEqual(evidenceBuffer);
  });

  test('fails closed when evidence bytes do not match the pinned checksum', async () => {
    const tampered = {
      ...input,
      evidenceFiles: [{ ...input.evidenceFiles[0], buffer: Buffer.from('tampered bytes') }]
    };
    await expect(buildAuditBundleArchive(tampered)).rejects.toMatchObject({
      code: 'AUDIT_EVIDENCE_CHECKSUM_MISMATCH'
    });
  });

  test('blocks legacy snapshots without contribution terms', async () => {
    const legacy = {
      ...input,
      snapshot: { ...input.snapshot, payload: { carbonResults: { perProduct: { total: 2 } } } }
    };
    await expect(buildAuditBundleArchive(legacy)).rejects.toMatchObject({
      code: 'AUDIT_CALCULATION_TERMS_REQUIRED'
    });
  });
});
