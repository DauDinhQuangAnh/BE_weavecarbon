const { evaluateEprAssessment, deriveEprStatus, isAnnexIvcCode } = require('../../src/services/euTextileEprControls');

const evidenceId = '10000000-0000-4000-8000-000000000001';
const evidence = [{ id: evidenceId, type: 'epr_pro_confirmation', name: 'mandate.pdf', sourceVendor: 'PRO',
  checksumSha256: 'a'.repeat(64), fileSizeBytes: 200, status: 'locked' }];
const actor = { name: 'Circular Textiles PRO', address: { street: '1 Main St', postalCode: '1000', city: 'Amsterdam', country: 'NL' },
  email: 'pro@invalid.example', phone: '', website: 'https://invalid.example', nationalIdentificationCode: 'PRO-NL-1',
  tradeRegisterNumber: 'TRADE-1', taxIdentificationNumber: 'TAX-1', mandateEvidenceIds: [evidenceId] };
const input = {
  assessmentReference: 'EPR-NL-2026', assessmentDate: '2026-09-13', memberState: 'NL',
  reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31', intendedUse: 'Internal EPR planning',
  producer: { legalName: 'Example VN', trademarks: ['Example'], brandNames: ['Example'],
    address: { street: '1 Factory Rd', postalCode: '700000', city: 'Ho Chi Minh City', country: 'VN' },
    email: 'epr@invalid.example', phone: '', website: 'https://invalid.example', contactPoint: 'Compliance team',
    nationalIdentificationCode: 'VN-1', tradeRegisterNumber: 'TRADE-VN-1', taxIdentificationNumber: 'TAX-VN-1',
    establishedCountry: 'VN', role: 'distance_seller', employeeCount: 20, annualTurnoverEur: 3000000,
    annualBalanceSheetEur: 2500000, suppliesUsedGoodsOnly: false, selfEmployedTailorCustomizedOnly: false,
    derivedFromUsedWasteOnly: false },
  authorizedRepresentative: { ...actor, applicable: false,
    nationalRuleBasis: 'National rule not encoded; specialist review required.', mandateEvidenceIds: [] },
  producerResponsibilityOrganisation: actor, cnCodes: ['62052000'],
  memberStateRule: { adapterId: 'NL-EPR-PLANNING', version: '2026-09', sourceUrl: 'https://government.example.invalid/epr',
    effectiveFrom: null, schemeStatus: 'unknown', competentAuthorityName: '', registerUrl: '',
    reportingSchedule: '', feeMethodStatus: 'pending', reviewEvidenceIds: [evidenceId] },
  declaredMarketRows: [{ cnCode: '62052000', quantity: 100, unit: 'PCE', weightKg: 50, productDescription: 'Cotton shirts' }],
  truthStatementConfirmed: true, evidenceDocumentIds: [evidenceId],
  limitations: 'EU-core planning only; national registration and fee rules not encoded.', notes: ''
};
const shipments = [{ lineId: 'line-1', shipmentId: 'shipment-1', invoiceDate: '2026-09-10', destinationCountry: 'NL',
  sku: 'SKU-1', productDescription: 'Cotton shirts', cnCode: '62052000', hsCodeConfirmed: true,
  quantity: 100, unit: 'PCE', weightKg: 50 }];

describe('R17 EU textile/footwear EPR controls', () => {
  test('encodes the Annex IVc baseline without treating excluded 63011000 as in scope', () => {
    expect(isAnnexIvcCode('6205 20 00')).toBe(true);
    expect(isAnnexIvcCode('6404 11 00')).toBe(true);
    expect(isAnnexIvcCode('6301 10 00')).toBe(false);
    expect(isAnnexIvcCode('9503 00 00')).toBe(false);
  });

  test('reconciles quantity and weight while retaining national adapter review', () => {
    const evaluated = evaluateEprAssessment(input, shipments, evidence);
    expect(evaluated.result.automatedStatus).toBe('specialist_review_required');
    expect(evaluated.result.totals).toEqual({ declaredQuantity: 100, declaredWeightKg: 50, systemQuantity: 100, systemWeightKg: 50 });
    expect(evaluated.result.reconciliation[0].status).toBe('matched');
    expect(evaluated.result.findings.map((item) => item.code)).toContain('EPR_NATIONAL_ADAPTER_INCOMPLETE');
    expect(evaluated.result.registrationStatus).toBe('not_externally_confirmed');
  });

  test('blocks an implemented national adapter claim when operational details are absent', () => {
    const evaluated = evaluateEprAssessment({ ...input, memberStateRule: { ...input.memberStateRule,
      schemeStatus: 'transposed' } }, shipments, evidence);
    const finding = evaluated.result.findings.find((item) => item.code === 'EPR_NATIONAL_ADAPTER_INCOMPLETE');
    expect(finding).toEqual(expect.objectContaining({ severity: 'blocker', path: 'memberStateRule' }));
    expect(evaluated.result.automatedStatus).toBe('needs_information');
  });

  test('blocks out-of-scope products, volume mismatch and invented truth statements', () => {
    const evaluated = evaluateEprAssessment({ ...input, cnCodes: ['95030000'], truthStatementConfirmed: false,
      declaredMarketRows: [{ ...input.declaredMarketRows[0], cnCode: '95030000', weightKg: 5 }] }, shipments, evidence);
    const codes = evaluated.result.findings.map((item) => item.code);
    expect(evaluated.result.automatedStatus).toBe('needs_information');
    expect(codes).toEqual(expect.arrayContaining(['EPR_CN_OUTSIDE_ANNEX_IVC', 'EPR_MARKET_VOLUME_MISMATCH', 'EPR_TRUTH_STATEMENT_REQUIRED']));
  });

  test('detects microenterprise transition and evidence drift after review/event', () => {
    const evaluated = evaluateEprAssessment({ ...input, producer: { ...input.producer, employeeCount: 5,
      annualTurnoverEur: 1000000, annualBalanceSheetEur: 1000000 } }, shipments, evidence);
    expect(evaluated.result.microenterprise).toBe(true);
    expect(evaluated.result.statutoryApplicationDate).toBe('2029-04-17');
    const assessment = { result: evaluated.result, latestReview: { decision: 'approved_for_internal_planning', evidenceSnapshot: evidence } };
    expect(deriveEprStatus(assessment, evidence, []).status).toBe('approved_for_internal_planning');
    expect(deriveEprStatus(assessment, [{ ...evidence[0], checksumSha256: 'b'.repeat(64) }], []).status).toBe('evidence_review_required');
  });
});
