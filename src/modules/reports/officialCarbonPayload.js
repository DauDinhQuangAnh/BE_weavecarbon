const STAGES = [
  ['materials', 'Materials'],
  ['production', 'Finished goods manufacturing'],
  ['energy', 'Energy'],
  ['transport', 'Logistics and storage'],
  ['packaging', 'Packaging']
];

const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));

const buildOfficialReportPayload = (clientPayload = {}, authorityRecord) => {
  const carbonResults = authorityRecord.carbonResults;
  const carbonAuthority = authorityRecord.carbonAuthority;
  const product = authorityRecord.product;
  const snapshot = authorityRecord.snapshot;
  const perProduct = carbonResults.perProduct || {};
  const quantity = Math.max(1, Math.trunc(Number(snapshot.quantity) || 1));
  const total = Number(perProduct.total) || 0;
  const stageRows = STAGES.map(([key, label]) => ({
    stage: label,
    activity: 'Server-authoritative product assessment',
    amount: round(perProduct[key]),
    unit: 'kg CO2e/product',
    source: carbonAuthority.source,
    kgCo2e: round(perProduct[key]),
    color: clientPayload.colors?.success || '#0B8F54',
    isDefault: false,
    formula: `carbonResults.perProduct.${key}`
  })).filter((row) => row.kgCo2e > 0);
  const pieData = STAGES.map(([key, label]) => ({
    name: label,
    value: total > 0 ? round((Number(perProduct[key] || 0) / total) * 100, 2) : 0,
    color: clientPayload.colors?.success || '#0B8F54'
  })).filter((row) => row.value > 0);
  const batchTonnes = round(
    Number(carbonResults.totalBatch?.total ?? total * quantity) / 1000,
    6
  );
  const officialRows = clientPayload.officialCbamRows || {};

  return {
    ...clientPayload,
    productId: product.id,
    sku: {
      ...(clientPayload.sku || {}),
      id: product.id,
      sku: product.sku,
      name: product.name,
      units: quantity
    },
    generatedAt: new Date().toISOString(),
    carbonAuthority,
    carbonResults,
    totals: {
      ...(clientPayload.totals || {}),
      pcfKgPerUnit: round(total, 6),
      batchTonnes
    },
    breakdownRows: stageRows,
    pieData,
    esgRows: [
      { scope: 'Scope 1', tCO2e: round((Number(carbonResults.scope1) || 0) * quantity / 1000, 6), source: carbonAuthority.source },
      { scope: 'Scope 2', tCO2e: round((Number(carbonResults.scope2) || 0) * quantity / 1000, 6), source: carbonAuthority.source },
      { scope: 'Scope 3', tCO2e: round((Number(carbonResults.scope3) || 0) * quantity / 1000, 6), source: carbonAuthority.source }
    ],
    cbamRows: [
      { field: 'Calculation identity', value: carbonAuthority.calculationId },
      { field: 'Calculation version', value: carbonAuthority.calculationVersion },
      { field: 'Engine version', value: carbonAuthority.engineVersion },
      { field: 'Methodology version', value: carbonAuthority.methodologyVersion },
      { field: 'Factor registry version', value: carbonAuthority.factorRegistryVersion },
      { field: 'GWP basis', value: carbonAuthority.gwpBasis },
      { field: 'Canonical input hash', value: carbonAuthority.canonicalInputHash },
      { field: 'Legacy calculation', value: carbonAuthority.legacy ? 'yes' : 'no' },
      { field: 'Total embedded emissions', value: batchTonnes, unit: 'tCO2e' }
    ],
    officialCbamRows: {
      ...officialRows,
      B_EMINST: [
        { field: 'Scope 1 emissions', value: round((Number(carbonResults.scope1) || 0) * quantity / 1000, 6), unit: 'tCO2e' },
        { field: 'Scope 2 emissions', value: round((Number(carbonResults.scope2) || 0) * quantity / 1000, 6), unit: 'tCO2e' }
      ],
      SUMMARY_COMMUNICATION: [{
        sku: product.sku,
        embedded_tco2e: batchTonnes,
        calculation_id: carbonAuthority.calculationId,
        calculation_version: carbonAuthority.calculationVersion,
        determination: '(D)'
      }]
    },
    sources: Array.from(new Set([
      ...(Array.isArray(clientPayload.sources) ? clientPayload.sources : []),
      'WeaveCarbon server-authoritative product assessment snapshot'
    ]))
  };
};

module.exports = { buildOfficialReportPayload };
