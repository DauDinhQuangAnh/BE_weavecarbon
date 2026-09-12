const fs = require('fs');
const path = require('path');

describe('R06 ICS2 handoff migration contract', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../migrations/028_r06_ics2_filing_handoff.sql'), 'utf8'
  );

  test('adds a tenant-bound profile carrying the controlled technical identity', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.shipment_ics2_profiles/i);
    expect(sql).toMatch(/weavecarbon\.ics2-filing-handoff/i);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_shipment_ics2_profiles_company_lrn/i);
    expect(sql).toMatch(/technical_package_version TEXT NOT NULL/i);
    expect(sql).toMatch(/UNIQUE\(id, company_id, shipment_id\)/i);
  });

  test('adds checksum-bound append-only external events', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ics2_external_events/i);
    expect(sql).toMatch(/document_payload_sha256 TEXT NOT NULL/i);
    expect(sql).toMatch(/document_file_sha256 TEXT NOT NULL/i);
    expect(sql).toMatch(/FOREIGN KEY \(company_id, shipment_id, evidence_document_id\)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.ics2_external_events/i);
  });

  test('requires an ICS2-specific reviewer role', () => {
    expect(sql).toMatch(/'ics2_dataset'/i);
    expect(sql).toMatch(/'ics2_filing_reviewer'/i);
  });
});
