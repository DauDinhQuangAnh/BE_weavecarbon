const { DynamicAllocationService } = require('../../src/services/dynamicAllocationService');

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const ruleId = '30000000-0000-4000-8000-000000000001';
const activityId = '40000000-0000-4000-8000-000000000001';
const processId = '50000000-0000-4000-8000-000000000001';

describe('G2 dynamic allocation service', () => {
  test('lists rules inside the active tenant only', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await new DynamicAllocationService(database).listRules(companyId)).toEqual([]);
    expect(database.query.mock.calls[0][1]).toEqual([companyId]);
  });

  test('does not run a draft rule', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: ruleId, company_id: companyId, facility_revision_id: companyId, approval_status: 'draft'
    }] }) };
    const result = await new DynamicAllocationService(database).createRun(companyId, userId, {
      ruleRevisionId: ruleId, sourceActivityId: activityId,
      targets: [{ targetEntityId: processId, driverValue: 1 }]
    });
    expect(result.code).toBe('INDUSTRIAL_ALLOCATION_RULE_NOT_APPROVED');
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  test('rejects targets outside the company or facility', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const service = new DynamicAllocationService(database);
    const result = await service.resolveTargets(companyId, {
      target_level: 'process', facility_revision_id: companyId
    }, [{ targetEntityId: processId, driverValue: 1 }]);
    expect(result.code).toBe('INDUSTRIAL_ALLOCATION_TARGET_INVALID');
    expect(database.query.mock.calls[0][1]).toEqual([companyId, companyId, [processId]]);
  });
});
