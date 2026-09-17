const pool = require('../shared/database');
const { withTransaction } = require('../shared/transaction');

function createEvidenceRepository({ database = pool } = {}) {
  return {
    withTransaction(work) {
      return withTransaction(database, work);
    },

    async findProductId({ companyId, productId }, queryable = database) {
      const { rows } = await queryable.query(
        'SELECT id FROM products WHERE id = $1 AND company_id = $2',
        [productId, companyId]
      );
      return rows[0]?.id || null;
    },

    async findShipmentId({ companyId, shipmentId }, queryable = database) {
      const { rows } = await queryable.query(
        'SELECT id FROM shipments WHERE id = $1 AND company_id = $2',
        [shipmentId, companyId]
      );
      return rows[0]?.id || null;
    },

    async list({ companyId, productId, lookupCode, pageSize, offset }) {
      const conditions = ['company_id = $1'];
      const params = [companyId];
      let index = 2;

      if (productId) {
        conditions.push(`product_id = $${index}`);
        params.push(productId);
        index += 1;
      }
      if (lookupCode) {
        conditions.push(`lookup_code = $${index}`);
        params.push(lookupCode);
        index += 1;
      }

      const where = conditions.join(' AND ');
      const [result, countResult] = await Promise.all([
        database.query(
          `SELECT id, company_id, product_id, shipment_id, evidence_type, document_name,
                  lookup_code, source_vendor, reporting_period_start, reporting_period_end,
                  valid_from, valid_to, approved_by, approval_note,
                  storage_provider, storage_bucket, storage_key, original_filename, mime_type,
                  file_size_bytes, checksum_sha256, extracted_json, status, warnings,
                  extraction_error, locked_at, uploaded_at, created_at, updated_at
           FROM evidence_documents
           WHERE ${where}
           ORDER BY created_at DESC LIMIT $${index} OFFSET $${index + 1}`,
          [...params, pageSize, offset]
        ),
        database.query(`SELECT COUNT(*) FROM evidence_documents WHERE ${where}`, params)
      ]);
      return { rows: result.rows, total: parseInt(countResult.rows[0].count, 10) };
    },

    async create(values, queryable = database) {
      const { rows } = await queryable.query(
        `INSERT INTO evidence_documents (
           company_id,
           product_id,
           shipment_id,
           evidence_type,
           document_name,
           lookup_code,
           source_vendor,
           reporting_period_start,
           reporting_period_end,
           valid_from,
           valid_to,
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
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'uploaded',$20)
         RETURNING *`,
        [
          values.companyId,
          values.productId,
          values.shipmentId,
          values.evidenceType,
          values.documentName,
          values.lookupCode,
          values.sourceVendor,
          values.reportingPeriodStart,
          values.reportingPeriodEnd,
          values.validFrom ?? null,
          values.validTo ?? null,
          values.storageProvider,
          values.storageBucket,
          values.storageKey,
          values.originalFilename,
          values.mimeType,
          values.fileSizeBytes,
          values.checksumSha256,
          values.extractedJson,
          values.userId
        ]
      );
      return rows[0];
    },

    async updateExtractedJson({ companyId, evidenceId, extractedJson, status }) {
      await database.query(
        `UPDATE evidence_documents
         SET extracted_json = COALESCE(extracted_json, '{}'::jsonb) || $1::jsonb,
             status = $2,
             warnings = '[]'::jsonb,
             extraction_error = NULL,
             updated_at = now()
         WHERE id = $3 AND company_id = $4`,
        [extractedJson, status, evidenceId, companyId]
      );
    },

    async markExtractionFailed({ companyId, evidenceId, warnings, reason }) {
      await database.query(
        `UPDATE evidence_documents
         SET status = 'extract_failed',
             warnings = $1::jsonb,
             extraction_error = $2,
             updated_at = now()
         WHERE id = $3 AND company_id = $4`,
        [warnings, reason, evidenceId, companyId]
      );
    },

    async lock({ companyId, userId, evidenceId }, queryable = database) {
      const { rows } = await queryable.query(
        `UPDATE evidence_documents
         SET status = 'locked',
             locked_at = now(),
             locked_by = $3,
             approved_by = $3,
             updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [evidenceId, companyId, userId]
      );
      return rows[0] || null;
    },

    async exists({ evidenceId, companyId }) {
      const { rows } = await database.query(
        'SELECT id FROM evidence_documents WHERE id = $1 AND company_id = $2',
        [evidenceId, companyId]
      );
      return rows.length > 0;
    },

    async getStatus({ evidenceId, companyId }) {
      const { rows } = await database.query(
        `SELECT status, warnings, extraction_error,
                CASE WHEN jsonb_typeof(extracted_json) = 'object'
                     THEN (SELECT count(*) FROM jsonb_object_keys(extracted_json))
                     ELSE 0 END AS field_count
         FROM evidence_documents
         WHERE id = $1 AND company_id = $2`,
        [evidenceId, companyId]
      );
      return rows[0] || null;
    },

    async getExtractedJson({ evidenceId, companyId }) {
      const { rows } = await database.query(
        'SELECT id, extracted_json FROM evidence_documents WHERE id = $1 AND company_id = $2',
        [evidenceId, companyId]
      );
      return rows[0] || null;
    },

    async getExtractionForReview({ evidenceId, companyId }, queryable = database) {
      const { rows } = await queryable.query(
        `SELECT id, document_name, status, checksum_sha256, file_size_bytes, extracted_json
         FROM evidence_documents WHERE id = $1 AND company_id = $2 FOR SHARE`,
        [evidenceId, companyId]
      );
      return rows[0] || null;
    },

    async getReviewer({ userId }, queryable = database) {
      const { rows } = await queryable.query(
        'SELECT id, email, full_name FROM users WHERE id = $1', [userId]
      );
      return rows[0] || null;
    },

    async createExtractionReview(values, queryable = database) {
      const { rows } = await queryable.query(
        `INSERT INTO evidence_ai_extraction_reviews
          (company_id,evidence_document_id,evidence_checksum_sha256,extraction_sha256,extraction_snapshot,
           reviewer_id,reviewer_name_snapshot,reviewer_role,decision,notes)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`,
        [values.companyId, values.evidenceDocumentId, values.evidenceChecksumSha256, values.extractionSha256,
          values.extractionSnapshot, values.reviewerId, values.reviewerName, values.reviewerRole,
          values.decision, values.notes]
      );
      return rows[0];
    },

    async createExtractionFieldDecision(values, queryable = database) {
      const { rows } = await queryable.query(
        `INSERT INTO evidence_ai_field_decisions
          (company_id,review_id,field_path,ai_value,decision,confirmed_value,canonical_field,field_sha256)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8) RETURNING *`,
        [values.companyId, values.reviewId, values.fieldPath, values.aiValue, values.decision,
          values.confirmedValue, values.canonicalField, values.fieldSha256]
      );
      return rows[0];
    },

    async listExtractionReviews({ evidenceId, companyId }) {
      const { rows } = await database.query(
        `SELECT review.*,
                COALESCE((SELECT jsonb_agg(to_jsonb(field) ORDER BY field.field_path)
                  FROM evidence_ai_field_decisions field
                  WHERE field.company_id=review.company_id AND field.review_id=review.id), '[]'::jsonb) AS fields
         FROM evidence_ai_extraction_reviews review
         WHERE review.evidence_document_id=$1 AND review.company_id=$2
         ORDER BY review.created_at DESC, review.id DESC`, [evidenceId, companyId]
      );
      return rows;
    },

    async getStoredFile({ evidenceId, companyId }, queryable = database) {
      const { rows } = await queryable.query(
        `SELECT storage_provider, storage_key, original_filename, document_name,
                mime_type, evidence_type
         FROM evidence_documents
         WHERE id = $1 AND company_id = $2`,
        [evidenceId, companyId]
      );
      return rows[0] || null;
    },

    async deleteLinkedInvoices({ evidenceId, companyId }, queryable = database) {
      await queryable.query(
        'DELETE FROM electricity_invoices WHERE evidence_document_id = $1 AND company_id = $2',
        [evidenceId, companyId]
      );
      await queryable.query(
        'DELETE FROM fuel_invoices WHERE evidence_document_id = $1 AND company_id = $2',
        [evidenceId, companyId]
      );
    },

    async deleteEvidence({ evidenceId, companyId }, queryable = database) {
      const { rowCount } = await queryable.query(
        'DELETE FROM evidence_documents WHERE id = $1 AND company_id = $2',
        [evidenceId, companyId]
      );
      return rowCount > 0;
    }
  };
}

module.exports = {
  createEvidenceRepository,
  evidenceRepository: createEvidenceRepository()
};
