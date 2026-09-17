const { validateRule, validateRun, calculateAllocation } = require('../../src/services/dynamicAllocationControls');

const facilityId = '10000000-0000-4000-8000-000000000001';
const ruleId = '20000000-0000-4000-8000-000000000001';
const activityId = '30000000-0000-4000-8000-000000000001';
const evidenceId = '40000000-0000-4000-8000-000000000001';

describe('G2 dynamic allocation controls', () => {
  test('accepts a governed forward allocation rule', () => {
    const result = validateRule({ allocationReference: 'ELEC-2026', facilityRevisionId: facilityId,
      sourceLevel: 'facility', targetLevel: 'process', allocationMethod: 'machine_hour', driverUnit: 'hour',
      methodologyReference: 'Plant allocation SOP', methodologyVersion: '2.1', rationale: 'Allocate shared electricity by runtime.',
      approvalStatus: 'approved', evidenceDocumentId: evidenceId });
    expect(result.errors).toEqual([]);
    expect(result.value.ruleSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects backward levels and ungoverned approved rules', () => {
    const result = validateRule({ allocationReference: 'BAD', facilityRevisionId: facilityId,
      sourceLevel: 'product', targetLevel: 'process', allocationMethod: 'mass', driverUnit: 'kg',
      methodologyReference: 'SOP', methodologyVersion: '1', rationale: 'No.', approvalStatus: 'approved' });
    expect(result.errors.join(' ')).toMatch(/move forward/);
    expect(result.errors.join(' ')).toMatch(/evidenceDocumentId/);
  });

  test('requires one source and unique positive targets', () => {
    const result = validateRun({ ruleRevisionId: ruleId, sourceActivityId: activityId,
      sourceAllocationLineId: activityId, targets: [{ targetEntityId: facilityId, driverValue: 0 }] });
    expect(result.errors.join(' ')).toMatch(/Exactly one/);
    expect(result.errors.join(' ')).toMatch(/greater than zero/);
  });

  test('allocates deterministically and reconciles rounding residuals', () => {
    const result = calculateAllocation({ sourceQuantity: 10, sourceUnit: 'kWh', driverUnit: 'hour', targets: [
      { targetEntityId: 'b0000000-0000-4000-8000-000000000001', driverValue: 1 },
      { targetEntityId: 'a0000000-0000-4000-8000-000000000001', driverValue: 2 },
      { targetEntityId: 'c0000000-0000-4000-8000-000000000001', driverValue: 3 }
    ] });
    expect(result.lines.map((line) => line.targetEntityId[0])).toEqual(['a', 'b', 'c']);
    expect(result.allocatedQuantity).toBe(10);
    expect(result.reconciliationDifference).toBe(0);
    expect(result.lines.reduce((sum, line) => sum + line.allocatedQuantity, 0)).toBe(10);
  });
});
