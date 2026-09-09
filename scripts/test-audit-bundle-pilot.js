#!/usr/bin/env node

require('dotenv').config();

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const pool = require('../src/config/database');
const { calculateCarbonFootprint } = require('../src/modules/carbon/core');
const { insertFinalizedProductSnapshot } = require('../src/modules/carbon/calculationSnapshot');
const { createReportsService } = require('../src/modules/reports');

const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA';
const REPORTING_PERIOD = Object.freeze({ start: '2026-01-01', end: '2026-12-31' });
const STAGE_EVIDENCE_TYPES = Object.freeze({
  materials: 'material_invoice',
  packaging: 'packaging_specification',
  finished_goods_manufacturing: 'electricity_bill',
  logistics_and_storage: 'transport_document'
});

const result = {
  schemaVersion: 'weavecarbon-audit-pilot-result-v1',
  startedAt: new Date().toISOString(),
  status: 'running',
  isolatedDatabaseConfirmed: false,
  productionDataTouched: false,
  checks: [],
  bundles: []
};

let uploadsRoot;

function check(name, details = {}) {
  result.checks.push({ name, status: 'passed', ...details });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function writeResult() {
  const artifactDir = path.resolve(__dirname, '..', 'artifacts', 'audit-pilot');
  await fs.promises.mkdir(artifactDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(artifactDir, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );
}

function requireIsolationConfirmation(databaseName) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Audit pilot refuses to run with NODE_ENV=production.');
  }
  if (process.env.ALLOW_AUDIT_BUNDLE_PILOT !== '1') {
    throw new Error('Set ALLOW_AUDIT_BUNDLE_PILOT=1 to run the synthetic-data pilot.');
  }
  if (process.env.AUDIT_PILOT_CONFIRM_ISOLATED !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set AUDIT_PILOT_CONFIRM_ISOLATED=${REQUIRED_CONFIRMATION} after confirming database isolation.`);
  }
  if (!process.env.AUDIT_PILOT_DATABASE || process.env.AUDIT_PILOT_DATABASE !== databaseName) {
    throw new Error('AUDIT_PILOT_DATABASE must exactly match current_database().');
  }
}

async function assertRequiredSchema() {
  const requiredTables = [
    'audit_bundles',
    'audit_bundle_evidence',
    'audit_bundle_reviews',
    'audit_bundle_issuances',
    'audit_bundle_share_links',
    'audit_bundle_assurance_records',
    'evidence_documents',
    'product_assessment_snapshots'
  ];
  const tables = await pool.query(
    `SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
     FROM unnest($1::text[]) AS name`,
    [requiredTables]
  );
  const missing = tables.rows.filter((row) => !row.present).map((row) => row.name);
  assert.deepEqual(missing, [], `Required migrations are missing: ${missing.join(', ')}`);
  check('required_schema_present', { tableCount: requiredTables.length });
}

async function insertFixture(runId) {
  const companyId = crypto.randomUUID();
  const otherCompanyId = crypto.randomUUID();
  const creatorId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO companies (id, name, business_type)
       VALUES ($1, $2, 'factory'), ($3, $4, 'factory')`,
      [companyId, `AUDIT-PILOT-${runId}`, otherCompanyId, `AUDIT-PILOT-OTHER-${runId}`]
    );
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, email_verified)
       VALUES ($1, $2, $3, 'Audit Pilot Creator', true),
              ($4, $5, $3, 'Audit Pilot Reviewer', true)`,
      [
        creatorId,
        `audit-pilot-creator-${runId}@invalid.example`,
        'synthetic-pilot-no-login',
        reviewerId,
        `audit-pilot-reviewer-${runId}@invalid.example`
      ]
    );
    await client.query(
      `INSERT INTO products (id, company_id, sku, name, description, category, weight_kg, status)
       VALUES ($1, $2, $3, 'Synthetic EU textile pilot',
               'Non-production fixture for immutable Audit Pack verification.',
               'textile', 0.5, 'active')`,
      [productId, companyId, `AUDIT-PILOT-${runId}`]
    );

    const fixture = require('../tests/fixtures/carbon/v1/inputs.json').cases[0].input;
    const carbonResult = calculateCarbonFootprint(fixture);
    assert.ok(carbonResult.calculationTerms.length > 0, 'Pilot calculation must contain contribution terms.');
    const snapshot = await insertFinalizedProductSnapshot(client, {
      productId,
      companyId,
      assessmentPayload: {
        fixtureType: 'audit_pilot',
        synthetic: true,
        runId
      },
      input: fixture,
      result: carbonResult,
      calculatedAt: new Date('2026-09-09T00:00:00.000Z')
    });
    await client.query('COMMIT');
    check('authoritative_calculation_snapshot_created', {
      calculationSnapshotId: snapshot.row.snapshot_id,
      contributionTermCount: carbonResult.calculationTerms.length
    });
    return { companyId, otherCompanyId, creatorId, reviewerId, productId, carbonResult };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertEvidence(fixture, runId) {
  const groups = new Map();
  fixture.carbonResult.calculationTerms.forEach((term, index) => {
    if (!STAGE_EVIDENCE_TYPES[term.stage]) {
      throw new Error(`No pilot evidence type is mapped for calculation stage: ${term.stage}`);
    }
    if (!groups.has(term.stage)) groups.set(term.stage, []);
    groups.get(term.stage).push(index + 1);
  });

  const documents = [...groups.entries()].map(([stage, calculationTermNumbers]) => ({
    type: STAGE_EVIDENCE_TYPES[stage],
    name: `${stage}-activity.json`,
    auditClaims: { calculationTermNumbers },
    content: { synthetic: true, runId, stage, calculationTermNumbers, reportingPeriod: REPORTING_PERIOD }
  }));
  const factorVersionIds = [...new Set(
    fixture.carbonResult.calculationTerms.map((term) => term.factorVersionId)
  )].sort();
  documents.push({
    type: 'emission_factor_source',
    name: 'factor-sources.json',
    auditClaims: { factorVersionIds },
    content: { synthetic: true, runId, factorVersionIds, reportingPeriod: REPORTING_PERIOD }
  });

  let assuranceEvidenceId = null;
  for (const document of documents) {
    const evidenceId = crypto.randomUUID();
    const storageKey = `pilot/${runId}/${evidenceId}/${document.name}`;
    const filePath = path.resolve(uploadsRoot, storageKey);
    const relative = path.relative(uploadsRoot, filePath);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Evidence path escaped the pilot upload root.');
    const buffer = Buffer.from(`${JSON.stringify(document.content, null, 2)}\n`, 'utf8');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    await pool.query(
      `INSERT INTO evidence_documents (
         id, company_id, product_id, evidence_type, document_name,
         reporting_period_start, reporting_period_end,
         storage_provider, storage_key, original_filename, mime_type,
         file_size_bytes, checksum_sha256, extracted_json, status,
         locked_at, locked_by, uploaded_by, valid_from, valid_to, approved_by, approval_note
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'local',$8,$5,'application/json',
         $9,$10,$11::jsonb,$14,now(),$12,$12,$6,$13,$12,
         'Synthetic isolated Audit Pack pilot evidence'
       )`,
      [
        evidenceId,
        fixture.companyId,
        fixture.productId,
        document.type,
        document.name,
        REPORTING_PERIOD.start,
        REPORTING_PERIOD.end,
        storageKey,
        buffer.length,
        sha256(buffer),
        JSON.stringify({ auditClaims: document.auditClaims, synthetic: true, runId }),
        fixture.creatorId,
        '2027-12-31',
        document.type === 'emission_factor_source' ? 'third_party_verified' : 'locked'
      ]
    );
    if (document.type === 'emission_factor_source') assuranceEvidenceId = evidenceId;
  }
  check('period_bound_evidence_created', {
    documentCount: documents.length,
    activityDocumentCount: groups.size,
    factorVersionCount: factorVersionIds.length
  });
  return assuranceEvidenceId;
}

async function inspectArchive(service, bundle) {
  const stored = await pool.query(
    `SELECT storage_key, bundle_sha256, manifest_sha256, file_size_bytes
     FROM audit_bundles WHERE id = $1`,
    [bundle.id]
  );
  const row = stored.rows[0];
  const archivePath = path.resolve(uploadsRoot, row.storage_key);
  const buffer = await fs.promises.readFile(archivePath);
  assert.equal(buffer.length, Number(row.file_size_bytes));
  assert.equal(sha256(buffer), row.bundle_sha256);
  assert.equal(await service.verifyAuditBundleFile(bundle.reportId, bundle.companyId, archivePath), true);

  const zip = await JSZip.loadAsync(buffer);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  const calculation = JSON.parse(await zip.file('calculation.json').async('string'));
  const evidenceIndex = JSON.parse(await zip.file('evidence/index.json').async('string'));
  assert.equal(manifest.termEvidenceCoverage.status, 'complete');
  assert.equal(manifest.termEvidenceCoverage.termCount, calculation.carbonResults.calculationTerms.length);
  assert.equal(manifest.manifestSha256, row.manifest_sha256);
  assert.ok(evidenceIndex.length > 1);
  for (const evidence of evidenceIndex) {
    const archived = await zip.file(`evidence/${evidence.evidenceDocumentId}/${evidence.filename}`).async('nodebuffer');
    assert.equal(archived.length, evidence.fileSizeBytes);
    assert.equal(sha256(archived), evidence.sha256);
  }
  check(`bundle_v${bundle.version}_archive_verified`, {
    bundleId: bundle.id,
    fileSizeBytes: buffer.length,
    bundleSha256: row.bundle_sha256,
    manifestSha256: row.manifest_sha256,
    evidenceDocumentCount: evidenceIndex.length,
    contributionTermCount: manifest.termEvidenceCoverage.termCount
  });
  return { manifest, row };
}

async function expectDatabaseMutationBlocked(name, sql, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SAVEPOINT mutation_probe');
    let blocked = false;
    try {
      await client.query(sql, params);
    } catch (error) {
      blocked = true;
      await client.query('ROLLBACK TO SAVEPOINT mutation_probe');
    }
    assert.equal(blocked, true, `${name} unexpectedly succeeded.`);
    await client.query('ROLLBACK');
    check(name);
  } finally {
    client.release();
  }
}

async function createGenerateInspect(service, fixture) {
  const created = await service.createAuditBundle(fixture.companyId, fixture.creatorId, fixture.productId);
  const bundle = { ...created, companyId: fixture.companyId };
  assert.equal(created.lifecycleStatus, 'draft');
  await service._generateAuditBundle(created.reportId, created.id, fixture.companyId);
  const completed = await service.getAuditBundle(fixture.companyId, created.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.lifecycleStatus, 'blocked');
  assert.equal(completed.termEvidenceCoverage.status, 'complete');
  await inspectArchive(service, bundle);
  result.bundles.push({ id: bundle.id, reportId: bundle.reportId, version: bundle.version });
  return bundle;
}

async function reviewAndIssue(service, fixture, bundle) {
  await service.reviewAuditBundle(fixture.companyId, fixture.reviewerId, bundle.id, {
    decision: 'approved',
    notes: 'Synthetic pilot: exercise unresolved blocking QA exception.',
    qaExceptions: [{
      code: 'PILOT-BLOCKER',
      message: 'Synthetic blocker used to prove issue gating.',
      severity: 'blocking',
      status: 'open'
    }]
  });
  assert.equal((await service.getAuditBundle(fixture.companyId, bundle.id)).lifecycleStatus, 'blocked');
  await assert.rejects(
    service.issueAuditBundle(fixture.companyId, fixture.creatorId, bundle.id, {
      assertion: 'Synthetic internal carbon calculation assertion.',
      criteria: 'WeaveCarbon internal Audit Pack pilot criteria v1.',
      signatureAcknowledged: true
    }),
    (error) => error?.code === 'AUDIT_QA_BLOCKING_EXCEPTIONS'
  );
  check(`bundle_v${bundle.version}_qa_blocker_enforced`);

  const review = await service.reviewAuditBundle(fixture.companyId, fixture.reviewerId, bundle.id, {
    decision: 'approved',
    notes: 'Synthetic blocker resolved after pilot inspection.',
    qaExceptions: [{
      code: 'PILOT-BLOCKER',
      message: 'Synthetic blocker used to prove issue gating.',
      severity: 'blocking',
      status: 'resolved'
    }]
  });
  assert.equal((await service.getAuditBundle(fixture.companyId, bundle.id)).lifecycleStatus, 'ready');
  const issuance = await service.issueAuditBundle(fixture.companyId, fixture.creatorId, bundle.id, {
    assertion: 'Synthetic internal carbon calculation assertion.',
    criteria: 'WeaveCarbon internal Audit Pack pilot criteria v1.',
    signatureAcknowledged: true
  });
  assert.equal(issuance.lifecycleStatus, 'issued');
  assert.equal(issuance.assuranceStatus, 'not_verified');
  assert.equal(issuance.signatureValid, true);
  assert.equal((await service.getAuditBundle(fixture.companyId, bundle.id)).lifecycleStatus, 'issued');
  check(`bundle_v${bundle.version}_review_and_internal_issue`, {
    reviewId: review.id,
    issuanceId: issuance.id,
    assuranceStatus: issuance.assuranceStatus
  });
  return { review, issuance };
}

async function exerciseSignedSharingAndAssurance(service, fixture, bundle) {
  const share = await service.createAuditBundleShare(fixture.companyId, fixture.creatorId, bundle.id, {
    label: 'Synthetic verifier one-time link',
    expiresInHours: 24,
    maxDownloads: 1
  });
  assert.match(share.token, /^[A-Za-z0-9_-]{43}$/);
  const publicMetadata = await service.getPublicAuditBundleShare(share.token);
  assert.equal(publicMetadata.bundle.id, bundle.id);
  assert.equal(publicMetadata.issuance.signatureValid, true);
  assert.equal(publicMetadata.assuranceStatus, 'not_verified');
  const download = await service.downloadPublicAuditBundleShare(share.token);
  assert.equal(sha256(download.buffer), publicMetadata.bundle.bundleSha256);
  assert.equal(await service.getPublicAuditBundleShare(share.token), null);
  check(`bundle_v${bundle.version}_signed_one_time_share`, {
    shareId: share.id,
    signaturePayloadSha256: publicMetadata.issuance.signaturePayloadSha256
  });

  const revocableShare = await service.createAuditBundleShare(fixture.companyId, fixture.creatorId, bundle.id, {
    label: 'Synthetic revocation probe', expiresInHours: 24, maxDownloads: 2
  });
  await service.revokeAuditBundleShare(
    fixture.companyId, fixture.creatorId, bundle.id, revocableShare.id,
    { reason: 'Synthetic pilot revocation.' }
  );
  assert.equal(await service.getPublicAuditBundleShare(revocableShare.token), null);
  check(`bundle_v${bundle.version}_share_revocation`);

  const assurance = await service.createAuditBundleAssuranceRecord(
    fixture.companyId,
    fixture.creatorId,
    bundle.id,
    {
      outcome: 'limited_assurance',
      providerName: 'Synthetic Independent Verifier',
      practitionerName: 'Synthetic Assurance Practitioner',
      standard: 'Synthetic pilot criteria; not a real assurance engagement',
      scope: 'Synthetic calculation and evidence fixture only.',
      statementDate: '2026-09-10',
      validTo: '2027-09-10',
      evidenceDocumentId: fixture.assuranceEvidenceId,
      notes: 'Technical lifecycle probe only.'
    }
  );
  assert.equal(assurance.assuranceStatus, 'limited_assurance');
  assert.equal((await service.getAuditBundle(fixture.companyId, bundle.id)).assuranceStatus, 'limited_assurance');
  check(`bundle_v${bundle.version}_external_assurance_record`, {
    assuranceId: assurance.id,
    evidenceDocumentId: fixture.assuranceEvidenceId
  });
  const supersessionShare = await service.createAuditBundleShare(
    fixture.companyId, fixture.creatorId, bundle.id,
    { label: 'Synthetic supersession probe', expiresInHours: 24, maxDownloads: 2 }
  );
  return { share, revocableShare, supersessionShare, assurance };
}

async function main() {
  const database = await pool.query('SELECT current_database() AS name');
  const databaseName = database.rows[0].name;
  requireIsolationConfirmation(databaseName);
  result.isolatedDatabaseConfirmed = true;
  result.database = { name: databaseName };
  check('explicit_isolation_guard_passed');
  await assertRequiredSchema();

  const runId = (process.env.AUDIT_PILOT_RUN_ID || crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), `weave-audit-pilot-${runId}-`));
  const fixture = await insertFixture(runId);
  fixture.assuranceEvidenceId = await insertEvidence(fixture, runId);

  const queued = [];
  const service = createReportsService({
    database: pool,
    uploadsRoot,
    jobQueue: {
      enqueue: async (task) => {
        queued.push(task);
        return true;
      }
    }
  });

  const first = await createGenerateInspect(service, fixture);
  const firstLifecycle = await reviewAndIssue(service, fixture, first);
  const firstTrust = await exerciseSignedSharingAndAssurance(service, fixture, first);
  assert.equal(await service.getAuditBundle(fixture.otherCompanyId, first.id), null);
  check('cross_tenant_bundle_read_denied');

  await expectDatabaseMutationBlocked(
    'completed_bundle_update_blocked',
    'UPDATE audit_bundles SET error_message = $1 WHERE id = $2',
    ['mutation-probe', first.id]
  );
  await expectDatabaseMutationBlocked(
    'share_identity_update_blocked',
    'UPDATE audit_bundle_share_links SET label = $1 WHERE id = $2',
    ['mutation-probe', firstTrust.share.id]
  );
  await expectDatabaseMutationBlocked(
    'assurance_update_blocked',
    'UPDATE audit_bundle_assurance_records SET notes = $1 WHERE id = $2',
    ['mutation-probe', firstTrust.assurance.id]
  );
  await expectDatabaseMutationBlocked(
    'pinned_evidence_delete_blocked',
    'DELETE FROM audit_bundle_evidence WHERE audit_bundle_id = $1',
    [first.id]
  );
  await expectDatabaseMutationBlocked(
    'review_update_blocked',
    'UPDATE audit_bundle_reviews SET notes = $1 WHERE id = $2',
    ['mutation-probe', firstLifecycle.review.id]
  );
  await expectDatabaseMutationBlocked(
    'issuance_delete_blocked',
    'DELETE FROM audit_bundle_issuances WHERE id = $1',
    [firstLifecycle.issuance.id]
  );

  const second = await service.createAuditBundle(fixture.companyId, fixture.creatorId, fixture.productId);
  assert.equal(second.version, 2);
  assert.equal((await service.getAuditBundle(fixture.companyId, first.id)).lifecycleStatus, 'issued');
  check('new_draft_does_not_supersede_issued_bundle');
  await service._generateAuditBundle(second.reportId, second.id, fixture.companyId);
  await inspectArchive(service, { ...second, companyId: fixture.companyId });
  result.bundles.push({ id: second.id, reportId: second.reportId, version: second.version });
  await reviewAndIssue(service, fixture, second);
  assert.equal((await service.getAuditBundle(fixture.companyId, first.id)).lifecycleStatus, 'superseded');
  assert.equal(await service.getPublicAuditBundleShare(firstTrust.supersessionShare.token), null);
  check('new_issuance_supersedes_previous_bundle');
  check('supersession_invalidates_previous_share');

  assert.equal(queued.length, 2);
  check('existing_report_queue_reused', { queuedAuditBundleJobs: queued.length });
  result.status = 'passed';
  result.finishedAt = new Date().toISOString();
}

main()
  .catch((error) => {
    result.status = 'failed';
    result.finishedAt = new Date().toISOString();
    result.error = { name: error.name, code: error.code || null, message: error.message };
    console.error('[audit-pilot] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await writeResult().catch((error) => console.error('[audit-pilot] Could not write result:', error));
    if (uploadsRoot) await fs.promises.rm(uploadsRoot, { recursive: true, force: true }).catch(() => {});
    await pool.end().catch(() => {});
    if (result.status === 'passed') {
      console.log(JSON.stringify(result, null, 2));
    }
  });
