const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '../../migrations/030_r20_compliance_applicability_core.sql'), 'utf8'
);

describe('R20 compliance applicability migration contract', () => {
  test('creates tenant-bound immutable evaluations and reviews', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.compliance_applicability_evaluations/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.compliance_applicability_reviews/i);
    expect(sql).toMatch(/FOREIGN KEY \(shipment_id, company_id\)/i);
    expect(sql).toMatch(/REFERENCES public\.shipments\(id, company_id\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(evaluation_id, company_id, shipment_id\)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.compliance_applicability_evaluations/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.compliance_applicability_reviews/i);
  });

  test('constrains lifecycle values and indexes foreign keys and tenant queries', () => {
    expect(sql).toContain("'specialist_review_required'");
    expect(sql).toContain("'confirmed_for_internal_planning'");
    expect(sql).toContain("reviewer_role = 'compliance_specialist'");
    expect(sql).toMatch(/reviewer_name_snapshot TEXT NOT NULL/i);
    expect(sql).toMatch(/idx_compliance_applicability_evaluations_tenant/i);
    expect(sql).toMatch(/idx_compliance_applicability_evaluations_created_by/i);
    expect(sql).toMatch(/idx_compliance_applicability_reviews_evaluation/i);
    expect(sql).toMatch(/idx_compliance_applicability_reviews_reviewer/i);
    expect(sql).not.toMatch(/TRUNCATE|DROP\s+TABLE/i);
  });
});
