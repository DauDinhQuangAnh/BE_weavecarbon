const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/047_g2_ai_extraction_human_review.sql'), 'utf8');

describe('G2 AI extraction human review migration', () => {
  test('stores checksum-bound reviews and field-level decisions', () => {
    expect(sql).toContain('evidence_ai_extraction_reviews');
    expect(sql).toContain('evidence_ai_field_decisions');
    expect(sql).toContain('evidence_checksum_sha256');
    expect(sql).toContain('extraction_sha256');
    expect(sql).toContain('field_sha256');
  });

  test('keeps AI review ledgers tenant-bound and immutable', () => {
    expect(sql).toContain('REFERENCES public.evidence_documents(id, company_id)');
    expect(sql).toContain('REFERENCES public.evidence_ai_extraction_reviews(id, company_id)');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(2);
  });
});
