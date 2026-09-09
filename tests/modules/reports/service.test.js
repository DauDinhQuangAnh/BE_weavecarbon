jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/analytics', () => ({
  enqueueEvent: jest.fn(),
  queuePendingDispatch: jest.fn(),
  trackEvent: jest.fn()
}));
jest.mock('../../../src/modules/shared/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { createReportsService } = require('../../../src/modules/reports');
const { createMockClient } = require('../../helpers/mockPool');
const { sha256 } = require('../../../src/modules/reports/auditBundle');

describe('ReportsService', () => {
  test('loads the active V2 template through the injected database port', async () => {
    const template = { id: 'template-id', version: '2.0' };
    const database = { query: jest.fn().mockResolvedValue({ rows: [template] }) };
    const service = createReportsService({ database });

    await expect(service.getActiveV2Template()).resolves.toBe(template);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('report_templates'));
  });

  test('keeps list filtering, safe sorting and pagination on the company boundary', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'report-id',
        report_type: 'dataset_export',
        title: 'Audit export',
        status: 'completed',
        file_format: 'csv',
        records: 4
      }] });
    const database = { connect: jest.fn().mockResolvedValue(client) };
    const service = createReportsService({ database });

    const result = await service.listReports('company-id', {
      search: 'audit',
      status: 'completed',
      page: 2,
      page_size: 5,
      sort_by: 'unsafe_column',
      sort_order: 'asc'
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('r.company_id = $1'),
      ['company-id', '%audit%', 'completed']
    );
    expect(client.query.mock.calls[1][0]).toContain('ORDER BY r.created_at ASC');
    expect(client.query.mock.calls[1][1]).toEqual([
      'company-id', '%audit%', 'completed', 5, 5
    ]);
    expect(result.pagination).toEqual({ page: 2, page_size: 5, total: 1, total_pages: 1 });
    expect(result.items[0]).toEqual(expect.objectContaining({ id: 'report-id' }));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('releases a database connection when a report query fails', async () => {
    const client = createMockClient();
    const queryError = new Error('database unavailable');
    client.query.mockRejectedValue(queryError);
    const service = createReportsService({
      database: { connect: jest.fn().mockResolvedValue(client) }
    });

    await expect(service.getReportById('report-id', 'company-id')).rejects.toBe(queryError);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('includes the authoritative calculation identity in product exports', () => {
    const service = createReportsService();
    const dataset = service._getDatasetQuery('company-id', 'product');

    expect(dataset.query).toContain('INNER JOIN latest_product_assessment_snapshots');
    expect(dataset.query).toContain('ps.id AS calculation_id');
    expect(dataset.columns).toEqual(expect.arrayContaining([
      'calculation_id',
      'calculation_version',
      'calculated_at',
      'engine_version',
      'methodology_version',
      'factor_registry_version',
      'gwp_basis',
      'canonical_input_hash',
      'is_legacy'
    ]));
  });

  test('reads an Audit Pack only through the requesting company boundary', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{
      id: 'bundle-1', report_id: 'report-1', product_id: 'product-1',
      calculation_snapshot_id: 'snapshot-1', version: '2', status: 'completed',
      manifest: { termEvidenceCoverage: { status: 'complete' } },
      review_id: 'review-1', review_decision: 'approved', review_qa_exceptions: [],
      assurance_status: 'not_verified', manifest_sha256: 'a'.repeat(64),
      bundle_sha256: 'b'.repeat(64), file_size_bytes: '321', original_filename: 'pack.zip'
    }] }) };
    const service = createReportsService({ database });

    await expect(service.getAuditBundle('company-1', 'bundle-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'bundle-1', version: 2, status: 'completed', lifecycleStatus: 'ready',
        downloadUrl: '/api/reports/report-1/download'
      })
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ab.id = $1 AND ab.company_id = $2'),
      ['bundle-1', 'company-1']
    );
    expect(database.query.mock.calls[0][0]).toContain('INNER JOIN audit_bundle_issuances newer_issuance');
  });

  test.each([
    [false, 'issued'],
    [true, 'superseded']
  ])('supersedes an issued Audit Pack only after a newer issuance exists', async (
    hasNewerIssuedBundle,
    expectedLifecycle
  ) => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{
      id: 'bundle-1', report_id: 'report-1', product_id: 'product-1',
      calculation_snapshot_id: 'snapshot-1', version: '1', status: 'completed',
      manifest: { termEvidenceCoverage: { status: 'complete' } },
      assurance_status: 'not_verified', issuance_id: 'issuance-1',
      has_newer_issued_bundle: hasNewerIssuedBundle
    }] }) };
    const service = createReportsService({ database });

    await expect(service.getAuditBundle('company-1', 'bundle-1')).resolves.toEqual(
      expect.objectContaining({ lifecycleStatus: expectedLifecycle })
    );
  });

  test('records append-only human review with normalized QA exceptions', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'bundle-1', status: 'completed', issued: false }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'review-1', decision: 'approved',
        qa_exceptions: [{ code: 'QA-1', message: 'Checked', severity: 'warning', status: 'resolved' }],
        notes: 'Reviewed', reviewed_by: 'user-2', reviewed_at: '2026-09-09T00:00:00Z'
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.reviewAuditBundle('company-1', 'user-2', 'bundle-1', {
      decision: 'APPROVED', notes: ' Reviewed ',
      qaExceptions: [{ code: 'QA-1', message: 'Checked', severity: 'warning', status: 'resolved' }]
    })).resolves.toEqual(expect.objectContaining({ id: 'review-1', decision: 'approved' }));
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO audit_bundle_reviews');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('blocks issue until every calculation term has period-bound evidence coverage', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'bundle-1', status: 'completed', issuance_id: null, has_newer_completed_bundle: false,
        review_decision: 'approved', review_qa_exceptions: [],
        manifest: { termEvidenceCoverage: { status: 'incomplete', missingTermCount: 1 } }
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.issueAuditBundle('company-1', 'user-2', 'bundle-1', {
      assertion: 'Internal calculation assertion', criteria: 'WeaveCarbon internal review criteria v1',
      signatureAcknowledged: true
    })).rejects.toMatchObject({ code: 'AUDIT_EVIDENCE_COVERAGE_INCOMPLETE', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('requires different users for human review and issue', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'bundle-1', status: 'completed', issuance_id: null, has_newer_completed_bundle: false,
        manifest_sha256: 'a'.repeat(64), bundle_sha256: 'b'.repeat(64),
        review_decision: 'approved', review_qa_exceptions: [], reviewed_by: 'user-2',
        signer_name: 'Reviewer Issuer', signer_email: 'reviewer@example.test',
        manifest: { termEvidenceCoverage: { status: 'complete' } }
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.issueAuditBundle('company-1', 'user-2', 'bundle-1', {
      assertion: 'Internal assertion', criteria: 'Internal criteria v1', signatureAcknowledged: true
    })).rejects.toMatchObject({ code: 'AUDIT_SEGREGATION_OF_DUTIES_REQUIRED', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('issues an approved immutable Audit Pack without changing assurance status', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'bundle-1', status: 'completed', issuance_id: null, has_newer_completed_bundle: false,
        manifest_sha256: 'a'.repeat(64), bundle_sha256: 'b'.repeat(64),
        review_decision: 'approved', review_qa_exceptions: [], reviewed_by: 'user-1',
        signer_name: 'Issuer Two', signer_email: 'issuer@example.test',
        manifest: { termEvidenceCoverage: { status: 'complete' } }
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'issuance-1', assertion_text: 'Internal assertion', criteria: 'Internal criteria v1',
        issued_by: 'user-2', issued_at: '2026-09-09T00:00:00Z'
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createReportsService({ database: { connect: jest.fn().mockResolvedValue(client) } });

    await expect(service.issueAuditBundle('company-1', 'user-2', 'bundle-1', {
      assertion: 'Internal assertion', criteria: 'Internal criteria v1', signatureAcknowledged: true
    })).resolves.toEqual(expect.objectContaining({
      id: 'issuance-1', lifecycleStatus: 'issued', assuranceStatus: 'not_verified'
    }));
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO audit_bundle_issuances');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('blocks Audit Pack creation for a snapshot without contribution terms', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        product_id: '11111111-1111-4111-8111-111111111111',
        snapshot_id: 'snapshot-1', is_legacy: false,
        payload: { carbonResults: { perProduct: { total: 2 } } }
      }] })
      .mockResolvedValue({ rows: [] });
    const service = createReportsService({
      database: { connect: jest.fn().mockResolvedValue(client) }
    });

    await expect(service.createAuditBundle(
      'company-1', 'user-1', '11111111-1111-4111-8111-111111111111'
    )).rejects.toMatchObject({ code: 'AUDIT_CALCULATION_TERMS_REQUIRED', statusCode: 409 });
    expect(client.query.mock.calls[1][1]).toEqual([
      '11111111-1111-4111-8111-111111111111', 'company-1'
    ]);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('writes and verifies the Audit Pack before marking it completed', async () => {
    const uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weave-audit-'));
    try {
      const evidenceBuffer = Buffer.from('approved evidence bytes');
      const evidencePath = path.join(uploadsRoot, 'evidence', 'source.pdf');
      await fs.promises.mkdir(path.dirname(evidencePath), { recursive: true });
      await fs.promises.writeFile(evidencePath, evidenceBuffer);
      const client = createMockClient();
      client.query.mockImplementation((sql) => {
        const text = String(sql);
        if (text.includes('SELECT ab.*, p.sku')) {
          return Promise.resolve({ rows: [{
            id: 'bundle-1', company_id: 'company-1', product_id: 'product-1',
            calculation_snapshot_id: 'snapshot-1', report_id: 'report-1', version: 1,
            status: 'processing', sku: 'SKU-1', name: 'Tee',
            created_at: '2026-09-09T00:00:00.000Z', snapshot_version: 2,
            calculated_at: '2026-09-09T00:00:00.000Z', engine_version: 'engine-v1',
            methodology_version: 'method-v1', factor_registry_version: 'factors-v1',
            gwp_basis: 'AR5', canonical_input_hash: 'a'.repeat(64),
            snapshot_payload: {
              carbonResults: {
                calculationTermsSchemaVersion: 'carbon-contribution-terms-v1',
                calculationTerms: [{
                  stage: 'materials', activity: 1, activityUnit: 'kg', factorId: 'cotton',
                  factorVersionId: 'cotton:v1', factorValue: 2, factorUnit: 'kgCO2e/kg', kgCo2e: 2
                }]
              }
            }
          }] });
        }
        if (text.includes('SELECT * FROM audit_bundle_evidence')) {
          return Promise.resolve({ rows: [{
            audit_bundle_id: 'bundle-1', evidence_document_id: 'evidence-1',
            evidence_type: 'material_invoice', storage_provider: 'local',
            storage_key: 'evidence/source.pdf', original_filename: 'source.pdf',
            mime_type: 'application/pdf', file_size_bytes: evidenceBuffer.length,
            checksum_sha256: sha256(evidenceBuffer)
          }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });
      const service = createReportsService({
        database: { connect: jest.fn().mockResolvedValue(client) },
        uploadsRoot
      });

      const result = await service._generateAuditBundle('report-1', 'bundle-1', 'company-1');
      const completion = client.query.mock.calls.find(([sql]) =>
        String(sql).includes("UPDATE audit_bundles\n                SET status = 'completed'")
      );
      expect(completion).toBeTruthy();
      const storageKey = completion[1][3];
      const bundleBuffer = await fs.promises.readFile(path.join(uploadsRoot, storageKey));
      expect(sha256(bundleBuffer)).toBe(result.bundleSha256);
      const zip = await JSZip.loadAsync(bundleBuffer);
      expect(zip.file('manifest.json')).toBeTruthy();
      expect(zip.file('evidence/evidence-1/source.pdf')).toBeTruthy();
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledTimes(1);
    } finally {
      await fs.promises.rm(uploadsRoot, { recursive: true, force: true });
    }
  });
});
