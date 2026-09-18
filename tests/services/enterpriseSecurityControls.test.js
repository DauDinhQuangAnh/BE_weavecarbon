const controls = require('../../src/services/enterpriseSecurityControls');
const {
  EnterpriseSecurityService,
  EXPECTED_MIGRATION
} = require('../../src/services/enterpriseSecurityService');

const evidenceId = '12345678-1234-4234-8234-123456789abc';
const sha = 'a'.repeat(64);
const digest = `sha256:${'b'.repeat(64)}`;

describe('G2-13 enterprise security controls', () => {
  test('active OIDC configuration requires external secret reference and all validation checks', () => {
    const valid = {
      connectionReference: 'entra-production',
      protocol: 'oidc',
      issuerUrl: 'https://login.example.com/tenant/v2.0',
      authorizationEndpoint: 'https://login.example.com/oauth2/authorize',
      tokenEndpoint: 'https://login.example.com/oauth2/token',
      jwksUri: 'https://login.example.com/discovery/keys',
      clientId: 'weavecarbon-production',
      clientSecretReference: 'vault://weavecarbon/oidc/client-secret',
      allowedEmailDomains: ['example.com'],
      scopes: ['openid', 'email', 'profile'],
      validationChecks: {
        discoveryValidated: true,
        jwksValidated: true,
        idTokenValidationValidated: true,
        loginRoundTripValidated: true
      },
      status: 'active',
      evidenceDocumentId: evidenceId
    };
    expect(controls.sso(valid).errors).toEqual([]);
    expect(controls.sso({ ...valid, clientSecretReference: 'actual-secret' }).errors.join(' '))
      .toMatch(/external secret-manager URI/);
    expect(controls.sso({
      ...valid,
      validationChecks: { ...valid.validationChecks, loginRoundTripValidated: false }
    }).errors).toContain('An active connection requires all OIDC validation checks.');
  });

  test('policy, key and incident inputs retain governed evidence and lifecycle bounds', () => {
    expect(controls.policy({
      policyReference: 'default', requireMfaForAdmins: true, ssoMode: 'required',
      sessionIdleMinutes: 30, dataRetentionDays: 2555, approvalStatus: 'approved',
      rationale: 'Approved enterprise security baseline.', evidenceDocumentId: evidenceId
    }).errors).toEqual([]);
    expect(controls.keyEvent({
      keyReference: 'mfa-key-v1', purpose: 'mfa_encryption', provider: 'Vault',
      externalSecretReference: 'vault://weavecarbon/mfa/key-v1', keyVersion: '1',
      lifecycleStatus: 'active', effectiveAt: '2026-09-18T00:00:00Z',
      rotationDueAt: '2026-12-18T00:00:00Z', reason: 'Initial activation.',
      evidenceDocumentId: evidenceId
    }).errors).toEqual([]);
    expect(controls.incident({
      incidentReference: 'INC-2026-001', eventType: 'detected', severity: 'high',
      occurredAt: '2026-09-18T01:00:00Z', owner: 'Security lead',
      summary: 'Detection record.', personalDataInvolved: false,
      regulatoryNotificationRequired: false, evidenceDocumentId: evidenceId
    }).errors).toEqual([]);
  });

  test('production acceptance requires immutable release identifiers and structured evidence', () => {
    const valid = {
      releaseReference: '2026.09.18-1', backendCommitSha: 'c'.repeat(40),
      frontendCommitSha: 'd'.repeat(40), backendImageDigest: digest,
      frontendImageDigest: digest, highestMigration: EXPECTED_MIGRATION,
      ciRunUrl: 'https://github.com/example/actions/runs/1', rollbackImageDigest: digest,
      backupRestoreReportSha256: sha, smokeResults: {}, securityScanSummary: {},
      decision: 'blocked', decisionRationale: 'Awaiting production verification.',
      evidenceDocumentId: evidenceId
    };
    expect(controls.acceptance(valid).errors).toEqual([]);
    expect(controls.acceptance({ ...valid, backendCommitSha: 'short' }).errors.join(' '))
      .toMatch(/40-character/);
  });

  test('accepted production records are blocked if any runtime or scan gate fails', async () => {
    const database = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM evidence_documents')) return { rows: [{
          id: evidenceId, document_name: 'release.json', status: 'locked',
          checksum_sha256: sha, file_size_bytes: 100
        }] };
        if (sql.includes('FROM schema_migrations')) return { rows: [{ name: EXPECTED_MIGRATION }] };
        throw new Error(`Unexpected query: ${sql}`);
      })
    };
    const service = new EnterpriseSecurityService(database);
    service.getPosture = jest.fn().mockResolvedValue({
      policy: { approvalStatus: 'approved', requireMfaForAdmins: true, ssoMode: 'required' },
      adminMfa: { total: 1, enabled: 1 }, activeSsoConnections: 1,
      overdueKeys: 0, openIncidents: 0
    });
    const input = {
      releaseReference: '2026.09.18-1', backendCommitSha: 'c'.repeat(40),
      frontendCommitSha: 'd'.repeat(40), backendImageDigest: digest,
      frontendImageDigest: digest, highestMigration: EXPECTED_MIGRATION,
      ciRunUrl: 'https://github.com/example/actions/runs/1', rollbackImageDigest: digest,
      backupRestoreReportSha256: sha,
      smokeResults: {
        health: true, readiness: true, capability: true, authentication: true,
        tenantIsolation: false, migration: true, rollbackAvailable: true
      },
      securityScanSummary: { unresolvedCritical: 0, unresolvedHigh: 0 },
      decision: 'accepted', decisionRationale: 'Release passed.', evidenceDocumentId: evidenceId
    };
    await expect(service.createAcceptanceRun('company-1', 'user-1', input))
      .resolves.toMatchObject({
        blocked: true,
        code: 'PRODUCTION_ACCEPTANCE_GATES_FAILED',
        details: { failedGates: expect.arrayContaining(['tenantIsolation']) }
      });
  });
});
