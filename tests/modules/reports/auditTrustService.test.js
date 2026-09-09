jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/analytics', () => ({
  enqueueEvent: jest.fn(), queuePendingDispatch: jest.fn(), trackEvent: jest.fn()
}));
jest.mock('../../../src/modules/shared/logger', () => ({
  error: jest.fn(), info: jest.fn(), warn: jest.fn()
}));

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createReportsService } = require('../../../src/modules/reports');
const { createMockClient } = require('../../helpers/mockPool');
const { createAuditIssuanceSignature } = require('../../../src/modules/reports/auditTrust');
const { sha256 } = require('../../../src/modules/reports/auditBundle');

const signedRow = (overrides = {}) => {
  const signature = createAuditIssuanceSignature({
    companyId: 'company-1',
    auditBundleId: 'bundle-1',
    manifestSha256: 'a'.repeat(64),
    bundleSha256: 'b'.repeat(64),
    assertion: 'Internal assertion',
    criteria: 'Criteria v1',
    signerId: 'issuer-1',
    signerName: 'Issuer One',
    signerEmail: 'issuer@example.test',
    signedAt: '2026-09-10T00:00:00.000Z'
  });
  return {
    id: 'bundle-1',
    status: 'completed',
    issuance_id: 'issuance-1',
    manifest_sha256: 'a'.repeat(64),
    bundle_sha256: 'b'.repeat(64),
    signature_algorithm: signature.signatureAlgorithm,
    signature_payload: signature.signaturePayload,
    signature_payload_sha256: signature.signaturePayloadSha256,
    signature_public_key: signature.signaturePublicKey,
    signature_value: signature.signatureValue,
    ...overrides
  };
};

describe('Audit Pack signed sharing and external assurance service', () => {
  test('creates a time-bound share while persisting only the token hash', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [signedRow({ has_newer_issued_bundle: false })] })
      .mockResolvedValueOnce({ rows: [{
        id: 'share-1', label: 'Verifier', expires_at: '2026-09-17T00:00:00Z',
        max_downloads: 3, download_count: 0, created_at: '2026-09-10T00:00:00Z'
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    const result = await service.createAuditBundleShare('company-1', 'admin-1', 'bundle-1', {
      label: 'Verifier', expiresInHours: 168, maxDownloads: 3
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.shareUrl).toContain(result.token);
    const insert = client.query.mock.calls[3];
    expect(insert[0]).toContain('INSERT INTO audit_bundle_share_links');
    expect(insert[1][3]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert[1][3]).not.toContain(result.token);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects sharing a legacy unsigned issuance', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'bundle-1', status: 'completed', issuance_id: 'issuance-1',
        manifest_sha256: 'a'.repeat(64), bundle_sha256: 'b'.repeat(64)
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.createAuditBundleShare('company-1', 'admin-1', 'bundle-1'))
      .rejects.toMatchObject({ code: 'AUDIT_ISSUANCE_SIGNATURE_REQUIRED', statusCode: 409 });
  });

  test('records an assurance conclusion only against current third-party evidence', async () => {
    const evidenceId = crypto.randomUUID();
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [signedRow({
        product_id: 'product-1', latest_assurance_id: null,
        evidence_id: evidenceId, evidence_status: 'third_party_verified',
        evidence_sha256: 'c'.repeat(64), evidence_storage_key: 'evidence/statement.pdf',
        pinned_evidence_id: evidenceId, pinned_evidence_sha256: 'c'.repeat(64),
        evidence_file_size: 123, evidence_valid_to: '2027-12-31'
      })] })
      .mockResolvedValueOnce({ rows: [{
        id: 'assurance-1', outcome: 'limited_assurance', provider_name: 'Independent Verifier',
        practitioner_name: 'Reviewer', standard: 'ISAE 3410', scope: 'Selected PCF assertions',
        statement_date: '2026-09-10', valid_to: '2027-09-10',
        evidence_document_id: evidenceId, evidence_sha256: 'c'.repeat(64),
        recorded_at: '2026-09-10T01:00:00Z'
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.createAuditBundleAssuranceRecord('company-1', 'admin-1', 'bundle-1', {
      outcome: 'limited_assurance', providerName: 'Independent Verifier', practitionerName: 'Reviewer',
      standard: 'ISAE 3410', scope: 'Selected PCF assertions', statementDate: '2026-09-10',
      validTo: '2027-09-10', evidenceDocumentId: evidenceId
    })).resolves.toEqual(expect.objectContaining({
      id: 'assurance-1', assuranceStatus: 'limited_assurance', evidenceDocumentId: evidenceId
    }));
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO audit_bundle_assurance_records');
  });

  test('streams an intact shared file once and consumes its download allowance', async () => {
    const uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'audit-share-'));
    try {
      const token = crypto.randomBytes(32).toString('base64url');
      const buffer = Buffer.from('immutable audit bundle');
      const storageKey = 'reports/company-1/bundle-1.zip';
      await fs.promises.mkdir(path.dirname(path.join(uploadsRoot, storageKey)), { recursive: true });
      await fs.promises.writeFile(path.join(uploadsRoot, storageKey), buffer);
      const row = signedRow({
        share_id: 'share-1', label: 'Verifier', expires_at: '2027-09-10T00:00:00Z',
        max_downloads: 1, download_count: 0,
        share_manifest_sha256: 'a'.repeat(64),
        share_bundle_sha256: sha256(buffer), bundle_sha256: sha256(buffer),
        audit_bundle_id: 'bundle-1', version: 1, report_id: 'report-1',
        storage_provider: 'local', storage_key: storageKey,
        original_filename: 'AuditPack.zip', mime_type: 'application/zip',
        file_size_bytes: buffer.length, sku: 'SKU-1', product_name: 'Product',
        assertion_text: 'Internal assertion', criteria: 'Criteria v1',
        signer_name_snapshot: 'Issuer One', signer_email_snapshot: 'issuer@example.test',
        issued_at: '2026-09-10T00:00:00Z'
      });
      row.signature_payload = {
        ...row.signature_payload,
        bundleSha256: sha256(buffer)
      };
      const resigned = createAuditIssuanceSignature({
        companyId: 'company-1', auditBundleId: 'bundle-1', manifestSha256: 'a'.repeat(64),
        bundleSha256: sha256(buffer), assertion: 'Internal assertion', criteria: 'Criteria v1',
        signerId: 'issuer-1', signerName: 'Issuer One', signerEmail: 'issuer@example.test',
        signedAt: '2026-09-10T00:00:00.000Z'
      });
      Object.assign(row, {
        signature_algorithm: resigned.signatureAlgorithm,
        signature_payload: resigned.signaturePayload,
        signature_payload_sha256: resigned.signaturePayloadSha256,
        signature_public_key: resigned.signaturePublicKey,
        signature_value: resigned.signatureValue
      });
      const client = createMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const service = createReportsService({
        database: { connect: jest.fn().mockResolvedValue(client) }, uploadsRoot
      });

      const result = await service.downloadPublicAuditBundleShare(token);
      expect(result.buffer).toEqual(buffer);
      expect(client.query.mock.calls[2][0]).toContain('download_count = download_count + 1');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    } finally {
      await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
    }
  });
});
