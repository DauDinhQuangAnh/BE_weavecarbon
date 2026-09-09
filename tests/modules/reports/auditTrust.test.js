const {
  createAuditIssuanceSignature,
  createAuditShareToken,
  deriveExternalAssuranceStatus,
  normalizeAuditShareToken,
  verifyAuditIssuanceSignature
} = require('../../../src/modules/reports/auditTrust');

describe('Audit Pack trust controls', () => {
  test('signs and verifies the exact canonical issuance payload', () => {
    const signature = createAuditIssuanceSignature({
      companyId: 'company-1',
      auditBundleId: 'bundle-1',
      manifestSha256: 'a'.repeat(64),
      bundleSha256: 'b'.repeat(64),
      assertion: 'Internal assertion',
      criteria: 'Criteria v1',
      signerId: 'user-1',
      signerName: 'Signer One',
      signerEmail: 'signer@example.test',
      signedAt: '2026-09-10T00:00:00.000Z'
    });

    expect(verifyAuditIssuanceSignature(signature)).toBe(true);
    expect(verifyAuditIssuanceSignature({
      ...signature,
      signaturePayload: { ...signature.signaturePayload, assertion: 'Changed' }
    })).toBe(false);
    expect(verifyAuditIssuanceSignature({
      ...signature,
      id: 'different-bundle',
      issuance_id: 'issuance-1',
      manifest_sha256: 'a'.repeat(64),
      bundle_sha256: 'b'.repeat(64)
    })).toBe(false);
  });

  test('generates opaque tokens while exposing only a stable hash for storage', () => {
    const first = createAuditShareToken();
    const second = createAuditShareToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.token).not.toBe(second.token);
    expect(normalizeAuditShareToken(first.token)).toBe(first.token);
    expect(normalizeAuditShareToken('not-a-token')).toBeNull();
  });

  test.each([
    ['requested', 'not_verified'],
    ['evidence_received', 'not_verified'],
    ['limited_assurance', 'limited_assurance'],
    ['reasonable_assurance', 'reasonable_assurance'],
    ['qualified', 'qualified'],
    ['adverse', 'adverse'],
    ['withdrawn', 'withdrawn']
  ])('maps external outcome %s without inventing assurance', (outcome, expected) => {
    expect(deriveExternalAssuranceStatus({ outcome })).toBe(expected);
  });

  test('does not present an expired assurance record as current', () => {
    expect(deriveExternalAssuranceStatus({
      outcome: 'reasonable_assurance', validTo: '2000-01-01'
    })).toBe('expired');
  });
});
