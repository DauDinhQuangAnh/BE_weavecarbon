const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../utils/http');

router.use(authenticate);
router.use(requireRole('b2b'));

// GET /api/electricity-invoices
router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const limit = Math.min(parsePositiveInt(req.query.limit, 100), 500);
  const page = parsePositiveInt(req.query.page, 1);
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT id, facility_name, billing_period, kwh,
            emission_factor_kg_per_kwh, emission_factor_source,
            scope2_co2e_kg, status, evidence_document_id, created_at, updated_at
     FROM electricity_invoices
     WHERE company_id = $1
     ORDER BY billing_period DESC, created_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, limit, offset]
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM electricity_invoices WHERE company_id = $1`,
    [companyId]
  );

  return sendSuccess(res, {
    data: rows,
    meta: { total: parseInt(countRows[0].count, 10), page, limit }
  });
}));

// POST /api/electricity-invoices
router.post('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const {
    facility_name = 'Main Facility',
    billing_period,
    kwh,
    emission_factor_kg_per_kwh = 0.4290,
    emission_factor_source = 'VN Ministry of Natural Resources 2024',
    status = 'uploaded',
    evidence_document_id
  } = req.body;

  if (!billing_period || kwh === undefined || kwh === null) {
    return sendError(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'billing_period and kwh are required'
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO electricity_invoices
       (company_id, facility_name, billing_period, kwh,
        emission_factor_kg_per_kwh, emission_factor_source,
        status, evidence_document_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, facility_name, billing_period, kwh,
               emission_factor_kg_per_kwh, emission_factor_source,
               scope2_co2e_kg, status, created_at`,
    [
      companyId, facility_name, billing_period, kwh,
      emission_factor_kg_per_kwh, emission_factor_source,
      status, evidence_document_id || null, req.userId || null
    ]
  );

  return sendSuccess(res, { status: 201, data: rows[0] });
}));

// PUT /api/electricity-invoices/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const { facility_name, billing_period, kwh, emission_factor_kg_per_kwh, emission_factor_source, status } = req.body;

  const { rows } = await pool.query(
    `UPDATE electricity_invoices SET
       facility_name = COALESCE($3, facility_name),
       billing_period = COALESCE($4, billing_period),
       kwh = COALESCE($5, kwh),
       emission_factor_kg_per_kwh = COALESCE($6, emission_factor_kg_per_kwh),
       emission_factor_source = COALESCE($7, emission_factor_source),
       status = COALESCE($8, status),
       updated_at = now()
     WHERE id = $1 AND company_id = $2
     RETURNING id, facility_name, billing_period, kwh,
               emission_factor_kg_per_kwh, emission_factor_source,
               scope2_co2e_kg, status, updated_at`,
    [req.params.id, companyId, facility_name, billing_period, kwh,
     emission_factor_kg_per_kwh, emission_factor_source, status]
  );

  if (!rows.length) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Electricity invoice not found.' });
  }

  return sendSuccess(res, { data: rows[0] });
}));

// DELETE /api/electricity-invoices/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const { rowCount } = await pool.query(
    `DELETE FROM electricity_invoices WHERE id = $1 AND company_id = $2`,
    [req.params.id, companyId]
  );

  if (!rowCount) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Electricity invoice not found.' });
  }

  return sendSuccess(res, { data: { deleted: true } });
}));

module.exports = router;
