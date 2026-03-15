const {
  SUPPORTED_TARGET_MARKETS_SET,
  normalizeTargetMarkets
} = require("../constants/targetMarkets");

const DEFAULT_DOMESTIC_MARKET = "VN";
const SCHEMA_QUERY_TIMEOUT_MS = 8000;
let domesticMarketSchemaReady = null;

const normalizeDomesticMarket = (domesticMarket, fallbackTargetMarkets = []) => {
  const normalizedDomestic = String(domesticMarket || "").trim().toUpperCase();
  if (SUPPORTED_TARGET_MARKETS_SET.has(normalizedDomestic)) {
    return normalizedDomestic;
  }

  const normalizedFallbackMarkets = normalizeTargetMarkets(fallbackTargetMarkets);
  if (normalizedFallbackMarkets.length > 0) {
    return normalizedFallbackMarkets[0];
  }

  return DEFAULT_DOMESTIC_MARKET;
};

const normalizeCompanyMarkets = ({
  currentPlan,
  domesticMarket,
  targetMarkets
}) => {
  const normalizedPlan = String(currentPlan || "").trim().toLowerCase();
  const normalizedTargetMarkets = normalizeTargetMarkets(targetMarkets);
  const normalizedDomesticMarket = normalizeDomesticMarket(domesticMarket, normalizedTargetMarkets);
  const target_markets = normalizedPlan === "trial" ? [] : normalizedTargetMarkets;

  return {
    domestic_market: normalizedDomesticMarket,
    target_markets
  };
};

const ensureCompaniesDomesticMarketColumn = async (client) => {
  if (domesticMarketSchemaReady) {
    await domesticMarketSchemaReady;
    return;
  }

  domesticMarketSchemaReady = (async () => {
    await client.query({
      text: `
        ALTER TABLE public.companies
        ADD COLUMN IF NOT EXISTS domestic_market TEXT
      `,
      query_timeout: SCHEMA_QUERY_TIMEOUT_MS
    });

    await client.query({
      text: `
        UPDATE public.companies
        SET domestic_market = CASE
          WHEN domestic_market IS NOT NULL AND BTRIM(domestic_market) <> '' THEN UPPER(BTRIM(domestic_market))
          WHEN array_length(target_markets, 1) > 0 THEN UPPER(BTRIM(target_markets[1]))
          ELSE $1
        END
        WHERE domestic_market IS NULL OR BTRIM(domestic_market) = ''
      `,
      values: [DEFAULT_DOMESTIC_MARKET],
      query_timeout: SCHEMA_QUERY_TIMEOUT_MS
    });

    await client.query({
      text: `
        ALTER TABLE public.companies
        ALTER COLUMN domestic_market SET DEFAULT '${DEFAULT_DOMESTIC_MARKET}'
      `,
      query_timeout: SCHEMA_QUERY_TIMEOUT_MS
    });
  })().catch((error) => {
    domesticMarketSchemaReady = null;
    throw error;
  });

  await domesticMarketSchemaReady;
};

module.exports = {
  DEFAULT_DOMESTIC_MARKET,
  normalizeDomesticMarket,
  normalizeCompanyMarkets,
  ensureCompaniesDomesticMarketColumn
};
