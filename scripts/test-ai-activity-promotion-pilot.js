#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/database');
const { aiActivityPromotionControls: controls, AiActivityPromotionService } = require('../src/modules/evidence');

const IDS = {
  company: '00000000-0000-4000-8000-000000000141',
  otherCompany: '00000000-0000-4000-8000-000000000142',
  user: '00000000-0000-4000-8000-000000000143',
  evidence: '00000000-0000-4000-8000-000000000144',
  otherEvidence: '00000000-0000-4000-8000-000000000145',
  review: '00000000-0000-4000-8000-000000000146',
  facility: '00000000-0000-4000-8000-000000000147'
};
const checksum = 'a'.repeat(64);
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

function transactionDatabase(client) {
  let sequence = 0;
  let activeSavepoint = null;
  const serviceClient = {
    async query(sql, params) {
      const command = String(sql).trim().toUpperCase();
      if (command === 'BEGIN') {
        activeSavepoint = `ai_service_${++sequence}`;
        return client.query(`SAVEPOINT ${activeSavepoint}`);
      }
      if (command === 'COMMIT') {
        const savepoint = activeSavepoint;
        activeSavepoint = null;
        return client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      if (command === 'ROLLBACK') {
        const savepoint = activeSavepoint;
        activeSavepoint = null;
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        return client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return client.query(sql, params);
    },
    release() {}
  };
  return {
    query: (sql, params) => client.query(sql, params),
    connect: async () => serviceClient
  };
}

function candidateInput(suggestions, dataQualityLevel = 'L3') {
  return {
    candidateReference: `G2-14-${dataQualityLevel}`,
    suggestionSha256: suggestions.suggestionSha256,
    notes: 'Named administrator reviewed every semantic mapping and source value.',
    fieldDecisions: suggestions.fields.map((field) => ({
      fieldPath: field.fieldPath,
      decision: 'accepted',
      confirmedCanonicalField: field.suggestedCanonicalField,
      rationale: 'Accepted after comparison with the checksum-bound source document.'
    })),
    overrideRationales: {},
    anomalyResolutions: [],
    evidenceMatches: [],
    activityPayload: {
      activityReference: 'INV-G2-14-001',
      facilityRevisionId: IDS.facility,
      activityType: 'purchased_electricity',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      quantity: 1250,
      canonicalUnit: 'kWh',
      sourceKind: 'invoice',
      dataQualityLevel
    }
  };
}

async function main() {
  if (process.env.ALLOW_AI_ACTIVITY_PROMOTION_PILOT !== '1' ||
      process.env.AI_ACTIVITY_PROMOTION_PILOT_CONFIRM !== 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA') {
    throw new Error('AI activity-promotion pilot requires explicit isolated-database confirmation.');
  }
  const expectedDatabase = process.env.AI_ACTIVITY_PROMOTION_PILOT_DATABASE;
  const actualDatabase = await pool.query('SELECT current_database() AS name');
  assert(expectedDatabase && actualDatabase.rows[0].name === expectedDatabase,
    `Pilot database mismatch: expected ${expectedDatabase || '<unset>'}, got ${actualDatabase.rows[0].name}.`);

  const client = await pool.connect();
  const auditEvents = [];
  try {
    await client.query('BEGIN');
    const migration = await client.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1');
    assert(migration.rows[0]?.name === '052_g2_controlled_ai_activity_promotion.sql', 'G2-14 migration is not current.');

    await client.query(
      `INSERT INTO companies(id,name,business_type)
       VALUES($1,'G2-14 Pilot','factory'),($2,'Other tenant','factory')`,
      [IDS.company, IDS.otherCompany]
    );
    await client.query(
      `INSERT INTO users(id,email,password_hash,full_name,email_verified)
       VALUES($1,'g2-14-pilot@example.invalid','not-used','G2-14 Named Promoter',true)`,
      [IDS.user]
    );
    await client.query(
      `INSERT INTO company_members(company_id,user_id,role,status) VALUES($1,$2,'admin','active')`,
      [IDS.company, IDS.user]
    );
    const extracted = {
      invoice_number: 'INV-G2-14-001',
      activity_type: 'purchased_electricity',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      kwh_total: 1250,
      unit: 'kWh',
      emission_factor_id: 'MUST-NOT-PROMOTE'
    };
    await client.query(
      `INSERT INTO evidence_documents(id,company_id,evidence_type,document_name,file_size_bytes,checksum_sha256,
         extracted_json,status,locked_at,locked_by,uploaded_by)
       VALUES($1,$2,'electricity_bill','g2-14-source.pdf',512,$3,$4::jsonb,'locked',now(),$5,$5),
             ($6,$7,'electricity_bill','other-tenant.pdf',512,$3,'{}'::jsonb,'locked',now(),$5,$5)`,
      [IDS.evidence, IDS.company, checksum, JSON.stringify(extracted), IDS.user,
        IDS.otherEvidence, IDS.otherCompany]
    );
    await client.query(
      `INSERT INTO industrial_facility_revisions(id,company_id,facility_reference,revision,name,country_code,created_by)
       VALUES($1,$2,'G2-14-FACILITY',1,'G2-14 Synthetic Facility','VN',$3)`,
      [IDS.facility, IDS.company, IDS.user]
    );
    await client.query(
      `INSERT INTO evidence_ai_extraction_reviews(id,company_id,evidence_document_id,evidence_checksum_sha256,
         extraction_sha256,extraction_snapshot,reviewer_id,reviewer_name_snapshot,reviewer_role,decision,notes)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'G2-14 Named Reviewer','evidence_ai_reviewer',
         'approved_for_mapping','Every OCR field was compared to the synthetic source.')`,
      [IDS.review, IDS.company, IDS.evidence, checksum, controls.sha256(extracted),
        JSON.stringify(extracted), IDS.user]
    );
    for (const [fieldPath, value] of Object.entries(extracted)) {
      await client.query(
        `INSERT INTO evidence_ai_field_decisions(company_id,review_id,field_path,ai_value,decision,
           confirmed_value,canonical_field,field_sha256)
         VALUES($1,$2,$3,$4::jsonb,'accepted',$4::jsonb,$3,$5)`,
        [IDS.company, IDS.review, fieldPath, JSON.stringify(value), controls.sha256({ fieldPath, value })]
      );
    }

    const service = new AiActivityPromotionService(
      transactionDatabase(client),
      async (event) => { auditEvents.push(event); return { id: `audit-${auditEvents.length}` }; }
    );
    const suggestions = await service.suggestions(IDS.company, IDS.evidence, IDS.review);
    assert(suggestions && !suggestions.blocked, 'Governed semantic suggestions were unexpectedly blocked.');
    assert(suggestions.fields.find((field) => field.fieldPath === 'emission_factor_id')?.suggestedCanonicalField === 'unmapped',
      'Factor field was not explicitly excluded from promotion.');

    const blockedCandidate = await service.createCandidate(
      IDS.company, IDS.user, IDS.evidence, IDS.review, candidateInput(suggestions, 'L5')
    );
    assert(blockedCandidate.status === 'blocked' && blockedCandidate.blockerCodes.includes('OCR_DATA_QUALITY_OVERCLAIM'),
      'L5 OCR candidate was not retained as blocked.');
    const blockedPromotion = await service.promote(IDS.company, IDS.user, IDS.evidence, blockedCandidate.id, {
      promoterRole: 'industrial_activity_promoter',
      attestation: 'I reviewed the source and accept promotion of this candidate.'
    });
    assert(blockedPromotion.blocked && blockedPromotion.code === 'AI_ACTIVITY_CANDIDATE_BLOCKED',
      'Blocked candidate was promotable.');

    const candidate = await service.createCandidate(
      IDS.company, IDS.user, IDS.evidence, IDS.review, candidateInput(suggestions)
    );
    assert(candidate.status === 'ready_for_promotion' && candidate.blockerCodes.length === 0,
      'Valid candidate was not ready for promotion.');
    const promoted = await service.promote(IDS.company, IDS.user, IDS.evidence, candidate.id, {
      promoterRole: 'industrial_activity_promoter',
      attestation: 'I reviewed all lineage and explicitly approve this controlled activity promotion.'
    });
    assert(promoted.activity && promoted.promotion, 'Promotion did not create both activity and promotion records.');
    const repeat = await service.promote(IDS.company, IDS.user, IDS.evidence, candidate.id, {
      promoterRole: 'industrial_activity_promoter',
      attestation: 'I reviewed all lineage and explicitly approve this controlled activity promotion.'
    });
    assert(repeat.alreadyPromoted === true, 'Promotion idempotency did not return the existing ledger record.');

    const counts = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM evidence_ai_activity_candidates WHERE company_id=$1) AS candidates,
         (SELECT COUNT(*) FROM evidence_ai_activity_promotions WHERE company_id=$1) AS promotions,
         (SELECT COUNT(*) FROM industrial_activity_records WHERE company_id=$1) AS activities,
         (SELECT COUNT(*) FROM industrial_activity_evidence WHERE company_id=$1) AS links`,
      [IDS.company]
    );
    assert(Number(counts.rows[0].candidates) === 2 && Number(counts.rows[0].promotions) === 1 &&
      Number(counts.rows[0].activities) === 1 && Number(counts.rows[0].links) === 1,
    'Expected two candidates but exactly one promoted activity and lineage link.');
    assert(auditEvents.length === 3, 'Expected two candidate audit events and one promotion audit event.');

    await expectCode(client,
      'UPDATE evidence_ai_activity_candidates SET notes=$2 WHERE id=$1',
      [candidate.id, 'tampered'], 'P0001', 'ai_candidate_immutable');
    await expectCode(client,
      'UPDATE evidence_ai_activity_promotions SET attestation=$2 WHERE id=$1',
      [promoted.promotion.id, 'tampered attestation must never be accepted'], 'P0001', 'ai_promotion_immutable');
    await expectCode(client,
      `INSERT INTO evidence_ai_activity_candidates(company_id,evidence_document_id,extraction_review_id,
         candidate_reference,revision,status,suggestion_engine,suggestion_engine_version,suggestion_sha256,
         source_evidence_snapshot,field_decisions,anomaly_snapshot,anomaly_resolutions,evidence_match_snapshot,
         canonical_payload,notes,payload_sha256,created_by)
       VALUES($1,$2,$3,'cross-tenant',1,'blocked','pilot','1',$4,'{}','[]','[]','[]','[]','{}','invalid',$4,$5)`,
      [IDS.company, IDS.otherEvidence, IDS.review, checksum, IDS.user], '23503', 'ai_candidate_tenant_fk');

    const artifact = {
      status: 'passed',
      productionDataTouched: false,
      migration: migration.rows[0].name,
      checks: {
        governedSemanticSuggestions: true,
        factorAndCalculationFieldsExcluded: true,
        l4L5OverclaimBlocked: true,
        separateNamedPromotion: true,
        promotionIdempotent: true,
        tenantBindingEnforced: true,
        candidateAndPromotionImmutable: true,
        authoritativeActivityLineageCreated: true
      }
    };
    const outputDirectory = path.join(__dirname, '../artifacts/ai-activity-promotion-pilot');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    await client.query('ROLLBACK');
    console.log('G2-14 controlled AI/OCR activity-promotion pilot passed');
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
