const fs=require('fs');const path=require('path');const sql=fs.readFileSync(path.resolve(__dirname,'../../migrations/041_g2_vn_mrv_lifecycle.sql'),'utf8');
describe('G2-03 Vietnam MRV migration',()=>{
 test('creates tenant-bound immutable case, plan, filing and event ledgers',()=>{expect(sql).toContain('vn_mrv_case_revisions');expect(sql).toContain('vn_mrv_measurement_plan_revisions');expect(sql).toContain('vn_mrv_filing_snapshots');expect(sql).toContain('vn_mrv_external_events');expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(4);});
 test('links canonical facilities, corporate inventories and evidence',()=>{expect(sql).toContain('REFERENCES public.industrial_facility_revisions(id, company_id)');expect(sql).toContain('REFERENCES public.corporate_ghg_inventory_revisions(id, company_id)');expect(sql).toContain('REFERENCES public.evidence_documents(id, company_id)');});
});
