const {legalBasisFor,validateCase,filingReadiness}=require('../../src/services/vnMrvControls');
describe('G2-03 Vietnam MRV controls',()=>{
 test('switches the official facility-list basis on its effective date',()=>{expect(legalBasisFor('2026-09-24').sources.at(-1).id).toBe('QD-13-2024');expect(legalBasisFor('2026-09-25').sources.at(-1).id).toBe('QD-42-2026');});
 test('does not accept a confirmed listing without evidence',()=>{const result=validateCase({caseReference:'MRV-1',facilityRevisionId:'30000000-0000-4000-8000-000000000001',reportingYear:2026,sector:'industry_trade',applicabilityStatus:'confirmed_listed',assessmentDate:'2026-09-15',rationale:'Listed.'});expect(result.errors).toContain('Confirmed listing requires a listing reference and evidence UUID.');});
 test('keeps incomplete filing preparation out of ready status',()=>{const result=filingReadiness({mrvCase:{applicability_status:'undetermined'},plan:null,inventory:null,dqlRows:[]});expect(result.status).toBe('needs_information');expect(result.blockers.length).toBeGreaterThan(3);});
});
