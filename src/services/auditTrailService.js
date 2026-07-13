const pool = require('../config/database');
const logger = require('../utils/logger');

async function logAuditTrail({
  client = pool,
  companyId,
  userId = null,
  evidenceDocumentId = null,
  dataGroup,
  changedField,
  oldValue = null,
  newValue = null,
  reason = null,
  notes = null
}) {
  if (!companyId || !dataGroup || !changedField) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO audit_trail
         (company_id, evidence_document_id, data_group, changed_field,
          old_value, new_value, reason, notes, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        companyId,
        evidenceDocumentId,
        dataGroup,
        changedField,
        oldValue == null ? null : String(oldValue),
        newValue == null ? null : String(newValue),
        reason,
        notes,
        userId
      ]
    );

    return rows[0] || null;
  } catch (error) {
    logger.error({ err: error }, '[auditTrailService] Failed to write audit trail');
    return null;
  }
}

module.exports = {
  logAuditTrail
};
