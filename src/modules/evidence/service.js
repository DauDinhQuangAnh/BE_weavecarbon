const { evidenceRepository } = require('./repository');
const fileStorage = require('./fileStorage');
const logger = require('../shared/logger');
const { logAuditTrail } = require('../shared/auditing');

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toText(value) {
  return String(value ?? '').trim();
}

function toDateOrNull(value) {
  const text = toText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toUuidOrNull(value) {
  const text = toText(value);
  return UUID_REGEX.test(text) ? text : null;
}

class EvidenceService {
  constructor({
    repository = evidenceRepository,
    storage = fileStorage,
    log = logger,
    audit = logAuditTrail
  } = {}) {
    this.repository = repository;
    this.storage = storage;
    this.log = log;
    this.audit = audit;
  }

  async ensureProductBelongsToCompany(companyId, productId, queryable) {
    const safeProductId = toUuidOrNull(productId);
    if (!safeProductId) return null;

    return queryable
      ? this.repository.findProductId({ companyId, productId: safeProductId }, queryable)
      : this.repository.findProductId({ companyId, productId: safeProductId });
  }

  async listEvidence(companyId, filters = {}) {
    let productId = null;
    if (filters.productId) {
      productId = toUuidOrNull(filters.productId);
      if (!productId) return { items: [], total: 0 };
    }
    const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(filters.pageSize, 10) || 50));
    const offset = (page - 1) * pageSize;
    const result = await this.repository.list({
      companyId,
      productId,
      lookupCode: filters.lookupCode,
      pageSize,
      offset
    });

    return {
      items: result.rows.map((row) => this.formatEvidence(row)),
      total: result.total
    };
  }

  async createEvidence(companyId, userId, payload = {}, queryable) {
    const productId = await this.ensureProductBelongsToCompany(
      companyId,
      payload.product_id || payload.productId,
      queryable
    );

    if ((payload.product_id || payload.productId) && !productId) {
      return { error: 'PRODUCT_NOT_FOUND' };
    }

    const requestedShipmentId = toUuidOrNull(payload.shipment_id || payload.shipmentId);
    const shipmentId = requestedShipmentId
      ? await this.repository.findShipmentId({ companyId, shipmentId: requestedShipmentId }, queryable)
      : null;
    if ((payload.shipment_id || payload.shipmentId) && !shipmentId) {
      return { error: 'SHIPMENT_NOT_FOUND' };
    }

    const evidenceType = toText(payload.evidence_type || payload.evidenceType || payload.type) || 'document';
    const documentName = toText(payload.document_name || payload.documentName || payload.fileName || payload.name);
    if (!documentName) {
      return { error: 'DOCUMENT_NAME_REQUIRED' };
    }

    const values = {
      companyId,
      productId,
      shipmentId,
      evidenceType,
      documentName,
      lookupCode: toText(payload.lookup_code || payload.lookupCode) || null,
      sourceVendor: toText(payload.source_vendor || payload.sourceVendor || payload.vendor) || null,
      reportingPeriodStart: toDateOrNull(
        payload.reporting_period_start || payload.reportingPeriodStart
      ),
      reportingPeriodEnd: toDateOrNull(
        payload.reporting_period_end || payload.reportingPeriodEnd
      ),
      storageProvider: toText(payload.storage_provider || payload.storageProvider) || 'local',
      storageBucket: toText(payload.storage_bucket || payload.storageBucket) || null,
      storageKey: toText(payload.storage_key || payload.storageKey) || null,
      originalFilename:
        toText(payload.original_filename || payload.originalFilename || payload.fileName) || documentName,
      mimeType: toText(payload.mime_type || payload.mimeType) || null,
      fileSizeBytes: Number.isFinite(Number(payload.file_size_bytes || payload.fileSizeBytes))
        ? Number(payload.file_size_bytes || payload.fileSizeBytes)
        : 0,
      checksumSha256:
        toText(payload.checksum_sha256 || payload.checksumSha256 || payload.sha256) || null,
      extractedJson: JSON.stringify(toObject(payload.extracted_json || payload.extractedJson)),
      userId
    };
    const row = queryable
      ? await this.repository.create(values, queryable)
      : await this.repository.create(values);

    return { data: this.formatEvidence(row) };
  }

  async createEvidenceWithAudit(companyId, userId, payload = {}) {
    return this.repository.withTransaction(async (client) => {
      const result = await this.createEvidence(companyId, userId, payload, client);
      if (result.error) return result;
      await this.audit({
        client,
        strict: true,
        companyId,
        userId,
        evidenceDocumentId: result.data.id,
        dataGroup: 'evidence',
        changedField: 'evidence.uploaded',
        newValue: result.data.fileName || result.data.documentName,
        reason: payload.auditReason || 'evidence.create',
        notes: `Created evidence ${result.data.documentName || result.data.fileName || ''}`.trim()
      });
      return result;
    });
  }

  async updateExtractedJson(companyId, evidenceId, extractedJson, newStatus = 'ocr_parsed') {
    await this.repository.updateExtractedJson({
      companyId,
      evidenceId,
      extractedJson: JSON.stringify(extractedJson || {}),
      status: newStatus
    });
  }

  // Records why AI extraction produced no usable data, so the frontend can show a reason
  // instead of a silent "no fields" state. `reason` is a short, user-facing message.
  async markExtractionFailed(companyId, evidenceId, reason) {
    const message = String(reason || 'AI không đọc được chứng từ.').slice(0, 500);
    await this.repository.markExtractionFailed({
      companyId,
      evidenceId,
      warnings: JSON.stringify([message]),
      reason: message
    });
  }

  async lockEvidence(companyId, userId, evidenceId) {
    const row = await this.repository.lock({ companyId, userId, evidenceId });
    return row ? this.formatEvidence(row) : null;
  }

  async lockEvidenceWithAudit(companyId, userId, evidenceId, reason = 'evidence.lock') {
    return this.repository.withTransaction(async (client) => {
      const row = await this.repository.lock({ companyId, userId, evidenceId }, client);
      if (!row) return null;
      const evidence = this.formatEvidence(row);
      await this.audit({
        client,
        strict: true,
        companyId,
        userId,
        evidenceDocumentId: evidence.id,
        dataGroup: 'evidence',
        changedField: 'evidence.verified',
        oldValue: 'uploaded',
        newValue: 'locked',
        reason,
        notes: `Locked evidence ${evidence.fileName || evidence.documentName || evidence.id}`
      });
      return evidence;
    });
  }

  async evidenceExists(companyId, evidenceId) {
    return this.repository.exists({ companyId, evidenceId });
  }

  async getEvidenceStatus(companyId, evidenceId) {
    const row = await this.repository.getStatus({ companyId, evidenceId });
    if (!row) return null;
    return {
      status: row.status,
      fieldCount: Number(row.field_count || 0),
      warnings: row.warnings || [],
      extractionError: row.extraction_error || null
    };
  }

  async getEvidenceFields(companyId, evidenceId) {
    const row = await this.repository.getExtractedJson({ companyId, evidenceId });
    if (!row) return null;
    const extracted = row.extracted_json ?? {};
    return Object.entries(extracted).map(([key, value]) => ({
      id: key,
      label: key,
      ai_value: String(value ?? ''),
      confirmed_value: null
    }));
  }

  async deleteEvidence(companyId, evidenceId) {
    const { storedFile, deleted } = await this.repository.withTransaction(async (client) => {
      const currentFile = await this.repository.getStoredFile({ companyId, evidenceId }, client);
      await this.repository.deleteLinkedInvoices({ companyId, evidenceId }, client);
      const wasDeleted = await this.repository.deleteEvidence({ companyId, evidenceId }, client);
      return { storedFile: currentFile, deleted: wasDeleted };
    });
    if (!deleted) return false;

    if (storedFile?.storage_provider === 'local' && storedFile.storage_key) {
      await this.storage.removeEvidenceFile(storedFile.storage_key).catch((error) => {
        this.log.warn(
          { err: error, evidenceId, storageKey: storedFile.storage_key },
          '[evidence] failed to remove local evidence file after database deletion'
        );
      });
    }
    return true;
  }

  statusToVerificationLevel(status) {
    const map = {
      uploaded: 0, pending: 0,
      ocr_parsed: 1, processing: 1, extracted: 1,
      logic_checked: 2, needs_review: 2, verified: 2, locked: 2,
      source_matched: 3,
      cross_checked: 4,
      third_party_verified: 5,
    };
    return map[status] ?? 0;
  }

  formatEvidence(row) {
    const level = this.statusToVerificationLevel(row.status);
    return {
      id: row.id,
      companyId: row.company_id,
      productId: row.product_id,
      shipmentId: row.shipment_id,
      kind: row.evidence_type,
      evidenceType: row.evidence_type,
      documentName: row.document_name,
      fileName: row.original_filename || row.document_name,
      lookupCode: row.lookup_code,
      sourceVendor: row.source_vendor,
      reportingPeriodStart: row.reporting_period_start,
      reportingPeriodEnd: row.reporting_period_end,
      storageProvider: row.storage_provider,
      storageBucket: row.storage_bucket,
      storageKey: row.storage_key,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      fileSizeBytes: Number(row.file_size_bytes || 0),
      checksumSha256: row.checksum_sha256 || null,
      extractedJson: row.extracted_json || {},
      status: row.status,
      verificationLevel: level,
      trustScore: level >= 3 ? level * 20 : null,
      warnings: row.warnings || null,
      extractionError: row.extraction_error || null,
      lockedAt: row.locked_at,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function createEvidenceService(dependencies) {
  return new EvidenceService(dependencies);
}

const evidenceService = createEvidenceService();

module.exports = evidenceService;
module.exports.EvidenceService = EvidenceService;
module.exports.createEvidenceService = createEvidenceService;
module.exports.toDateOrNull = toDateOrNull;
module.exports.toObject = toObject;
module.exports.toText = toText;
module.exports.toUuidOrNull = toUuidOrNull;
