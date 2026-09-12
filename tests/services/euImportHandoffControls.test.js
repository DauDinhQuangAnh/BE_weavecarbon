const {
  HANDOFF_SCHEMA,
  buildEuImportHandoffDataset,
  normalizeEuImportProfile,
  validateEuImportHandoff
} = require('../../src/services/euImportHandoffControls');

function fixture(lineCount = 1) {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    id: `line-${index + 1}`, lineNumber: index + 1, sku: `SKU-${index + 1}`,
    goodsDescription: `Cotton shirt style ${index + 1}`, hsCode: '62052000', originCountry: 'VN',
    quantity: 10, unit: 'PCE', unitPrice: 5, currency: 'USD', netWeightKg: 2, grossWeightKg: 2.2,
    packageRefs: ['CTN-1']
  }));
  return {
    shipment: { id: 'shipment-1', referenceNumber: 'VN-EU-1', originCountry: 'VN', destinationCountry: 'NL' },
    profile: {
      invoiceNumber: 'INV-1', invoiceDate: '2026-09-11', packingListNumber: 'PL-1',
      poContractId: 'PO-1', currency: 'USD', customsValueAmount: lineCount * 50,
      incotermCode: 'FOB', incotermLocation: 'Cat Lai', portOfLoading: 'Cat Lai',
      portOfDischarge: 'Rotterdam', placeOfDelivery: 'Rotterdam'
    },
    euImportProfile: normalizeEuImportProfile({
      memberStateCode: 'NL',
      importer: { name: 'EU Importer', address: 'Rotterdam', country: 'NL', eori: 'NL123456789012' },
      declarant: { name: 'EU Declarant', address: 'Rotterdam', country: 'NL', eori: 'NL123456789013' },
      representationType: 'none', customsOfficeCode: 'NL000123', declarationDatasetCode: 'H1',
      additionalDeclarationType: 'A', requestedProcedureCode: '40', previousProcedureCode: '00',
      modeOfTransportAtBorder: '1', inlandModeOfTransport: '3', borderTransportIdentity: 'MV CONTROLLED',
      placeOfGoodsCode: 'NLRTM01', deliveryTermsLocation: 'Rotterdam', valuationMethodCode: '1',
      exchangeRate: 0.85, customsValueCurrency: 'EUR', customsValueAmount: lineCount * 50,
      dutyTreatment: 'not_subject', vatTreatment: 'not_subject', restrictionStatus: 'not_required',
      preferenceClaimStatus: 'no_claim', guaranteeRequirementStatus: 'not_required',
      supportingDocuments: [
        { type: 'commercial_invoice', code: 'N380', reference: 'INV-1' },
        { type: 'packing_list', reference: 'PL-1' },
        { type: 'carrier_document', reference: 'BL-1' }
      ],
      targetSystemSchemaId: 'declarant.nl.import', targetSystemSchemaVersion: '2026.09'
    }),
    lines,
    euImportLineDetails: lines.map((line) => ({
      id: `detail-${line.id}`, exportLineId: line.id, taricCode: '6205200000',
      taricSource: 'EU TARIC', taricVersion: '2026-09-11', taricEffectiveDate: '2026-09-11',
      taricConfirmed: true, additionalCodes: [], nationalAdditionalCodes: [],
      requestedProcedureCode: '40', previousProcedureCode: '00'
    })),
    packages: [{
      packageNumber: 'CTN-1', packageType: 'carton', quantity: 1,
      netWeightKg: lineCount * 2, grossWeightKg: lineCount * 2.2,
      weightMeasurementBasis: 'per_package', containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1'
    }],
    containers: [{ containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1', equipmentType: '40HC' }],
    carrierDocuments: [{
      id: 'evidence-1', checksumSha256: 'a'.repeat(64),
      structured: { id: 'carrier-1', status: 'confirmed', documentType: 'bill_of_lading', documentNumber: 'BL-1', issuerName: 'Carrier' },
      latestReconciliation: { status: 'passed' }
    }],
    documents: [
      { id: 'invoice-doc-1', type: 'commercial_invoice', status: 'issued', payloadSha256: 'b'.repeat(64), fileSha256: 'c'.repeat(64) },
      { id: 'packing-doc-1', type: 'packing_list', status: 'issued', payloadSha256: 'd'.repeat(64), fileSha256: 'e'.repeat(64) }
    ]
  };
}

describe('R05 EU import declarant handoff controls', () => {
  const options = { isCarrierCurrent: () => true, isSupportingDocumentCurrent: () => true };

  test('validates every one of 25 TARIC-mapped lines without an implicit line cap', () => {
    const result = validateEuImportHandoff(fixture(25), options);
    expect(result.status).toBe('passed');
    expect(result.summary.goodsLineCount).toBe(25);
    expect(result.summary.mappedLineCount).toBe(25);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'line_25_taric10', status: 'ready' }),
      expect.objectContaining({ code: 'line_25_taric_confirmed', status: 'ready' }),
      expect.objectContaining({ code: 'carrier_document_reconciliation', status: 'ready' })
    ]));
  });

  test('fails closed without a national target schema or separately confirmed TARIC classification', () => {
    const snapshot = fixture();
    snapshot.euImportProfile.targetSystemSchemaId = '';
    snapshot.euImportLineDetails[0].taricConfirmed = false;
    const result = validateEuImportHandoff(snapshot, options);
    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'target_system_schema_id', status: 'missing' }),
      expect.objectContaining({ code: 'line_1_taric_confirmed', status: 'invalid' })
    ]));
  });

  test('rejects non-EU destinations and TARIC codes that break HS6 continuity', () => {
    const snapshot = fixture();
    snapshot.shipment.destinationCountry = 'US';
    snapshot.euImportLineDetails[0].taricCode = '6403990000';
    const result = validateEuImportHandoff(snapshot, options);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'destination_member_state_match', status: 'invalid' }),
      expect.objectContaining({ code: 'line_1_classification_continuity', status: 'invalid' })
    ]));
  });

  test('requires exact references for claimed preference, restrictions and guarantees', () => {
    const snapshot = fixture();
    Object.assign(snapshot.euImportProfile, {
      preferenceClaimStatus: 'claimed', restrictionStatus: 'required', guaranteeRequirementStatus: 'required'
    });
    const result = validateEuImportHandoff(snapshot, options);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'preference_references', status: 'invalid' }),
      expect.objectContaining({ code: 'restriction_references', status: 'invalid' }),
      expect.objectContaining({ code: 'guarantee_references', status: 'invalid' })
    ]));
  });

  test('builds an explicitly non-submittable EUCDM-referenced controlled dataset', () => {
    const snapshot = fixture(2);
    const reconciliation = validateEuImportHandoff(snapshot, options);
    const dataset = buildEuImportHandoffDataset(snapshot, {
      generatedAt: '2026-09-11T00:00:00.000Z', documentVersion: 1,
      sourceSnapshotSha256: 'f'.repeat(64), reconciliation
    });
    expect(dataset.schema).toEqual({ id: HANDOFF_SCHEMA.id, version: HANDOFF_SCHEMA.version });
    expect(dataset.eucdmReferenceVersion).toBe('7.0.11');
    expect(dataset.notForDirectSubmission).toBe(true);
    expect(dataset.authorityStatus).toBe('NOT_SUBMITTED');
    expect(dataset.warning).toMatch(/not a SAD/i);
    expect(dataset.goods).toHaveLength(2);
    expect(dataset.targetMapping).toMatchObject({
      memberStateCode: 'NL', targetSystemSchemaId: 'declarant.nl.import', targetSystemSchemaVersion: '2026.09'
    });
  });
});
