const { IndustrialCoreService } = require('../../src/services/industrialCoreService');

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';

describe('G2 industrial core persistence', () => {
  test('tenant-scopes facility listings', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: companyId }] }).mockResolvedValueOnce({ rows: [] }) };
    const service = new IndustrialCoreService(database);
    expect(await service.listFacilities(companyId)).toEqual([]);
    expect(database.query.mock.calls[1][1]).toEqual([companyId]);
  });

  test('does not write an invalid facility', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: companyId }] }), connect: jest.fn() };
    const result = await new IndustrialCoreService(database).createFacility(companyId, userId, { name: 'No reference' });
    expect(result.code).toBe('INDUSTRIAL_FACILITY_INVALID');
    expect(database.connect).not.toHaveBeenCalled();
  });

  test('caps activity list size and scopes the query to the active company', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: companyId }] }).mockResolvedValueOnce({ rows: [] }) };
    const service = new IndustrialCoreService(database);
    await service.listActivities(companyId, 9999);
    expect(database.query.mock.calls[1][1]).toEqual([companyId, 500]);
  });

  test('rejects a manual activity when its provenance does not match sourceSha256', async () => {
    const facilityRevisionId = '30000000-0000-4000-8000-000000000001';
    const database = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ id: companyId }] }),
      connect: jest.fn()
    };
    const result = await new IndustrialCoreService(database).createActivity(companyId, userId, {
      activityReference: 'ACT-HASH', facilityRevisionId, activityType: 'electricity',
      periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-30T23:59:59.000Z', quantity: 100,
      canonicalUnit: 'kWh', sourceKind: 'manual', dataQualityLevel: 'L3', sourceSha256: 'a'.repeat(64),
      rawPayload: { entryMode: 'carbon_operations_manual', provenance: { activityReference: 'ACT-HASH' } }
    });
    expect(result.code).toBe('INDUSTRIAL_ACTIVITY_PROVENANCE_MISMATCH');
    expect(database.connect).not.toHaveBeenCalled();
  });

  test('rejects an activity whose process belongs to another facility revision', async () => {
    const facilityRevisionId = '30000000-0000-4000-8000-000000000001';
    const otherFacilityRevisionId = '30000000-0000-4000-8000-000000000002';
    const processRevisionId = '40000000-0000-4000-8000-000000000001';
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: companyId }] })
        .mockResolvedValueOnce({ rows: [{ id: facilityRevisionId }] })
        .mockResolvedValueOnce({ rows: [{ id: processRevisionId, facility_revision_id: otherFacilityRevisionId }] }),
      connect: jest.fn()
    };
    const result = await new IndustrialCoreService(database).createActivity(companyId, userId, {
      activityReference: 'ACT-1', facilityRevisionId, processRevisionId, activityType: 'electricity',
      periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-30T23:59:59.000Z', quantity: 100,
      canonicalUnit: 'kWh', sourceKind: 'manual', dataQualityLevel: 'L3', sourceSha256: 'a'.repeat(64)
    });
    expect(result.code).toBe('INDUSTRIAL_ACTIVITY_REFERENCE_MISMATCH');
    expect(database.connect).not.toHaveBeenCalled();
  });

  test('rejects a process-bound measurement point when its process is omitted', async () => {
    const facilityRevisionId = '30000000-0000-4000-8000-000000000001';
    const pointRevisionId = '50000000-0000-4000-8000-000000000001';
    const pointProcessRevisionId = '40000000-0000-4000-8000-000000000001';
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: companyId }] })
        .mockResolvedValueOnce({ rows: [{ id: facilityRevisionId }] })
        .mockResolvedValueOnce({ rows: [{
          id: pointRevisionId,
          facility_revision_id: facilityRevisionId,
          process_revision_id: pointProcessRevisionId
        }] }),
      connect: jest.fn()
    };
    const result = await new IndustrialCoreService(database).createActivity(companyId, userId, {
      activityReference: 'ACT-2', facilityRevisionId, measurementPointRevisionId: pointRevisionId,
      activityType: 'electricity', periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-09-30T23:59:59.000Z', quantity: 100, canonicalUnit: 'kWh',
      sourceKind: 'manual', dataQualityLevel: 'L3', sourceSha256: 'b'.repeat(64)
    });
    expect(result.code).toBe('INDUSTRIAL_ACTIVITY_REFERENCE_MISMATCH');
    expect(database.connect).not.toHaveBeenCalled();
  });

  test('rejects activity approval when controlled evidence has no SHA-256 checksum', async () => {
    const activityId = '50000000-0000-4000-8000-000000000001';
    const database = { query: jest.fn() };
    const service = new IndustrialCoreService(database);
    jest.spyOn(service, 'getActivityLineage').mockResolvedValue({
      activity: { id: activityId, sourceSha256: 'a'.repeat(64) },
      evidence: [{ id: '60000000-0000-4000-8000-000000000001', status: 'locked', checksumSha256: null }]
    });
    const result = await service.reviewActivity(companyId, activityId, userId, {
      reviewerRole: 'industrial_activity_reviewer', decision: 'approved', notes: 'Reviewed source evidence.'
    });
    expect(result.code).toBe('INDUSTRIAL_ACTIVITY_EVIDENCE_NOT_LOCKED');
    expect(database.query).not.toHaveBeenCalled();
  });
});
