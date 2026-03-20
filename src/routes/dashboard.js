const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getSchemaCapabilities } = require('../config/schemaCapabilities');
const { authenticate, requireRole } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildMonthlyActualExpression = (
  materialsField,
  productionField,
  packagingField,
  productTransportField,
  shipmentTransportField
) => `
  (
    COALESCE(${materialsField}, 0) +
    COALESCE(${productionField}, 0) +
    COALESCE(${packagingField}, 0) +
    GREATEST(COALESCE(${productTransportField}, 0), COALESCE(${shipmentTransportField}, 0))
  )
`;

const buildShipmentAllocatedExpression = (
  allocatedField,
  shipmentTotalField,
  shipmentProductCountField
) => `
  (
    CASE
      WHEN COALESCE(${allocatedField}, 0) > 0 THEN COALESCE(${allocatedField}, 0)
      WHEN COALESCE(${shipmentTotalField}, 0) > 0 AND COALESCE(${shipmentProductCountField}, 0) > 0
        THEN COALESCE(${shipmentTotalField}, 0) / NULLIF(${shipmentProductCountField}, 0)
      ELSE 0
    END
  )
`;

router.get('/overview', authenticate, requireRole('b2b'), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const trendMonths = parseInt(req.query.trend_months, 10) || 6;

    if (trendMonths < 1 || trendMonths > 12) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'trend_months must be between 1 and 12'
        }
      });
    }

    if (!companyId) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'No company associated with this user'
        }
      });
    }

    const overview = await dashboardService.getOverview(companyId, trendMonths);

    return res.json({
      success: true,
      data: overview,
      meta: {
        company_id: companyId,
        generated_at: new Date().toISOString(),
        trend_period_months: trendMonths
      }
    });
  } catch (error) {
    console.error('Dashboard overview error:', error);
    next(error);
  }
});

router.post('/targets', authenticate, requireRole('b2b'), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'No company associated with this user'
        }
      });
    }

    const { hasCarbonTargets } = getSchemaCapabilities();
    if (!hasCarbonTargets) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CARBON_TARGETS_TABLE_MISSING',
          message: 'carbon_targets table does not exist'
        }
      });
    }

    const now = new Date();
    const year = Number.parseInt(req.body?.year, 10) || now.getFullYear();
    const month = Number.parseInt(req.body?.month, 10) || (now.getMonth() + 1);
    if (year < 2020 || year > 2100 || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PERIOD',
          message: 'year/month is invalid'
        }
      });
    }

    const mode = String(req.body?.mode || 'manual').trim().toLowerCase();
    if (!['manual', 'auto'].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_MODE',
          message: 'mode must be manual or auto'
        }
      });
    }

    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;

    const monthActualQuery = `
      WITH product_monthly AS (
        SELECT
          COALESCE(SUM(p.materials_co2e), 0) AS materials,
          COALESCE(SUM(p.production_co2e), 0) AS production,
          COALESCE(SUM(p.packaging_co2e), 0) AS packaging,
          COALESCE(SUM(p.transport_co2e), 0) AS product_transport
        FROM products p
        WHERE p.company_id = $1
          AND date_trunc('month', COALESCE(p.updated_at, p.created_at))::date = $2::date
      ),
      shipment_product_counts AS (
        SELECT
          shipment_id,
          COUNT(*)::numeric AS product_count
        FROM shipment_products
        GROUP BY shipment_id
      ),
      shipment_monthly AS (
        SELECT
          COALESCE(
            SUM(
              ${buildShipmentAllocatedExpression('sp.allocated_co2e', 's.total_co2e', 'spc.product_count')}
            ),
            0
          ) AS shipment_transport
        FROM shipments s
        INNER JOIN shipment_products sp ON sp.shipment_id = s.id
        LEFT JOIN shipment_product_counts spc ON spc.shipment_id = s.id
        WHERE s.company_id = $1
          AND s.status <> 'cancelled'
          AND date_trunc('month', COALESCE(s.updated_at, s.created_at))::date = $2::date
      )
      SELECT
        ${buildMonthlyActualExpression('pm.materials', 'pm.production', 'pm.packaging', 'pm.product_transport', 'sm.shipment_transport')} AS actual_emissions
      FROM product_monthly pm
      CROSS JOIN shipment_monthly sm
    `;

    const monthActualResult = await pool.query(monthActualQuery, [companyId, periodStart]);
    const actualEmissions = toNumber(monthActualResult.rows?.[0]?.actual_emissions);

    let targetCo2e = 0;
    let reductionPercentage = null;
    let baselineCo2e = null;

    if (mode === 'manual') {
      targetCo2e = toNumber(req.body?.target_co2e);
      if (targetCo2e <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TARGET',
            message: 'target_co2e must be greater than 0 for manual mode'
          }
        });
      }
    } else {
      const reductionInput = toNumber(req.body?.reduction_percentage || 8);
      const normalizedReduction = Math.min(50, Math.max(1, reductionInput));
      reductionPercentage = normalizedReduction;

      const baselineQuery = `
        WITH month_series AS (
          SELECT generate_series(
            date_trunc('month', $2::date) - (2 * interval '1 month'),
            date_trunc('month', $2::date),
            interval '1 month'
          )::date AS month_start
        ),
        product_monthly AS (
          SELECT
            date_trunc('month', COALESCE(p.updated_at, p.created_at))::date AS month_start,
            COALESCE(SUM(p.materials_co2e), 0) AS materials,
            COALESCE(SUM(p.production_co2e), 0) AS production,
            COALESCE(SUM(p.packaging_co2e), 0) AS packaging,
            COALESCE(SUM(p.transport_co2e), 0) AS product_transport
          FROM products p
          WHERE p.company_id = $1
            AND COALESCE(p.updated_at, p.created_at) >= date_trunc('month', $2::date) - (2 * interval '1 month')
            AND COALESCE(p.updated_at, p.created_at) < date_trunc('month', $2::date) + interval '1 month'
          GROUP BY date_trunc('month', COALESCE(p.updated_at, p.created_at))
        ),
        shipment_product_counts AS (
          SELECT
            shipment_id,
            COUNT(*)::numeric AS product_count
          FROM shipment_products
          GROUP BY shipment_id
        ),
        shipment_monthly AS (
          SELECT
            date_trunc('month', COALESCE(s.updated_at, s.created_at))::date AS month_start,
            COALESCE(
              SUM(
                ${buildShipmentAllocatedExpression('sp.allocated_co2e', 's.total_co2e', 'spc.product_count')}
              ),
              0
            ) AS shipment_transport
          FROM shipments s
          INNER JOIN shipment_products sp ON sp.shipment_id = s.id
          LEFT JOIN shipment_product_counts spc ON spc.shipment_id = s.id
          WHERE s.company_id = $1
            AND s.status <> 'cancelled'
            AND COALESCE(s.updated_at, s.created_at) >= date_trunc('month', $2::date) - (2 * interval '1 month')
            AND COALESCE(s.updated_at, s.created_at) < date_trunc('month', $2::date) + interval '1 month'
          GROUP BY date_trunc('month', COALESCE(s.updated_at, s.created_at))
        ),
        actual_monthly AS (
          SELECT
            ms.month_start,
            ${buildMonthlyActualExpression('pm.materials', 'pm.production', 'pm.packaging', 'pm.product_transport', 'sm.shipment_transport')} AS actual_emissions
          FROM month_series ms
          LEFT JOIN product_monthly pm ON pm.month_start = ms.month_start
          LEFT JOIN shipment_monthly sm ON sm.month_start = ms.month_start
        )
        SELECT
          COALESCE(AVG(NULLIF(actual_emissions, 0)), 0) AS baseline_co2e
        FROM actual_monthly
      `;

      const baselineResult = await pool.query(baselineQuery, [companyId, periodStart]);
      baselineCo2e = toNumber(baselineResult.rows?.[0]?.baseline_co2e);

      if (baselineCo2e <= 0) {
        baselineCo2e = actualEmissions;
      }
      if (baselineCo2e <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_DATA',
            message: 'Not enough emissions data to generate an automatic target'
          }
        });
      }

      targetCo2e = baselineCo2e * (1 - normalizedReduction / 100);
      targetCo2e = Math.max(0, Math.round(targetCo2e * 10000) / 10000);
    }

    const upsertQuery = `
      INSERT INTO carbon_targets (
        company_id, year, month, target_co2e, actual_co2e, reduction_percentage, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (company_id, year, month)
      DO UPDATE SET
        target_co2e = EXCLUDED.target_co2e,
        actual_co2e = EXCLUDED.actual_co2e,
        reduction_percentage = EXCLUDED.reduction_percentage,
        updated_at = NOW()
      RETURNING id, company_id, year, month, target_co2e, actual_co2e, reduction_percentage, created_at, updated_at
    `;

    const saveResult = await pool.query(upsertQuery, [
      companyId,
      year,
      month,
      targetCo2e,
      actualEmissions > 0 ? actualEmissions : null,
      reductionPercentage
    ]);
    const saved = saveResult.rows?.[0];

    dashboardService.invalidateOverviewCache(companyId);

    return res.status(200).json({
      success: true,
      data: {
        id: saved?.id,
        company_id: saved?.company_id,
        year: Number.parseInt(saved?.year, 10) || year,
        month: Number.parseInt(saved?.month, 10) || month,
        target_co2e: toNumber(saved?.target_co2e),
        actual_co2e: toNumber(saved?.actual_co2e),
        reduction_percentage: saved?.reduction_percentage == null ? null : toNumber(saved?.reduction_percentage),
        baseline_co2e: baselineCo2e == null ? null : toNumber(baselineCo2e),
        mode
      }
    });
  } catch (error) {
    console.error('Dashboard targets error:', error);
    next(error);
  }
});

module.exports = router;
