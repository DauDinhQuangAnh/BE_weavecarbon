const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../utils/http');

const FUEL_EMISSION_FACTORS = {
  diesel:  2.6880,
  petrol:  2.3520,
  lpg:     1.6290,
  cng:     2.7400,
  coal:    2.4200,
  biomass: 0.0000,
  other:   2.5000
};

router.use(authenticate);
router.use(requireRole('b2b'));

// GET /api/fuel-invoices
router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const limit = Math.min(parsePositiveInt(req.query.limit, 100), 500);
  const page = parsePositiveInt(req.query.page, 1);
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT id, billing_period, fuel_type, quantity_liters,
            emission_factor_kg_per_liter, scope1_co2e_kg,
            status, evidence_document_id, created_at, updated_at
     FROM fuel_invoices
     WHERE company_id = $1
     ORDER BY billing_period DESC, created_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, limit, offset]
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM fuel_invoices WHERE company_id = $1`,
    [companyId]
  );

  return sendSuccess(res, {
    data: rows,
    meta: { total: parseInt(countRows[0].count, 10), page, limit }
  });
}));

// POST /api/fuel-invoices
router.post('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const {
    billing_period,
    fuel_type = 'diesel',
    quantity_liters,
    emission_factor_kg_per_liter,
    scope1_co2e_kg,
    status = 'uploaded',
    evidence_document_id
  } = req.body;

  if (!billing_period || quantity_liters === undefined || quantity_liters === null) {
    return sendError(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'billing_period and quantity_liters are required'
    });
  }

  const factor = emission_factor_kg_per_liter ?? FUEL_EMISSION_FACTORS[fuel_type] ?? 2.5;
  const co2e = scope1_co2e_kg ?? (parseFloat(quantity_liters) * factor);

  const { rows } = await pool.query(
    `INSERT INTO fuel_invoices
       (company_id, billing_period, fuel_type, quantity_liters,
        emission_factor_kg_per_liter, scope1_co2e_kg,
        status, evidence_document_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, billing_period, fuel_type, quantity_liters,
               emission_factor_kg_per_liter, scope1_co2e_kg, status, created_at`,
    [
      companyId, billing_period, fuel_type, quantity_liters,
      factor, co2e, status, evidence_document_id || null, req.userId || null
    ]
  );

  return sendSuccess(res, { status: 201, data: rows[0] });
}));

// PUT /api/fuel-invoices/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const { billing_period, fuel_type, quantity_liters, emission_factor_kg_per_liter, scope1_co2e_kg, status } = req.body;

  const { rows } = await pool.query(
    `UPDATE fuel_invoices SET
       billing_period = COALESCE($3, billing_period),
       fuel_type = COALESCE($4, fuel_type),
       quantity_liters = COALESCE($5, quantity_liters),
       emission_factor_kg_per_liter = COALESCE($6, emission_factor_kg_per_liter),
       scope1_co2e_kg = COALESCE($7, scope1_co2e_kg),
       status = COALESCE($8, status),
       updated_at = now()
     WHERE id = $1 AND company_id = $2
     RETURNING id, billing_period, fuel_type, quantity_liters,
               emission_factor_kg_per_liter, scope1_co2e_kg, status, updated_at`,
    [req.params.id, companyId, billing_period, fuel_type,
     quantity_liters, emission_factor_kg_per_liter, scope1_co2e_kg, status]
  );

  if (!rows.length) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Fuel invoice not found.' });
  }

  return sendSuccess(res, { data: rows[0] });
}));

// DELETE /api/fuel-invoices/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const { rowCount } = await pool.query(
    `DELETE FROM fuel_invoices WHERE id = $1 AND company_id = $2`,
    [req.params.id, companyId]
  );

  if (!rowCount) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Fuel invoice not found.' });
  }

  return sendSuccess(res, { data: { deleted: true } });
}));

module.exports = router;
