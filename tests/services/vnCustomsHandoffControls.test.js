const {
  HANDOFF_SCHEMA,
  buildVnCustomsHandoffDataset,
  normalizeVnCustomsProfile,
  validateVnCustomsHandoff
} = require('../../src/services/vnCustomsHandoffControls');

function fixture(lineCount = 1) {
  return {
    shipment: { id: 'shipment-1', referenceNumber: 'VN-EU-1', originCountry: 'VN', destinationCountry: 'DE' },
    profile: {
      invoiceNumber: 'INV-1', invoiceDate: '2026-09-10', packingListNumber: 'PL-1',
      poContractId: 'PO-1', currency: 'USD', incotermCode: 'FOB', incotermLocation: 'Cat Lai',
      incotermVersion: 'Incoterms 2020', customsValueAmount: lineCount * 50,
      customsValueBasis: 'Invoice transaction value', freightAmount: 0, insuranceAmount: 0,
      surchargeAmount: 0, discountAmount: 0, transportMode: 'sea', carrierName: 'Carrier',
      portOfLoading: 'Cat Lai', portOfDischarge: 'Hamburg', placeOfDelivery: 'Hamburg',
      exporter: { name: 'VN Exporter', address: 'HCMC', country: 'VN' },
      importer: { name: 'EU Importer', address: 'Berlin', country: 'DE' },
      consignee: { name: 'EU Consignee', address: 'Hamburg', country: 'DE' },
      notifyParty: {}
    },
    vnCustomsProfile: normalizeVnCustomsProfile({
      declarant: { name: 'VN Exporter', taxId: '0312345678', address: 'HCMC', role: 'exporter' },
      customsBroker: { name: 'Broker Co', taxId: '0300000001', code: 'BROKER01' },
      customsOfficeCode: '02CI', declarationTypeCode: 'B11', cargoClassificationCode: 'A',
      transportMethodCode: '1', exitCustomsOfficeCode: '02CI', loadingLocationCode: 'VNSGN',
      destinationCountryCode: 'DE', invoiceClassificationCode: 'A', invoicePaymentMethodCode: 'TTR',
      exchangeRate: 25000, permitRequirementStatus: 'not_required', inspectionRequirementStatus: 'not_required',
      taxTreatment: 'not_subject', supportingDocuments: [
        { type: 'commercial_invoice', reference: 'INV-1' },
        { type: 'packing_list', reference: 'PL-1' }
      ],
      brokerTargetSchemaId: 'broker.vnaccs-import', brokerTargetSchemaVersion: '2026.1'
    }),
    lines: Array.from({ length: lineCount }, (_, index) => ({
      lineNumber: index + 1, sku: `SKU-${index + 1}`, goodsDescription: `Cotton shirt style ${index + 1}`,
      hsCode: '62052000', hsCodeSource: 'Vietnam tariff', hsCodeRuleset: 'AHTN-2022',
      hsCodeEffectiveDate: '2026-01-01', hsCodeConfirmed: true, originCountry: 'VN',
      quantity: 10, unit: 'PCE', unitPrice: 5, currency: 'USD', netWeightKg: 2, grossWeightKg: 2.2
    })),
    packages: [{
      packageNumber: 'CTN-1', packageType: 'carton', marksAndNumbers: 'PO-1', quantity: 1,
      netWeightKg: lineCount * 2, grossWeightKg: lineCount * 2.2,
      weightMeasurementBasis: 'per_package', containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1', contents: []
    }],
    containers: [{ containerNumber: 'TCLU1234567', sealNumber: 'SEAL-1', equipmentType: '40HC' }],
    carrierDocuments: [{
      id: 'evidence-1', checksumSha256: 'a'.repeat(64),
      structured: {
        id: 'carrier-1', status: 'confirmed', documentType: 'bill_of_lading',
        documentNumber: 'BL-1', issuerName: 'Carrier'
      },
      latestReconciliation: { status: 'passed' }
    }],
    documents: [
      { id: 'invoice-doc-1', type: 'commercial_invoice', status: 'issued', payloadSha256: 'b'.repeat(64), fileSha256: 'c'.repeat(64) },
      { id: 'packing-doc-1', type: 'packing_list', status: 'issued', payloadSha256: 'd'.repeat(64), fileSha256: 'e'.repeat(64) }
    ]
  };
}

describe('R04 Vietnam customs broker handoff controls', () => {
  test('passes a complete broker-mapped dataset and evaluates every goods line', () => {
    const snapshot = fixture(25);
    const result = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: (item) => item.latestReconciliation?.status === 'passed',
      isSupportingDocumentCurrent: () => true
    });

    expect(result.status).toBe('passed');
    expect(result.summary.goodsLineCount).toBe(25);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'line_25_vn_hs8', status: 'ready' }),
      expect.objectContaining({ code: 'carrier_document_reconciliation', status: 'ready' }),
      expect.objectContaining({ code: 'invoice_customs_value_reconciliation', status: 'ready' })
    ]));
  });

  test('fails closed without a broker target schema or with a non-8-digit Vietnam tariff code', () => {
    const snapshot = fixture();
    snapshot.vnCustomsProfile.brokerTargetSchemaId = '';
    snapshot.lines[0].hsCode = '620520';
    const result = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: () => true, isSupportingDocumentCurrent: () => true
    });

    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'broker_target_schema_id', status: 'missing' }),
      expect.objectContaining({ code: 'line_1_vn_hs8', status: 'invalid' })
    ]));
  });

  test('requires referenced proof when a permit or specialised inspection applies', () => {
    const snapshot = fixture();
    snapshot.vnCustomsProfile.permitRequirementStatus = 'required';
    snapshot.vnCustomsProfile.inspectionRequirementStatus = 'required';
    const result = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: () => true, isSupportingDocumentCurrent: () => true
    });

    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'permit_references', status: 'invalid' }),
      expect.objectContaining({ code: 'inspection_references', status: 'invalid' })
    ]));
  });

  test('produces an explicitly non-submission payload with versioned legal and mapping identity', () => {
    const snapshot = fixture(2);
    const reconciliation = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: () => true, isSupportingDocumentCurrent: () => true
    });
    const dataset = buildVnCustomsHandoffDataset(snapshot, {
      generatedAt: '2026-09-10T00:00:00.000Z', documentVersion: 1,
      sourceSnapshotSha256: 'b'.repeat(64), reconciliation
    });

    expect(dataset.schema).toEqual({ id: HANDOFF_SCHEMA.id, version: HANDOFF_SCHEMA.version });
    expect(dataset.notForDirectSubmission).toBe(true);
    expect(dataset.authorityStatus).toBe('NOT_SUBMITTED');
    expect(dataset.warning).toMatch(/not a VNACCS message/i);
    expect(dataset.goods).toHaveLength(2);
    expect(dataset.brokerMapping).toMatchObject({ targetSchemaId: 'broker.vnaccs-import', targetSchemaVersion: '2026.1' });
    expect(dataset.supportingDocuments.controlledIssuedDocuments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'invoice-doc-1', type: 'commercial_invoice' }),
      expect.objectContaining({ id: 'packing-doc-1', type: 'packing_list' })
    ]));
  });

  test('fails closed when an issued invoice or packing list is not current', () => {
    const snapshot = fixture();
    const result = validateVnCustomsHandoff(snapshot, {
      isCarrierCurrent: () => true,
      isSupportingDocumentCurrent: (document) => document.type === 'commercial_invoice'
    });

    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'packing_list_issued_current', status: 'missing' })
    ]));
  });
});
