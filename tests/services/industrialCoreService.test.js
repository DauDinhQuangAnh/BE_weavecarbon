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
});
