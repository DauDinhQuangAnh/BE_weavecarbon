function text(value) {
  return String(value ?? '').trim();
}

function dateTime(value) {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeActivityInput(input = {}) {
  const quantity = input.quantity === '' || input.quantity === null || input.quantity === undefined
    ? null
    : Number(input.quantity);
  return {
    activityReference: text(input.activityReference || input.activity_reference),
    facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    processRevisionId: text(input.processRevisionId || input.process_revision_id) || null,
    measurementPointRevisionId: text(input.measurementPointRevisionId || input.measurement_point_revision_id) || null,
    activityType: text(input.activityType || input.activity_type),
    periodStart: dateTime(input.periodStart || input.period_start),
    periodEnd: dateTime(input.periodEnd || input.period_end),
    quantity,
    canonicalUnit: text(input.canonicalUnit || input.canonical_unit),
    sourceKind: text(input.sourceKind || input.source_kind).toLowerCase(),
    dataQualityLevel: text(input.dataQualityLevel || input.data_quality_level).toUpperCase(),
    rawPayload: input.rawPayload && typeof input.rawPayload === 'object' && !Array.isArray(input.rawPayload)
      ? input.rawPayload
      : {},
    sourceSha256: text(input.sourceSha256 || input.source_sha256).toLowerCase(),
    evidenceDocumentIds: [...new Set((Array.isArray(input.evidenceDocumentIds || input.evidence_document_ids)
      ? (input.evidenceDocumentIds || input.evidence_document_ids)
      : []).map(text).filter(Boolean))]
  };
}

function validateActivityInput(input = {}) {
  const value = normalizeActivityInput(input);
  const errors = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value.activityReference || value.activityReference.length > 120) errors.push('activityReference is required and must not exceed 120 characters.');
  if (!uuid.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (value.processRevisionId && !uuid.test(value.processRevisionId)) errors.push('processRevisionId must be a UUID.');
  if (value.measurementPointRevisionId && !uuid.test(value.measurementPointRevisionId)) errors.push('measurementPointRevisionId must be a UUID.');
  if (!value.activityType) errors.push('activityType is required.');
  if (!value.periodStart || !value.periodEnd || (value.periodStart && value.periodEnd && value.periodEnd < value.periodStart)) errors.push('A valid periodStart and periodEnd are required.');
  if (!Number.isFinite(value.quantity) || value.quantity < 0) errors.push('quantity must be zero or greater.');
  if (!value.canonicalUnit) errors.push('canonicalUnit is required.');
  if (!['invoice', 'meter', 'plc', 'sensor', 'supplier', 'manual', 'api'].includes(value.sourceKind)) errors.push('sourceKind is invalid.');
  if (!['L1', 'L2', 'L3', 'L4', 'L5'].includes(value.dataQualityLevel)) errors.push('dataQualityLevel must be L1-L5.');
  if (!/^[a-f0-9]{64}$/.test(value.sourceSha256)) errors.push('sourceSha256 must be a SHA-256 hex digest.');
  if (value.evidenceDocumentIds.length > 100 || value.evidenceDocumentIds.some((id) => !uuid.test(id))) errors.push('evidenceDocumentIds must contain at most 100 UUIDs.');
  return { value, errors };
}

module.exports = { normalizeActivityInput, validateActivityInput };
