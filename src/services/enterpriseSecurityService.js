const pool = require('../config/database');
const controls = require('./enterpriseSecurityControls');

const EXPECTED_MIGRATION = '051_g2_enterprise_security_acceptance.sql';
const REQUIRED_SMOKE_GATES = [
  'health', 'readiness', 'capability', 'authentication',
  'tenantIsolation', 'migration', 'rollbackAvailable'
];
const blocked = (code, message, status = 422, details = undefined) => ({
  blocked: true, code, message, status, ...(details ? { details } : {})
});
const evidenceSnapshot = (row) => ({
  id: row.id,
  name: row.document_name,
  status: row.status,
  checksumSha256: row.checksum_sha256,
  fileSizeBytes: Number(row.file_size_bytes)
});
const evidenceValid = (row) => row && ['locked', 'third_party_verified'].includes(row.status) &&
  /^[a-f0-9]{64}$/i.test(row.checksum_sha256 || '') && Number(row.file_size_bytes) > 0;
const camelRow = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()), value
]));

class EnterpriseSecurityService {
  constructor(database = pool) { this.database = database; }

  async _evidence(companyId, evidenceId, client = this.database) {
    const result = await client.query(
      `SELECT id,document_name,status,checksum_sha256,file_size_bytes
       FROM evidence_documents WHERE id=$1 AND company_id=$2`,
      [evidenceId, companyId]
    );
    return evidenceValid(result.rows[0]) ? result.rows[0] : null;
  }

  async _adminMfaCoverage(companyId, client = this.database) {
    const result = await client.query(
      `SELECT cm.user_id,u.email,
              EXISTS (
                SELECT 1 FROM user_mfa_factor_revisions enabled
                WHERE enabled.user_id=cm.user_id AND enabled.status='enabled'
                  AND enabled.revision > COALESCE((
                    SELECT MAX(disabled.revision) FROM user_mfa_factor_revisions disabled
                    WHERE disabled.user_id=cm.user_id AND disabled.status='disabled'
                  ),0)
              ) AS mfa_enabled
       FROM company_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.company_id=$1 AND cm.status='active' AND cm.role='admin'
       ORDER BY u.email`,
      [companyId]
    );
    return {
      total: result.rows.length,
      enabled: result.rows.filter((row) => row.mfa_enabled).length,
      missing: result.rows.filter((row) => !row.mfa_enabled).map((row) => ({
        userId: row.user_id, email: row.email
      }))
    };
  }

  async _hasActiveSso(companyId, client = this.database) {
    const result = await client.query(
      `SELECT s.id FROM enterprise_sso_connection_revisions s
       JOIN evidence_documents e ON e.id=s.evidence_document_id AND e.company_id=s.company_id
       WHERE s.company_id=$1 AND s.status='active'
         AND s.revision=(SELECT MAX(newer.revision) FROM enterprise_sso_connection_revisions newer
                         WHERE newer.company_id=s.company_id AND newer.connection_reference=s.connection_reference)
         AND e.status IN ('locked','third_party_verified')
         AND e.checksum_sha256=s.evidence_snapshot->>'checksumSha256' AND e.file_size_bytes>0
         AND (s.validation_checks->>'discoveryValidated')::boolean
         AND (s.validation_checks->>'jwksValidated')::boolean
         AND (s.validation_checks->>'idTokenValidationValidated')::boolean
         AND (s.validation_checks->>'loginRoundTripValidated')::boolean
       LIMIT 1`,
      [companyId]
    );
    return Boolean(result.rows[0]);
  }

  async getPosture(companyId) {
    const [policy, sso, keys, incidents, acceptance, adminMfa, hasValidatedSso] = await Promise.all([
      this.database.query(
        `SELECT * FROM enterprise_security_policy_revisions WHERE company_id=$1
         ORDER BY created_at DESC,id DESC LIMIT 1`, [companyId]),
      this.database.query(
        `SELECT DISTINCT ON (connection_reference) * FROM enterprise_sso_connection_revisions
         WHERE company_id=$1 ORDER BY connection_reference,revision DESC`, [companyId]),
      this.database.query(
        `SELECT DISTINCT ON (key_reference) * FROM enterprise_key_lifecycle_events
         WHERE company_id=$1 ORDER BY key_reference,revision DESC`, [companyId]),
      this.database.query(
        `SELECT DISTINCT ON (incident_reference) * FROM enterprise_security_incident_events
         WHERE company_id=$1 ORDER BY incident_reference,revision DESC`, [companyId]),
      this.database.query(
        `SELECT * FROM production_acceptance_runs WHERE company_id=$1
         ORDER BY created_at DESC,id DESC LIMIT 1`, [companyId]),
      this._adminMfaCoverage(companyId),
      this._hasActiveSso(companyId)
    ]);
    const latestPolicy = policy.rows[0] || null;
    const activeSso = hasValidatedSso
      ? sso.rows.filter((row) => row.status === 'active').length
      : 0;
    const now = Date.now();
    const overdueKeys = keys.rows.filter((row) => row.lifecycle_status === 'active' && row.rotation_due_at && new Date(row.rotation_due_at).getTime() <= now).length;
    const openIncidents = incidents.rows.filter((row) => !['closed'].includes(row.event_type)).length;
    return {
      policy: latestPolicy ? camelRow(latestPolicy) : null,
      adminMfa,
      activeSsoConnections: activeSso,
      overdueKeys,
      openIncidents,
      latestProductionAcceptance: acceptance.rows[0] ? camelRow(acceptance.rows[0]) : null,
      productionReady: latestPolicy?.approval_status === 'approved' &&
        (!latestPolicy.require_mfa_for_admins || adminMfa.total === adminMfa.enabled) &&
        (latestPolicy.sso_mode !== 'required' || activeSso > 0) &&
        overdueKeys === 0 && openIncidents === 0 && acceptance.rows[0]?.decision === 'accepted'
    };
  }

  async listPolicies(companyId) {
    const result = await this.database.query(
      `SELECT * FROM enterprise_security_policy_revisions WHERE company_id=$1
       ORDER BY policy_reference,revision DESC`, [companyId]);
    return result.rows.map(camelRow);
  }

  async createPolicy(companyId, userId, input) {
    const parsed = controls.policy(input);
    if (parsed.errors.length) return blocked('ENTERPRISE_POLICY_INVALID', parsed.errors.join(' '));
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`security-policy:${companyId}:${parsed.value.policyReference}`]);
      const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId, client);
      if (!evidence) { await client.query('ROLLBACK'); return blocked('ENTERPRISE_POLICY_EVIDENCE_INVALID', 'Locked, checksummed, tenant-bound policy evidence is required.'); }
      if (parsed.value.approvalStatus === 'approved' && parsed.value.requireMfaForAdmins) {
        const coverage = await this._adminMfaCoverage(companyId, client);
        if (!coverage.total || coverage.missing.length) {
          await client.query('ROLLBACK');
          return blocked('ENTERPRISE_POLICY_ADMIN_MFA_INCOMPLETE', 'Every active company administrator must have MFA enabled before policy approval.', 409, coverage);
        }
      }
      if (parsed.value.approvalStatus === 'approved' && parsed.value.ssoMode === 'required' && !await this._hasActiveSso(companyId, client)) {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_POLICY_SSO_INCOMPLETE', 'A validated active OIDC connection is required before approving mandatory SSO.', 409);
      }
      const revisionResult = await client.query(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision FROM enterprise_security_policy_revisions
         WHERE company_id=$1 AND policy_reference=$2`, [companyId, parsed.value.policyReference]);
      const revision = Number(revisionResult.rows[0].revision);
      const snapshot = evidenceSnapshot(evidence);
      const fingerprint = controls.sha({ companyId, revision, ...parsed.value, evidenceChecksum: evidence.checksum_sha256 });
      const result = await client.query(
        `INSERT INTO enterprise_security_policy_revisions(company_id,policy_reference,revision,require_mfa_for_admins,
           sso_mode,session_idle_minutes,data_retention_days,approval_status,rationale,evidence_document_id,
           evidence_snapshot,payload_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING *`,
        [companyId, parsed.value.policyReference, revision, parsed.value.requireMfaForAdmins,
          parsed.value.ssoMode, parsed.value.sessionIdleMinutes, parsed.value.dataRetentionDays,
          parsed.value.approvalStatus, parsed.value.rationale, evidence.id, JSON.stringify(snapshot), fingerprint, userId]);
      await client.query('COMMIT');
      return camelRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async listSsoConnections(companyId) {
    const result = await this.database.query(
      `SELECT * FROM enterprise_sso_connection_revisions WHERE company_id=$1
       ORDER BY connection_reference,revision DESC`, [companyId]);
    return result.rows.map(camelRow);
  }

  async createSsoConnection(companyId, userId, input) {
    const parsed = controls.sso(input);
    if (parsed.errors.length) return blocked('ENTERPRISE_SSO_INVALID', parsed.errors.join(' '));
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`enterprise-sso:${companyId}:${parsed.value.connectionReference}`]);
      const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId, client);
      if (!evidence) { await client.query('ROLLBACK'); return blocked('ENTERPRISE_SSO_EVIDENCE_INVALID', 'Locked, checksummed, tenant-bound SSO validation evidence is required.'); }
      const prior = await client.query(
        `SELECT revision,status FROM enterprise_sso_connection_revisions
         WHERE company_id=$1 AND connection_reference=$2 ORDER BY revision DESC LIMIT 1`,
        [companyId, parsed.value.connectionReference]);
      if (prior.rows[0]?.status === 'disabled' && parsed.value.status === 'active') {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_SSO_CONNECTION_RETIRED', 'A disabled connection cannot be reactivated; create a new connection reference.', 409);
      }
      const revision = Number(prior.rows[0]?.revision || 0) + 1;
      const snapshot = evidenceSnapshot(evidence);
      const fingerprint = controls.sha({ companyId, revision, ...parsed.value, evidenceChecksum: evidence.checksum_sha256 });
      const v = parsed.value;
      const result = await client.query(
        `INSERT INTO enterprise_sso_connection_revisions(company_id,connection_reference,revision,protocol,issuer_url,
           authorization_endpoint,token_endpoint,jwks_uri,client_id,client_secret_reference,allowed_email_domains,
           scopes,required_acr,validation_checks,status,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18,$19) RETURNING *`,
        [companyId, v.connectionReference, revision, v.protocol, v.issuerUrl, v.authorizationEndpoint,
          v.tokenEndpoint, v.jwksUri, v.clientId, v.clientSecretReference, v.allowedEmailDomains, v.scopes,
          v.requiredAcr, JSON.stringify(v.validationChecks), v.status, evidence.id, JSON.stringify(snapshot), fingerprint, userId]);
      await client.query('COMMIT');
      return camelRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async listKeyEvents(companyId) {
    const result = await this.database.query(
      `SELECT * FROM enterprise_key_lifecycle_events WHERE company_id=$1
       ORDER BY key_reference,revision DESC`, [companyId]);
    return result.rows.map(camelRow);
  }

  async createKeyEvent(companyId, userId, input) {
    const parsed = controls.keyEvent(input);
    if (parsed.errors.length) return blocked('ENTERPRISE_KEY_EVENT_INVALID', parsed.errors.join(' '));
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`enterprise-key:${companyId}:${parsed.value.keyReference}`]);
      const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId, client);
      if (!evidence) { await client.query('ROLLBACK'); return blocked('ENTERPRISE_KEY_EVIDENCE_INVALID', 'Locked, checksummed, tenant-bound key lifecycle evidence is required.'); }
      const priorResult = await client.query(
        `SELECT * FROM enterprise_key_lifecycle_events WHERE company_id=$1 AND key_reference=$2
         ORDER BY revision DESC LIMIT 1`, [companyId, parsed.value.keyReference]);
      const prior = priorResult.rows[0];
      if ((!prior && parsed.value.lifecycleStatus !== 'active') ||
          (prior && (prior.lifecycle_status !== 'active' || !['rotated', 'revoked'].includes(parsed.value.lifecycleStatus)))) {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_KEY_TRANSITION_INVALID', 'A key reference must start active and may transition once to rotated or revoked.', 409);
      }
      if (prior && (prior.purpose !== parsed.value.purpose || prior.provider !== parsed.value.provider ||
          prior.external_secret_reference !== parsed.value.externalSecretReference || prior.key_version !== parsed.value.keyVersion)) {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_KEY_IDENTITY_CHANGED', 'Key identity fields are immutable across lifecycle events.', 409);
      }
      const revision = Number(prior?.revision || 0) + 1;
      const snapshot = evidenceSnapshot(evidence); const v = parsed.value;
      const fingerprint = controls.sha({ companyId, revision, ...v, evidenceChecksum: evidence.checksum_sha256 });
      const result = await client.query(
        `INSERT INTO enterprise_key_lifecycle_events(company_id,key_reference,revision,purpose,provider,external_secret_reference,
           key_version,lifecycle_status,effective_at,rotation_due_at,reason,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING *`,
        [companyId, v.keyReference, revision, v.purpose, v.provider, v.externalSecretReference, v.keyVersion,
          v.lifecycleStatus, v.effectiveAt, v.rotationDueAt, v.reason, evidence.id, JSON.stringify(snapshot), fingerprint, userId]);
      await client.query('COMMIT'); return camelRow(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listIncidents(companyId) {
    const result = await this.database.query(
      `SELECT * FROM enterprise_security_incident_events WHERE company_id=$1
       ORDER BY incident_reference,revision DESC`, [companyId]);
    return result.rows.map(camelRow);
  }

  async createIncidentEvent(companyId, userId, input) {
    const parsed = controls.incident(input);
    if (parsed.errors.length) return blocked('ENTERPRISE_INCIDENT_INVALID', parsed.errors.join(' '));
    const transitions = {
      detected: ['triaged'], triaged: ['contained'], contained: ['eradicated'],
      eradicated: ['recovered'], recovered: ['closed'], closed: ['reopened'], reopened: ['triaged']
    };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`security-incident:${companyId}:${parsed.value.incidentReference}`]);
      const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId, client);
      if (!evidence) { await client.query('ROLLBACK'); return blocked('ENTERPRISE_INCIDENT_EVIDENCE_INVALID', 'Locked, checksummed, tenant-bound incident evidence is required.'); }
      const priorResult = await client.query(
        `SELECT * FROM enterprise_security_incident_events WHERE company_id=$1 AND incident_reference=$2
         ORDER BY revision DESC LIMIT 1`, [companyId, parsed.value.incidentReference]);
      const prior = priorResult.rows[0];
      if ((!prior && parsed.value.eventType !== 'detected') ||
          (prior && !transitions[prior.event_type]?.includes(parsed.value.eventType))) {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_INCIDENT_TRANSITION_INVALID', 'Incident events must follow the governed response lifecycle.', 409);
      }
      if (prior && new Date(parsed.value.occurredAt) < new Date(prior.occurred_at)) {
        await client.query('ROLLBACK');
        return blocked('ENTERPRISE_INCIDENT_TIME_INVALID', 'Incident event time cannot precede the previous event.', 409);
      }
      const revision = Number(prior?.revision || 0) + 1;
      const snapshot = evidenceSnapshot(evidence); const v = parsed.value;
      const fingerprint = controls.sha({ companyId, revision, ...v, evidenceChecksum: evidence.checksum_sha256 });
      const result = await client.query(
        `INSERT INTO enterprise_security_incident_events(company_id,incident_reference,revision,event_type,severity,occurred_at,
           owner,summary,personal_data_involved,regulatory_notification_required,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
        [companyId, v.incidentReference, revision, v.eventType, v.severity, v.occurredAt, v.owner, v.summary,
          v.personalDataInvolved, v.regulatoryNotificationRequired, evidence.id, JSON.stringify(snapshot), fingerprint, userId]);
      await client.query('COMMIT'); return camelRow(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listAcceptanceRuns(companyId) {
    const result = await this.database.query(
      `SELECT * FROM production_acceptance_runs WHERE company_id=$1 ORDER BY created_at DESC,id DESC`, [companyId]);
    return result.rows.map(camelRow);
  }

  async createAcceptanceRun(companyId, userId, input) {
    const parsed = controls.acceptance(input);
    if (parsed.errors.length) return blocked('PRODUCTION_ACCEPTANCE_INVALID', parsed.errors.join(' '));
    const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId);
    if (!evidence) return blocked('PRODUCTION_ACCEPTANCE_EVIDENCE_INVALID', 'Locked, checksummed, tenant-bound release evidence is required.');
    const migration = await this.database.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1');
    const actualMigration = migration.rows[0]?.name || null;
    const failedGates = REQUIRED_SMOKE_GATES.filter((gate) => parsed.value.smokeResults[gate] !== true);
    if (parsed.value.highestMigration !== actualMigration) failedGates.push('declaredMigrationMatchesDatabase');
    if (actualMigration !== EXPECTED_MIGRATION) failedGates.push('expectedSecurityMigrationApplied');
    if (Number(parsed.value.securityScanSummary.unresolvedCritical) !== 0) failedGates.push('zeroUnresolvedCriticalFindings');
    if (Number(parsed.value.securityScanSummary.unresolvedHigh) !== 0) failedGates.push('zeroUnresolvedHighFindings');
    if (parsed.value.decision === 'accepted') {
      const posture = await this.getPosture(companyId);
      if (posture.policy?.approvalStatus !== 'approved') failedGates.push('approvedEnterpriseSecurityPolicy');
      if (posture.policy?.requireMfaForAdmins && posture.adminMfa.enabled !== posture.adminMfa.total) failedGates.push('adminMfaCoverage');
      if (posture.policy?.ssoMode === 'required' && posture.activeSsoConnections < 1) failedGates.push('activeValidatedSso');
      if (posture.overdueKeys > 0) failedGates.push('noOverdueKeys');
      if (posture.openIncidents > 0) failedGates.push('noOpenIncidents');
      if (failedGates.length) return blocked('PRODUCTION_ACCEPTANCE_GATES_FAILED', 'An accepted release must pass every production and enterprise-security gate.', 409, { failedGates });
    }
    const v = parsed.value; const snapshot = evidenceSnapshot(evidence);
    const fingerprint = controls.sha({ companyId, ...v, actualMigration, evidenceChecksum: evidence.checksum_sha256 });
    try {
      const result = await this.database.query(
        `INSERT INTO production_acceptance_runs(company_id,release_reference,backend_commit_sha,frontend_commit_sha,
           backend_image_digest,frontend_image_digest,highest_migration,ci_run_url,rollback_image_digest,
           backup_restore_report_sha256,smoke_results,security_scan_summary,decision,decision_rationale,
           evidence_document_id,evidence_snapshot,payload_sha256,approved_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18) RETURNING *`,
        [companyId, v.releaseReference, v.backendCommitSha, v.frontendCommitSha, v.backendImageDigest,
          v.frontendImageDigest, v.highestMigration, v.ciRunUrl, v.rollbackImageDigest,
          v.backupRestoreReportSha256, JSON.stringify(v.smokeResults), JSON.stringify(v.securityScanSummary),
          v.decision, v.decisionRationale, evidence.id, JSON.stringify(snapshot), fingerprint, userId]);
      return camelRow(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return blocked('PRODUCTION_ACCEPTANCE_DUPLICATE', 'This release reference already has an immutable acceptance record.', 409);
      throw error;
    }
  }
}

module.exports = {
  EXPECTED_MIGRATION,
  REQUIRED_SMOKE_GATES,
  EnterpriseSecurityService,
  enterpriseSecurityService: new EnterpriseSecurityService()
};
