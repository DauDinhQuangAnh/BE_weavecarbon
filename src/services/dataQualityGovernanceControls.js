const crypto = require('crypto');

const DQL_METHOD_VERSION = 'WEAVECARBON-DQL-1.0.0';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function number(value) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function scoreDql(input = {}) {
  const dimensions = ['temporal', 'geographic', 'technological', 'completeness', 'reliability'];
  const scores = Object.fromEntries(dimensions.map((key) => [key, number(input[`${key}Score`] ?? input[`${key}_score`])]));
  const completenessPercent = number(input.completenessPercent ?? input.completeness_percent);
  const errors = dimensions.filter((key) => !Number.isInteger(scores[key]) || scores[key] < 1 || scores[key] > 5)
    .map((key) => `${key}Score must be an integer from 1 to 5.`);
  if (completenessPercent === null || completenessPercent < 0 || completenessPercent > 100) errors.push('completenessPercent must be from 0 to 100.');
  if (errors.length) return { errors };
  const overallScore = Number((dimensions.reduce((sum, key) => sum + scores[key], 0) / dimensions.length).toFixed(2));
  const level = overallScore >= 4.5 ? 'L5' : overallScore >= 3.5 ? 'L4' : overallScore >= 2.5 ? 'L3' : overallScore >= 1.5 ? 'L2' : 'L1';
  const value = { subjectType: text(input.subjectType || input.subject_type).toLowerCase(), subjectReference: text(input.subjectReference || input.subject_reference),
    methodologyVersion: DQL_METHOD_VERSION, scores, completenessPercent, overallScore, dataQualityLevel: level,
    rationale: text(input.rationale), improvementActions: array(input.improvementActions || input.improvement_actions).map(text).filter(Boolean),
    evidenceDocumentIds: [...new Set(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text).filter(Boolean))] };
  if (!['activity', 'facility', 'process', 'measurement_point', 'emission_factor'].includes(value.subjectType)) errors.push('subjectType is invalid.');
  if (!value.subjectReference || value.subjectReference.length > 240) errors.push('subjectReference is required and must not exceed 240 characters.');
  if (!value.rationale || value.rationale.length > 5000) errors.push('rationale is required and must not exceed 5000 characters.');
  if (value.evidenceDocumentIds.length > 100 || value.evidenceDocumentIds.some((id) => !UUID_REGEX.test(id))) errors.push('evidenceDocumentIds must contain at most 100 UUIDs.');
  return { value: { ...value, assessmentSha256: sha256(value) }, errors };
}

function normalizeFactorProposal(input = {}) {
  const value = { proposalReference: text(input.proposalReference || input.proposal_reference), factorId: text(input.factorId || input.factor_id),
    label: text(input.label), factorValue: number(input.factorValue ?? input.factor_value), unit: text(input.unit),
    sourceName: text(input.sourceName || input.source_name), sourceUrl: text(input.sourceUrl || input.source_url),
    sourceYear: number(input.sourceYear ?? input.source_year), geography: text(input.geography), boundary: text(input.boundary),
    validFrom: text(input.validFrom || input.valid_from) || null, validTo: text(input.validTo || input.valid_to) || null,
    gwpBasis: text(input.gwpBasis || input.gwp_basis), uncertaintyCv: number(input.uncertaintyCv ?? input.uncertainty_cv),
    isProxy: input.isProxy === true || input.is_proxy === true,
    evidenceDocumentIds: [...new Set(array(input.evidenceDocumentIds || input.evidence_document_ids).map(text).filter(Boolean))] };
  return { ...value, payloadSha256: sha256(value) };
}

function validateFactorProposal(input = {}) {
  const value = normalizeFactorProposal(input); const errors = [];
  ['proposalReference', 'factorId', 'label', 'unit', 'sourceName', 'sourceUrl', 'geography', 'boundary', 'gwpBasis'].forEach((key) => { if (!value[key]) errors.push(`${key} is required.`); });
  if (value.factorValue === null || value.factorValue < 0) errors.push('factorValue must be zero or greater.');
  if (value.uncertaintyCv === null || value.uncertaintyCv < 0) errors.push('uncertaintyCv must be zero or greater.');
  if (value.sourceYear !== null && (!Number.isInteger(value.sourceYear) || value.sourceYear < 1900 || value.sourceYear > 2200)) errors.push('sourceYear is invalid.');
  if (value.validFrom && value.validTo && value.validTo < value.validFrom) errors.push('validTo must be on or after validFrom.');
  if (!value.evidenceDocumentIds.length || value.evidenceDocumentIds.length > 100 || value.evidenceDocumentIds.some((id) => !UUID_REGEX.test(id))) errors.push('At least one and at most 100 evidence UUIDs are required.');
  return { value, errors };
}

function validateFactorReview(input = {}) {
  const value = { reviewerRole: text(input.reviewerRole || input.reviewer_role), decision: text(input.decision).toLowerCase(), notes: text(input.notes) }; const errors = [];
  if (value.reviewerRole !== 'emission_factor_reviewer') errors.push('reviewerRole must be emission_factor_reviewer.');
  if (!['approved_for_release_candidate', 'needs_information', 'rejected'].includes(value.decision)) errors.push('decision is invalid.');
  if (!value.notes || value.notes.length > 5000) errors.push('notes are required and must not exceed 5000 characters.');
  return { value, errors };
}

module.exports = { DQL_METHOD_VERSION, scoreDql, validateFactorProposal, validateFactorReview };
