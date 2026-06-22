const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../utils/http');

router.use(authenticate);
router.use(requireRole('b2b'));

// GET /api/carbon-calculations
router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const limit = Math.min(parsePositiveInt(req.query.limit, 100), 500);
  const page = parsePositiveInt(req.query.page, 1);
  const offset = (page - 1) * limit;

  const conditions = ['company_id = $1'];
  const params = [companyId];

  if (req.query.product_id) {
    params.push(req.query.product_id);
    conditions.push(`product_id = $${params.length}`);
  }

  if (req.query.calculation_type) {
    params.push(req.query.calculation_type);
    conditions.push(`calculation_type = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await pool.query(
    `SELECT id, product_id, shipment_id, calculation_type,
            period_start, period_end,
            materials_co2e, production_co2e, transport_co2e,
            packaging_co2e, total_co2e,
            methodology, emission_factor_version, notes, created_at
     FROM carbon_calculations
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM carbon_calculations WHERE ${where}`,
    params
  );

  return sendSuccess(res, {
    data: rows,
    meta: { total: parseInt(countRows[0].count, 10), page, limit }
  });
}));

// POST /api/carbon-calculations
router.post('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const {
    product_id,
    shipment_id,
    calculation_type,
    period_start,
    period_end,
    materials_co2e = 0,
    production_co2e = 0,
    transport_co2e = 0,
    packaging_co2e = 0,
    total_co2e,
    methodology,
    emission_factor_version = '2024',
    notes
  } = req.body;

  if (!calculation_type || total_co2e === undefined || total_co2e === null) {
    return sendError(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'calculation_type and total_co2e are required'
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO carbon_calculations
       (company_id, product_id, shipment_id, calculation_type,
        period_start, period_end,
        materials_co2e, production_co2e, transport_co2e, packaging_co2e,
        total_co2e, methodology, emission_factor_version, notes, calculated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, product_id, calculation_type, total_co2e,
               materials_co2e, production_co2e, transport_co2e, packaging_co2e,
               period_start, period_end, created_at`,
    [
      companyId, product_id || null, shipment_id || null, calculation_type,
      period_start || null, period_end || null,
      materials_co2e, production_co2e, transport_co2e, packaging_co2e,
      total_co2e, methodology || null, emission_factor_version, notes || null,
      req.userId || null
    ]
  );

  return sendSuccess(res, { status: 201, data: rows[0] });
}));

module.exports = router;
