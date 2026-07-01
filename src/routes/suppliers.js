const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../utils/http');

const formatSupplier = (row) => ({
  id: row.id,
  supplierName: row.supplier_name,
  supplierEmail: row.supplier_email,
  materialSupplied: row.material_supplied,
  requiredData: row.required_data,
  deadline: row.deadline,
  status: row.status,
  sentAt: row.sent_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.use(authenticate);
router.use(requireRole('b2b'));

// GET /api/suppliers — list supplier requests for the authenticated company
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const limit = parsePositiveInt(req.query.limit, 200);
    const offset = parsePositiveInt(req.query.offset, 0) - 1;
    const page = parsePositiveInt(req.query.page, 1);
    const effectiveOffset = req.query.page ? (page - 1) * limit : Math.max(offset, 0);

    const { rows } = await pool.query(
      `SELECT id, supplier_name, supplier_email, material_supplied,
              required_data, deadline, status, sent_at, created_at, updated_at
       FROM supplier_requests
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, effectiveOffset]
    );

    return sendSuccess(res, { data: rows.map(formatSupplier) });
  })
);

// POST /api/suppliers — create a new supplier data request
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const {
      supplier_name, supplierName,
      supplier_email, supplierEmail,
      material_supplied, materialSupplied,
      required_data, requiredData,
      deadline, status,
    } = req.body;
    const resolvedName = supplierName ?? supplier_name;
    const resolvedEmail = supplierEmail ?? supplier_email;
    const resolvedMaterial = materialSupplied ?? material_supplied ?? null;
    const resolvedData = requiredData ?? required_data;

    if (!resolvedName || !resolvedEmail) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'supplier_name and supplier_email are required'
      });
    }

    const normalizedStatus = ['draft', 'sent', 'waiting', 'received', 'overdue'].includes(status)
      ? status
      : 'draft';

    const { rows } = await pool.query(
      `INSERT INTO supplier_requests
         (company_id, supplier_name, supplier_email, material_supplied, required_data, deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, supplier_name, supplier_email, material_supplied,
                 required_data, deadline, status, sent_at, created_at, updated_at`,
      [
        companyId,
        resolvedName,
        resolvedEmail,
        resolvedMaterial,
        Array.isArray(resolvedData) ? resolvedData : [],
        deadline || null,
        normalizedStatus
      ]
    );

    return sendSuccess(res, { status: 201, data: formatSupplier(rows[0]) });
  })
);

// PUT /api/suppliers/:id — update status or sent_at
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const { id } = req.params;
    const { status, sent_at, sentAt, deadline, required_data, requiredData } = req.body;
    const resolvedSentAt = sentAt ?? sent_at ?? null;
    const resolvedRequiredData = requiredData ?? required_data;

    const validStatuses = ['draft', 'sent', 'waiting', 'received', 'overdue'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const { rows } = await pool.query(
      `UPDATE supplier_requests
       SET status        = COALESCE($3, status),
           sent_at       = COALESCE($4::TIMESTAMPTZ, sent_at),
           deadline      = COALESCE($5::DATE, deadline),
           required_data = COALESCE($6, required_data),
           updated_at    = now()
       WHERE id = $1 AND company_id = $2
       RETURNING id, supplier_name, supplier_email, material_supplied,
                 required_data, deadline, status, sent_at, created_at, updated_at`,
      [
        id,
        companyId,
        status || null,
        resolvedSentAt,
        deadline || null,
        Array.isArray(resolvedRequiredData) ? resolvedRequiredData : null
      ]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Supplier request not found' });
    }

    return sendSuccess(res, { data: formatSupplier(rows[0]) });
  })
);

// DELETE /api/suppliers/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const companyId = req.companyId;
    if (!companyId) return sendNoCompany(res);

    const { rows } = await pool.query(
      `DELETE FROM supplier_requests WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, companyId]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Supplier request not found' });
    }

    return sendSuccess(res, { data: { deleted: true, id: rows[0].id } });
  })
);

module.exports = router;
