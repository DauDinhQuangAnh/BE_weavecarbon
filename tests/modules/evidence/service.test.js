jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

const { createEvidenceService } = require('../../../src/modules/evidence');

const COMPANY_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';

function createDependencies() {
  return {
    repository: {
      findProductId: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      updateExtractedJson: jest.fn(),
      markExtractionFailed: jest.fn(),
      lock: jest.fn(),
      exists: jest.fn(),
      getStatus: jest.fn(),
      getExtractedJson: jest.fn(),
      getStoredFile: jest.fn(),
      deleteLinkedInvoices: jest.fn(),
      deleteEvidence: jest.fn()
    },
    storage: { removeEvidenceFile: jest.fn().mockResolvedValue(undefined) },
    log: { warn: jest.fn() }
  };
}

describe('EvidenceService', () => {
  test('rejects a malformed product id without querying the database', async () => {
    const dependencies = createDependencies();
    const service = createEvidenceService(dependencies);

    await expect(service.ensureProductBelongsToCompany(COMPANY_ID, 'not-a-uuid'))
      .resolves.toBeNull();
    expect(dependencies.repository.findProductId).not.toHaveBeenCalled();
  });

  test('returns PRODUCT_NOT_FOUND before insert when product ownership fails', async () => {
    const dependencies = createDependencies();
    dependencies.repository.findProductId.mockResolvedValue(null);
    const service = createEvidenceService(dependencies);

    await expect(service.createEvidence(COMPANY_ID, 'user-1', {
      productId: PRODUCT_ID,
      documentName: 'Invoice.pdf'
    })).resolves.toEqual({ error: 'PRODUCT_NOT_FOUND' });
    expect(dependencies.repository.create).not.toHaveBeenCalled();
  });

  test('requires a document name before insert', async () => {
    const dependencies = createDependencies();
    const service = createEvidenceService(dependencies);

    await expect(service.createEvidence(COMPANY_ID, 'user-1', {}))
      .resolves.toEqual({ error: 'DOCUMENT_NAME_REQUIRED' });
    expect(dependencies.repository.create).not.toHaveBeenCalled();
  });

  test('normalizes mixed payload styles and formats the created evidence', async () => {
    const dependencies = createDependencies();
    dependencies.repository.findProductId.mockResolvedValue(PRODUCT_ID);
    dependencies.repository.create.mockImplementation(async (values) => ({
      id: 'evidence-1',
      company_id: values.companyId,
      product_id: values.productId,
      evidence_type: values.evidenceType,
      document_name: values.documentName,
      original_filename: values.originalFilename,
      file_size_bytes: values.fileSizeBytes,
      extracted_json: {},
      status: 'uploaded'
    }));
    const service = createEvidenceService(dependencies);

    const result = await service.createEvidence(COMPANY_ID, 'user-1', {
      product_id: PRODUCT_ID,
      evidenceType: 'invoice',
      fileName: 'Invoice.pdf',
      reportingPeriodStart: '2026-08-01T12:00:00Z',
      fileSizeBytes: '42'
    });

    expect(dependencies.repository.create).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      productId: PRODUCT_ID,
      evidenceType: 'invoice',
      documentName: 'Invoice.pdf',
      reportingPeriodStart: '2026-08-01',
      storageProvider: 'local',
      originalFilename: 'Invoice.pdf',
      fileSizeBytes: 42,
      extractedJson: '{}',
      userId: 'user-1'
    }));
    expect(result.data).toEqual(expect.objectContaining({
      id: 'evidence-1',
      productId: PRODUCT_ID,
      fileName: 'Invoice.pdf',
      verificationLevel: 0
    }));
  });

  test('maps extraction status and fields for the frontend', async () => {
    const dependencies = createDependencies();
    dependencies.repository.getStatus.mockResolvedValue({
      status: 'extract_failed',
      field_count: '2',
      warnings: ['warning'],
      extraction_error: 'failed'
    });
    dependencies.repository.getExtractedJson.mockResolvedValue({
      extracted_json: { invoice_number: 123, supplier: null }
    });
    const service = createEvidenceService(dependencies);

    await expect(service.getEvidenceStatus(COMPANY_ID, 'evidence-1')).resolves.toEqual({
      status: 'extract_failed',
      fieldCount: 2,
      warnings: ['warning'],
      extractionError: 'failed'
    });
    await expect(service.getEvidenceFields(COMPANY_ID, 'evidence-1')).resolves.toEqual([
      { id: 'invoice_number', label: 'invoice_number', ai_value: '123', confirmed_value: null },
      { id: 'supplier', label: 'supplier', ai_value: '', confirmed_value: null }
    ]);
  });

  test('deletes metadata and then removes a local file', async () => {
    const dependencies = createDependencies();
    dependencies.repository.getStoredFile.mockResolvedValue({
      storage_provider: 'local',
      storage_key: 'evidence/company/2026/file.pdf'
    });
    dependencies.repository.deleteEvidence.mockResolvedValue(true);
    const service = createEvidenceService(dependencies);

    await expect(service.deleteEvidence(COMPANY_ID, 'evidence-1')).resolves.toBe(true);
    expect(dependencies.repository.deleteLinkedInvoices).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      evidenceId: 'evidence-1'
    });
    expect(dependencies.storage.removeEvidenceFile)
      .toHaveBeenCalledWith('evidence/company/2026/file.pdf');
  });

  test('keeps database deletion successful when local file cleanup fails', async () => {
    const dependencies = createDependencies();
    const cleanupError = new Error('disk unavailable');
    dependencies.repository.getStoredFile.mockResolvedValue({
      storage_provider: 'local',
      storage_key: 'evidence/company/2026/file.pdf'
    });
    dependencies.repository.deleteEvidence.mockResolvedValue(true);
    dependencies.storage.removeEvidenceFile.mockRejectedValue(cleanupError);
    const service = createEvidenceService(dependencies);

    await expect(service.deleteEvidence(COMPANY_ID, 'evidence-1')).resolves.toBe(true);
    expect(dependencies.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: cleanupError, evidenceId: 'evidence-1' }),
      expect.stringContaining('failed to remove local evidence file')
    );
  });
});
