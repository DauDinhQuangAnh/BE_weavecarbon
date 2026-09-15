const fs=require('fs');const path=require('path');const sql=fs.readFileSync(path.resolve(__dirname,'../../migrations/042_g2_mitigation_allowance_operations.sql'),'utf8');
describe('G2-04 mitigation and allowance migration',()=>{
  test('creates immutable initiative, evidence, scenario, allocation and position ledgers',()=>{['mitigation_initiative_revisions','mitigation_initiative_evidence','mitigation_scenario_revisions','mitigation_scenario_evidence','allowance_allocation_revisions','allowance_position_snapshots'].forEach((name)=>expect(sql).toContain(name));expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(6);});
  test('keeps references tenant-bound',()=>{expect(sql).toContain('REFERENCES public.industrial_facility_revisions(id, company_id)');expect(sql).toContain('REFERENCES public.corporate_ghg_inventory_revisions(id, company_id)');expect(sql).toContain('REFERENCES public.evidence_documents(id, company_id)');});
});
