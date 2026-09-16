const crypto = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? '').trim();
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounded = (value, max) => Boolean(value) && value.length <= max;
const evidenceError = (value, errors) => { if (!UUID.test(value)) errors.push('evidenceDocumentId must be a UUID.'); };
function date(value) { const parsed = new Date(`${value}T00:00:00Z`); return DATE.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function number(value, min, max, decimals) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && Number(value.toFixed(decimals)) === value;
}

function location(input = {}) {
  const value = { facilityRevisionId: text(input.facilityRevisionId), latitude: input.latitude, longitude: input.longitude,
    precisionMeters: input.precisionMeters, locationBasis: text(input.locationBasis), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!UUID.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!number(value.latitude, -90, 90, 6) || !number(value.longitude, -180, 180, 6)) errors.push('Latitude and longitude must be coordinates with at most six decimal places.');
  if (!Number.isInteger(value.precisionMeters) || value.precisionMeters < 1 || value.precisionMeters > 100000) errors.push('precisionMeters must be 1–100000.');
  if (!bounded(value.locationBasis, 2000)) errors.push('locationBasis is required.');
  evidenceError(value.evidenceDocumentId, errors);
  return { value, errors };
}

function assessment(input = {}) {
  const value = { facilityRevisionId: text(input.facilityRevisionId), locationRevisionId: text(input.locationRevisionId),
    hazardType: text(input.hazardType), scenarioKind: text(input.scenarioKind), scenarioReference: text(input.scenarioReference),
    horizonStart: text(input.horizonStart), horizonEnd: text(input.horizonEnd), sourceKind: text(input.sourceKind),
    sourceUrl: text(input.sourceUrl), datasetIdentifier: text(input.datasetIdentifier), datasetVersion: text(input.datasetVersion),
    spatialResolution: text(input.spatialResolution), temporalResolution: text(input.temporalResolution),
    gridReference: text(input.gridReference), spatialMatchNotes: text(input.spatialMatchNotes),
    modelName: text(input.modelName), scenarioName: text(input.scenarioName), hazardMetric: text(input.hazardMetric),
    metricValue: input.metricValue, metricUnit: text(input.metricUnit), uncertaintyNotes: text(input.uncertaintyNotes),
    exposureRating: input.exposureRating, vulnerabilityRating: input.vulnerabilityRating,
    businessDependencyPercent: input.businessDependencyPercent, priorityBand: text(input.priorityBand),
    ratingRationale: text(input.ratingRationale), evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!UUID.test(value.facilityRevisionId) || !UUID.test(value.locationRevisionId)) errors.push('Facility and location revision UUIDs are required.');
  if (!['heat', 'drought', 'extreme_rainfall'].includes(value.hazardType)) errors.push('hazardType is unsupported.');
  if (!['historical', 'projection'].includes(value.scenarioKind)) errors.push('scenarioKind is unsupported.');
  if (!bounded(value.scenarioReference, 120)) errors.push('scenarioReference is required.');
  if (!date(value.horizonStart) || !date(value.horizonEnd) || value.horizonEnd < value.horizonStart) errors.push('A valid scenario horizon is required.');
  if (!['ERA5_LAND', 'CMIP6', 'OTHER'].includes(value.sourceKind) || (value.scenarioKind === 'historical' && value.sourceKind === 'CMIP6') || (value.scenarioKind === 'projection' && value.sourceKind === 'ERA5_LAND')) errors.push('sourceKind does not match the scenario kind.');
  if (!/^https:\/\/[^\s]+$/i.test(value.sourceUrl) || value.sourceUrl.length > 2000) errors.push('An HTTPS sourceUrl is required.');
  for (const key of ['datasetIdentifier', 'datasetVersion', 'spatialResolution', 'temporalResolution', 'hazardMetric', 'metricUnit']) {
    if (!bounded(value[key], key === 'datasetIdentifier' ? 240 : key === 'metricUnit' ? 100 : 120)) errors.push(`${key} is required.`);
  }
  if (!bounded(value.gridReference, 240) || !bounded(value.spatialMatchNotes, 4000)) errors.push('Grid reference and spatial match notes are required.');
  if (value.scenarioKind === 'projection' && (!bounded(value.modelName, 120) || !bounded(value.scenarioName, 120))) errors.push('Projection requires modelName and scenarioName.');
  if (value.modelName.length > 120 || value.scenarioName.length > 120) errors.push('Model and scenario names must be at most 120 characters.');
  if (!number(value.metricValue, -1e15, 1e15, 8)) errors.push('metricValue must be a finite number with at most eight decimals.');
  if (!bounded(value.uncertaintyNotes, 4000)) errors.push('uncertaintyNotes are required.');
  if (!Number.isInteger(value.exposureRating) || value.exposureRating < 1 || value.exposureRating > 5 ||
      !Number.isInteger(value.vulnerabilityRating) || value.vulnerabilityRating < 1 || value.vulnerabilityRating > 5) errors.push('Exposure and vulnerability ratings must be 1–5.');
  if (!number(value.businessDependencyPercent, 0, 100, 3)) errors.push('businessDependencyPercent must be 0–100 with at most three decimals.');
  if (!['low', 'medium', 'high'].includes(value.priorityBand)) errors.push('priorityBand is unsupported.');
  if (!bounded(value.ratingRationale, 4000)) errors.push('ratingRationale is required.');
  evidenceError(value.evidenceDocumentId, errors);
  return { value, errors };
}

function portfolio(input = {}) {
  const value = { portfolioReference: text(input.portfolioReference), assessmentIds: input.assessmentIds,
    methodologyNotes: text(input.methodologyNotes) };
  const errors = [];
  if (!bounded(value.portfolioReference, 120)) errors.push('portfolioReference is required.');
  if (!Array.isArray(value.assessmentIds) || value.assessmentIds.length < 2 || value.assessmentIds.length > 100 ||
      value.assessmentIds.some((id) => !UUID.test(id)) || new Set(value.assessmentIds).size !== value.assessmentIds.length) errors.push('assessmentIds requires 2–100 unique assessment UUIDs.');
  if (!bounded(value.methodologyNotes, 4000)) errors.push('methodologyNotes are required.');
  return { value, errors };
}

module.exports = { location, assessment, portfolio, sha };
