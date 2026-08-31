const { roundBatch, roundPerProduct } = require('./normalization');
const { toStageBreakdown } = require('./stageModel');

const CORE_STAGE_KEYS = [
  'materials',
  'finished_goods_manufacturing',
  'packaging',
  'logistics_and_storage'
];

const aggregateCarbon = ({ stages, quantity }) => {
  const stageBreakdown = CORE_STAGE_KEYS.map((stage) =>
    toStageBreakdown(stage, stages[stage])
  );
  const perProduct = {
    materials: roundPerProduct(stages.materials.amount),
    production: roundPerProduct(stages.finished_goods_manufacturing.amount),
    energy: 0,
    transport: roundPerProduct(stages.logistics_and_storage.amount),
    packaging: roundPerProduct(stages.packaging.amount),
    total: roundPerProduct(
      stages.materials.amount +
        stages.finished_goods_manufacturing.amount +
        stages.logistics_and_storage.amount +
        stages.packaging.amount
    )
  };
  const totalBatch = {
    materials: roundBatch(perProduct.materials * quantity),
    production: roundBatch(perProduct.production * quantity),
    energy: 0,
    transport: roundBatch(perProduct.transport * quantity),
    packaging: roundBatch(perProduct.packaging * quantity),
    total: roundBatch(perProduct.total * quantity)
  };
  const factorSourceSummary = stageBreakdown.flatMap((stage) => stage.factors);

  return {
    stageBreakdown,
    factorSourceSummary,
    factorManifest: Array.from(
      new Set(factorSourceSummary.map((factor) => factor.factorVersionId))
    ),
    perProduct,
    totalBatch,
    cradleToGateCoreKgCO2e: roundPerProduct(
      perProduct.materials + perProduct.production + perProduct.packaging
    ),
    gateToMarketExtensionKgCO2e: perProduct.transport
  };
};

module.exports = { CORE_STAGE_KEYS, aggregateCarbon };
