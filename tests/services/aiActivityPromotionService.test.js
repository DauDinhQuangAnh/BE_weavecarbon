jest.mock('../../src/modules/shared/database', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));
jest.mock('../../src/modules/shared/auditing', () => ({ logAuditTrail: jest.fn() }));

const { AiActivityPromotionService } = require('../../src/modules/evidence');

describe('AiActivityPromotionService fail-closed gates', () => {
  test('turns malformed references into blocker codes without sending invalid UUIDs to PostgreSQL', async () => {
    const queryable = { query: jest.fn() };
    const service = new AiActivityPromotionService({}, jest.fn());

    await expect(service._referenceBlockers('company-1', {
      facilityRevisionId: 'not-a-uuid',
      processRevisionId: 'also-invalid',
      measurementPointRevisionId: 'still-invalid'
    }, queryable)).resolves.toEqual([
      'FACILITY_REFERENCE_INVALID',
      'PROCESS_REFERENCE_INVALID',
      'MEASUREMENT_POINT_REFERENCE_INVALID'
    ]);
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('accepts only a locked source whose checksum and extraction still match the review snapshot', () => {
    const service = new AiActivityPromotionService({}, jest.fn());
    const context = {
      review: {
        decision: 'approved_for_mapping',
        evidence_checksum_sha256: 'a'.repeat(64),
        extraction_snapshot: { quantity: 10, unit: 'kWh' },
        fields: [
          { field_path: 'quantity', decision: 'accepted' },
          { field_path: 'unit', decision: 'corrected' }
        ]
      },
      evidence: {
        status: 'locked',
        checksum_sha256: 'a'.repeat(64),
        file_size_bytes: 100,
        extracted_json: { unit: 'kWh', quantity: 10 }
      }
    };

    expect(service._contextGate(context)).toBeNull();
    context.evidence.extracted_json.quantity = 11;
    expect(service._contextGate(context)).toEqual(expect.objectContaining({
      blocked: true,
      code: 'AI_ACTIVITY_SOURCE_CHANGED'
    }));
  });

  test('rejects incomplete or rejected review field coverage', () => {
    const service = new AiActivityPromotionService({}, jest.fn());
    const context = {
      review: {
        decision: 'approved_for_mapping', evidence_checksum_sha256: 'a'.repeat(64),
        extraction_snapshot: { auditClaims: {}, quantity: 10, unit: 'kWh' },
        fields: [{ field_path: 'quantity', decision: 'accepted' }]
      },
      evidence: {
        status: 'locked', checksum_sha256: 'a'.repeat(64), file_size_bytes: 100,
        extracted_json: { unit: 'kWh', quantity: 10, auditClaims: {} }
      }
    };

    expect(service._contextGate(context)).toEqual(expect.objectContaining({
      code: 'AI_ACTIVITY_REVIEW_FIELD_COVERAGE_INVALID'
    }));
    context.review.fields.push({ field_path: 'unit', decision: 'rejected' });
    expect(service._contextGate(context)).toEqual(expect.objectContaining({
      code: 'AI_ACTIVITY_REVIEW_FIELD_COVERAGE_INVALID'
    }));
  });

  test('rejects promotion without a separate named-role attestation before database access', async () => {
    const database = { connect: jest.fn() };
    const service = new AiActivityPromotionService(database, jest.fn());

    await expect(service.promote('company-1', 'user-1', 'evidence-1', 'candidate-1', {
      promoterRole: 'evidence_ai_reviewer',
      attestation: 'too short'
    })).resolves.toEqual(expect.objectContaining({
      blocked: true,
      code: 'AI_ACTIVITY_PROMOTION_ATTESTATION_INVALID'
    }));
    expect(database.connect).not.toHaveBeenCalled();
  });

  test('caps additional evidence-match decisions before querying PostgreSQL', async () => {
    const service = new AiActivityPromotionService({}, jest.fn());
    const queryable = { query: jest.fn() };
    const requested = Array.from({ length: 100 }, (_item, index) => ({
      evidenceDocumentId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      relationship: 'supports_activity',
      decision: 'rejected',
      rationale: 'Reviewed and rejected for this activity.'
    }));

    await expect(service._evidenceMatches('company-1', { id: 'source-1' }, [], requested, queryable))
      .resolves.toEqual({ error: expect.objectContaining({ code: 'AI_ACTIVITY_EVIDENCE_MATCH_LIMIT_EXCEEDED' }) });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('scores only controlled same-tenant evidence with governed relationship signals', async () => {
    const service = new AiActivityPromotionService({}, jest.fn());
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [
      {
        id: '00000000-0000-4000-8000-000000000201', document_name: 'support.pdf',
        evidence_type: 'electricity_bill', status: 'locked', checksum_sha256: 'b'.repeat(64),
        file_size_bytes: 50, product_id: 'product-1', shipment_id: null, source_vendor: 'EVN',
        reporting_period_start: '2026-08-01', reporting_period_end: '2026-08-31'
      },
      {
        id: '00000000-0000-4000-8000-000000000202', document_name: 'factor.pdf',
        evidence_type: 'emission_factor_source', status: 'locked', checksum_sha256: 'c'.repeat(64),
        file_size_bytes: 50, product_id: 'product-1'
      }
    ] }) };

    const result = await service._evidenceMatchSuggestions('company-1', {
      id: 'source-1', evidence_type: 'electricity_bill', product_id: 'product-1', shipment_id: null,
      source_vendor: 'EVN', reporting_period_start: '2026-08-01', reporting_period_end: '2026-08-31'
    }, queryable);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      evidenceDocumentId: '00000000-0000-4000-8000-000000000201',
      relationship: 'supports_activity',
      confidence: 0.95
    }));
  });

  test('requires an explicit decision for every governed evidence-match suggestion', async () => {
    const service = new AiActivityPromotionService({}, jest.fn());
    const queryable = { query: jest.fn() };
    const suggested = [{ evidenceDocumentId: '00000000-0000-4000-8000-000000000211' }];

    await expect(service._evidenceMatches(
      'company-1',
      { id: '00000000-0000-4000-8000-000000000210' },
      suggested,
      [],
      queryable
    )).resolves.toEqual({
      error: expect.objectContaining({ code: 'AI_ACTIVITY_EVIDENCE_MATCH_DECISIONS_INCOMPLETE' })
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });
});
