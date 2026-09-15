const express=require('express');const {authenticate,requireRole,requireCompanyAdmin}=require('../middleware/auth');const asyncHandler=require('../utils/asyncHandler');const {sendError,sendSuccess}=require('../utils/http');const {logAuditTrail}=require('../services/auditTrailService');const {mitigationOperationsService}=require('../services/mitigationOperationsService');
const router=express.Router();router.use(authenticate);router.use(requireRole('b2b'));
function blocked(res,item,notFound='NO_COMPANY'){if(!item)return sendError(res,{status:404,code:notFound,message:'Record or active company not found.'});if(item.blocked)return sendError(res,{status:422,code:item.code,message:item.message,details:item.details});return null;}
const write=(method,event,field)=>(asyncHandler(async(req,res)=>{const item=await mitigationOperationsService[method](req.companyId,req.userId,req.body);const stop=blocked(res,item);if(stop)return stop;await logAuditTrail({companyId:req.companyId,userId:req.userId,dataGroup:'mitigation_operations',changedField:field,newValue:item.id,reason:event,notes:item.readinessStatus||item.recordStatus||item.lifecycleStatus||''});return sendSuccess(res,{status:201,data:item});}));
router.get('/initiatives',asyncHandler(async(req,res)=>{const x=await mitigationOperationsService.listInitiatives(req.companyId);return blocked(res,x)||sendSuccess(res,{data:x});}));
router.post('/initiatives',requireCompanyAdmin,write('createInitiative','g2.mitigation_initiative_created','initiative.revision_created'));
router.get('/scenarios',asyncHandler(async(req,res)=>{const x=await mitigationOperationsService.listScenarios(req.companyId);return blocked(res,x)||sendSuccess(res,{data:x});}));
router.post('/scenarios',requireCompanyAdmin,write('createScenario','g2.mitigation_scenario_created','scenario.revision_created'));
router.get('/allocations',asyncHandler(async(req,res)=>{const x=await mitigationOperationsService.listAllocations(req.companyId);return blocked(res,x)||sendSuccess(res,{data:x});}));
router.post('/allocations',requireCompanyAdmin,write('createAllocation','g2.allowance_allocation_created','allocation.revision_created'));
router.get('/positions',asyncHandler(async(req,res)=>{const x=await mitigationOperationsService.listPositions(req.companyId);return blocked(res,x)||sendSuccess(res,{data:x});}));
router.post('/positions',requireCompanyAdmin,write('createPosition','g2.allowance_position_created','position.snapshot_created'));
module.exports=router;
