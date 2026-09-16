const { location, assessment, portfolio } = require('../../src/services/climateRiskControls');
const facilityRevisionId = '12345678-1234-4234-8234-123456789abc';
const locationRevisionId = '22345678-1234-4234-8234-123456789abc';
const evidenceDocumentId = '32345678-1234-4234-8234-123456789abc';
const valid = { facilityRevisionId, locationRevisionId, hazardType: 'heat', scenarioKind: 'projection',
  scenarioReference: '2031-2050-ssp245', horizonStart: '2031-01-01', horizonEnd: '2050-12-31',
  sourceKind: 'CMIP6', sourceUrl: 'https://cds.climate.copernicus.eu/datasets/projections-cmip6',
  datasetIdentifier: 'CMIP6', datasetVersion: 'v1', spatialResolution: 'model grid', temporalResolution: 'monthly',
  gridReference: 'cell-24', spatialMatchNotes: 'Nearest grid cell; not site-scale',
  modelName: 'model-a', scenarioName: 'ssp245', hazardMetric: 'hot_days', metricValue: 22.5,
  metricUnit: 'days/year', uncertaintyNotes: 'Single model, no downscaling', exposureRating: 3,
  vulnerabilityRating: 4, businessDependencyPercent: 50, priorityBand: 'high',
  ratingRationale: 'Heat affects key process; author-assigned screening band', evidenceDocumentId };

test('location requires bounded coordinates and evidence', () => {
  expect(location({ facilityRevisionId, latitude: 10.123456, longitude: 106.123456, precisionMeters: 100,
    locationBasis: 'geocoded facility entrance', evidenceDocumentId }).errors).toEqual([]);
  expect(location({ facilityRevisionId, latitude: 91, longitude: 106, precisionMeters: 100,
    locationBasis: 'bad', evidenceDocumentId }).errors.length).toBeGreaterThan(0);
});

test('projection requires model, scenario and provenance', () => {
  expect(assessment(valid).errors).toEqual([]);
  expect(assessment({ ...valid, modelName: '' }).errors).toContain('Projection requires modelName and scenarioName.');
  expect(assessment({ ...valid, sourceKind: 'ERA5_LAND' }).errors).toContain('sourceKind does not match the scenario kind.');
  expect(assessment({ ...valid, horizonStart: '2031-02-30' }).errors).toContain('A valid scenario horizon is required.');
  expect(assessment({ ...valid, metricValue: 1e-9 }).errors).toContain('metricValue must be a finite number with at most eight decimals.');
});

test('portfolio inputs must be unique and adequately explained', () => {
  expect(portfolio({ portfolioReference: 'P1', assessmentIds: [facilityRevisionId, locationRevisionId], methodologyNotes: 'screening only' }).errors).toEqual([]);
  expect(portfolio({ portfolioReference: 'P1', assessmentIds: [facilityRevisionId, facilityRevisionId], methodologyNotes: 'screening only' }).errors.length).toBeGreaterThan(0);
});
