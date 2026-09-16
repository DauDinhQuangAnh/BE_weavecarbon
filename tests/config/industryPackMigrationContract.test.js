const fs = require('fs'); const path = require('path'); const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/043_g2_industry_pack_pilots.sql'), 'utf8');
describe('G2-05 industry pack migration', () => {
  test('creates tenant-bound immutable pilot snapshots', () => { expect(sql).toContain('industry_pack_pilot_snapshots'); expect(sql).toContain('BEFORE UPDATE OR DELETE'); expect(sql).toContain('REFERENCES public.industrial_process_revisions(id, company_id)'); });
  test('does not mark unreviewed packs as approved', () => { expect(sql).toContain("pack_approval_status = 'expert_review_required'"); });
});
