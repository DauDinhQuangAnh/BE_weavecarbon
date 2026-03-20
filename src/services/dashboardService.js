const pool = require('../config/database');
const { getSchemaCapabilities } = require('../config/schemaCapabilities');
const { READ_CACHE_TTL_MS } = require('../config/runtime');
const TtlCache = require('../utils/ttlCache');

const MARKET_READINESS_PREVIEW_LIMIT = 3;
const overviewCache = new TtlCache({ ttlMs: READ_CACHE_TTL_MS });

const toNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

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

function invalidateOverviewCache(companyId) {
  overviewCache.deleteWhere((key) => key.startsWith(`${companyId}:`));
}

async function getOverview(companyId, trendMonths) {
  const cacheKey = `${companyId}:${trendMonths}`;
  const cached = overviewCache.get(cacheKey);
  if (typeof cached !== 'undefined') {
    return cached;
  }

  const capabilities = getSchemaCapabilities();

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

  const targetMonthlyCte = capabilities.hasCarbonTargets ? `
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

  const exportReadinessPromise = capabilities.hasMarketReadiness
    ? pool.query(exportReadinessFromMarketReadinessQuery, [companyId])
    : capabilities.hasExportMarkets
      ? pool.query(exportReadinessFromExportMarketsQuery, [companyId])
      : Promise.resolve({ rows: [{ total_markets: 0, avg_export_readiness: 0 }] });

  const marketReadinessPromise = capabilities.hasMarketReadiness
    ? pool.query(marketReadinessFromMarketReadinessQuery, [companyId])
    : capabilities.hasExportMarkets
      ? pool.query(marketReadinessFromExportMarketsQuery, [companyId])
      : pool.query(marketReadinessFromCompanyTargetMarketsQuery, [companyId]);

  const [
    statsResult,
    trendResult,
    recommendationsResult,
    exportResult,
    marketReadinessResult
  ] = await Promise.all([
    pool.query(statsQuery, [companyId]),
    pool.query(carbonTrendQuery, [companyId, trendMonths]),
    pool.query(recommendationsQuery, [companyId]),
    exportReadinessPromise,
    marketReadinessPromise
  ]);

  let exportReadinessRow = exportResult.rows?.[0] || { total_markets: 0, avg_export_readiness: 0 };
  if (
    capabilities.hasMarketReadiness &&
    (parseInt(exportReadinessRow.total_markets, 10) || 0) === 0 &&
    capabilities.hasExportMarkets
  ) {
    const exportFallbackResult = await pool.query(exportReadinessFromExportMarketsQuery, [companyId]);
    exportReadinessRow = exportFallbackResult.rows?.[0] || exportReadinessRow;
  }

  let marketRows = marketReadinessResult.rows || [];
  if (marketRows.length === 0 && capabilities.hasMarketReadiness && capabilities.hasExportMarkets) {
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

  const statsRow = statsResult.rows[0] || {};
  const stats = {
    total_co2e: toNumber(statsRow.total_co2e),
    total_skus: parseInt(statsRow.total_skus, 10) || 0,
    avg_export_readiness: parseFloat(exportReadinessRow.avg_export_readiness) || 0,
    data_confidence: toNumber(statsRow.data_confidence)
  };

  const carbonTrend = trendResult.rows.map((row) => ({
    month: row.month_key,
    label: row.label,
    actual_emissions: toNumber(row.actual_emissions),
    target_emissions: toNumber(row.target_emissions)
  }));

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

  const marketReadiness = marketRows.map((row) => ({
    market_code: row.market_code,
    market_name: row.market_name,
    score: parseFloat(row.score) || 0,
    status: row.status,
    requirements_met: row.requirements_met,
    requirements_missing: row.requirements_missing
  }));

  const marketReadinessDisplay = buildMarketReadinessDisplay(marketReadiness);

  const recommendations = recommendationsResult.rows.map((row) => {
    let title = '';
    switch (row.category) {
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
      title,
      description: row.description,
      impact_level: row.impact_level,
      reduction_percentage: parseFloat(row.reduction_percentage) || 0,
      estimated_cost_savings: parseFloat(row.estimated_cost_savings) || 0,
      category: row.category,
      product_id: row.product_id
    };
  });

  const payload = {
    stats,
    carbon_trend: carbonTrend,
    emission_breakdown: emissionBreakdown,
    market_readiness: marketReadiness,
    market_readiness_preview: marketReadinessDisplay.preview_items,
    market_readiness_remaining_count: marketReadinessDisplay.remaining_count,
    market_readiness_remaining_label: marketReadinessDisplay.remaining_label,
    market_readiness_display: marketReadinessDisplay,
    recommendations
  };

  overviewCache.set(cacheKey, payload);
  return payload;
}

module.exports = {
  getOverview,
  invalidateOverviewCache
};
