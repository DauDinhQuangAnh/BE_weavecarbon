const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/i;
const HTTPS = /^https:\/\/[^\s]+$/i;
const SECRET_REFERENCE = /^(?:vault|aws-sm|azure-kv|gcp-sm|doppler|1password):\/\/[^\s]{1,480}$/i;
const text = (value) => String(value ?? '').trim();
const bounded = (value, max) => Boolean(value) && value.length <= max;
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidence = (value, errors) => {
  if (!UUID.test(value)) errors.push('evidenceDocumentId must be a UUID.');
};

function policy(input = {}) {
  const value = {
    policyReference: text(input.policyReference || 'default'),
    requireMfaForAdmins: input.requireMfaForAdmins === true,
    ssoMode: text(input.ssoMode || 'disabled'),
    sessionIdleMinutes: input.sessionIdleMinutes,
    dataRetentionDays: input.dataRetentionDays,
    approvalStatus: text(input.approvalStatus),
    rationale: text(input.rationale),
    evidenceDocumentId: text(input.evidenceDocumentId)
  };
  const errors = [];
  if (!bounded(value.policyReference, 120)) errors.push('policyReference is required.');
  if (!['disabled', 'optional', 'required'].includes(value.ssoMode)) errors.push('ssoMode is unsupported.');
  if (!Number.isInteger(value.sessionIdleMinutes) || value.sessionIdleMinutes < 5 || value.sessionIdleMinutes > 1440) errors.push('sessionIdleMinutes must be 5–1440.');
  if (!Number.isInteger(value.dataRetentionDays) || value.dataRetentionDays < 30 || value.dataRetentionDays > 36500) errors.push('dataRetentionDays must be 30–36500.');
  if (!['draft', 'approved'].includes(value.approvalStatus)) errors.push('approvalStatus must be draft or approved.');
  if (!bounded(value.rationale, 5000)) errors.push('rationale is required.');
  evidence(value.evidenceDocumentId, errors);
  return { value, errors };
}

function sso(input = {}) {
  const checks = input.validationChecks || {};
  const value = {
    connectionReference: text(input.connectionReference),
    protocol: text(input.protocol || 'oidc'),
    issuerUrl: text(input.issuerUrl),
    authorizationEndpoint: text(input.authorizationEndpoint),
    tokenEndpoint: text(input.tokenEndpoint),
    jwksUri: text(input.jwksUri),
    clientId: text(input.clientId),
    clientSecretReference: text(input.clientSecretReference),
    allowedEmailDomains: Array.isArray(input.allowedEmailDomains)
      ? input.allowedEmailDomains.map((item) => text(item).toLowerCase()) : [],
    scopes: Array.isArray(input.scopes) ? input.scopes.map(text) : ['openid', 'email', 'profile'],
    requiredAcr: text(input.requiredAcr) || null,
    validationChecks: {
      discoveryValidated: checks.discoveryValidated === true,
      jwksValidated: checks.jwksValidated === true,
      idTokenValidationValidated: checks.idTokenValidationValidated === true,
      loginRoundTripValidated: checks.loginRoundTripValidated === true
    },
    status: text(input.status),
    evidenceDocumentId: text(input.evidenceDocumentId)
  };
  const errors = [];
  if (!bounded(value.connectionReference, 120)) errors.push('connectionReference is required.');
  if (value.protocol !== 'oidc') errors.push('Only OIDC is supported.');
  for (const key of ['issuerUrl', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri']) {
    if (!HTTPS.test(value[key]) || value[key].length > 2000) errors.push(`${key} must be an HTTPS URL.`);
  }
  if (!bounded(value.clientId, 500)) errors.push('clientId is required.');
  if (!SECRET_REFERENCE.test(value.clientSecretReference) || value.clientSecretReference.length > 500) errors.push('clientSecretReference must be an external secret-manager URI, never a secret value.');
  if (value.allowedEmailDomains.length < 1 || value.allowedEmailDomains.length > 50 ||
      value.allowedEmailDomains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) ||
      new Set(value.allowedEmailDomains).size !== value.allowedEmailDomains.length) errors.push('allowedEmailDomains must contain 1–50 unique DNS domains.');
  if (value.scopes.length < 1 || value.scopes.length > 20 || !value.scopes.includes('openid') ||
      value.scopes.some((scope) => !/^[A-Za-z0-9._:-]{1,100}$/.test(scope))) errors.push('scopes must be valid and include openid.');
  if (!['draft', 'active', 'disabled'].includes(value.status)) errors.push('status is unsupported.');
  if (value.status === 'active' && Object.values(value.validationChecks).some((checked) => !checked)) errors.push('An active connection requires all OIDC validation checks.');
  evidence(value.evidenceDocumentId, errors);
  return { value, errors };
}

function keyEvent(input = {}) {
  const value = {
    keyReference: text(input.keyReference), purpose: text(input.purpose), provider: text(input.provider),
    externalSecretReference: text(input.externalSecretReference), keyVersion: text(input.keyVersion),
    lifecycleStatus: text(input.lifecycleStatus), effectiveAt: text(input.effectiveAt),
    rotationDueAt: text(input.rotationDueAt) || null, reason: text(input.reason),
    evidenceDocumentId: text(input.evidenceDocumentId)
  };
  const errors = [];
  if (!bounded(value.keyReference, 160)) errors.push('keyReference is required.');
  if (!['jwt_signing', 'mfa_encryption', 'database_encryption', 'object_storage_encryption', 'weavenode_transport', 'deployment', 'integration'].includes(value.purpose)) errors.push('purpose is unsupported.');
  if (!bounded(value.provider, 160)) errors.push('provider is required.');
  if (!SECRET_REFERENCE.test(value.externalSecretReference) || value.externalSecretReference.length > 500) errors.push('externalSecretReference must be an external secret-manager URI.');
  if (!bounded(value.keyVersion, 120)) errors.push('keyVersion is required.');
  if (!['active', 'rotated', 'revoked'].includes(value.lifecycleStatus)) errors.push('lifecycleStatus is unsupported.');
  const effective = new Date(value.effectiveAt); const due = value.rotationDueAt ? new Date(value.rotationDueAt) : null;
  if (Number.isNaN(effective.getTime())) errors.push('effectiveAt must be an ISO timestamp.');
  if (due && (Number.isNaN(due.getTime()) || due <= effective)) errors.push('rotationDueAt must be after effectiveAt.');
  if (!bounded(value.reason, 2000)) errors.push('reason is required.');
  evidence(value.evidenceDocumentId, errors);
  return { value, errors };
}

function incident(input = {}) {
  const value = {
    incidentReference: text(input.incidentReference), eventType: text(input.eventType), severity: text(input.severity),
    occurredAt: text(input.occurredAt), owner: text(input.owner), summary: text(input.summary),
    personalDataInvolved: input.personalDataInvolved === true,
    regulatoryNotificationRequired: input.regulatoryNotificationRequired === true,
    evidenceDocumentId: text(input.evidenceDocumentId)
  };
  const errors = [];
  if (!bounded(value.incidentReference, 120)) errors.push('incidentReference is required.');
  if (!['detected', 'triaged', 'contained', 'eradicated', 'recovered', 'closed', 'reopened'].includes(value.eventType)) errors.push('eventType is unsupported.');
  if (!['low', 'medium', 'high', 'critical'].includes(value.severity)) errors.push('severity is unsupported.');
  if (Number.isNaN(new Date(value.occurredAt).getTime())) errors.push('occurredAt must be an ISO timestamp.');
  if (!bounded(value.owner, 240) || !bounded(value.summary, 5000)) errors.push('owner and summary are required.');
  evidence(value.evidenceDocumentId, errors);
  return { value, errors };
}

function acceptance(input = {}) {
  const value = {
    releaseReference: text(input.releaseReference), backendCommitSha: text(input.backendCommitSha),
    frontendCommitSha: text(input.frontendCommitSha), backendImageDigest: text(input.backendImageDigest),
    frontendImageDigest: text(input.frontendImageDigest), highestMigration: text(input.highestMigration),
    ciRunUrl: text(input.ciRunUrl), rollbackImageDigest: text(input.rollbackImageDigest),
    backupRestoreReportSha256: text(input.backupRestoreReportSha256), smokeResults: input.smokeResults || {},
    securityScanSummary: input.securityScanSummary || {}, decision: text(input.decision),
    decisionRationale: text(input.decisionRationale), evidenceDocumentId: text(input.evidenceDocumentId)
  };
  const errors = [];
  if (!bounded(value.releaseReference, 160)) errors.push('releaseReference is required.');
  if (!COMMIT.test(value.backendCommitSha) || !COMMIT.test(value.frontendCommitSha)) errors.push('Backend and frontend commit SHAs must be full 40-character hashes.');
  if (!DIGEST.test(value.backendImageDigest) || !DIGEST.test(value.frontendImageDigest) || !DIGEST.test(value.rollbackImageDigest)) errors.push('Image and rollback references must be immutable sha256 digests.');
  if (!bounded(value.highestMigration, 240)) errors.push('highestMigration is required.');
  if (!HTTPS.test(value.ciRunUrl) || value.ciRunUrl.length > 2000) errors.push('ciRunUrl must be HTTPS.');
  if (!SHA256.test(value.backupRestoreReportSha256)) errors.push('backupRestoreReportSha256 must be a SHA-256 hash.');
  if (!value.smokeResults || typeof value.smokeResults !== 'object' || Array.isArray(value.smokeResults)) errors.push('smokeResults must be an object.');
  if (!value.securityScanSummary || typeof value.securityScanSummary !== 'object' || Array.isArray(value.securityScanSummary)) errors.push('securityScanSummary must be an object.');
  if (!['blocked', 'accepted'].includes(value.decision)) errors.push('decision is unsupported.');
  if (!bounded(value.decisionRationale, 5000)) errors.push('decisionRationale is required.');
  evidence(value.evidenceDocumentId, errors);
  return { value, errors };
}

module.exports = { policy, sso, keyEvent, incident, acceptance, sha, SECRET_REFERENCE };
