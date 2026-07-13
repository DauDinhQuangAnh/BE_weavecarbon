const { toNumber, toPayloadObject, isNonEmptyString, safeArray } = require('./shared');
const { clampConfidenceScore, getConfidenceLevel } = require('./mappers');

const sumPercentage = (items = []) =>
    items.reduce((sum, item) => {
        const percentage = toNumber(item?.percentage, 0);
        return sum + Math.max(0, percentage);
    }, 0);

const hasAddressData = (location = {}) => {
    if (!location || typeof location !== 'object') {
        return false;
    }
    return Boolean(
        isNonEmptyString(location.streetNumber) ||
        isNonEmptyString(location.street) ||
        isNonEmptyString(location.ward) ||
        isNonEmptyString(location.district) ||
        isNonEmptyString(location.city) ||
        isNonEmptyString(location.stateRegion) ||
        isNonEmptyString(location.country) ||
        isNonEmptyString(location.postalCode) ||
        Number.isFinite(location.lat) ||
        Number.isFinite(location.lng)
    );
};

const buildCarbonResultsWithConfidence = (carbonResults, confidenceScore) => {
    const normalizedScore = Math.round(clampConfidenceScore(confidenceScore) * 100) / 100;
    const normalizedLevel = getConfidenceLevel(normalizedScore);
    const safeCarbonResults = toPayloadObject(carbonResults);

    return {
        ...safeCarbonResults,
        confidenceLevel: normalizedLevel,
        confidence_level: normalizedLevel,
        confidenceScore: normalizedScore,
        confidence_score: normalizedScore
    };
};

const computeDataConfidenceScore = (productData = {}) => {
    const payload = toPayloadObject(productData);
    const carbonResults = toPayloadObject(payload.carbonResults);
    const providedScore = toNumber(
        carbonResults.confidenceScore ??
        carbonResults.confidence_score ??
        payload.confidenceScore ??
        payload.confidence_score,
        Number.NaN
    );

    if (Number.isFinite(providedScore)) {
        return Math.round(clampConfidenceScore(providedScore) * 100) / 100;
    }

    const materials = safeArray(payload.materials);
    const productionProcesses = safeArray(payload.productionProcesses);
    const energySources = safeArray(payload.energySources);
    const transportLegs = safeArray(payload.transportLegs ?? payload.transport_legs);
    const originAddress = payload.originAddress ?? payload.origin_address;
    const destinationAddress = payload.destinationAddress ?? payload.destination_address;
    const estimatedTotalDistance = toNumber(
        payload.estimatedTotalDistance ?? payload.estimated_total_distance,
        0
    );

    let score = 0;

    // 1) Materials completeness (0-35)
    if (materials.length > 0) {
        const totalMaterialPercentage = sumPercentage(materials);
        const completeRatio =
            totalMaterialPercentage >= 95 && totalMaterialPercentage <= 105 ?
            1 :
            Math.max(0, Math.min(1, totalMaterialPercentage / 100));

        const typedCount = materials.filter((item) =>
            isNonEmptyString(item?.materialType)
        ).length;
        const knownOriginCount = materials.filter((item) => {
            const source = String(item?.source || '').trim().toLowerCase();
            return source.length > 0 && source !== 'unknown';
        }).length;

        score += 15 * completeRatio;
        score += 10 * (typedCount / materials.length);
        score += 10 * (knownOriginCount / materials.length);
    } else {
        score += 4;
    }

    // 2) Manufacturing completeness (0-25)
    if (productionProcesses.length > 0) {
        score += 12;
    }
    if (isNonEmptyString(payload.manufacturingLocation)) {
        score += 8;
    }
    if (isNonEmptyString(payload.wasteRecovery)) {
        score += 5;
    }

    // 3) Energy completeness (0-15)
    if (energySources.length > 0) {
        const energyTotalPercentage = sumPercentage(energySources);
        const energyCompleteness =
            energyTotalPercentage >= 95 && energyTotalPercentage <= 105 ?
            1 :
            Math.max(0, Math.min(1, energyTotalPercentage / 100));
        const validEnergyCount = energySources.filter((source) =>
            isNonEmptyString(source?.source)
        ).length;

        score += 10 * energyCompleteness;
        score += 5 * (validEnergyCount / energySources.length);
    } else {
        score += 3;
    }

    // 4) Logistics completeness (0-20)
    const legsWithDistance = transportLegs.filter((leg) =>
        toNumber(leg?.estimatedDistance ?? leg?.estimated_distance ?? leg?.distance_km, 0) > 0
    ).length;

    if (transportLegs.length > 0) {
        score += 8;
        score += 6 * (legsWithDistance / transportLegs.length);

        const legsWithMode = transportLegs.filter((leg) =>
            isNonEmptyString(leg?.mode ?? leg?.transport_mode)
        ).length;
        score += 3 * (legsWithMode / transportLegs.length);
    } else if (estimatedTotalDistance > 0) {
        score += 9;
    }

    const hasOrigin = hasAddressData(originAddress);
    const hasDestination = hasAddressData(destinationAddress);
    if (hasOrigin && hasDestination) {
        score += 3;
    } else if (hasOrigin || hasDestination) {
        score += 1.5;
    }

    // 5) Proxy usage penalty (up to -20)
    const proxyNotesRaw = safeArray(
        carbonResults.proxyNotes ?? carbonResults.proxy_notes
    ).map((item) => String(item || '').trim()).filter(Boolean);
    const uniqueProxyNotes = [...new Set(proxyNotesRaw)];
    const proxyUsed = Boolean(
        carbonResults.proxyUsed ??
        carbonResults.proxy_used ??
        uniqueProxyNotes.length > 0
    );

    let penalty = 0;
    if (proxyUsed) {
        penalty += 8;
    }
    penalty += Math.min(12, uniqueProxyNotes.length * 2);

    const materialUnknownOriginCount = materials.filter((item) => {
        const source = String(item?.source || '').trim().toLowerCase();
        return source === 'unknown';
    }).length;
    penalty += Math.min(6, materialUnknownOriginCount * 2);

    score = Math.max(0, score - penalty);

    return Math.round(clampConfidenceScore(score) * 100) / 100;
};

module.exports = {
    sumPercentage,
    hasAddressData,
    buildCarbonResultsWithConfidence,
    computeDataConfidenceScore
};
