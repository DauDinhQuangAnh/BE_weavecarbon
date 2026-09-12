const {
  HANDOFF_SCHEMA,
  buildIcs2HandoffDataset,
  isDetailedDescription,
  normalizeIcs2Profile,
  validateIcs2Handoff
} = require('../../src/services/ics2HandoffControls');

const makeSnapshot = () => ({
  shipment: {
    id: '11111111-1111-4111-8111-111111111111',
    referenceNumber: 'VN-EU-R06-001', originCountry: 'VN', destinationCountry: 'DE'
  },
  profile: {
    billOfLadingNo: 'OOLU1234567890',
    exporter: { name: 'Weave VN', address: 'HCMC', country: 'VN' },
    importer: { name: 'Buyer GmbH', address: 'Berlin', country: 'DE' }
  },
  lines: [{
    id: '22222222-2222-4222-8222-222222222222', lineNumber: 1, sku: 'TEE-001',
    goodsDescription: 'Men knitted cotton T-shirts', hsCode: '610910', originCountry: 'VN',
    quantity: 100, unit: 'PCE', grossWeightKg: 120, packageRefs: ['CTN-001']
  }],
  packages: [{
    packageType: 'carton', quantity: 10, grossWeightKg: 12,
    weightMeasurementBasis: 'per_package'
  }],
  carrierDocuments: [{
    id: '33333333-3333-4333-8333-333333333333',
    latestReconciliation: { status: 'passed' }
  }],
  ics2Profile: normalizeIcs2Profile({
    transportMode: 'sea', messageDatasetCode: 'F11', filingRole: 'carrier',
    filingArrangement: 'multiple', localReferenceNumber: 'R06-LRN-001',
    sender: { name: 'Ocean Filer', address: 'Rotterdam', country: 'NL', eori: 'NL123456789' },
    declarant: { name: 'Ocean Carrier', address: 'Rotterdam', country: 'NL', eori: 'NL987654321' },
    customsOfficeFirstEntry: 'DE004851', firstEntryCountry: 'DE',
    estimatedArrivalAt: '2026-10-01T10:00:00Z', itineraryCountries: ['VN', 'DE'],
    conveyanceReference: 'VOY-2609',
    masterTransportDocument: { type: 'N705', number: 'OOLU1234567890' },
    activeBorderTransportMeans: { identificationType: 'IMO', identificationNumber: 'IMO9876543', nationality: 'PA' },
    containerIndicator: true, seals: ['SEAL-001'], paymentMethodCode: 'A',
    targetSystemSchemaId: 'carrier.ics2.r3.f11', targetSystemSchemaVersion: '2026.09',
    technicalPackageId: 'ICS2-EO-CTSS-R2-R3', technicalPackageVersion: 'accepted-by-filer-2026.09',
    messageNamespace: 'urn:wco:datamodel:eu:ics2:2',
    houseConsignments: [{
      id: 'HOUSE-1', transportDocumentType: 'N703', transportDocumentNumber: 'HBL-001',
      consignor: { name: 'Weave VN', address: 'HCMC', country: 'VN' },
      consignee: { name: 'Buyer GmbH', address: 'Berlin', country: 'DE' },
      buyer: { name: 'Buyer GmbH', address: 'Berlin', country: 'DE' },
      seller: { name: 'Weave VN', address: 'HCMC', country: 'VN' },
      destinationCountry: 'DE', placeOfDelivery: 'Berlin', grossMassKg: 120,
      packageCount: 10, goodsLineIds: ['22222222-2222-4222-8222-222222222222']
    }]
  })
});

describe('ICS2 filing handoff controls', () => {
  test('pins the controlled internal identity and rejects direct submission semantics', () => {
    const profile = normalizeIcs2Profile({ filingPurpose: 'direct_submission' });
    expect(profile).toMatchObject({
      schemaId: HANDOFF_SCHEMA.id,
      schemaVersion: HANDOFF_SCHEMA.version,
      filingPurpose: 'filer_handoff',
      ics2Release: 'R3',
      htiAgreementRef: 'EU-ICS2-TI-V2.0'
    });
  });

  test('accepts a reconciled F11 maritime master/house handoff', () => {
    const snapshot = makeSnapshot();
    const result = validateIcs2Handoff(snapshot, { isCarrierCurrent: () => true });
    expect(result.status).toBe('ready');
    expect(result.blockingCodes).toEqual([]);
  });

  test('rejects a dataset that does not match the border transport mode', () => {
    const snapshot = makeSnapshot();
    snapshot.ics2Profile.messageDatasetCode = 'F50';
    const result = validateIcs2Handoff(snapshot, { isCarrierCurrent: () => true });
    expect(result.blockingCodes).toContain('dataset_mode_compatibility');
  });

  test('requires each goods line exactly once at the lowest house level', () => {
    const snapshot = makeSnapshot();
    snapshot.ics2Profile.houseConsignments.push({
      ...snapshot.ics2Profile.houseConsignments[0], id: 'HOUSE-2', transportDocumentNumber: 'HBL-002'
    });
    const result = validateIcs2Handoff(snapshot, { isCarrierCurrent: () => true });
    expect(result.blockingCodes).toContain('line_1_house_assignment');
  });

  test.each(['goods', 'cargo', 'unknown', 'not available', 'textiles'])(
    'rejects generic goods description %s',
    (description) => expect(isDetailedDescription(description)).toBe(false)
  );

  test('builds a nested non-submittable dataset without fabricating an MRN', () => {
    const snapshot = makeSnapshot();
    const dataset = buildIcs2HandoffDataset(snapshot, {
      generatedAt: '2026-09-12T00:00:00.000Z', documentVersion: 1,
      sourceSnapshotSha256: 'a'.repeat(64), reconciliation: { status: 'ready' }
    });
    expect(dataset).toMatchObject({
      datasetNature: 'ICS2_FILER_HANDOFF_NOT_FOR_DIRECT_SUBMISSION',
      notForDirectSubmission: true,
      authorityStatus: 'NOT_SUBMITTED',
      filing: { messageDatasetCode: 'F11' }
    });
    expect(dataset.filing.houseConsignments[0].goodsItems[0]).toMatchObject({
      goodsDescription: 'Men knitted cotton T-shirts', hsCode: '610910'
    });
    expect(JSON.stringify(dataset)).not.toMatch(/"mrn"/i);
  });
});
