const fs = require('fs');
const path = require('path');

const pilot = fs.readFileSync(
  path.join(__dirname, '../../scripts/test-carrier-document-pilot.js'), 'utf8'
);
const workflow = fs.readFileSync(
  path.join(__dirname, '../../.github/workflows/backend-ci.yml'), 'utf8'
);

describe('R07 isolated pilot contract', () => {
  test('keeps the destructive synthetic fixture behind explicit isolation guards', () => {
    expect(pilot).toContain("ALLOW_CARRIER_DOCUMENT_PILOT !== '1'");
    expect(pilot).toContain('I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA');
    expect(pilot).toContain('CARRIER_PILOT_DATABASE');
    expect(pilot).toMatch(/NODE_ENV === 'production'/);
  });

  test('exercises origin safety boundaries and retains a dedicated artifact', () => {
    expect(pilot).toContain("'origin_workbook'");
    expect(pilot).toContain("'origin_specialist_reviewer'");
    expect(pilot).toContain('ORIGIN_EVIDENCE_FILE_TAMPERED');
    expect(pilot).toContain('EVFTA_ORIGIN_SUPPORT_HANDOFF_NOT_PROOF_OF_ORIGIN');
    expect(pilot).toContain("proofOfOriginStatus, 'NOT_ISSUED'");
    expect(pilot).toContain("preferentialTreatmentStatus, 'NOT_GRANTED'");
    expect(pilot).toContain("'origin-handoff-pilot'");
  });

  test('uploads R06, R07 and R20 artifacts in CI', () => {
    expect(workflow).toContain('path: artifacts/ics2-handoff-pilot/result.json');
    expect(workflow).toContain('path: artifacts/origin-handoff-pilot/result.json');
    expect(workflow).toContain('path: artifacts/compliance-applicability-pilot/result.json');
  });
});
