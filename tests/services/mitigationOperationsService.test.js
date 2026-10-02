const {MitigationOperationsService}=require('../../src/services/mitigationOperationsService');
const id=(n)=>`${n}0000000-0000-4000-8000-000000000001`;

describe('G2-04 mitigation operations service',()=>{
  test('builds a facility-scoped position without changing company gross totals',async()=>{
    const facilityId=id(1),inventoryId=id(2),allocationId=id(3),scenarioId=id(4);let insertValues;
    const database={query:jest.fn(async(sql,values)=>{
      if(sql.includes('SELECT id, facility_reference FROM industrial_facility_revisions'))return{rows:[{id:facilityId,facility_reference:'FAC-1'}]};
      if(sql.includes('FROM corporate_ghg_inventory_revisions i'))return{rows:[{id:inventoryId,automated_status:'inventory_review_required',latest_review_decision:'approved_for_internal_report',reporting_period_end:'2026-12-31',result_sha256:'a'.repeat(64),result_snapshot:{automatedStatus:'inventory_review_required',totals:{grossScope1AndLocationScope2KgCo2e:6000}},activity_snapshot:[{facilityReference:'FAC-1',scope:'scope1',calculatedCo2eKg:600},{facilityReference:'FAC-1',scope:'scope2',accountingMethod:'location_based',calculatedCo2eKg:400},{facilityReference:'FAC-2',scope:'scope1',calculatedCo2eKg:5000}]}]};
      if(sql.includes('FROM allowance_allocation_revisions'))return{rows:[{id:allocationId,instrument_type:'authority_quota',record_status:'evidence_confirmed',quantity_tco2e:0.5,evidence_document_id:id(5)}]};
      if(sql.includes('FROM mitigation_scenario_revisions s'))return{rows:[{id:scenarioId,expected_reduction_tco2e:0.1,evidence_snapshot:[{id:id(6)}]}]};
      if(sql.includes('INSERT INTO allowance_position_snapshots')){insertValues=values;return{rows:[{id:id(9),facility_revision_id:facilityId,corporate_inventory_id:inventoryId,reporting_year:2026,allocation_ids:[allocationId],scenario_ids:[scenarioId],gross_emissions_tco2e:values[6],authority_quota_tco2e:values[7],internal_budget_tco2e:values[8],credit_reference_tco2e:values[9],planned_reduction_tco2e:values[10],projected_position_tco2e:values[11],readiness_status:values[12],blockers:JSON.parse(values[13]),payload_sha256:values[15],disclaimer:values[17]}]};}
      throw new Error(`Unexpected SQL: ${sql}`);
    })};
    const result=await new MitigationOperationsService(database).createPosition(id(7),id(8),{facilityRevisionId:facilityId,corporateInventoryId:inventoryId,reportingYear:2026,allocationIds:[allocationId],scenarioIds:[scenarioId]});
    expect(insertValues[6]).toBe(1);expect(result.grossEmissionsTco2e).toBe(1);expect(result.projectedPositionTco2e).toBe(0.4);expect(result.readinessStatus).toBe('ready_for_internal_review');
  });

  test('transitions initiative lifecycle creating a new revision', async () => {
    const initId = id(1), companyId = id(2), userId = id(3), facId = id(4);
    const mockClient = {
      query: jest.fn(async (sql) => {
        if (sql === 'BEGIN' || sql.includes('pg_advisory_xact_lock') || sql === 'COMMIT') return {};
        if (sql.includes('SELECT COALESCE(MAX(revision),0)+1')) return { rows: [{ revision: 2 }] };
        if (sql.includes('INSERT INTO mitigation_initiative_revisions')) {
          return { rows: [{ id: id(9), facility_revision_id: facId, initiative_reference: 'INIT-1', revision: 2, title: 'Energy Efficiency', lifecycle_status: 'in_progress', owner_name: 'Lead', baseline_year: 2025, target_reduction_tco2e: 10, planned_start: '2026-01-01', planned_end: '2027-12-31', methodology: {}, assumptions: {}, evidence_snapshot: [], initiative_sha256: 'b'.repeat(64), created_at: new Date().toISOString() }] };
        }
        if (sql.includes('INSERT INTO mitigation_initiative_evidence')) return {};
        throw new Error(`Unexpected client SQL: ${sql}`);
      }),
      release: jest.fn()
    };
    const database = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM mitigation_initiative_revisions WHERE id=$1')) {
          return { rows: [{ id: initId, company_id: companyId, facility_revision_id: facId, initiative_reference: 'INIT-1', revision: 1, title: 'Energy Efficiency', lifecycle_status: 'proposed', owner_name: 'Lead', baseline_year: 2025, target_reduction_tco2e: 10, planned_start: '2026-01-01', planned_end: '2027-12-31', methodology: {}, assumptions: {}, evidence_snapshot: [] }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      connect: jest.fn(async () => mockClient)
    };
    const service = new MitigationOperationsService(database);
    const result = await service.transitionInitiativeLifecycle(companyId, userId, initId, { lifecycleStatus: 'in_progress', reason: 'Project started', notes: 'Stage 1 rollout' });
    expect(result.lifecycleStatus).toBe('in_progress');
    expect(result.revision).toBe(2);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
