const { resolveEnergyFactor } = require('./factorRegistry');
const { clamp, isFiniteNumber, roundPerProduct } = require('./normalization');

const averageQualityScore = (factor) => {
  const scores = factor.qualityScores;
  return (
    scores.technologicalRepresentativeness +
    scores.temporalRepresentativeness +
    scores.geographicalRepresentativeness +
    scores.completeness +
    scores.reliability
  ) / 5;
};

const resolveConfidenceLevel = (
  dataQualityRating1To5,
  proxyShare,
  uncertaintyHalfWidth95Percent
) => {
  if (
    dataQualityRating1To5 <= 2 &&
    proxyShare <= 0.15 &&
    uncertaintyHalfWidth95Percent <= 20
  ) {
    return 'high';
  }
  if (
    dataQualityRating1To5 <= 3.5 &&
    proxyShare <= 0.5 &&
    uncertaintyHalfWidth95Percent <= 60
  ) {
    return 'medium';
  }
  return 'low';
};

const calculateDataQuality = ({
  input,
  unitMassKg,
  bomCoverage,
  unknownMaterialOriginCount,
  processFactorIds,
  energyEntries,
  manufacturingGeography,
  transportEntries,
  contributionTerms,
  uncertainty
}) => {
  const totalContribution = contributionTerms.reduce((sum, term) => sum + term.amount, 0);
  const proxyContribution = contributionTerms
    .filter((term) => term.factor.isProxy)
    .reduce((sum, term) => sum + term.amount, 0);
  const proxyShare = totalContribution > 0
    ? clamp(proxyContribution / totalContribution, 0, 1)
    : 1;
  const explicitMaterialFactorCount = input.materials.filter(
    (material) => Boolean(material.factorId)
  ).length;
  const explicitAccessoryWeightCount = input.accessories.filter(
    (accessory) => isFiniteNumber(accessory.weightKg) && accessory.weightKg > 0
  ).length;
  const explicitTransportDistanceCount = input.transport.filter(
    (transport) => isFiniteNumber(transport.distanceKm) && transport.distanceKm > 0
  ).length;

  const completenessScore = clamp(
    (unitMassKg > 0 ? 4 : 0) +
      (input.materials.length > 0 ? 6 : 0) +
      (bomCoverage >= 95 && bomCoverage <= 105 ? 10 : bomCoverage > 0 ? 5 : 0) +
      (processFactorIds.length > 0 ? 4 : 0) +
      (energyEntries.length > 0 ? 3 : 0) +
      (transportEntries.length > 0 ? 3 : 0),
    0,
    30
  );
  const specificityScore = clamp(
    (input.materials.length > 0
      ? Math.round((explicitMaterialFactorCount / input.materials.length) * 10)
      : 0) +
      (input.accessories.length === 0
        ? 5
        : Math.round((explicitAccessoryWeightCount / input.accessories.length) * 5)) +
      (input.processFactorIds.length > 0 ? 5 : 2) +
      (input.energyMix.length > 0 ? 5 : 2),
    0,
    25
  );
  const geographicScore = clamp(
    (manufacturingGeography ? 5 : 0) +
      (energyEntries.some((entry) =>
        resolveEnergyFactor(entry.factorId, entry.geography || manufacturingGeography)?.id ===
          'energy-grid-vn-2023'
      )
        ? 10
        : energyEntries.length > 0
          ? 5
          : 2) -
      (unknownMaterialOriginCount > 0 ? 5 : 0),
    0,
    15
  );
  const transportSpecificityScore = clamp(
    (transportEntries.length > 0
      ? Math.round((explicitTransportDistanceCount / transportEntries.length) * 10)
      : 0) +
      (transportEntries.every((entry) => Boolean(entry.mode || entry.factorId)) &&
      transportEntries.length > 0
        ? 5
        : transportEntries.length > 0
          ? 2
          : 0),
    0,
    15
  );
  const proxyShareScore = clamp(Math.round((1 - proxyShare) * 15), 0, 15);
  const dataQualityBreakdown = {
    completeness: { score: completenessScore, maxScore: 30 },
    specificity: { score: specificityScore, maxScore: 25 },
    geographicRelevance: { score: geographicScore, maxScore: 15 },
    transportSpecificity: { score: transportSpecificityScore, maxScore: 15 },
    proxyShare: { score: proxyShareScore, maxScore: 15 }
  };
  const legacyConfidenceScore = clamp(
    completenessScore +
      specificityScore +
      geographicScore +
      transportSpecificityScore +
      proxyShareScore,
    0,
    100
  );
  const weightedQualityNumerator = contributionTerms.reduce(
    (sum, term) => sum + averageQualityScore(term.factor) * term.amount,
    0
  );
  const dataQualityRating1To5 = totalContribution > 0
    ? roundPerProduct(weightedQualityNumerator / totalContribution)
    : 5;
  const dataQualityPercent = roundPerProduct(100 * (5 - dataQualityRating1To5) / 4);
  const confidenceLevel = resolveConfidenceLevel(
    dataQualityRating1To5,
    proxyShare,
    uncertainty.halfWidth95Percent
  );
  const confidenceScore = clamp(
    Math.round((legacyConfidenceScore + dataQualityPercent) / 2),
    0,
    100
  );
  const contributionDenominator = totalContribution > 0 ? totalContribution : 1;

  return {
    confidenceLevel,
    confidenceScore,
    proxyShare,
    dataQualityBreakdown,
    quality: {
      dataQualityRating1To5,
      dataQualityPercent,
      confidenceLevel,
      primaryDataEmissionsShare: roundPerProduct(
        contributionTerms
          .filter((term) => term.factor.factorClass === 'measured_primary_activity')
          .reduce((sum, term) => sum + term.amount, 0) / contributionDenominator
      ),
      supplierSpecificEmissionsShare: roundPerProduct(
        contributionTerms
          .filter((term) => term.factor.factorClass === 'supplier_specific')
          .reduce((sum, term) => sum + term.amount, 0) / contributionDenominator
      ),
      secondaryEmissionsShare: roundPerProduct(
        contributionTerms
          .filter((term) => term.factor.factorClass === 'documented_secondary')
          .reduce((sum, term) => sum + term.amount, 0) / contributionDenominator
      ),
      proxyEmissionsShare: roundPerProduct(proxyShare)
    }
  };
};

module.exports = { calculateDataQuality, resolveConfidenceLevel };
