const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const MARKET_READINESS_PREVIEW_LIMIT = 3;

const normalizeBreakdownPercentages = (values) => {
  if (!Array.isArray(values) || values.length === 0) return [];

  const safeValues = values.map((value) => {
    const normalized = toNumber(value);
    return normalized > 0 ? normalized : 0;
  });
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return safeValues.map(() => 0);
  }

  const raw = safeValues.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  const minRequired = safeValues.map((value) => (value > 0 ? 1 : 0));
  const adjusted = floors.map((value, index) => Math.max(value, minRequired[index]));

  let currentTotal = adjusted.reduce((sum, value) => sum + value, 0);

  if (currentTotal < 100) {
    const rankedByFraction = raw
      .map((value, index) => ({ index, fraction: value - floors[index] }))
      .sort((a, b) => b.fraction - a.fraction);
    let cursor = 0;
    while (currentTotal < 100 && rankedByFraction.length > 0) {
      const target = rankedByFraction[cursor % rankedByFraction.length];
      adjusted[target.index] += 1;
      currentTotal += 1;
      cursor += 1;
    }
  } else if (currentTotal > 100) {
    const rankedByMagnitude = raw
      .map((value, index) => ({ index, value }))
      .sort((a, b) => b.value - a.value);
    let cursor = 0;
    while (currentTotal > 100 && rankedByMagnitude.length > 0) {
      const target = rankedByMagnitude[cursor % rankedByMagnitude.length];
      if (adjusted[target.index] > minRequired[target.index]) {
        adjusted[target.index] -= 1;
        currentTotal -= 1;
      }
      cursor += 1;
      if (cursor > rankedByMagnitude.length * 10) {
        break;
      }
    }
  }

  return adjusted;
};

const buildMonthlyActualExpression = (materialsField, productionField, packagingField, productTransportField, shipmentTransportField) => `
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

const buildMarketReadinessDisplay = (
  marketReadiness,
  previewLimit = MARKET_READINESS_PREVIEW_LIMIT
) => {
  const visibleItems = Array.isArray(marketReadiness)
    ? marketReadiness.slice(0, previewLimit)
    : [];
  const hiddenItems = Array.isArray(marketReadiness)
    ? marketReadiness.slice(previewLimit)
    : [];

  return {
    preview_items: visibleItems,
    remaining_items: hiddenItems,
    remaining_count: hiddenItems.length,
    remaining_label: hiddenItems.length > 0 ? `+${hiddenItems.length}` : '',
    preview_limit: previewLimit,
    has_more: hiddenItems.length > 0
  };
};

/**
 * GET /api/dashboard/overview
 * Dashboard tổng quan cho B2B users
 * Requires: Authentication + B2B role
 */
router.get('/overview', authenticate, requireRole('b2b'), async (req, res, next) => {
  try {
    const userId = req.userId;
    const companyId = req.companyId;

    // Validate query params
    const trendMonths = parseInt(req.query.trend_months) || 6;
    if (trendMonths < 1 || trendMonths > 12) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'trend_months must be between 1 and 12'
        }
      });
    }

    // Check if user has company
    if (!companyId) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'No company associated with this user'
        }
      });
    }

    // ======================
    // 1. STATS - Thống kê tổng quan
    // ======================
    const statsQuery = `
      WITH tracked_products AS (
        SELECT *
        FROM products
        WHERE company_id = $1
          AND status <> 'archived'
      ),
      product_totals AS (
        SELECT
          COALESCE(SUM(tp.materials_co2e), 0) as materials,
          COALESCE(SUM(tp.production_co2e), 0) as production,
          COALESCE(SUM(tp.packaging_co2e), 0) as packaging,
          COALESCE(SUM(tp.transport_co2e), 0) as product_transport,
          COUNT(tp.id)::int as total_skus,
          COALESCE(AVG(tp.data_confidence_score), 0) as data_confidence
        FROM tracked_products tp
      ),
      shipment_product_counts AS (
        SELECT
          shipment_id,
          COUNT(*)::numeric AS product_count
        FROM shipment_products
        GROUP BY shipment_id
      ),
      latest_product_shipments AS (
        SELECT DISTINCT ON (sp.product_id)
          sp.product_id,
          ${buildShipmentAllocatedExpression('sp.allocated_co2e', 's.total_co2e', 'spc.product_count')} as allocated_co2e
        FROM shipment_products sp
        INNER JOIN shipments s ON s.id = sp.shipment_id
        INNER JOIN tracked_products tp ON tp.id = sp.product_id
        LEFT JOIN shipment_product_counts spc ON spc.shipment_id = sp.shipment_id
        WHERE s.company_id = $1
          AND s.status <> 'cancelled'
        ORDER BY
          sp.product_id,
          s.updated_at DESC NULLS LAST,
          s.created_at DESC NULLS LAST
      ),
      shipment_totals AS (
        SELECT COALESCE(SUM(allocated_co2e), 0) as shipment_transport
        FROM latest_product_shipments
      )
      SELECT
        pt.materials,
        pt.production,
        pt.packaging,
        pt.product_transport,
        st.shipment_transport,
        GREATEST(pt.product_transport, st.shipment_transport) as transport,
        (pt.materials + pt.production + pt.packaging + GREATEST(pt.product_transport, st.shipment_transport)) as total_co2e,
        pt.total_skus,
        pt.data_confidence
      FROM product_totals pt
      CROSS JOIN shipment_totals st
    `;

    const tableExistsResult = await pool.query(`
      SELECT
        to_regclass('public.market_readiness') IS NOT NULL AS has_market_readiness,
        to_regclass('public.export_markets') IS NOT NULL AS has_export_markets
    `);
    const hasMarketReadiness = Boolean(tableExistsResult.rows?.[0]?.has_market_readiness);
    const hasExportMarkets = Boolean(tableExistsResult.rows?.[0]?.has_export_markets);

    const exportReadinessFromMarketReadinessQuery = `
      SELECT
        COUNT(*)::int AS total_markets,
        COALESCE(AVG(readiness_score), 0) as avg_export_readiness
      FROM market_readiness
      WHERE company_id = $1
    `;
    const exportReadinessFromExportMarketsQuery = `
      SELECT
        COUNT(*)::int AS total_markets,
        COALESCE(AVG(score), 0) as avg_export_readiness
      FROM export_markets
      WHERE company_id = $1
    `;

    const [statsResult, exportResult] = await Promise.all([
      pool.query(statsQuery, [companyId]),
      hasMarketReadiness
        ? pool.query(exportReadinessFromMarketReadinessQuery, [companyId])
        : hasExportMarkets
          ? pool.query(exportReadinessFromExportMarketsQuery, [companyId])
          : Promise.resolve({ rows: [{ total_markets: 0, avg_export_readiness: 0 }] })
    ]);

    let exportReadinessRow = exportResult.rows?.[0] || { total_markets: 0, avg_export_readiness: 0 };
    if (
      hasMarketReadiness &&
      (parseInt(exportReadinessRow.total_markets, 10) || 0) === 0 &&
      hasExportMarkets
    ) {
      const exportFallbackResult = await pool.query(exportReadinessFromExportMarketsQuery, [companyId]);
      exportReadinessRow = exportFallbackResult.rows?.[0] || exportReadinessRow;
    }

    const statsRow = statsResult.rows[0] || {};
    const stats = {
      total_co2e: toNumber(statsRow.total_co2e),
      total_skus: parseInt(statsRow.total_skus) || 0,
      avg_export_readiness: parseFloat(exportReadinessRow.avg_export_readiness) || 0,
      data_confidence: toNumber(statsRow.data_confidence)
    };

    // ======================
    // 2. CARBON TREND - Xu hướng carbon theo tháng
    // ======================
    const carbonTargetsExistsResult = await pool.query(`
      SELECT to_regclass('public.carbon_targets') IS NOT NULL AS "exists"
    `);
    const hasCarbonTargets = Boolean(carbonTargetsExistsResult.rows?.[0]?.exists);
    const targetMonthlyCte = hasCarbonTargets ? `
      target_monthly AS (
        SELECT
          make_date(year, month, 1)::date AS month_start,
          COALESCE(SUM(actual_co2e), 0) AS actual_emissions,
          COALESCE(SUM(target_co2e), 0) AS target_emissions
        FROM carbon_targets
        WHERE company_id = $1
          AND make_date(year, month, 1) >= (
            date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month')
          )::date
        GROUP BY make_date(year, month, 1)
      ),
    ` : `
      target_monthly AS (
        SELECT
          NULL::date AS month_start,
          0::numeric AS actual_emissions,
          0::numeric AS target_emissions
        WHERE FALSE
      ),
    `;

    const carbonTrendQuery = `
      WITH month_series AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month'),
          date_trunc('month', CURRENT_DATE),
          interval '1 month'
        )::date AS month_start
      ),
      ${targetMonthlyCte}
      product_monthly AS (
        SELECT
          date_trunc('month', COALESCE(p.updated_at, p.created_at))::date AS month_start,
          COALESCE(SUM(p.materials_co2e), 0) AS materials,
          COALESCE(SUM(p.production_co2e), 0) AS production,
          COALESCE(SUM(p.packaging_co2e), 0) AS packaging,
          COALESCE(SUM(p.transport_co2e), 0) AS product_transport
        FROM products p
        WHERE p.company_id = $1
          AND COALESCE(p.updated_at, p.created_at) >=
            date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month')
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
          AND COALESCE(s.updated_at, s.created_at) >=
            date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month')
        GROUP BY date_trunc('month', COALESCE(s.updated_at, s.created_at))
      ),
      fallback_monthly AS (
        SELECT
          ms.month_start,
          COALESCE(pm.materials, 0) AS materials,
          COALESCE(pm.production, 0) AS production,
          COALESCE(pm.packaging, 0) AS packaging,
          COALESCE(pm.product_transport, 0) AS product_transport,
          COALESCE(sm.shipment_transport, 0) AS shipment_transport
        FROM month_series ms
        LEFT JOIN product_monthly pm ON pm.month_start = ms.month_start
        LEFT JOIN shipment_monthly sm ON sm.month_start = ms.month_start
      )
      SELECT
        EXTRACT(YEAR FROM fm.month_start)::int AS year,
        EXTRACT(MONTH FROM fm.month_start)::int AS month,
        to_char(fm.month_start, 'YYYY-MM') AS month_key,
        CONCAT('T', EXTRACT(MONTH FROM fm.month_start)::int) AS label,
        CASE
          WHEN tm.month_start IS NOT NULL THEN COALESCE(tm.actual_emissions, 0)
          ELSE (
            fm.materials +
            fm.production +
            fm.packaging +
            GREATEST(fm.product_transport, fm.shipment_transport)
          )
        END AS actual_emissions,
        CASE
          WHEN tm.month_start IS NOT NULL THEN COALESCE(tm.target_emissions, 0)
          ELSE (
            fm.materials +
            fm.production +
            fm.packaging +
            GREATEST(fm.product_transport, fm.shipment_transport)
          )
        END AS target_emissions
      FROM fallback_monthly fm
      LEFT JOIN target_monthly tm ON tm.month_start = fm.month_start
      ORDER BY fm.month_start ASC
    `;

    const trendResult = await pool.query(carbonTrendQuery, [companyId, trendMonths]);

    const carbonTrend = trendResult.rows.map(row => ({
      month: row.month_key,
      label: row.label,
      actual_emissions: toNumber(row.actual_emissions),
      target_emissions: toNumber(row.target_emissions)
    }));

    // ======================
    // 3. EMISSION BREAKDOWN - Phân tích nguồn phát thải
    // ======================
    const materials = toNumber(statsRow.materials);
    const production = toNumber(statsRow.production);
    const transport = toNumber(statsRow.transport);
    const packaging = toNumber(statsRow.packaging);
    const breakdownPercentages = normalizeBreakdownPercentages([
      materials,
      production,
      transport,
      packaging
    ]);

    const emissionBreakdown = [
      {
        category: 'materials',
        label: 'Vật liệu',
        percentage: breakdownPercentages[0] || 0,
        co2e: materials,
        color: 'hsl(var(--primary))'
      },
      {
        category: 'production',
        label: 'Sản xuất',
        percentage: breakdownPercentages[1] || 0,
        co2e: production,
        color: 'hsl(var(--accent))'
      },
      {
        category: 'transport',
        label: 'Vận chuyển',
        percentage: breakdownPercentages[2] || 0,
        co2e: transport,
        color: 'hsl(150, 40%, 50%)'
      },
      {
        category: 'packaging',
        label: 'Đóng gói',
        percentage: breakdownPercentages[3] || 0,
        co2e: packaging,
        color: 'hsl(35, 50%, 60%)'
      }
    ];

    // ======================
    // 4. MARKET READINESS - Mức độ sẵn sàng xuất khẩu
    // ======================
    const marketReadinessFromMarketReadinessQuery = `
      SELECT 
        market_code,
        market_name,
        readiness_score as score,
        status,
        COALESCE(requirements_met, ARRAY[]::text[]) as requirements_met,
        COALESCE(requirements_missing, ARRAY[]::text[]) as requirements_missing
      FROM market_readiness
      WHERE company_id = $1
      ORDER BY readiness_score DESC
    `;
    const marketReadinessFromExportMarketsQuery = `
      SELECT
        market_code,
        market_name,
        COALESCE(score, 0) as score,
        COALESCE(status, 'draft') as status,
        ARRAY[]::text[] as requirements_met,
        ARRAY[]::text[] as requirements_missing
      FROM export_markets
      WHERE company_id = $1
      ORDER BY score DESC, market_name ASC
    `;
    const marketReadinessFromCompanyTargetMarketsQuery = `
      SELECT DISTINCT
        UPPER(TRIM(tm.market_code)) AS market_code,
        UPPER(TRIM(tm.market_code)) AS market_name,
        0::numeric AS score,
        'draft'::text AS status,
        ARRAY[]::text[] as requirements_met,
        ARRAY[]::text[] as requirements_missing
      FROM companies c
      CROSS JOIN LATERAL unnest(COALESCE(c.target_markets, ARRAY[]::text[])) AS tm(market_code)
      WHERE c.id = $1
        AND TRIM(COALESCE(tm.market_code, '')) <> ''
      ORDER BY market_code ASC
    `;

    let marketRows = [];
    if (hasMarketReadiness) {
      const marketResult = await pool.query(marketReadinessFromMarketReadinessQuery, [companyId]);
      marketRows = marketResult.rows || [];
    }
    if (marketRows.length === 0 && hasExportMarkets) {
      const marketFallbackResult = await pool.query(marketReadinessFromExportMarketsQuery, [companyId]);
      marketRows = marketFallbackResult.rows || [];
    }
    if (marketRows.length === 0) {
      const targetMarketFallbackResult = await pool.query(
        marketReadinessFromCompanyTargetMarketsQuery,
        [companyId]
      );
      marketRows = targetMarketFallbackResult.rows || [];
    }

    const marketReadiness = marketRows.map(row => ({
      market_code: row.market_code,
      market_name: row.market_name,
      score: parseFloat(row.score) || 0,
      status: row.status,
      requirements_met: row.requirements_met,
      requirements_missing: row.requirements_missing
    }));
    const marketReadinessDisplay = buildMarketReadinessDisplay(marketReadiness);

    // ======================
    // 5. AI RECOMMENDATIONS - Khuyến nghị cải thiện
    // ======================
    const recommendationsQuery = `
      SELECT 
        id,
        recommendation_text as description,
        impact_level,
        COALESCE(estimated_reduction_percentage, 0) as reduction_percentage,
        COALESCE(estimated_cost_savings, 0) as estimated_cost_savings,
        category,
        product_id
      FROM ai_recommendations
      WHERE company_id = $1
        AND (is_implemented = false OR is_implemented IS NULL)
      ORDER BY 
        CASE impact_level 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'low' THEN 3 
        END,
        created_at DESC
      LIMIT 5
    `;

    const recsResult = await pool.query(recommendationsQuery, [companyId]);
    const recommendations = recsResult.rows.map(row => {
      // Generate title from category
      let title = '';
      switch(row.category) {
        case 'materials':
          title = 'Tối ưu nguyên liệu';
          break;
        case 'production':
          title = 'Cải thiện quy trình sản xuất';
          break;
        case 'transport':
          title = 'Tối ưu tuyến vận chuyển';
          break;
        case 'packaging':
          title = 'Sử dụng bao bì bền vững';
          break;
        default:
          title = 'Khuyến nghị cải thiện';
      }

      return {
        id: row.id,
        title: title,
        description: row.description,
        impact_level: row.impact_level,
        reduction_percentage: parseFloat(row.reduction_percentage) || 0,
        estimated_cost_savings: parseFloat(row.estimated_cost_savings) || 0,
        category: row.category,
        product_id: row.product_id
      };
    });

    // ======================
    // RESPONSE
    // ======================
    res.json({
      success: true,
      data: {
        stats,
        carbon_trend: carbonTrend,
        emission_breakdown: emissionBreakdown,
        market_readiness: marketReadiness,
        market_readiness_preview: marketReadinessDisplay.preview_items,
        market_readiness_remaining_count: marketReadinessDisplay.remaining_count,
        market_readiness_remaining_label: marketReadinessDisplay.remaining_label,
        market_readiness_display: marketReadinessDisplay,
        recommendations
      },
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

/**
 * POST /api/dashboard/targets
 * Set monthly carbon target (manual or auto suggestion)
 * Requires: Authentication + B2B role
 */
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

    const tableExistsResult = await pool.query(`
      SELECT to_regclass('public.carbon_targets') IS NOT NULL AS "exists"
    `);
    const hasCarbonTargets = Boolean(tableExistsResult.rows?.[0]?.exists);
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
