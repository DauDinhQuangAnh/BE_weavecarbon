const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/037_r17_eu_textile_epr_core.sql'), 'utf8');

describe('R17 EU textile EPR migration contract', () => {
  test('creates tenant-bound immutable revisions, reviews and external events', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.eu_textile_epr_assessment_revisions/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.eu_textile_epr_reviews/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.eu_textile_epr_external_events/i);
    expect(sql).toMatch(/FOREIGN KEY \(assessment_id, company_id\)/i);
    expect(sql).toMatch(/append-only and immutable/i);
  });

  test('indexes tenant, reviewer, recorder and evidence foreign-key access', () => {
    expect(sql).toMatch(/idx_eu_textile_epr_assessment_tenant/i);
    expect(sql).toMatch(/idx_eu_textile_epr_reviews_reviewer/i);
    expect(sql).toMatch(/idx_eu_textile_epr_external_events_evidence/i);
    expect(sql).toMatch(/idx_eu_textile_epr_external_events_recorded_by/i);
  });

  test('restricts lifecycle vocabulary and keeps evidence/hash snapshots', () => {
    expect(sql).toMatch(/authority_registration_confirmed/i);
    expect(sql).toMatch(/fee_payment_confirmed/i);
    expect(sql).toMatch(/shipment_snapshot_sha256/i);
    expect(sql).toMatch(/evidence_snapshot JSONB NOT NULL/i);
  });
});
