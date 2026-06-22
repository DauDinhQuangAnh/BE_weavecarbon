const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany } = require('../utils/http');

router.use(authenticate);
router.use(requireRole('b2b'));

const VALID_STATUSES = ['missing', 'proxy', 'self_declared', 'uploaded', 'verified'];
const VALID_RISKS = ['low', 'medium', 'high'];

// GET /api/data-gaps — list data gaps for the authenticated company
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const { rows } = await pool.query(
      `SELECT id, data_group, required_for_audit, current_status,
              risk_level, required_action, owner, deadline, created_at, updated_at
       FROM data_gaps
       WHERE company_id = $1
       ORDER BY
         CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         created_at DESC`,
      [companyId]
    );

    return sendSuccess(res, { data: rows });
  })
);

// POST /api/data-gaps/seed — bulk-create from a list of group names
// Creates entries only for groups not already present (idempotent)
router.post(
  '/seed',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    if (!groups.length) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'groups array is required and must not be empty'
      });
    }

    // Find which groups already exist
    const { rows: existing } = await pool.query(
      `SELECT data_group FROM data_gaps WHERE company_id = $1`,
      [companyId]
    );
    const existingSet = new Set(existing.map((r) => r.data_group));
    const toInsert = groups.filter((g) => !existingSet.has(g));

    if (!toInsert.length) {
      return sendSuccess(res, { data: { seeded: 0, message: 'All groups already exist' } });
    }

    const values = toInsert
      .map((g, i) => `($1, $${i + 2}, true, 'missing', 'high')`)
      .join(', ');
    const params = [companyId, ...toInsert];

    const { rows: inserted } = await pool.query(
      `INSERT INTO data_gaps (company_id, data_group, required_for_audit, current_status, risk_level)
       VALUES ${values}
       RETURNING id, data_group, required_for_audit, current_status, risk_level,
                 required_action, owner, deadline, created_at, updated_at`,
      params
    );

    return sendSuccess(res, { data: { seeded: inserted.length, rows: inserted } });
  })
);

// POST /api/data-gaps — create a single data gap entry
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const {
      data_group,
      required_for_audit = true,
      current_status = 'missing',
      risk_level = 'high',
      required_action,
      owner,
      deadline
    } = req.body;

    if (!data_group) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'data_group is required'
      });
    }

    if (!VALID_STATUSES.includes(current_status)) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `current_status must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    if (!VALID_RISKS.includes(risk_level)) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `risk_level must be one of: ${VALID_RISKS.join(', ')}`
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO data_gaps
         (company_id, data_group, required_for_audit, current_status, risk_level, required_action, owner, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, data_group, required_for_audit, current_status, risk_level,
                 required_action, owner, deadline, created_at, updated_at`,
      [
        companyId,
        data_group,
        required_for_audit !== false,
        current_status,
        risk_level,
        required_action || null,
        owner || null,
        deadline || null
      ]
    );

    return sendSuccess(res, { status: 201, data: rows[0] });
  })
);

// PUT /api/data-gaps/:id — update a data gap
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const { id } = req.params;
    const { current_status, risk_level, required_action, owner, deadline, required_for_audit } =
      req.body;

    if (current_status && !VALID_STATUSES.includes(current_status)) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `current_status must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    if (risk_level && !VALID_RISKS.includes(risk_level)) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `risk_level must be one of: ${VALID_RISKS.join(', ')}`
      });
    }

    const { rows } = await pool.query(
      `UPDATE data_gaps
       SET current_status  = COALESCE($3, current_status),
           risk_level       = COALESCE($4, risk_level),
           required_action  = COALESCE($5, required_action),
           owner            = COALESCE($6, owner),
           deadline         = COALESCE($7::DATE, deadline),
           required_for_audit = COALESCE($8, required_for_audit),
           updated_at       = now()
       WHERE id = $1 AND company_id = $2
       RETURNING id, data_group, required_for_audit, current_status, risk_level,
                 required_action, owner, deadline, created_at, updated_at`,
      [
        id,
        companyId,
        current_status || null,
        risk_level || null,
        required_action !== undefined ? required_action : null,
        owner !== undefined ? owner : null,
        deadline || null,
        required_for_audit !== undefined ? required_for_audit : null
      ]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Data gap not found' });
    }

    return sendSuccess(res, { data: rows[0] });
  })
);

// DELETE /api/data-gaps/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const { rows } = await pool.query(
      `DELETE FROM data_gaps WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, companyId]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Data gap not found' });
    }

    return sendSuccess(res, { data: { deleted: true, id: rows[0].id } });
  })
);

module.exports = router;
