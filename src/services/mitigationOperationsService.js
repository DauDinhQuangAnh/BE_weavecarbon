const pool = require('../config/database');
const { RULESET, validateInitiative, validateScenario, validateAllocation, positionReadiness, sha } = require('./mitigationOperationsControls');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlled = (items) => items.every((item) => ['locked', 'third_party_verified'].includes(item.status) && /^[a-f0-9]{64}$/i.test(item.checksumSha256) && item.fileSizeBytes > 0);

class MitigationOperationsService {
  constructor(database = pool) { this.database = database; }
  async companyExists(companyId) { const result = await this.database.query('SELECT id FROM companies WHERE id=$1', [companyId]); return Boolean(result.rows[0]); }
  async evidence(companyId, ids) {
    if (!ids.length) return [];
    const result = await this.database.query(`SELECT id, document_name, evidence_type, status, checksum_sha256, file_size_bytes
      FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [companyId, ids]);
    return result.rows.map((row) => ({ id: row.id, name: row.document_name, type: row.evidence_type, status: row.status,
      checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0) }));
  }
  async listInitiatives(companyId) {
    if (!(await this.companyExists(companyId))) return null;
    const result = await this.database.query(`SELECT i.*, f.facility_reference, f.name AS facility_name FROM mitigation_initiative_revisions i
      JOIN industrial_facility_revisions f ON f.id=i.facility_revision_id AND f.company_id=i.company_id
      WHERE i.company_id=$1 ORDER BY i.created_at DESC`, [companyId]);
    return result.rows.map(this.formatInitiative);
  }
  async createInitiative(companyId, userId, input) {
    if (!(await this.companyExists(companyId))) return null;
    const { value, errors } = validateInitiative(input);
    if (errors.length) return { blocked: true, code: 'MITIGATION_INITIATIVE_INVALID', message: errors.join(' '), details: errors };
    const [facility, inventory, evidence] = await Promise.all([
      this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId, companyId]),
      value.baselineInventoryId ? this.database.query('SELECT id FROM corporate_ghg_inventory_revisions WHERE id=$1 AND company_id=$2', [value.baselineInventoryId, companyId]) : Promise.resolve({ rows: [{}] }),
      this.evidence(companyId, value.evidenceDocumentIds)
    ]);
    if (!facility.rows[0] || !inventory.rows[0] || evidence.length !== value.evidenceDocumentIds.length) return { blocked: true, code: 'MITIGATION_REFERENCE_INVALID', message: 'Facility, inventory and evidence must belong to the active company.' };
    if (!controlled(evidence)) return { blocked: true, code: 'MITIGATION_EVIDENCE_NOT_CONTROLLED', message: 'Initiative evidence must be locked or third-party verified, checksum identified and non-empty.' };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:mitigation:${value.initiativeReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM mitigation_initiative_revisions WHERE company_id=$1 AND initiative_reference=$2', [companyId, value.initiativeReference]);
      const inserted = await client.query(`INSERT INTO mitigation_initiative_revisions
        (company_id,facility_revision_id,initiative_reference,revision,title,lifecycle_status,owner_name,baseline_year,baseline_inventory_id,target_reduction_tco2e,planned_start,planned_end,methodology,assumptions,evidence_snapshot,initiative_sha256,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17) RETURNING *`,
      [companyId,value.facilityRevisionId,value.initiativeReference,Number(next.rows[0].revision),value.title,value.lifecycleStatus,value.ownerName,value.baselineYear,value.baselineInventoryId,value.targetReductionTco2e,value.plannedStart,value.plannedEnd,JSON.stringify(value.methodology),JSON.stringify(value.assumptions),JSON.stringify(evidence),value.initiativeSha256,userId]);
      for (const item of evidence) await client.query(`INSERT INTO mitigation_initiative_evidence (company_id,initiative_id,evidence_document_id,evidence_role,created_by) VALUES ($1,$2,$3,$4,$5)`, [companyId,inserted.rows[0].id,item.id,value.evidenceRole,userId]);
      await client.query('COMMIT'); return this.formatInitiative(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async listScenarios(companyId) {
    if (!(await this.companyExists(companyId))) return null;
    const result = await this.database.query(`SELECT s.*, i.initiative_reference, i.title AS initiative_title FROM mitigation_scenario_revisions s
      JOIN mitigation_initiative_revisions i ON i.id=s.initiative_id AND i.company_id=s.company_id WHERE s.company_id=$1 ORDER BY s.created_at DESC`, [companyId]);
    return result.rows.map(this.formatScenario);
  }
  async createScenario(companyId, userId, input) {
    const { value, errors } = validateScenario(input);
    if (errors.length) return { blocked: true, code: 'MITIGATION_SCENARIO_INVALID', message: errors.join(' '), details: errors };
    const [initiative, evidence] = await Promise.all([this.database.query('SELECT id FROM mitigation_initiative_revisions WHERE id=$1 AND company_id=$2', [value.initiativeId, companyId]), this.evidence(companyId, value.evidenceDocumentIds)]);
    if (!initiative.rows[0] || evidence.length !== value.evidenceDocumentIds.length) return { blocked: true, code: 'MITIGATION_SCENARIO_REFERENCE_INVALID', message: 'Initiative and evidence must belong to the active company.' };
    if (!controlled(evidence)) return { blocked: true, code: 'MITIGATION_EVIDENCE_NOT_CONTROLLED', message: 'Scenario evidence must be controlled.' };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:scenario:${value.scenarioReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM mitigation_scenario_revisions WHERE company_id=$1 AND scenario_reference=$2', [companyId,value.scenarioReference]);
      const result = await client.query(`INSERT INTO mitigation_scenario_revisions
        (company_id,initiative_id,scenario_reference,revision,scenario_type,period_start,period_end,baseline_emissions_tco2e,projected_emissions_tco2e,expected_reduction_tco2e,annual_projection,assumptions,sensitivity,evidence_snapshot,scenario_sha256,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16) RETURNING *`,
      [companyId,value.initiativeId,value.scenarioReference,Number(next.rows[0].revision),value.scenarioType,value.periodStart,value.periodEnd,value.baselineEmissionsTco2e,value.projectedEmissionsTco2e,value.expectedReductionTco2e,JSON.stringify(value.annualProjection),JSON.stringify(value.assumptions),JSON.stringify(value.sensitivity),JSON.stringify(evidence),value.scenarioSha256,userId]);
      for (const item of evidence) await client.query('INSERT INTO mitigation_scenario_evidence (company_id,scenario_id,evidence_document_id,created_by) VALUES ($1,$2,$3,$4)', [companyId,result.rows[0].id,item.id,userId]);
      await client.query('COMMIT'); return this.formatScenario(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async listAllocations(companyId) {
    if (!(await this.companyExists(companyId))) return null;
    const result = await this.database.query(`SELECT a.*, f.facility_reference, f.name AS facility_name FROM allowance_allocation_revisions a
      JOIN industrial_facility_revisions f ON f.id=a.facility_revision_id AND f.company_id=a.company_id WHERE a.company_id=$1 ORDER BY a.created_at DESC`, [companyId]);
    return result.rows.map(this.formatAllocation);
  }
  async createAllocation(companyId, userId, input) {
    const { value, errors } = validateAllocation(input);
    if (errors.length) return { blocked: true, code: 'ALLOWANCE_ALLOCATION_INVALID', message: errors.join(' '), details: errors };
    const [facility, evidence] = await Promise.all([this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId,companyId]), value.evidenceDocumentId ? this.evidence(companyId,[value.evidenceDocumentId]) : Promise.resolve([])]);
    if (!facility.rows[0] || (value.evidenceDocumentId && evidence.length !== 1)) return { blocked: true, code: 'ALLOWANCE_REFERENCE_INVALID', message: 'Facility and evidence must belong to the active company.' };
    if (value.recordStatus === 'evidence_confirmed' && !controlled(evidence)) return { blocked: true, code: 'ALLOWANCE_EVIDENCE_NOT_CONTROLLED', message: 'Confirmed allocation evidence must be controlled.' };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:allocation:${value.allocationReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM allowance_allocation_revisions WHERE company_id=$1 AND allocation_reference=$2', [companyId,value.allocationReference]);
      const result = await client.query(`INSERT INTO allowance_allocation_revisions
        (company_id,facility_revision_id,allocation_reference,revision,reporting_year,instrument_type,record_status,quantity_tco2e,vintage_year,external_reference,evidence_document_id,legal_basis_snapshot,notes,allocation_sha256,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) RETURNING *`,
      [companyId,value.facilityRevisionId,value.allocationReference,Number(next.rows[0].revision),value.reportingYear,value.instrumentType,value.recordStatus,value.quantityTco2e,value.vintageYear,value.externalReference,value.evidenceDocumentId,JSON.stringify(value.legalBasis),value.notes,value.allocationSha256,userId]);
      await client.query('COMMIT'); return this.formatAllocation(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async listPositions(companyId) {
    if (!(await this.companyExists(companyId))) return null;
    const result = await this.database.query('SELECT * FROM allowance_position_snapshots WHERE company_id=$1 ORDER BY created_at DESC', [companyId]); return result.rows.map(this.formatPosition);
  }
  async createPosition(companyId, userId, input = {}) {
    const facilityId=String(input.facilityRevisionId||''); const inventoryId=String(input.corporateInventoryId||''); const reportingYear=Number(input.reportingYear);
    const allocationIds=[...new Set(Array.isArray(input.allocationIds)?input.allocationIds.map(String):[])]; const scenarioIds=[...new Set(Array.isArray(input.scenarioIds)?input.scenarioIds.map(String):[])];
    if (!UUID.test(facilityId)||!UUID.test(inventoryId)||!Number.isInteger(reportingYear)||allocationIds.some((id)=>!UUID.test(id))||scenarioIds.some((id)=>!UUID.test(id))) return { blocked:true,code:'ALLOWANCE_POSITION_INVALID',message:'Facility, inventory, allocations and scenarios must use valid identifiers.' };
    const [facility,inventoryResult,allocationResult,scenarioResult]=await Promise.all([
      this.database.query('SELECT id, facility_reference FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2',[facilityId,companyId]),
      this.database.query(`SELECT i.*, (SELECT r.decision FROM corporate_ghg_inventory_reviews r WHERE r.inventory_id=i.id AND r.company_id=i.company_id ORDER BY r.created_at DESC LIMIT 1) AS latest_review_decision FROM corporate_ghg_inventory_revisions i WHERE i.id=$1 AND i.company_id=$2`,[inventoryId,companyId]),
      allocationIds.length?this.database.query('SELECT * FROM allowance_allocation_revisions WHERE company_id=$1 AND facility_revision_id=$2 AND reporting_year=$3 AND id=ANY($4::uuid[])',[companyId,facilityId,reportingYear,allocationIds]):Promise.resolve({rows:[]}),
      scenarioIds.length?this.database.query(`SELECT s.* FROM mitigation_scenario_revisions s JOIN mitigation_initiative_revisions i ON i.id=s.initiative_id AND i.company_id=s.company_id WHERE s.company_id=$1 AND i.facility_revision_id=$2 AND s.id=ANY($3::uuid[]) AND s.period_start <= $4::date AND s.period_end >= $5::date`,[companyId,facilityId,scenarioIds,`${reportingYear}-12-31`,`${reportingYear}-01-01`]):Promise.resolve({rows:[]})]);
    if(!facility.rows[0]||!inventoryResult.rows[0]||allocationResult.rows.length!==allocationIds.length||scenarioResult.rows.length!==scenarioIds.length)return{blocked:true,code:'ALLOWANCE_POSITION_REFERENCE_INVALID',message:'All position references must belong to the selected company, facility and reporting year.'};
    const inventory=inventoryResult.rows[0],allocations=allocationResult.rows,scenarios=scenarioResult.rows;
    const facilityReference=facility.rows[0].facility_reference; const facilitySources=(inventory.activity_snapshot||[]).filter((row)=>row.facilityReference===facilityReference||row.facility_reference===facilityReference);
    const grossKg=facilitySources.filter((row)=>row.scope==='scope1'||(row.scope==='scope2'&&(row.accountingMethod||row.accounting_method)!=='market_based')).reduce((total,row)=>total+Number(row.calculatedCo2eKg??row.calculated_co2e_kg??0),0);
    const inventoryYear=new Date(inventory.reporting_period_end).getUTCFullYear(); const readiness=positionReadiness({inventory,allocations,scenarios,facilityActivityCount:facilitySources.length,reportingYearMatches:inventoryYear===reportingYear});
    const gross=grossKg/1000;
    const sum=(types)=>allocations.filter((row)=>types.includes(row.instrument_type)).reduce((total,row)=>total+Number(row.quantity_tco2e),0);
    const authority=sum(['authority_quota','transfer_reference']),internal=sum(['internal_budget']),credits=sum(['credit_reference']);
    const planned=scenarios.reduce((total,row)=>total+Number(row.expected_reduction_tco2e),0); const projected=Number((gross-planned-authority-credits).toFixed(6));
    const evidence=[...allocations.filter((row)=>row.evidence_document_id).map((row)=>({id:row.evidence_document_id,source:'allocation'})),...scenarios.flatMap((row)=>row.evidence_snapshot||[])];
    const payload={schemaId:'weavecarbon.allowance-position',schemaVersion:'1.0.0',ruleset:RULESET,reportingYear,facilityRevisionId:facilityId,corporateInventoryId:inventoryId,inventoryResultSha256:inventory.result_sha256,grossEmissionsTco2e:gross,authorityQuotaTco2e:authority,internalBudgetTco2e:internal,creditReferenceTco2e:credits,plannedReductionTco2e:planned,projectedPositionTco2e:projected,allocationIds,scenarioIds,readiness}; const payloadSha256=sha(payload);
    const result=await this.database.query(`INSERT INTO allowance_position_snapshots (company_id,facility_revision_id,corporate_inventory_id,reporting_year,allocation_ids,scenario_ids,gross_emissions_tco2e,authority_quota_tco2e,internal_budget_tco2e,credit_reference_tco2e,planned_reduction_tco2e,projected_position_tco2e,readiness_status,blockers,payload,payload_sha256,evidence_snapshot,disclaimer,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19) RETURNING *`,[companyId,facilityId,inventoryId,reportingYear,JSON.stringify(allocationIds),JSON.stringify(scenarioIds),gross,authority,internal,credits,planned,projected,readiness.status,JSON.stringify(readiness.blockers),JSON.stringify(payload),payloadSha256,JSON.stringify(evidence),RULESET.disclaimer,userId]);
    return this.formatPosition(result.rows[0]);
  }
  formatInitiative(row) { return {id:row.id,facilityRevisionId:row.facility_revision_id,facilityReference:row.facility_reference,facilityName:row.facility_name,initiativeReference:row.initiative_reference,revision:Number(row.revision),title:row.title,lifecycleStatus:row.lifecycle_status,ownerName:row.owner_name,baselineYear:Number(row.baseline_year),baselineInventoryId:row.baseline_inventory_id,targetReductionTco2e:Number(row.target_reduction_tco2e),plannedStart:row.planned_start,plannedEnd:row.planned_end,methodology:row.methodology,assumptions:row.assumptions,evidenceSnapshot:row.evidence_snapshot,initiativeSha256:row.initiative_sha256,createdAt:row.created_at}; }
  formatScenario(row) { return {id:row.id,initiativeId:row.initiative_id,initiativeReference:row.initiative_reference,initiativeTitle:row.initiative_title,scenarioReference:row.scenario_reference,revision:Number(row.revision),scenarioType:row.scenario_type,periodStart:row.period_start,periodEnd:row.period_end,baselineEmissionsTco2e:Number(row.baseline_emissions_tco2e),projectedEmissionsTco2e:Number(row.projected_emissions_tco2e),expectedReductionTco2e:Number(row.expected_reduction_tco2e),annualProjection:row.annual_projection,assumptions:row.assumptions,sensitivity:row.sensitivity,evidenceSnapshot:row.evidence_snapshot,scenarioSha256:row.scenario_sha256,createdAt:row.created_at}; }
  formatAllocation(row) { return {id:row.id,facilityRevisionId:row.facility_revision_id,facilityReference:row.facility_reference,facilityName:row.facility_name,allocationReference:row.allocation_reference,revision:Number(row.revision),reportingYear:Number(row.reporting_year),instrumentType:row.instrument_type,recordStatus:row.record_status,quantityTco2e:Number(row.quantity_tco2e),vintageYear:row.vintage_year?Number(row.vintage_year):null,externalReference:row.external_reference,evidenceDocumentId:row.evidence_document_id,legalBasis:row.legal_basis_snapshot,notes:row.notes,allocationSha256:row.allocation_sha256,createdAt:row.created_at}; }
  formatPosition(row) { return {id:row.id,facilityRevisionId:row.facility_revision_id,corporateInventoryId:row.corporate_inventory_id,reportingYear:Number(row.reporting_year),allocationIds:row.allocation_ids,scenarioIds:row.scenario_ids,grossEmissionsTco2e:Number(row.gross_emissions_tco2e),authorityQuotaTco2e:Number(row.authority_quota_tco2e),internalBudgetTco2e:Number(row.internal_budget_tco2e),creditReferenceTco2e:Number(row.credit_reference_tco2e),plannedReductionTco2e:Number(row.planned_reduction_tco2e),projectedPositionTco2e:Number(row.projected_position_tco2e),readinessStatus:row.readiness_status,blockers:row.blockers,payloadSha256:row.payload_sha256,disclaimer:row.disclaimer,createdAt:row.created_at}; }
}

module.exports={MitigationOperationsService,mitigationOperationsService:new MitigationOperationsService()};
