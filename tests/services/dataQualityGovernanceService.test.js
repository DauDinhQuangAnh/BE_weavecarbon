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

  test('checks DQL subjects against the real G2 revision tables (LOI-021)', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) };
    const service = new DataQualityGovernanceService(database);
    await expect(service._subjectExists('company-1', 'activity', 'KHONG-TON-TAI-999')).resolves.toBe(false);
    expect(database.query.mock.calls[0][0]).toContain('FROM industrial_activity_records');
    await expect(service._subjectExists('company-1', 'facility', 'FAC-BD-01')).resolves.toBe(true);
    expect(database.query.mock.calls[1][0]).toContain('FROM industrial_facility_revisions');
  });
});
