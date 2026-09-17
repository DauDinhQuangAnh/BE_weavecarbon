const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? '').trim();
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  return value;
}
const stableJson = (value) => JSON.stringify(stable(value));
const sha = (value) => crypto.createHash('sha256').update(stableJson(value)).digest('hex');
const bounded = (value, max) => Boolean(value) && value.length <= max;
const number = (value, min, max, decimals) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && Number(value.toFixed(decimals)) === value;
function date(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return DATE.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function evidence(value, errors) { if (!UUID.test(value)) errors.push('evidenceDocumentId must be a UUID.'); }

function profile(input = {}) {
  const value = { supplierReference: text(input.supplierReference), legalName: text(input.legalName), tradingName: text(input.tradingName) || null,
    countryCode: text(input.countryCode).toUpperCase(), sector: text(input.sector), supplierTier: input.supplierTier,
    lifecycleStatus: text(input.lifecycleStatus).toLowerCase(), evidenceDocumentId: text(input.evidenceDocumentId), metadata: object(input.metadata) };
  const errors = [];
  if (!bounded(value.supplierReference, 120) || !bounded(value.legalName, 240)) errors.push('Supplier reference and legal name are required.');
  if (value.tradingName && value.tradingName.length > 240) errors.push('tradingName must not exceed 240 characters.');
  if (!/^[A-Z]{2}$/.test(value.countryCode)) errors.push('countryCode must be a two-letter uppercase code.');
  if (!bounded(value.sector, 160)) errors.push('sector is required.');
  if (!Number.isInteger(value.supplierTier) || value.supplierTier < 1 || value.supplierTier > 4) errors.push('supplierTier must be 1–4.');
  if (!['prospective', 'active', 'inactive'].includes(value.lifecycleStatus)) errors.push('lifecycleStatus is invalid.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function site(input = {}) {
  const value = { supplierRevisionId: text(input.supplierRevisionId), siteReference: text(input.siteReference), siteName: text(input.siteName),
    countryCode: text(input.countryCode).toUpperCase(), latitude: input.latitude, longitude: input.longitude,
    precisionMeters: input.precisionMeters, locationBasis: text(input.locationBasis), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!UUID.test(value.supplierRevisionId)) errors.push('supplierRevisionId must be a UUID.');
  if (!bounded(value.siteReference, 120) || !bounded(value.siteName, 240)) errors.push('Site reference and name are required.');
  if (!/^[A-Z]{2}$/.test(value.countryCode)) errors.push('countryCode must be a two-letter uppercase code.');
  if (!number(value.latitude, -90, 90, 6) || !number(value.longitude, -180, 180, 6)) errors.push('Coordinates require at most six decimal places.');
  if (!Number.isInteger(value.precisionMeters) || value.precisionMeters < 1 || value.precisionMeters > 100000) errors.push('precisionMeters must be 1–100000.');
  if (!bounded(value.locationBasis, 2000)) errors.push('locationBasis is required.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function relationship(input = {}) {
  const value = { supplierRevisionId: text(input.supplierRevisionId), relationshipReference: text(input.relationshipReference),
    materialOrService: text(input.materialOrService), procurementCategory: text(input.procurementCategory),
    spendPercent: input.spendPercent, productionDependencyPercent: input.productionDependencyPercent,
    singleSource: input.singleSource, dependentSkuCount: input.dependentSkuCount, dependentRouteCount: input.dependentRouteCount,
    effectiveFrom: text(input.effectiveFrom), effectiveTo: text(input.effectiveTo) || null, evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!UUID.test(value.supplierRevisionId)) errors.push('supplierRevisionId must be a UUID.');
  if (!bounded(value.relationshipReference, 120) || !bounded(value.materialOrService, 240) || !bounded(value.procurementCategory, 160)) errors.push('Relationship reference, material/service and category are required.');
  if (!number(value.spendPercent, 0, 100, 3) || !number(value.productionDependencyPercent, 0, 100, 3)) errors.push('Spend and production dependency must be 0–100 with at most three decimals.');
  if (typeof value.singleSource !== 'boolean') errors.push('singleSource must be boolean.');
  if (!Number.isSafeInteger(value.dependentSkuCount) || value.dependentSkuCount < 0 || !Number.isSafeInteger(value.dependentRouteCount) || value.dependentRouteCount < 0) errors.push('Dependent SKU and route counts must be nonnegative integers.');
  if (!date(value.effectiveFrom) || (value.effectiveTo && (!date(value.effectiveTo) || value.effectiveTo < value.effectiveFrom))) errors.push('Relationship effective dates are invalid.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function climateAssessment(input = {}) {
  const value = { supplierRevisionId: text(input.supplierRevisionId), siteRevisionId: text(input.siteRevisionId),
    hazardType: text(input.hazardType), scenarioKind: text(input.scenarioKind), scenarioReference: text(input.scenarioReference),
    horizonStart: text(input.horizonStart), horizonEnd: text(input.horizonEnd), sourceKind: text(input.sourceKind), sourceUrl: text(input.sourceUrl),
    datasetIdentifier: text(input.datasetIdentifier), datasetVersion: text(input.datasetVersion), spatialResolution: text(input.spatialResolution),
    temporalResolution: text(input.temporalResolution), gridReference: text(input.gridReference), spatialMatchNotes: text(input.spatialMatchNotes),
    modelName: text(input.modelName) || null, scenarioName: text(input.scenarioName) || null, hazardMetric: text(input.hazardMetric),
    metricValue: input.metricValue, metricUnit: text(input.metricUnit), uncertaintyNotes: text(input.uncertaintyNotes),
    exposureRating: input.exposureRating, vulnerabilityRating: input.vulnerabilityRating, priorityBand: text(input.priorityBand),
    ratingRationale: text(input.ratingRationale), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!UUID.test(value.supplierRevisionId) || !UUID.test(value.siteRevisionId)) errors.push('Supplier and site revision UUIDs are required.');
  if (!['heat', 'drought', 'extreme_rainfall'].includes(value.hazardType)) errors.push('hazardType is unsupported.');
  if (!['historical', 'projection'].includes(value.scenarioKind)) errors.push('scenarioKind is unsupported.');
  if (!bounded(value.scenarioReference, 120) || !date(value.horizonStart) || !date(value.horizonEnd) || value.horizonEnd < value.horizonStart) errors.push('Scenario reference and horizon are required.');
  if (!['ERA5_LAND', 'CMIP6', 'OTHER'].includes(value.sourceKind) || (value.scenarioKind === 'historical' && value.sourceKind === 'CMIP6') || (value.scenarioKind === 'projection' && value.sourceKind === 'ERA5_LAND')) errors.push('sourceKind does not match scenarioKind.');
  if (!/^https:\/\/[^\s]+$/i.test(value.sourceUrl) || value.sourceUrl.length > 2000) errors.push('An HTTPS sourceUrl is required.');
  for (const [key, max] of [['datasetIdentifier', 240], ['datasetVersion', 120], ['spatialResolution', 120], ['temporalResolution', 120], ['hazardMetric', 120], ['metricUnit', 100]]) if (!bounded(value[key], max)) errors.push(`${key} is required.`);
  if (!bounded(value.gridReference, 240) || !bounded(value.spatialMatchNotes, 4000) || !bounded(value.uncertaintyNotes, 4000)) errors.push('Grid, spatial match and uncertainty notes are required.');
  if (value.scenarioKind === 'projection' && (!bounded(value.modelName, 120) || !bounded(value.scenarioName, 120))) errors.push('Projection requires modelName and scenarioName.');
  if (!number(value.metricValue, -1e15, 1e15, 8)) errors.push('metricValue is invalid.');
  if (!Number.isInteger(value.exposureRating) || value.exposureRating < 1 || value.exposureRating > 5 || !Number.isInteger(value.vulnerabilityRating) || value.vulnerabilityRating < 1 || value.vulnerabilityRating > 5) errors.push('Exposure and vulnerability ratings must be 1–5.');
  if (!['low', 'medium', 'high'].includes(value.priorityBand) || !bounded(value.ratingRationale, 4000)) errors.push('Priority band and rationale are required.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function carbonSnapshot(input = {}) {
  const value = { subjectKind: text(input.subjectKind), facilityRevisionId: text(input.facilityRevisionId) || null,
    supplierRevisionId: text(input.supplierRevisionId) || null, reportingPeriodStart: text(input.reportingPeriodStart),
    reportingPeriodEnd: text(input.reportingPeriodEnd), grossKgCo2e: input.grossKgCo2e,
    activityQuantity: input.activityQuantity ?? null, activityUnit: text(input.activityUnit) || null,
    intensityKgCo2e: input.intensityKgCo2e ?? null, boundary: text(input.boundary),
    methodologyReference: text(input.methodologyReference), sourceKind: text(input.sourceKind),
    dataQualityLevel: text(input.dataQualityLevel).toUpperCase(), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!['facility', 'supplier'].includes(value.subjectKind) || (value.subjectKind === 'facility' ? !UUID.test(value.facilityRevisionId || '') || value.supplierRevisionId : !UUID.test(value.supplierRevisionId || '') || value.facilityRevisionId)) errors.push('Exactly one subject revision matching subjectKind is required.');
  if (!date(value.reportingPeriodStart) || !date(value.reportingPeriodEnd) || value.reportingPeriodEnd < value.reportingPeriodStart) errors.push('Reporting period is invalid.');
  if (!number(value.grossKgCo2e, 0, 1e18, 8)) errors.push('grossKgCo2e is invalid.');
  const hasActivity = value.activityQuantity !== null || value.activityUnit !== null || value.intensityKgCo2e !== null;
  if (hasActivity && (!number(value.activityQuantity, 0.00000001, 1e18, 8) || !bounded(value.activityUnit, 100) || !number(value.intensityKgCo2e, 0, 1e18, 8))) errors.push('Activity quantity, unit and intensity must be supplied together.');
  if (!bounded(value.boundary, 4000) || !bounded(value.methodologyReference, 500)) errors.push('Boundary and methodology reference are required.');
  if (!['supplier_specific', 'facility_inventory', 'estimated', 'proxy'].includes(value.sourceKind)) errors.push('sourceKind is invalid.');
  if ((value.subjectKind === 'supplier' && value.sourceKind === 'facility_inventory') ||
      (value.subjectKind === 'facility' && value.sourceKind === 'supplier_specific')) errors.push('sourceKind does not match subjectKind.');
  if (!['L1', 'L2', 'L3', 'L4', 'L5'].includes(value.dataQualityLevel)) errors.push('dataQualityLevel must be L1–L5.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function criticalityModel(input = {}) {
  const value = { modelReference: text(input.modelReference), carbonWeightPercent: input.carbonWeightPercent,
    climateWeightPercent: input.climateWeightPercent, dependencyWeightPercent: input.dependencyWeightPercent,
    mediumThreshold: input.mediumThreshold, highThreshold: input.highThreshold,
    normalizationPolicy: text(input.normalizationPolicy), rationale: text(input.rationale),
    approvalStatus: text(input.approvalStatus), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!bounded(value.modelReference, 120)) errors.push('modelReference is required.');
  for (const key of ['carbonWeightPercent', 'climateWeightPercent', 'dependencyWeightPercent']) if (!number(value[key], 0, 100, 3)) errors.push(`${key} must be 0–100 with at most three decimals.`);
  if (Math.round((Number(value.carbonWeightPercent) + Number(value.climateWeightPercent) + Number(value.dependencyWeightPercent)) * 1000) !== 100000) errors.push('Criticality weights must total exactly 100.000.');
  if (!number(value.mediumThreshold, 0, 100, 4) || !number(value.highThreshold, 0, 100, 4) || value.mediumThreshold >= value.highThreshold) errors.push('Priority thresholds are invalid.');
  if (!bounded(value.normalizationPolicy, 5000) || !bounded(value.rationale, 5000)) errors.push('Normalization policy and rationale are required.');
  if (!['draft', 'approved'].includes(value.approvalStatus)) errors.push('approvalStatus is invalid.');
  evidence(value.evidenceDocumentId, errors); return { value, errors };
}

function criticality(input = {}) {
  const value = { subjectKind: text(input.subjectKind), facilityRevisionId: text(input.facilityRevisionId) || null,
    supplierRevisionId: text(input.supplierRevisionId) || null, relationshipRevisionId: text(input.relationshipRevisionId) || null,
    carbonSnapshotId: text(input.carbonSnapshotId), modelRevisionId: text(input.modelRevisionId),
    climateAssessmentIds: Array.isArray(input.climateAssessmentIds) ? input.climateAssessmentIds.map(text) : [],
    assessmentPeriodStart: text(input.assessmentPeriodStart), assessmentPeriodEnd: text(input.assessmentPeriodEnd),
    normalizedCarbonScore: input.normalizedCarbonScore, normalizedClimateScore: input.normalizedClimateScore,
    normalizedDependencyScore: input.normalizedDependencyScore, carbonScoreRationale: text(input.carbonScoreRationale),
    climateScoreRationale: text(input.climateScoreRationale), dependencyScoreRationale: text(input.dependencyScoreRationale) };
  const errors = [];
  const subjectValid = value.subjectKind === 'facility'
    ? UUID.test(value.facilityRevisionId || '') && !value.supplierRevisionId && !value.relationshipRevisionId
    : value.subjectKind === 'supplier' && UUID.test(value.supplierRevisionId || '') && UUID.test(value.relationshipRevisionId || '') && !value.facilityRevisionId;
  if (!subjectValid) errors.push('Subject and relationship references do not match subjectKind.');
  if (!UUID.test(value.carbonSnapshotId) || !UUID.test(value.modelRevisionId)) errors.push('Carbon snapshot and model revision UUIDs are required.');
  if (value.climateAssessmentIds.length < 1 || value.climateAssessmentIds.length > 3 || new Set(value.climateAssessmentIds).size !== value.climateAssessmentIds.length || value.climateAssessmentIds.some((id) => !UUID.test(id))) errors.push('climateAssessmentIds requires 1–3 unique UUIDs.');
  if (!date(value.assessmentPeriodStart) || !date(value.assessmentPeriodEnd) || value.assessmentPeriodEnd < value.assessmentPeriodStart) errors.push('Assessment period is invalid.');
  for (const key of ['normalizedCarbonScore', 'normalizedClimateScore', 'normalizedDependencyScore']) if (!number(value[key], 0, 100, 4)) errors.push(`${key} must be 0–100.`);
  for (const key of ['carbonScoreRationale', 'climateScoreRationale', 'dependencyScoreRationale']) if (!bounded(value[key], 4000)) errors.push(`${key} is required.`);
  return { value, errors };
}

function portfolio(input = {}) {
  const value = { portfolioReference: text(input.portfolioReference), criticalitySnapshotIds: Array.isArray(input.criticalitySnapshotIds) ? input.criticalitySnapshotIds.map(text) : [], methodologyNotes: text(input.methodologyNotes) };
  const errors = [];
  if (!bounded(value.portfolioReference, 120)) errors.push('portfolioReference is required.');
  if (value.criticalitySnapshotIds.length < 2 || value.criticalitySnapshotIds.length > 100 || new Set(value.criticalitySnapshotIds).size !== value.criticalitySnapshotIds.length || value.criticalitySnapshotIds.some((id) => !UUID.test(id))) errors.push('criticalitySnapshotIds requires 2–100 unique UUIDs.');
  if (!bounded(value.methodologyNotes, 5000)) errors.push('methodologyNotes are required.');
  return { value, errors };
}

module.exports = { profile, site, relationship, climateAssessment, carbonSnapshot, criticalityModel, criticality, portfolio, sha, stableJson };
