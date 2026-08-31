const { roundPerProduct } = require('./normalization');
const { UNCERTAINTY_BY_QUALITY } = require('./stageModel');

const buildRssUncertainty = (terms, total) => {
  if (total <= 0 || terms.length === 0) {
    return {
      method: 'rss_fallback',
      p5KgCO2e: 0,
      p95KgCO2e: 0,
      halfWidth95Percent: 0
    };
  }

  const variance = terms.reduce((sum, term) => {
    const cv = term.factor.uncertaintyCv || UNCERTAINTY_BY_QUALITY[term.factor.quality];
    return sum + Math.pow(term.amount * cv, 2);
  }, 0);
  const halfWidth = 1.96 * Math.sqrt(variance);
  return {
    method: 'rss_fallback',
    p5KgCO2e: roundPerProduct(Math.max(0, total - halfWidth)),
    p95KgCO2e: roundPerProduct(total + halfWidth),
    halfWidth95Percent: roundPerProduct((halfWidth / total) * 100)
  };
};

module.exports = { buildRssUncertainty };
