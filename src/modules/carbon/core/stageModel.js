const { roundPerProduct } = require('./normalization');

const QUALITY_RANK = {
  primary: 0,
  documented_secondary: 1,
  internal_proxy: 2,
  market_default_or_missing: 3
};

const UNCERTAINTY_BY_QUALITY = {
  primary: 0.1,
  documented_secondary: 0.2,
  internal_proxy: 0.35,
  market_default_or_missing: 0.5
};

const maxQuality = (left, right) =>
  QUALITY_RANK[left] >= QUALITY_RANK[right] ? left : right;

const createStageAccumulator = () => ({ amount: 0, factors: [], quality: 'primary' });

const addFactorSummary = (accumulator, stage, factor) => {
  const key = `${stage}:${factor.id}`;
  if (accumulator.factors.some((item) => `${item.stage}:${item.factorId}` === key)) {
    accumulator.quality = maxQuality(accumulator.quality, factor.quality);
    return;
  }

  accumulator.factors.push({
    factorId: factor.id,
    factorVersionId: factor.factorVersionId,
    label: factor.label,
    stage,
    unit: factor.unit,
    value: factor.value,
    source: factor.source,
    sourceUrl: factor.sourceUrl,
    geography: factor.geography,
    year: factor.year,
    quality: factor.quality,
    factorClass: factor.factorClass,
    boundaryType: factor.boundaryType,
    gwpBasis: factor.gwpBasis,
    uncertaintyCv: factor.uncertaintyCv,
    qualityScores: factor.qualityScores,
    isProxy: factor.isProxy
  });
  accumulator.quality = maxQuality(accumulator.quality, factor.quality);
};

const buildStageRange = (amount, quality) => {
  if (amount <= 0) return { min: 0, max: 0 };
  const uncertainty = UNCERTAINTY_BY_QUALITY[quality];
  return {
    min: roundPerProduct(amount * (1 - uncertainty)),
    max: roundPerProduct(amount * (1 + uncertainty))
  };
};

const toStageBreakdown = (stage, accumulator) => ({
  stage,
  amount: roundPerProduct(accumulator.amount),
  range: buildStageRange(accumulator.amount, accumulator.quality),
  quality: accumulator.quality,
  factors: accumulator.factors,
  isEstimated: accumulator.factors.some((factor) => factor.isProxy)
});

module.exports = {
  QUALITY_RANK,
  UNCERTAINTY_BY_QUALITY,
  addFactorSummary,
  createStageAccumulator,
  maxQuality,
  toStageBreakdown
};
