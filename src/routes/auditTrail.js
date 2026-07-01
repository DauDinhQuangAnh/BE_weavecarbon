const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../utils/http');

const formatAuditEntry = (row) => ({
  id: row.id,
  evidenceDocumentId: row.evidence_document_id,
  dataGroup: row.data_group,
  changedField: row.changed_field,
  oldValue: row.old_value,
  newValue: row.new_value,
  reason: row.reason,
  notes: row.notes,
  changedBy: row.changed_by,
  createdAt: row.created_at,
});

router.use(authenticate);
router.use(requireRole('b2b'));

// GET /api/audit-trail
// Returns audit trail entries for the authenticated company.
// Query: limit (default 100, max 500), page (default 1), changed_field (filter)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const rawLimit = parsePositiveInt(req.query.limit, 100);
    const limit = Math.min(rawLimit, 500);
    const page = parsePositiveInt(req.query.page, 1);
    const offset = (page - 1) * limit;

    const conditions = ['at.company_id = $1'];
    const params = [companyId];

    if (req.query.changed_field) {
      params.push(req.query.changed_field);
      conditions.push(`at.changed_field = $${params.length}`);
    }

    if (req.query.data_group) {
      params.push(`%${req.query.data_group}%`);
      conditions.push(`at.data_group ILIKE $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const { rows } = await pool.query(
      `SELECT
         at.id,
         at.evidence_document_id,
         at.data_group,
         at.changed_field,
         at.old_value,
         at.new_value,
         at.reason,
         at.notes,
         at.changed_by,
         at.created_at
       FROM audit_trail at
       WHERE ${where}
       ORDER BY at.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM audit_trail at WHERE ${where}`,
      params
    );

    return sendSuccess(res, {
      data: rows.map(formatAuditEntry),
      meta: {
        total: parseInt(countRows[0].count, 10),
        page,
        limit
      }
    });
  })
);

// POST /api/audit-trail — internal write endpoint (used by other routes to log changes)
// Not intended to be called directly by the FE.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const {
      evidence_document_id,
      data_group,
      changed_field,
      old_value,
      new_value,
      reason,
      notes
    } = req.body;

    if (!data_group) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'data_group is required'
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO audit_trail
         (company_id, evidence_document_id, data_group, changed_field,
          old_value, new_value, reason, notes, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, evidence_document_id, data_group, changed_field,
                 old_value, new_value, reason, notes, changed_by, created_at`,
      [
        companyId,
        evidence_document_id || null,
        data_group,
        changed_field || null,
        old_value || null,
        new_value || null,
        reason || null,
        notes || null,
        req.userId || null
      ]
    );

    return sendSuccess(res, { status: 201, data: formatAuditEntry(rows[0]) });
  })
);

module.exports = router;
