const {
  SUPPORTED_TARGET_MARKETS_SET,
  normalizeTargetMarkets
} = require("../constants/targetMarkets");
const { assertSchemaCapability } = require('../config/schemaCapabilities');

const DEFAULT_DOMESTIC_MARKET = "VN";

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

const ensureCompaniesDomesticMarketColumn = async () => {
  assertSchemaCapability(
    'hasCompaniesDomesticMarketColumn',
    'companies.domestic_market is missing. Run "npm run migrate" before starting the API.'
  );
};

module.exports = {
  DEFAULT_DOMESTIC_MARKET,
  normalizeDomesticMarket,
  normalizeCompanyMarkets,
  ensureCompaniesDomesticMarketColumn
};
