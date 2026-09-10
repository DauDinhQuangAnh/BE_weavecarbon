const { normalizeCarrierDocument, sameSet, validateCarrierDocument } = require('../../src/services/carrierDocumentControls');

function shipmentSnapshot() {
  return {
    profile: {
      billOfLadingNo: 'OOLU-123', carrierName: 'Ocean Carrier', transportMode: 'sea',
      exporter: { name: 'VN Exporter' }, consignee: { name: 'EU Consignee' },
      portOfLoading: 'Cat Lai', portOfDischarge: 'Rotterdam', placeOfDelivery: 'Paris'
    },
    containers: [
      { containerNumber: 'TCLU1234567', sealNumber: 'SEAL-A' },
      { containerNumber: 'MSCU7654321', sealNumber: 'SEAL-B' }
    ],
    packages: [{
      packageType: 'pallet', quantity: 1, grossWeightKg: 100,
      weightMeasurementBasis: 'group_total', dimensionMeasurementBasis: 'group_total',
      lengthCm: 120, widthCm: 100, heightCm: 120
    }, {
      packageType: 'carton', quantity: 2, grossWeightKg: 50,
      weightMeasurementBasis: 'per_package', dimensionMeasurementBasis: 'per_package',
      lengthCm: 50, widthCm: 40, heightCm: 30
    }, {
      packageType: 'carton', quantity: 1, grossWeightKg: 25,
      weightMeasurementBasis: 'group_total', dimensionMeasurementBasis: 'group_total',
      lengthCm: 40, widthCm: 30, heightCm: 20
    }]
  };
}

function completeBillOfLading() {
  return {
    evidenceDocumentId: '00000000-0000-4000-8000-000000000001',
    documentType: 'bill_of_lading', contractLevel: 'direct', transportMode: 'sea',
    documentNumber: 'OOLU-123', issuerName: 'Ocean Carrier', issueDate: '2026-09-10',
    issuePlace: 'Ho Chi Minh City', shipper: { name: 'VN Exporter' },
    consignee: { name: 'EU Consignee' }, vesselName: 'MV Green', voyageNumber: 'V001',
    placeOfLoading: 'Cat Lai', placeOfDischarge: 'Rotterdam', placeOfDelivery: 'Paris',
    goodsDescription: 'Cotton shirts', packageCount: 3, packageType: 'carton',
    marksAndNumbers: 'PO-1', grossWeightKg: 125, measurementCbm: 0.144,
    containerNumbers: ['MSCU7654321', 'TCLU1234567'], sealNumbers: ['SEAL-B', 'SEAL-A'],
    freightTerms: 'prepaid', authenticationMethod: 'carrier digital signature',
    authenticationReference: 'SIGNATURE-REF-1', authenticityStatus: 'operator_confirmed',
    originalStatus: 'electronic', negotiable: false,
    evidence: {
      type: 'carrier_bill_of_lading', checksumSha256: 'a'.repeat(64), fileSizeBytes: 1234
    }
  };
}

describe('carrier document controls', () => {
  test('normalizes identifiers and sets without inventing metadata', () => {
    const normalized = normalizeCarrierDocument({
      document_type: 'BILL_OF_LADING', container_numbers: [' tclu1234567 ', 'TCLU1234567']
    });
    expect(normalized.documentType).toBe('bill_of_lading');
    expect(normalized.containerNumbers).toEqual(['TCLU1234567']);
    expect(normalized.authenticityStatus).toBe('unverified');
    expect(sameSet(['seal-b', 'SEAL-A'], ['seal-a', 'SEAL-B'])).toBe(true);
  });

  test('passes a complete B/L only when carrier totals and equipment exactly reconcile', () => {
    const result = validateCarrierDocument(shipmentSnapshot(), completeBillOfLading());
    expect(result.status).toBe('passed');
    expect(result.summary).toMatchObject({
      expectedPackageCount: 3,
      expectedGrossWeightKg: 125,
      expectedContainerNumbers: ['MSCU7654321', 'TCLU1234567']
    });
    expect(result.checks.every((check) => check.status === 'ready')).toBe(true);
  });

  test('blocks mismatched containers, seals, packages, weight and authenticity', () => {
    const document = completeBillOfLading();
    document.packageCount = 2;
    document.grossWeightKg = 120;
    document.containerNumbers = ['TCLU1234567'];
    document.sealNumbers = ['WRONG'];
    document.authenticityStatus = 'unverified';
    const result = validateCarrierDocument(shipmentSnapshot(), document);
    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'package_count_reconciliation', status: 'invalid' }),
      expect.objectContaining({ code: 'gross_weight_reconciliation', status: 'invalid' }),
      expect.objectContaining({ code: 'container_reconciliation', status: 'invalid' }),
      expect.objectContaining({ code: 'seal_reconciliation', status: 'invalid' }),
      expect.objectContaining({ code: 'authenticity_status', status: 'invalid' })
    ]));
  });

  test.each([
    ['bill_of_lading', 'air'], ['fbl', 'sea'], ['air_waybill', 'road'], ['cmr', 'rail'], ['cim', 'sea']
  ])('rejects %s for incompatible mode %s', (documentType, transportMode) => {
    const document = completeBillOfLading();
    document.documentType = documentType;
    document.transportMode = transportMode;
    document.evidence.type = documentType;
    const result = validateCarrierDocument(shipmentSnapshot(), document);
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'document_mode_compatibility', status: 'invalid' }));
  });

  test('requires an 11-digit AWB and air-specific flight fields', () => {
    const document = completeBillOfLading();
    Object.assign(document, {
      documentType: 'air_waybill', transportMode: 'air', documentNumber: '123-1234567',
      placeOfDelivery: 'CDG', flightNumber: '', originalStatus: 'electronic'
    });
    document.evidence.type = 'air_waybill';
    const result = validateCarrierDocument({ ...shipmentSnapshot(), profile: { ...shipmentSnapshot().profile,
      billOfLadingNo: '123-1234567', transportMode: 'air', placeOfDelivery: 'CDG' } }, document);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'air_waybill_number_format', status: 'invalid' }),
      expect.objectContaining({ code: 'flight_number', status: 'missing' })
    ]));
  });
});
