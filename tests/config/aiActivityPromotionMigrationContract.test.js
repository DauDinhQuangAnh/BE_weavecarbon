const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/052_g2_controlled_ai_activity_promotion.sql'),
  'utf8'
);

describe('G2 controlled AI/OCR activity-promotion migration contract', () => {
  test('creates immutable candidate and promotion ledgers', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.evidence_ai_activity_candidates/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.evidence_ai_activity_promotions/i);
    expect(migration).toMatch(/trg_ai_activity_candidate_immutable/i);
    expect(migration).toMatch(/trg_ai_activity_promotion_immutable/i);
    expect(migration.match(/reject_industrial_core_mutation\(\)/g)).toHaveLength(2);
  });

  test('binds every cross-ledger reference to the same tenant', () => {
    expect(migration).toMatch(/FOREIGN KEY \(evidence_document_id, company_id\)[\s\S]*?evidence_documents\(id, company_id\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(extraction_review_id, company_id\)[\s\S]*?evidence_ai_extraction_reviews\(id, company_id\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(candidate_id, company_id\)[\s\S]*?evidence_ai_activity_candidates\(id, company_id\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(activity_id, company_id\)[\s\S]*?industrial_activity_records\(id, company_id\)/i);
  });

  test('enforces separate named promotion and checksum lineage', () => {
    expect(migration).toMatch(/promoter_role TEXT NOT NULL CHECK \(promoter_role = 'industrial_activity_promoter'\)/i);
    expect(migration).toMatch(/attestation TEXT NOT NULL CHECK \(length\(trim\(attestation\)\) BETWEEN 20 AND 5000\)/i);
    expect(migration).toMatch(/evidence_checksum_sha256 TEXT NOT NULL/i);
    expect(migration).toMatch(/extraction_sha256 TEXT NOT NULL/i);
    expect(migration).toMatch(/candidate_payload_sha256 TEXT NOT NULL/i);
    expect(migration).toMatch(/promotion_sha256 TEXT NOT NULL/i);
  });
});
