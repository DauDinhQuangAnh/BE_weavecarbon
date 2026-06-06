const pool = require('../config/database');

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
  async ensureProductBelongsToCompany(companyId, productId) {
    const safeProductId = toUuidOrNull(productId);
    if (!safeProductId) return null;

    const result = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND company_id = $2',
      [safeProductId, companyId]
    );
    return result.rows[0]?.id || null;
  }

  async listEvidence(companyId, filters = {}) {
    const conditions = ['company_id = $1'];
    const params = [companyId];
    let index = 2;

    if (filters.productId) {
      const safeProductId = toUuidOrNull(filters.productId);
      if (!safeProductId) return [];
      conditions.push(`product_id = $${index}`);
      params.push(safeProductId);
      index += 1;
    }

    if (filters.lookupCode) {
      conditions.push(`lookup_code = $${index}`);
      params.push(filters.lookupCode);
      index += 1;
    }

    const result = await pool.query(
      `
        SELECT *
        FROM evidence_documents
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 200
      `,
      params
    );

    return result.rows.map((row) => this.formatEvidence(row));
  }

  async createEvidence(companyId, userId, payload = {}) {
    const productId = await this.ensureProductBelongsToCompany(
      companyId,
      payload.product_id || payload.productId
    );

    if ((payload.product_id || payload.productId) && !productId) {
      return { error: 'PRODUCT_NOT_FOUND' };
    }

    const evidenceType = toText(payload.evidence_type || payload.evidenceType || payload.type) || 'document';
    const documentName = toText(payload.document_name || payload.documentName || payload.fileName || payload.name);
    if (!documentName) {
      return { error: 'DOCUMENT_NAME_REQUIRED' };
    }

    const result = await pool.query(
      `
        INSERT INTO evidence_documents (
          company_id,
          product_id,
          shipment_id,
          evidence_type,
          document_name,
          lookup_code,
          source_vendor,
          reporting_period_start,
          reporting_period_end,
          storage_provider,
          storage_bucket,
          storage_key,
          original_filename,
          mime_type,
          file_size_bytes,
          checksum_sha256,
          extracted_json,
          status,
          uploaded_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'uploaded',$18)
        RETURNING *
      `,
      [
        companyId,
        productId,
        toUuidOrNull(payload.shipment_id || payload.shipmentId),
        evidenceType,
        documentName,
        toText(payload.lookup_code || payload.lookupCode) || null,
        toText(payload.source_vendor || payload.sourceVendor || payload.vendor) || null,
        toDateOrNull(payload.reporting_period_start || payload.reportingPeriodStart),
        toDateOrNull(payload.reporting_period_end || payload.reportingPeriodEnd),
        toText(payload.storage_provider || payload.storageProvider) || 'local',
        toText(payload.storage_bucket || payload.storageBucket) || null,
        toText(payload.storage_key || payload.storageKey) || null,
        toText(payload.original_filename || payload.originalFilename || payload.fileName) || documentName,
        toText(payload.mime_type || payload.mimeType) || null,
        Number.isFinite(Number(payload.file_size_bytes || payload.fileSizeBytes))
          ? Number(payload.file_size_bytes || payload.fileSizeBytes)
          : 0,
        toText(payload.checksum_sha256 || payload.checksumSha256 || payload.sha256) || null,
        JSON.stringify(toObject(payload.extracted_json || payload.extractedJson)),
        userId
      ]
    );

    return { data: this.formatEvidence(result.rows[0]) };
  }

  async lockEvidence(companyId, userId, evidenceId) {
    const result = await pool.query(
      `
        UPDATE evidence_documents
        SET status = 'locked',
            locked_at = now(),
            locked_by = $3,
            updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING *
      `,
      [evidenceId, companyId, userId]
    );
    return result.rows[0] ? this.formatEvidence(result.rows[0]) : null;
  }

  formatEvidence(row) {
    return {
      id: row.id,
      companyId: row.company_id,
      productId: row.product_id,
      shipmentId: row.shipment_id,
      evidenceType: row.evidence_type,
      documentName: row.document_name,
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
      checksumSha256: row.checksum_sha256,
      extractedJson: row.extracted_json || {},
      status: row.status,
      lockedAt: row.locked_at,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = new EvidenceService();
