const {
  PublicEnvironmentalClaimService, claimMatchesPassportSurface, destinationCode
} = require('../../src/services/publicEnvironmentalClaimService');

const hash = 'a'.repeat(64);
const context = { companyId: 'company-1', shipmentId: 'shipment-1', shipmentReference: 'SHIP-1',
  destinationCountry: 'Netherlands', productId: 'product-1', productSku: 'SKU-1', calculationSha256: hash };
const input = { publicCommunication: true, channel: 'website', subjectType: 'product', subjectReference: 'product-1',
  marketCodes: ['NL'], methodology: { calculationSha256: hash }, exactClaimText: '4.5 kg CO2e cradle-to-gate.',
  specificationText: 'Internal boundary disclosed.', languageCode: 'en' };

describe('R18 public environmental-claim surface resolver', () => {
  test('requires an exact website subject, market and calculation binding', () => {
    expect(destinationCode('Netherlands')).toBe('NL');
    expect(claimMatchesPassportSurface({ input_snapshot: input }, context)).toBe(true);
    expect(claimMatchesPassportSurface({ input_snapshot: { ...input, channel: 'advertising' } }, context)).toBe(false);
    expect(claimMatchesPassportSurface({ input_snapshot: { ...input, subjectReference: 'product-2' } }, context)).toBe(false);
    expect(claimMatchesPassportSurface({ input_snapshot: { ...input,
      methodology: { calculationSha256: 'b'.repeat(64) } } }, context)).toBe(false);
    expect(claimMatchesPassportSurface({ input_snapshot: input }, {
      ...context, destinationCountry: 'unmapped market'
    })).toBe(false);
  });

  test('returns only a current approved latest revision with controlled evidence', async () => {
    const evidenceId = '10000000-0000-4000-8000-000000000001';
    const evidence = { id: evidenceId, checksumSha256: 'c'.repeat(64), fileSizeBytes: 100, status: 'locked', validTo: '2027-01-01' };
    const row = { id: 'dossier-1', claim_reference: 'CLAIM-1', revision: 2,
      communication_start: '2026-01-01', communication_end: '2027-01-01', ruleset_id: 'r18', ruleset_version: '1',
      result_sha256: 'd'.repeat(64), input_snapshot: input, result_snapshot: { automatedStatus: 'ready_for_legal_review' },
      evidence_snapshot: [evidence], latest_review: { decision: 'approved_for_publication', evidence_snapshot: [evidence] } };
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ id: evidenceId, checksum_sha256: evidence.checksumSha256,
        file_size_bytes: 100, status: 'locked', valid_to: '2027-01-01' }] }) };
    const service = new PublicEnvironmentalClaimService(database);
    const claims = await service.resolvePassportClaims(context);
    expect(claims).toEqual([expect.objectContaining({ dossierId: 'dossier-1', claimReference: 'CLAIM-1', revision: 2 })]);
    expect(database.query.mock.calls[0][0]).toContain('DISTINCT ON (dossier.claim_reference)');
    expect(database.query.mock.calls[0][1]).toEqual(['company-1', 'shipment-1']);
  });

  test('returns no public claim when evidence has drifted', async () => {
    const evidence = { id: '10000000-0000-4000-8000-000000000001', checksumSha256: 'c'.repeat(64),
      fileSizeBytes: 100, status: 'locked' };
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'dossier-1', claim_reference: 'CLAIM-1', revision: 1,
        communication_start: '2026-01-01', input_snapshot: input,
        result_snapshot: { automatedStatus: 'ready_for_legal_review' }, evidence_snapshot: [evidence],
        latest_review: { decision: 'approved_for_publication', evidence_snapshot: [evidence] } }] })
      .mockResolvedValueOnce({ rows: [{ id: evidence.id, checksum_sha256: 'e'.repeat(64),
        file_size_bytes: 100, status: 'locked', valid_to: null }] }) };
    await expect(new PublicEnvironmentalClaimService(database).resolvePassportClaims(context)).resolves.toEqual([]);
  });
});
