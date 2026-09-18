#!/usr/bin/env node

require('dotenv').config();
const pool = require('../src/config/database');

const IDS = {
  company: '00000000-0000-4000-8000-000000000131',
  otherCompany: '00000000-0000-4000-8000-000000000132',
  user: '00000000-0000-4000-8000-000000000133',
  evidence: '00000000-0000-4000-8000-000000000134',
  otherEvidence: '00000000-0000-4000-8000-000000000135'
};
const sha = 'a'.repeat(64);
const digest = `sha256:${'b'.repeat(64)}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function expectCode(client, sql, params, expectedCode, label) {
  await client.query(`SAVEPOINT ${label}`);
  try {
    await client.query(sql, params);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error.code !== expectedCode) throw error;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
    await client.query(`RELEASE SAVEPOINT ${label}`);
  }
}

async function main() {
  if (process.env.ALLOW_ENTERPRISE_SECURITY_PILOT !== '1' ||
      process.env.ENTERPRISE_SECURITY_PILOT_CONFIRM !== 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA') {
    throw new Error('Enterprise security pilot requires explicit isolated-database confirmation.');
  }
  const expectedDatabase = process.env.ENTERPRISE_SECURITY_PILOT_DATABASE;
  const actualDatabase = await pool.query('SELECT current_database() AS name');
  assert(expectedDatabase && actualDatabase.rows[0].name === expectedDatabase,
    `Pilot database mismatch: expected ${expectedDatabase || '<unset>'}, got ${actualDatabase.rows[0].name}.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const migration = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM schema_migrations
         WHERE name = '051_g2_enterprise_security_acceptance.sql'
       ) AS applied`
    );
    assert(migration.rows[0]?.applied === true, 'G2-13 migration is not applied.');
    await client.query(
      `INSERT INTO companies(id,name,business_type) VALUES($1,'G2-13 Pilot','factory'),($2,'Other tenant','factory')`,
      [IDS.company, IDS.otherCompany]
    );
    await client.query(
      `INSERT INTO users(id,email,password_hash,full_name,email_verified)
       VALUES($1,'g2-13-pilot@example.invalid','not-used','G2-13 Pilot',true)`, [IDS.user]
    );
    await client.query(
      `INSERT INTO company_members(company_id,user_id,role,status) VALUES($1,$2,'admin','active')`,
      [IDS.company, IDS.user]
    );
    await client.query(
      `INSERT INTO evidence_documents(id,company_id,evidence_type,document_name,file_size_bytes,checksum_sha256,status,locked_at,locked_by,uploaded_by)
       VALUES($1,$2,'security_policy','security-policy.pdf',100,$3,'locked',now(),$4,$4),
             ($5,$6,'security_policy','other-tenant.pdf',100,$3,'locked',now(),$4,$4)`,
      [IDS.evidence, IDS.company, sha, IDS.user, IDS.otherEvidence, IDS.otherCompany]
    );
    const recovery = Array.from({ length: 8 }, (_item, index) => ({
      salt: `salt-${index}`, hash: `${index}`.repeat(128).slice(0, 128)
    }));
    await client.query(
      `INSERT INTO user_mfa_factor_revisions(user_id,revision,status,secret_ciphertext,secret_iv,secret_auth_tag,recovery_code_hashes,reason,created_by)
       VALUES($1,1,'enabled','ciphertext','iv','tag',$2::jsonb,'Pilot MFA enabled.',$1)`,
      [IDS.user, JSON.stringify(recovery)]
    );
    const snapshot = JSON.stringify({
      id: IDS.evidence, name: 'security-policy.pdf', status: 'locked', checksumSha256: sha, fileSizeBytes: 100
    });
    const policy = await client.query(
      `INSERT INTO enterprise_security_policy_revisions(company_id,policy_reference,revision,require_mfa_for_admins,sso_mode,
         session_idle_minutes,data_retention_days,approval_status,rationale,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
       VALUES($1,'default',1,true,'optional',30,2555,'approved','Pilot policy.',$2,$3::jsonb,$4,$5) RETURNING id`,
      [IDS.company, IDS.evidence, snapshot, sha, IDS.user]
    );
    await client.query(
      `INSERT INTO enterprise_sso_connection_revisions(company_id,connection_reference,revision,protocol,issuer_url,
         authorization_endpoint,token_endpoint,jwks_uri,client_id,client_secret_reference,allowed_email_domains,scopes,
         validation_checks,status,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
       VALUES($1,'pilot-oidc',1,'oidc','https://idp.example.com','https://idp.example.com/authorize',
         'https://idp.example.com/token','https://idp.example.com/jwks','client','vault://pilot/oidc',ARRAY['example.com'],
         ARRAY['openid','email'],$2::jsonb,'active',$3,$4::jsonb,$5,$6)`,
      [IDS.company, JSON.stringify({ discoveryValidated: true, jwksValidated: true,
        idTokenValidationValidated: true, loginRoundTripValidated: true }), IDS.evidence, snapshot, sha, IDS.user]
    );
    await client.query(
      `INSERT INTO enterprise_key_lifecycle_events(company_id,key_reference,revision,purpose,provider,external_secret_reference,
         key_version,lifecycle_status,effective_at,rotation_due_at,reason,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
       VALUES($1,'mfa-key-v1',1,'mfa_encryption','Vault','vault://pilot/mfa','1','active',now(),now()+interval '90 days',
         'Pilot activation.',$2,$3::jsonb,$4,$5)`, [IDS.company, IDS.evidence, snapshot, sha, IDS.user]
    );
    await client.query(
      `INSERT INTO enterprise_security_incident_events(company_id,incident_reference,revision,event_type,severity,occurred_at,
         owner,summary,personal_data_involved,regulatory_notification_required,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
       VALUES($1,'INC-PILOT',1,'detected','low',now(),'Security lead','Synthetic lifecycle test.',false,false,$2,$3::jsonb,$4,$5)`,
      [IDS.company, IDS.evidence, snapshot, sha, IDS.user]
    );
    await client.query(
      `INSERT INTO production_acceptance_runs(company_id,release_reference,backend_commit_sha,frontend_commit_sha,
         backend_image_digest,frontend_image_digest,highest_migration,ci_run_url,rollback_image_digest,
         backup_restore_report_sha256,smoke_results,security_scan_summary,decision,decision_rationale,
         evidence_document_id,evidence_snapshot,payload_sha256,approved_by)
       VALUES($1,'pilot-release',$2,$3,$4,$4,'051_g2_enterprise_security_acceptance.sql','https://ci.example.com/run/1',$4,
         $5,$6::jsonb,$7::jsonb,'blocked','Synthetic acceptance control test.',$8,$9::jsonb,$10,$11)`,
      [IDS.company, 'c'.repeat(40), 'd'.repeat(40), digest, sha,
        JSON.stringify({ health: true }), JSON.stringify({ unresolvedCritical: 0 }), IDS.evidence, snapshot, sha, IDS.user]
    );
    await expectCode(client,
      'UPDATE enterprise_security_policy_revisions SET rationale=$2 WHERE id=$1',
      [policy.rows[0].id, 'tampered'], 'P0001', 'enterprise_policy_immutable');
    await expectCode(client,
      `INSERT INTO enterprise_security_policy_revisions(company_id,policy_reference,revision,require_mfa_for_admins,sso_mode,
         session_idle_minutes,data_retention_days,approval_status,rationale,evidence_document_id,evidence_snapshot,payload_sha256,created_by)
       VALUES($1,'cross-tenant',1,false,'disabled',30,2555,'draft','Invalid cross tenant.',$2,$3::jsonb,$4,$5)`,
      [IDS.company, IDS.otherEvidence, snapshot, sha, IDS.user], '23503', 'enterprise_policy_tenant_fk');
    const counts = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM enterprise_security_policy_revisions WHERE company_id=$1) AS policies,
         (SELECT COUNT(*) FROM enterprise_sso_connection_revisions WHERE company_id=$1) AS sso,
         (SELECT COUNT(*) FROM enterprise_key_lifecycle_events WHERE company_id=$1) AS keys,
         (SELECT COUNT(*) FROM enterprise_security_incident_events WHERE company_id=$1) AS incidents,
         (SELECT COUNT(*) FROM production_acceptance_runs WHERE company_id=$1) AS acceptance`, [IDS.company]
    );
    assert(Object.values(counts.rows[0]).every((value) => Number(value) === 1), 'Expected one record in every G2-13 ledger.');
    await client.query('ROLLBACK');
    console.log('G2-13 enterprise security migration, tenant binding and immutability OK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => pool.end());
