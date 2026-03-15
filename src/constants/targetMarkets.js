const SUPPORTED_TARGET_MARKETS = [
  "VN",
  "EU",
  "US",
  "JP",
  "KR",
  "AU",
  "ASEAN",
  "TH",
  "SG",
  "MY",
  "ID",
  "PH",
  "CA",
  "UK",
  "CN",
  "IN"
];

const SUPPORTED_TARGET_MARKETS_SET = new Set(SUPPORTED_TARGET_MARKETS);

const normalizeTargetMarkets = (value) => {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => SUPPORTED_TARGET_MARKETS_SET.has(item));

  return [...new Set(normalized)];
};

module.exports = {
  SUPPORTED_TARGET_MARKETS,
  SUPPORTED_TARGET_MARKETS_SET,
  normalizeTargetMarkets
};
