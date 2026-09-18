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
  const transaction = { id: 'transaction' };
  return {
    repository: {
      withTransaction: jest.fn((work) => work(transaction)),
      findProductId: jest.fn(),
      findShipmentId: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      updateExtractedJson: jest.fn(),
      markExtractionFailed: jest.fn(),
      lock: jest.fn(),
      exists: jest.fn(),
      getStatus: jest.fn(),
      getExtractedJson: jest.fn(),
      getExtractionForReview: jest.fn(),
      getReviewer: jest.fn(),
      createExtractionReview: jest.fn(),
      createExtractionFieldDecision: jest.fn(),
      listExtractionReviews: jest.fn(),
      getStoredFile: jest.fn(),
      deleteLinkedInvoices: jest.fn(),
      deleteEvidence: jest.fn()
    },
    storage: { removeEvidenceFile: jest.fn().mockResolvedValue(undefined) },
    log: { warn: jest.fn() },
    audit: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    transaction
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
      extracted_json: { auditClaims: { factorVersionIds: [] }, invoice_number: 123, supplier: null }
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

  test('blocks direct locking when AI/OCR fields have not received field decisions', async () => {
    const dependencies = createDependencies();
    dependencies.repository.getExtractionForReview.mockResolvedValue({
      id: 'evidence-1',
      extracted_json: { auditClaims: { factorVersionIds: [] }, invoice_number: 'INV-1' }
    });
    const service = createEvidenceService(dependencies);

    await expect(service.lockEvidenceWithAudit(COMPANY_ID, 'user-1', 'evidence-1'))
      .resolves.toEqual(expect.objectContaining({
        blocked: true,
        code: 'EVIDENCE_AI_FIELD_REVIEW_REQUIRED'
      }));
    expect(dependencies.repository.lock).not.toHaveBeenCalled();
    expect(dependencies.audit).not.toHaveBeenCalled();
  });

  test('allows direct locking when extracted JSON only contains platform metadata', async () => {
    const dependencies = createDependencies();
    dependencies.repository.getExtractionForReview.mockResolvedValue({
      id: 'evidence-1', extracted_json: { auditClaims: { factorVersionIds: [] } }
    });
    dependencies.repository.lock.mockResolvedValue({
      id: 'evidence-1', company_id: COMPANY_ID, status: 'locked',
      evidence_type: 'invoice', document_name: 'Invoice.pdf'
    });
    const service = createEvidenceService(dependencies);

    await expect(service.lockEvidenceWithAudit(COMPANY_ID, 'user-1', 'evidence-1'))
      .resolves.toEqual(expect.objectContaining({ id: 'evidence-1', status: 'locked' }));
    expect(dependencies.repository.lock).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceId: 'evidence-1' }), dependencies.transaction
    );
  });

  test('persists every human field decision before locking AI-extracted evidence', async () => {
    const dependencies = createDependencies();
    dependencies.repository.getExtractionForReview.mockResolvedValue({ id: 'evidence-1', status: 'ocr_parsed',
      checksum_sha256: 'a'.repeat(64), file_size_bytes: 42, extracted_json: { invoice_number: 'INV-1', quantity: 10 } });
    dependencies.repository.getReviewer.mockResolvedValue({ id: 'user-1', email: 'reviewer@example.com', full_name: 'Named Reviewer' });
    dependencies.repository.createExtractionReview.mockResolvedValue({ id: 'review-1', evidence_document_id: 'evidence-1',
      evidence_checksum_sha256: 'a'.repeat(64), extraction_sha256: 'b'.repeat(64), reviewer_id: 'user-1',
      reviewer_name_snapshot: 'Named Reviewer', reviewer_role: 'evidence_ai_reviewer', decision: 'approved_for_mapping', notes: 'Checked.' });
    dependencies.repository.createExtractionFieldDecision.mockImplementation(async (value) => ({ id: `field-${value.fieldPath}`,
      field_path: value.fieldPath, ai_value: JSON.parse(value.aiValue), decision: value.decision,
      confirmed_value: JSON.parse(value.confirmedValue), canonical_field: value.canonicalField, field_sha256: value.fieldSha256 }));
    dependencies.repository.lock.mockResolvedValue({ id: 'evidence-1', company_id: COMPANY_ID, status: 'locked',
      evidence_type: 'invoice', document_name: 'Invoice.pdf', checksum_sha256: 'a'.repeat(64) });
    const service = createEvidenceService(dependencies);

    const result = await service.confirmExtractionWithAudit(COMPANY_ID, 'user-1', 'evidence-1', { notes: 'Checked.', fields: [
      { id: 'invoice_number', confirmed_value: 'INV-1' }, { id: 'quantity', confirmed_value: '11' }
    ] });

    expect(result.data.review.fields).toHaveLength(2);
    expect(dependencies.repository.createExtractionFieldDecision).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'invoice_number', decision: 'accepted' }), dependencies.transaction);
    expect(dependencies.repository.createExtractionFieldDecision).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'quantity', decision: 'corrected' }), dependencies.transaction);
    expect(dependencies.repository.lock).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: 'evidence-1' }), dependencies.transaction);
    expect(dependencies.audit).toHaveBeenCalledWith(expect.objectContaining({ changedField: 'evidence.ai_extraction_reviewed' }));
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
    }, dependencies.transaction);
    expect(dependencies.storage.removeEvidenceFile)
      .toHaveBeenCalledWith('evidence/company/2026/file.pdf');
  });

  test('creates evidence and its audit row on the same transaction', async () => {
    const dependencies = createDependencies();
    dependencies.repository.create.mockResolvedValue({
      id: 'evidence-1', company_id: COMPANY_ID, evidence_type: 'invoice',
      document_name: 'Invoice.pdf', original_filename: 'Invoice.pdf', status: 'uploaded'
    });
    const service = createEvidenceService(dependencies);

    await expect(service.createEvidenceWithAudit(COMPANY_ID, 'user-1', {
      documentName: 'Invoice.pdf'
    })).resolves.toEqual({ data: expect.objectContaining({ id: 'evidence-1' }) });

    expect(dependencies.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID }),
      dependencies.transaction
    );
    expect(dependencies.audit).toHaveBeenCalledWith(expect.objectContaining({
      client: dependencies.transaction,
      strict: true,
      companyId: COMPANY_ID,
      evidenceDocumentId: 'evidence-1'
    }));
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
