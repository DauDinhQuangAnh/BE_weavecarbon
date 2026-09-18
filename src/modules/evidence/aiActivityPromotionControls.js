const crypto = require('crypto');
const { validateActivityInput } = require('../shared');

const ENGINE = 'weavecarbon.governed-semantic-mapper';
const ENGINE_VERSION = '1.0.0';
const TARGETS = new Set([
  'activityReference', 'activityType', 'periodStart', 'periodEnd',
  'quantity', 'canonicalUnit', 'unmapped'
]);
const REQUIRED_LINEAGE_TARGETS = ['periodStart', 'periodEnd', 'quantity', 'canonicalUnit'];
const PROHIBITED_SOURCE = /(?:emission[_. -]?factor|factor[_. -]?(?:id|value|version)|(?:^|[_. -])ef(?:$|[_. -])|gwp|co2e|carbon[_. -]?(?:result|total)|calculation|h[eệ][_. -]?s[oố][_. -]?ph[aá]t[_. -]?th[aả]i|k[eế]t[_. -]?qu[aả][_. -]?t[ií]nh)/iu;
const normalize = (value) => String(value ?? '').trim();
const labelKey = (value) => normalize(value).toLowerCase().normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function fieldSuggestion(fieldPath) {
  const raw = normalize(fieldPath);
  const key = labelKey(raw);
  if (PROHIBITED_SOURCE.test(raw)) {
    return { suggestedCanonicalField: 'unmapped', confidence: 1, rationale: 'Factor and calculation outputs are explicitly excluded from activity promotion.' };
  }
  const rules = [
    [/^(?:period_?start|start_?date|from_?date|billing_?start|ky_?bat_?dau|ngay_?bat_?dau|tu_?ngay)$/, 'periodStart', 0.97],
    [/^(?:period_?end|end_?date|to_?date|billing_?end|ky_?ket_?thuc|ngay_?ket_?thuc|den_?ngay)$/, 'periodEnd', 0.97],
    [/^(?:kwh_?total|quantity|usage|consumption|activity_?quantity|fuel_?quantity|volume|mass|weight|tong_?kwh|luong_?dien|so_?luong|tieu_?thu)$/, 'quantity', 0.9],
    [/^(?:unit|uom|canonical_?unit|measurement_?unit|don_?vi|dvt)$/, 'canonicalUnit', 0.92],
    [/^(?:activity_?type|resource_?type|fuel_?type|measurement_?type|loai_?hoat_?dong|loai_?nhien_?lieu)$/, 'activityType', 0.82],
    [/^(?:activity_?reference|invoice_?(?:number|no)|document_?(?:number|no)|reference|so_?hoa_?don|ma_?tham_?chieu)$/, 'activityReference', 0.8]
  ];
  const matched = rules.find(([pattern]) => pattern.test(key));
  return matched
    ? { suggestedCanonicalField: matched[1], confidence: matched[2], rationale: `Governed label rule matched ${key}.` }
    : { suggestedCanonicalField: 'unmapped', confidence: 0.4, rationale: 'No governed canonical activity-field rule matched this label.' };
}

function buildPromotionSuggestions({ review, evidence }, evidenceMatchSuggestions = []) {
  const fields = [...(review.fields || [])]
    .map((field) => {
      const suggestion = fieldSuggestion(field.field_path || field.fieldPath);
      return {
        fieldPath: field.field_path || field.fieldPath,
        confirmedValue: field.confirmed_value ?? field.confirmedValue ?? null,
        fieldDecision: field.decision,
        ...suggestion
      };
    })
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  const suggestions = {
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    evidenceDocumentId: evidence.id,
    evidenceChecksumSha256: evidence.checksum_sha256,
    extractionReviewId: review.id,
    extractionSha256: review.extraction_sha256,
    fields,
    evidenceMatches: [{
      evidenceDocumentId: evidence.id,
      relationship: 'source_document',
      confidence: 1,
      rationale: 'The reviewed extraction is checksum-bound to this source document.'
    }, ...evidenceMatchSuggestions]
  };
  return { ...suggestions, suggestionSha256: sha256(suggestions) };
}

function equivalent(target, left, right) {
  if (target === 'quantity') return Number.isFinite(Number(left)) && Number(left) === Number(right);
  if (target === 'periodStart' || target === 'periodEnd') {
    const a = new Date(left); const b = new Date(right);
    return !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && a.getTime() === b.getTime();
  }
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function validateCandidateInput(suggestions, input = {}) {
  const rawDecisions = Array.isArray(input.fieldDecisions) ? input.fieldDecisions : [];
  const decisionsByPath = new Map();
  const blockers = [];
  const warnings = [];
  for (const item of rawDecisions) {
    const fieldPath = normalize(item.fieldPath);
    if (!fieldPath || decisionsByPath.has(fieldPath)) {
      blockers.push({ code: 'FIELD_DECISION_DUPLICATE', severity: 'blocking', fieldPaths: fieldPath ? [fieldPath] : [], description: 'Every reviewed field requires exactly one semantic decision.' });
      continue;
    }
    decisionsByPath.set(fieldPath, item);
  }
  const normalizedDecisions = [];
  const mappedTargets = new Map();
  for (const suggestion of suggestions.fields) {
    const requested = decisionsByPath.get(suggestion.fieldPath);
    if (!requested) {
      blockers.push({ code: 'FIELD_DECISION_MISSING', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'A reviewed extraction field has no semantic decision.' });
      continue;
    }
    const canonicalField = normalize(requested.confirmedCanonicalField || requested.canonicalField);
    const decision = normalize(requested.decision).toLowerCase();
    const rationale = normalize(requested.rationale);
    if (!TARGETS.has(canonicalField) || !['accepted', 'corrected', 'rejected'].includes(decision)) {
      blockers.push({ code: 'FIELD_DECISION_INVALID', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'Semantic decision or canonical target is invalid.' });
      continue;
    }
    if (decision === 'accepted' && canonicalField !== suggestion.suggestedCanonicalField) {
      blockers.push({ code: 'FIELD_ACCEPTANCE_MISMATCH', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'Accepted mappings must retain the governed suggestion.' });
    }
    if (decision === 'corrected' && (canonicalField === suggestion.suggestedCanonicalField || rationale.length < 10)) {
      blockers.push({ code: 'FIELD_CORRECTION_RATIONALE_REQUIRED', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'Corrected mappings require a changed target and meaningful rationale.' });
    }
    if (decision === 'rejected' && (canonicalField !== 'unmapped' || rationale.length < 10)) {
      blockers.push({ code: 'FIELD_REJECTION_RATIONALE_REQUIRED', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'Rejected mappings must be unmapped and include meaningful rationale.' });
    }
    if (PROHIBITED_SOURCE.test(suggestion.fieldPath) && canonicalField !== 'unmapped') {
      blockers.push({ code: 'FACTOR_OR_CALCULATION_PROMOTION_FORBIDDEN', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: 'Emission-factor and calculation output fields cannot become authoritative activity data.' });
    }
    if (canonicalField !== 'unmapped') {
      if (mappedTargets.has(canonicalField)) {
        blockers.push({ code: 'CANONICAL_TARGET_DUPLICATE', severity: 'blocking', fieldPaths: [mappedTargets.get(canonicalField), suggestion.fieldPath], description: `Multiple extraction fields map to ${canonicalField}.` });
      } else {
        mappedTargets.set(canonicalField, suggestion.fieldPath);
      }
      const payloadValue = input.activityPayload?.[canonicalField];
      if (!equivalent(canonicalField, suggestion.confirmedValue, payloadValue)) {
        blockers.push({ code: 'MAPPED_VALUE_MISMATCH', severity: 'blocking', fieldPaths: [suggestion.fieldPath], description: `${canonicalField} does not match the human-confirmed extraction value.` });
      }
      if (suggestion.confidence < 0.75) {
        warnings.push({ code: `LOW_CONFIDENCE_MAPPING:${suggestion.fieldPath}`, severity: 'warning', fieldPaths: [suggestion.fieldPath], description: 'A low-confidence label mapping requires explicit risk acceptance.' });
      }
    }
    normalizedDecisions.push({
      fieldPath: suggestion.fieldPath,
      suggestedCanonicalField: suggestion.suggestedCanonicalField,
      confirmedCanonicalField: canonicalField,
      decision,
      confidence: suggestion.confidence,
      rationale,
      confirmedValue: suggestion.confirmedValue
    });
  }
  if (decisionsByPath.size !== suggestions.fields.length) {
    blockers.push({ code: 'FIELD_DECISION_COVERAGE_INVALID', severity: 'blocking', fieldPaths: [], description: 'Semantic decisions must cover the exact reviewed extraction field set.' });
  }
  const overrideRationales = input.overrideRationales && typeof input.overrideRationales === 'object'
    ? input.overrideRationales : {};
  for (const target of REQUIRED_LINEAGE_TARGETS) {
    if (!mappedTargets.has(target) && normalize(overrideRationales[target]).length < 10) {
      blockers.push({ code: `LINEAGE_OVERRIDE_REQUIRED:${target}`, severity: 'blocking', fieldPaths: [], description: `${target} must be mapped from a reviewed field or carry an explicit override rationale.` });
    }
  }
  const activityPayload = {
    ...(input.activityPayload || {}),
    evidenceDocumentIds: suggestions.evidenceMatches.map((item) => item.evidenceDocumentId),
    sourceSha256: suggestions.evidenceChecksumSha256,
    rawPayload: {
      origin: 'controlled_ai_ocr_promotion',
      extractionReviewId: suggestions.extractionReviewId,
      suggestionSha256: suggestions.suggestionSha256,
      overrideRationales
    }
  };
  const activityValidation = validateActivityInput(activityPayload);
  for (const error of activityValidation.errors) {
    blockers.push({ code: 'ACTIVITY_PAYLOAD_INVALID', severity: 'blocking', fieldPaths: [], description: error });
  }
  if (!['L1', 'L2', 'L3'].includes(activityValidation.value.dataQualityLevel)) {
    blockers.push({ code: 'OCR_DATA_QUALITY_OVERCLAIM', severity: 'blocking', fieldPaths: [], description: 'OCR promotion cannot directly claim reconciled or independently verified L4/L5 data.' });
  }
  if (activityValidation.value.quantity === 0) {
    warnings.push({ code: 'ZERO_QUANTITY', severity: 'warning', fieldPaths: [], description: 'A zero-quantity activity requires explicit reviewer acceptance.' });
  }
  const resolutions = Array.isArray(input.anomalyResolutions) ? input.anomalyResolutions.map((item) => ({
    code: normalize(item.code), resolution: normalize(item.resolution), rationale: normalize(item.rationale)
  })) : [];
  const warningCodeSet = new Set(warnings.map((item) => item.code));
  const resolvedCodes = new Set();
  for (const item of resolutions) {
    if (!warningCodeSet.has(item.code) || resolvedCodes.has(item.code) ||
        !['resolved', 'accepted_with_rationale'].includes(item.resolution) || item.rationale.length < 10) {
      blockers.push({ code: 'ANOMALY_RESOLUTION_INVALID', severity: 'blocking', fieldPaths: [], description: 'Anomaly resolutions must uniquely reference a current warning and include a meaningful rationale.' });
      continue;
    }
    resolvedCodes.add(item.code);
  }
  for (const warning of warnings) {
    if (!resolvedCodes.has(warning.code)) {
      blockers.push({ code: `UNRESOLVED_WARNING:${warning.code}`, severity: 'blocking', fieldPaths: warning.fieldPaths, description: 'Every warning requires an explicit resolution and rationale.' });
    }
  }
  return {
    activityPayload: activityValidation.value,
    fieldDecisions: normalizedDecisions,
    anomalies: [...blockers, ...warnings],
    anomalyResolutions: resolutions,
    blockerCodes: [...new Set(blockers.map((item) => item.code))],
    warningCodes: [...new Set(warnings.map((item) => item.code))]
  };
}

module.exports = {
  ENGINE,
  ENGINE_VERSION,
  TARGETS,
  PROHIBITED_SOURCE,
  sha256,
  fieldSuggestion,
  buildPromotionSuggestions,
  validateCandidateInput
};
