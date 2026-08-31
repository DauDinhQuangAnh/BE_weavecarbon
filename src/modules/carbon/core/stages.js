const {
  resolveAccessoryFactorIdByKeyword,
  resolveEnergyFactor,
  resolveEnergyScope,
  resolveFactorOrFallback,
  resolveMarketDistanceDefault
} = require('./factorRegistry');
const { clamp, isFiniteNumber, roundPerProduct, sumValues } = require('./normalization');
const {
  addFactorSummary,
  createStageAccumulator,
  maxQuality
} = require('./stageModel');

const calculateMaterials = ({ input, unitMassKg, methodology }) => {
  const stage = createStageAccumulator();
  const notes = [];
  const warnings = [];
  const contributionTerms = [];
  let scope3Amount = 0;
  let biogenicCarbonKgCO2e = 0;

  const totalAccessoryMassKg = input.accessories.reduce((sum, accessory) => {
    if (!isFiniteNumber(accessory.weightKg) || accessory.weightKg <= 0) return sum;
    return sum + accessory.weightKg;
  }, 0);
  const materialBaseMassKg = Math.max(unitMassKg - totalAccessoryMassKg, 0);
  const unknownMaterialOriginCount = input.materials.filter(
    (material) => (material.source || 'unknown') === 'unknown'
  ).length;
  const bomCoverage = input.materials.reduce(
    (sum, material) => sum + Math.max(0, material.percentage || 0),
    0
  );

  if (bomCoverage < 95 || bomCoverage > 105) {
    notes.push(
      `BOM coverage is ${roundPerProduct(bomCoverage)}%; results rely on partial material allocation.`
    );
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
    warnings.push('Material BOM coverage is outside the 95-105% control range.');
  }

  if (input.materials.length === 0) {
    notes.push('Material inputs are missing; material stage is excluded from the estimate.');
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  for (const material of input.materials) {
    const factor = resolveFactorOrFallback(
      material.factorId ?? material.type,
      methodology.defaultMaterialFactorId
    );
    const percentage = clamp(material.percentage || 0, 0, 100);
    const yieldToProduct = isFiniteNumber(material.yieldToProduct) && material.yieldToProduct > 0
      ? clamp(material.yieldToProduct, 0.01, 1)
      : 1;
    const amount = (materialBaseMassKg * (percentage / 100) / yieldToProduct) * factor.value;

    if (amount > 0) {
      stage.amount += amount;
      addFactorSummary(stage, 'materials', factor);
      contributionTerms.push({ amount, factor });
      scope3Amount += amount;
    }

    const biogenicFactor = material.biogenicCarbonFactorKgPerKg ?? factor.biogenicCarbonKgPerKg;
    if (isFiniteNumber(biogenicFactor) && biogenicFactor > 0) {
      const materialMassKg = (materialBaseMassKg * (percentage / 100)) / yieldToProduct;
      biogenicCarbonKgCO2e += materialMassKg * biogenicFactor;
    }

    if ((material.source || 'unknown') === 'unknown') {
      notes.push(
        `Material "${material.name || material.type}" has unknown origin; uncertainty is widened.`
      );
      stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
    }

    if (!material.factorId && factor.id === methodology.defaultMaterialFactorId) {
      notes.push(
        `Material "${material.name || material.type}" is mapped to a generic internal proxy factor.`
      );
    }
  }

  for (const accessory of input.accessories) {
    if (!isFiniteNumber(accessory.weightKg) || accessory.weightKg <= 0) {
      notes.push(
        `Accessory "${accessory.name || accessory.type}" has no explicit weight and is excluded from CO2e.`
      );
      stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
      continue;
    }

    const factor = resolveFactorOrFallback(
      accessory.factorId ?? resolveAccessoryFactorIdByKeyword(accessory.name || accessory.type),
      'accessory-other-proxy'
    );
    const amount = accessory.weightKg * factor.value;
    stage.amount += amount;
    addFactorSummary(stage, 'materials', factor);
    contributionTerms.push({ amount, factor });
    scope3Amount += amount;
  }

  return {
    stage,
    notes,
    warnings,
    contributionTerms,
    scope3Amount,
    biogenicCarbonKgCO2e,
    bomCoverage,
    unknownMaterialOriginCount
  };
};

const calculatePackaging = ({ input }) => {
  const stage = createStageAccumulator();
  const notes = [];
  const contributionTerms = [];
  let packagingMassKg = 0;
  let scope3Amount = 0;

  if (input.packaging && isFiniteNumber(input.packaging.weightKg) && input.packaging.weightKg > 0) {
    const packagingYield =
      isFiniteNumber(input.packaging.yieldToProduct) && input.packaging.yieldToProduct > 0
        ? clamp(input.packaging.yieldToProduct, 0.01, 1)
        : 1;
    packagingMassKg = input.packaging.weightKg / packagingYield;
    const factor = resolveFactorOrFallback(
      input.packaging.factorId ?? input.packaging.label,
      'packaging-minimal-proxy'
    );
    const amount = packagingMassKg * factor.value;
    stage.amount += amount;
    addFactorSummary(stage, 'packaging', factor);
    contributionTerms.push({ amount, factor });
    scope3Amount += amount;
  } else {
    if (input.includePackagingFallbackNote ?? true) {
      notes.push('Packaging is excluded because packaging weight/type was not provided.');
    }
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  return { stage, notes, contributionTerms, packagingMassKg, scope3Amount };
};

const calculateManufacturing = ({ input, unitMassKg, methodology, reportingActorRole }) => {
  const stage = createStageAccumulator();
  const notes = [];
  const contributionTerms = [];
  const energyBreakdown = [];
  const scopes = { scope1: 0, scope2: 0, scope3: 0 };
  const processFactorIds = input.processFactorIds.length > 0
    ? input.processFactorIds
    : [methodology.defaultProcessFactorId];

  if (input.processFactorIds.length === 0) {
    notes.push(
      `Manufacturing processes are missing; a generic ${methodology.processFallbackWarningLabel} process proxy was used.`
    );
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  const processIntensityKwhPerKg = processFactorIds.reduce((sum, factorId) => {
    const factor = resolveFactorOrFallback(factorId, methodology.defaultProcessFactorId);
    addFactorSummary(stage, 'finished_goods_manufacturing', factor);
    return sum + factor.value;
  }, 0);

  const manufacturingGeography = input.manufacturingGeography || input.originGeography;
  const energyEntries = input.energyMix.length > 0
    ? input.energyMix
    : [{
        factorId: manufacturingGeography ? undefined : 'energy-grid-generic',
        percentage: 100,
        geography: manufacturingGeography
      }];

  if (input.energyMix.length === 0) {
    notes.push(
      manufacturingGeography
        ? `No energy mix was provided; grid electricity was inferred for ${manufacturingGeography}.`
        : 'No energy mix was provided; a generic grid electricity fallback was used.'
    );
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  const totalEnergyPercent = sumValues(
    energyEntries.map((entry) => Math.max(0, entry.percentage || 0))
  );
  if (input.energyMix.length > 0 && (totalEnergyPercent < 95 || totalEnergyPercent > 105)) {
    notes.push(
      `Energy mix coverage is ${roundPerProduct(totalEnergyPercent)}%; shares were normalized before calculation.`
    );
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  const normalizedEnergyDenominator = totalEnergyPercent > 0 ? totalEnergyPercent : 100;
  const weightedEnergyFactor = energyEntries.reduce((sum, entry) => {
    const factor = resolveEnergyFactor(entry.factorId, entry.geography || manufacturingGeography);
    addFactorSummary(stage, 'finished_goods_manufacturing', factor);
    const normalizedShare = Math.max(0, entry.percentage || 0) / normalizedEnergyDenominator;
    const scopedAmount = unitMassKg * processIntensityKwhPerKg * factor.value * normalizedShare;
    const scopeKey = resolveEnergyScope(factor, reportingActorRole);
    scopes[scopeKey] += scopedAmount;
    energyBreakdown.push({
      factorId: factor.id,
      label: factor.label,
      amount: roundPerProduct(scopedAmount),
      scope: scopeKey
    });
    return sum + factor.value * normalizedShare;
  }, 0);

  const productionAmount = unitMassKg * processIntensityKwhPerKg * weightedEnergyFactor;
  stage.amount += productionAmount;
  if (productionAmount > 0) {
    const productionQualityFactor =
      stage.factors.find((factor) => factor.isProxy) || stage.factors[0];
    if (productionQualityFactor) {
      contributionTerms.push({
        amount: productionAmount,
        factor: resolveFactorOrFallback(
          productionQualityFactor.factorId,
          methodology.defaultProcessFactorId
        )
      });
    }
  }

  return {
    stage,
    notes,
    contributionTerms,
    energyBreakdown,
    scopes,
    processFactorIds,
    energyEntries,
    manufacturingGeography
  };
};

const calculateTransport = ({ input, unitMassKg, packagingMassKg }) => {
  const stage = createStageAccumulator();
  const notes = [];
  const contributionTerms = [];
  let scope3Amount = 0;
  const transportEntries = input.transport;
  const shippedMassTonne = (unitMassKg + packagingMassKg) / 1000;

  for (const transport of transportEntries) {
    if (!transport.mode && !transport.factorId) {
      notes.push('A transport leg is missing mode/factor and was excluded from the estimate.');
      stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
      continue;
    }

    const factor = resolveFactorOrFallback(
      transport.factorId ?? transport.mode,
      'transport-multimodal-proxy'
    );
    const explicitDistanceKm = isFiniteNumber(transport.distanceKm) && transport.distanceKm > 0
      ? transport.distanceKm
      : undefined;
    const fallbackDistanceKm = resolveMarketDistanceDefault(
      transport.defaultDistanceKey || input.destinationMarket
    );
    const distanceKm = explicitDistanceKm ?? fallbackDistanceKm;

    if (!explicitDistanceKm) {
      notes.push(
        `Transport distance for ${transport.mode || factor.label} used market default ${roundPerProduct(distanceKm)} km.`
      );
      stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
    }

    const amount = shippedMassTonne * distanceKm * factor.value;
    stage.amount += amount;
    addFactorSummary(stage, 'logistics_and_storage', factor);
    contributionTerms.push({ amount, factor });
    scope3Amount += amount;
  }

  if (transportEntries.length === 0) {
    notes.push('Transport is excluded because no transport legs were provided.');
    stage.quality = maxQuality(stage.quality, 'market_default_or_missing');
  }

  return { stage, notes, contributionTerms, scope3Amount, transportEntries };
};

module.exports = {
  calculateManufacturing,
  calculateMaterials,
  calculatePackaging,
  calculateTransport
};
