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
});
