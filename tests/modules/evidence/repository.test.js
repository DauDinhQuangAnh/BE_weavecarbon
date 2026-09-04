jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));

const { createEvidenceRepository } = require('../../../src/modules/evidence');

describe('evidenceRepository', () => {
  test('rolls back a failed multi-write operation and releases the connection', async () => {
    const failure = new Error('audit failed');
    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    const database = { connect: jest.fn().mockResolvedValue(client) };
    const repository = createEvidenceRepository({ database });

    await expect(repository.withTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('lists evidence with company/product/code filters and bounded pagination', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'evidence-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const repository = createEvidenceRepository({ database });

    await expect(repository.list({
      companyId: 'company-1',
      productId: 'product-1',
      lookupCode: 'LOOKUP-1',
      pageSize: 25,
      offset: 50
    })).resolves.toEqual({ rows: [{ id: 'evidence-1' }], total: 1 });

    expect(database.query.mock.calls[0][0]).toContain(
      'company_id = $1 AND product_id = $2 AND lookup_code = $3'
    );
    expect(database.query.mock.calls[0][1]).toEqual([
      'company-1', 'product-1', 'LOOKUP-1', 25, 50
    ]);
    expect(database.query.mock.calls[1][1]).toEqual([
      'company-1', 'product-1', 'LOOKUP-1'
    ]);
  });

  test('persists normalized evidence values in the preserved column order', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'evidence-1' }] }) };
    const repository = createEvidenceRepository({ database });
    const values = {
      companyId: 'company-1',
      productId: 'product-1',
      shipmentId: null,
      evidenceType: 'invoice',
      documentName: 'Invoice.pdf',
      lookupCode: 'LOOKUP-1',
      sourceVendor: 'Vendor',
      reportingPeriodStart: '2026-01-01',
      reportingPeriodEnd: '2026-01-31',
      storageProvider: 'local',
      storageBucket: null,
      storageKey: 'evidence/company/2026/file.pdf',
      originalFilename: 'Invoice.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 100,
      checksumSha256: 'abc',
      extractedJson: '{}',
      userId: 'user-1'
    };

    await expect(repository.create(values)).resolves.toEqual({ id: 'evidence-1' });
    expect(database.query.mock.calls[0][1]).toEqual([
      'company-1', 'product-1', null, 'invoice', 'Invoice.pdf', 'LOOKUP-1',
      'Vendor', '2026-01-01', '2026-01-31', 'local', null,
      'evidence/company/2026/file.pdf', 'Invoice.pdf', 'application/pdf', 100,
      'abc', '{}', 'user-1'
    ]);
  });

  test('keeps status and field reads company-scoped', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ status: 'ocr_parsed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evidence-1', extracted_json: {} }] });
    const repository = createEvidenceRepository({ database });

    await repository.getStatus({ evidenceId: 'evidence-1', companyId: 'company-1' });
    await repository.getExtractedJson({ evidenceId: 'evidence-1', companyId: 'company-1' });

    for (const call of database.query.mock.calls) {
      expect(call[0]).toContain('WHERE id = $1 AND company_id = $2');
      expect(call[1]).toEqual(['evidence-1', 'company-1']);
    }
  });

  test('deletes linked invoices in the preserved order and company scope', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const repository = createEvidenceRepository({ database });

    await repository.deleteLinkedInvoices({ evidenceId: 'evidence-1', companyId: 'company-1' });
    await expect(repository.deleteEvidence({
      evidenceId: 'evidence-1',
      companyId: 'company-1'
    })).resolves.toBe(true);

    expect(database.query.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining('DELETE FROM electricity_invoices'),
      expect.stringContaining('DELETE FROM fuel_invoices'),
      expect.stringContaining('DELETE FROM evidence_documents')
    ]);
    for (const call of database.query.mock.calls) {
      expect(call[1]).toEqual(['evidence-1', 'company-1']);
    }
  });
});
