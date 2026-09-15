const { DataQualityGovernanceService } = require('../../src/services/dataQualityGovernanceService');

const companyId = '10000000-0000-4000-8000-000000000001';
describe('G2-02 governance persistence', () => {
  test('tenant-scopes DQL listings', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: companyId }] }).mockResolvedValueOnce({ rows: [] }) };
    expect(await new DataQualityGovernanceService(database).listDql(companyId)).toEqual([]);
    expect(database.query.mock.calls[1][1]).toEqual([companyId]);
  });
  test('rejects malformed proposal ids before querying', async () => {
    const database = { query: jest.fn() };
    expect(await new DataQualityGovernanceService(database).reviewFactorProposal(companyId, 'bad-id', 'user', {})).toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });
});
