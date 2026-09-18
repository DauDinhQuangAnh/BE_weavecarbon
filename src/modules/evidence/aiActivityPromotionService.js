const pool = require('../shared/database');
const { logAuditTrail } = require('../shared/auditing');
const controls = require('./aiActivityPromotionControls');
const { validateActivityInput } = require('../shared');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCKED = new Set(['locked', 'third_party_verified']);
const RELATIONSHIPS = new Set(['supports_activity', 'source_document', 'calibration_record', 'review_record']);
const text = (value) => String(value ?? '').trim();
const blocked = (code, message, status = 422, details = undefined) => ({
  blocked: true, code, message, status, ...(details ? { details } : {})
});
const snapshotEvidence = (row, relationship = 'supports_activity') => ({
  id: row.id,
  documentName: row.document_name,
  evidenceType: row.evidence_type,
  status: row.status,
  checksumSha256: row.checksum_sha256,
  fileSizeBytes: Number(row.file_size_bytes),
  relationship
});
const dateOnly = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const sameText = (left, right) => text(left).toLowerCase() === text(right).toLowerCase();
const periodsOverlap = (leftStart, leftEnd, rightStart, rightEnd) => {
  const values = [leftStart, leftEnd, rightStart, rightEnd].map((value) => dateOnly(value));
  return values.every(Boolean) && values[0] <= values[3] && values[2] <= values[1];
};
const camel = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()), value
]));
const candidateFingerprint = ({
  companyId, evidenceId, reviewId, candidateReference, revision, status,
  suggestionEngine, suggestionEngineVersion, suggestionSha256, sourceSnapshot,
  fieldDecisions, anomalies, anomalyResolutions, evidenceMatches, canonicalPayload,
  blockerCodes, warningCodes, notes
}) => controls.sha256({
  companyId, evidenceId, reviewId, candidateReference, revision, status,
  suggestionEngine, suggestionEngineVersion, suggestionSha256, sourceSnapshot,
  fieldDecisions, anomalies, anomalyResolutions, evidenceMatches, canonicalPayload,
  blockerCodes, warningCodes, notes
});

class AiActivityPromotionService {
  constructor(database = pool, audit = logAuditTrail) {
    this.database = database;
    this.audit = audit;
  }

  async _context(companyId, evidenceId, reviewId, queryable = this.database) {
    if (![evidenceId, reviewId].every((value) => UUID.test(text(value)))) return null;
    const result = await queryable.query(
      `SELECT review.*, evidence.document_name,evidence.evidence_type,evidence.status AS evidence_status,
              evidence.checksum_sha256,evidence.file_size_bytes,evidence.extracted_json,
              evidence.product_id,evidence.shipment_id,evidence.source_vendor,
              evidence.reporting_period_start,evidence.reporting_period_end,
              COALESCE((SELECT jsonb_agg(to_jsonb(field) ORDER BY field.field_path)
                FROM evidence_ai_field_decisions field
                WHERE field.company_id=review.company_id AND field.review_id=review.id),'[]'::jsonb) AS fields
       FROM evidence_ai_extraction_reviews review
       JOIN evidence_documents evidence ON evidence.id=review.evidence_document_id AND evidence.company_id=review.company_id
       WHERE review.company_id=$1 AND review.evidence_document_id=$2 AND review.id=$3`,
      [companyId, evidenceId, reviewId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      review: row,
      evidence: {
        id: evidenceId,
        document_name: row.document_name,
        evidence_type: row.evidence_type,
        status: row.evidence_status,
        checksum_sha256: row.checksum_sha256,
        file_size_bytes: row.file_size_bytes,
        extracted_json: row.extracted_json,
        product_id: row.product_id,
        shipment_id: row.shipment_id,
        source_vendor: row.source_vendor,
        reporting_period_start: row.reporting_period_start,
        reporting_period_end: row.reporting_period_end
      }
    };
  }

  async _evidenceMatchSuggestions(companyId, sourceEvidence, queryable = this.database) {
    const result = await queryable.query(
      `SELECT id,document_name,evidence_type,status,checksum_sha256,file_size_bytes,
              product_id,shipment_id,source_vendor,reporting_period_start,reporting_period_end
       FROM evidence_documents
       WHERE company_id=$1 AND id<>$2 AND status IN ('locked','third_party_verified')
       ORDER BY created_at DESC,id DESC LIMIT 50`,
      [companyId, sourceEvidence.id]
    );
    return result.rows
      .filter((row) => !/(?:emission.?factor|methodology|pcf.?source|calculation)/i.test(row.evidence_type || ''))
      .filter((row) => /^[a-f0-9]{64}$/i.test(row.checksum_sha256 || '') && Number(row.file_size_bytes) > 0)
      .map((row) => {
        let confidence = 0;
        const reasons = [];
        if (sameText(row.evidence_type, sourceEvidence.evidence_type)) {
          confidence += 0.2; reasons.push('same evidence type');
        }
        if (sourceEvidence.product_id && row.product_id === sourceEvidence.product_id) {
          confidence += 0.35; reasons.push('same product');
        }
        if (sourceEvidence.shipment_id && row.shipment_id === sourceEvidence.shipment_id) {
          confidence += 0.45; reasons.push('same shipment');
        }
        if (periodsOverlap(sourceEvidence.reporting_period_start, sourceEvidence.reporting_period_end,
          row.reporting_period_start, row.reporting_period_end)) {
          confidence += 0.25; reasons.push('overlapping reporting period');
        }
        if (sourceEvidence.source_vendor && row.source_vendor && sameText(row.source_vendor, sourceEvidence.source_vendor)) {
          confidence += 0.15; reasons.push('same source vendor');
        }
        const relationship = /calibration/i.test(row.evidence_type || '') ? 'calibration_record' : 'supports_activity';
        return {
          evidenceDocumentId: row.id,
          relationship,
          confidence: Math.min(0.95, Number(confidence.toFixed(2))),
          rationale: reasons.length
            ? `Governed evidence-match rules: ${reasons.join(', ')}.`
            : 'No governed relationship signal matched.',
          evidence: {
            ...snapshotEvidence(row, relationship),
            reportingPeriodStart: dateOnly(row.reporting_period_start),
            reportingPeriodEnd: dateOnly(row.reporting_period_end)
          }
        };
      })
      .filter((item) => item.confidence >= 0.45)
      .sort((left, right) => right.confidence - left.confidence || left.evidenceDocumentId.localeCompare(right.evidenceDocumentId))
      .slice(0, 10);
  }

  async _promotionSuggestions(companyId, context, queryable = this.database) {
    const evidenceMatches = await this._evidenceMatchSuggestions(companyId, context.evidence, queryable);
    return controls.buildPromotionSuggestions(context, evidenceMatches);
  }

  _contextGate(context) {
    if (context.review.decision !== 'approved_for_mapping') {
      return blocked('AI_ACTIVITY_REVIEW_NOT_APPROVED', 'The extraction review is not approved for semantic mapping.', 409);
    }
    if (!LOCKED.has(context.evidence.status) || !/^[a-f0-9]{64}$/i.test(context.evidence.checksum_sha256 || '') || Number(context.evidence.file_size_bytes) <= 0) {
      return blocked('AI_ACTIVITY_SOURCE_NOT_CONTROLLED', 'Promotion requires current locked, checksummed source evidence.', 409);
    }
    if (context.evidence.checksum_sha256 !== context.review.evidence_checksum_sha256 ||
        controls.sha256(context.evidence.extracted_json || {}) !== controls.sha256(context.review.extraction_snapshot || {})) {
      return blocked('AI_ACTIVITY_SOURCE_CHANGED', 'The evidence or extraction no longer matches the immutable review.', 409);
    }
    const reviewedFields = Array.isArray(context.review.fields) ? context.review.fields : [];
    const reviewedPaths = reviewedFields.map((field) => text(field.field_path || field.fieldPath));
    const expectedPaths = Object.keys(context.review.extraction_snapshot || {})
      .filter((fieldPath) => fieldPath !== 'auditClaims')
      .sort();
    if (!expectedPaths.length || new Set(reviewedPaths).size !== reviewedPaths.length ||
        reviewedPaths.length !== expectedPaths.length ||
        expectedPaths.some((fieldPath) => !reviewedPaths.includes(fieldPath)) ||
        reviewedFields.some((field) => !['accepted', 'corrected'].includes(field.decision))) {
      return blocked('AI_ACTIVITY_REVIEW_FIELD_COVERAGE_INVALID', 'Promotion requires exact accepted/corrected decisions for every reviewable extraction field.', 409);
    }
    return null;
  }

  async suggestions(companyId, evidenceId, reviewId) {
    const context = await this._context(companyId, evidenceId, reviewId);
    if (!context) return null;
    const gate = this._contextGate(context);
    if (gate) return gate;
    return this._promotionSuggestions(companyId, context);
  }

  async _referenceBlockers(companyId, payload, queryable) {
    const blockers = [];
    if (!UUID.test(text(payload.facilityRevisionId))) {
      blockers.push('FACILITY_REFERENCE_INVALID');
    } else {
      const facility = await queryable.query(
        'SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2',
        [payload.facilityRevisionId, companyId]
      );
      if (!facility.rows[0]) blockers.push('FACILITY_REFERENCE_INVALID');
    }
    if (payload.processRevisionId) {
      if (!UUID.test(text(payload.processRevisionId))) {
        blockers.push('PROCESS_REFERENCE_INVALID');
      } else {
        const process = await queryable.query(
          'SELECT id,facility_revision_id FROM industrial_process_revisions WHERE id=$1 AND company_id=$2',
          [payload.processRevisionId, companyId]
        );
        if (!process.rows[0] || process.rows[0].facility_revision_id !== payload.facilityRevisionId) {
          blockers.push('PROCESS_REFERENCE_INVALID');
        }
      }
    }
    if (payload.measurementPointRevisionId) {
      if (!UUID.test(text(payload.measurementPointRevisionId))) {
        blockers.push('MEASUREMENT_POINT_REFERENCE_INVALID');
      } else {
        const point = await queryable.query(
          `SELECT id,facility_revision_id,process_revision_id FROM industrial_measurement_point_revisions
           WHERE id=$1 AND company_id=$2`, [payload.measurementPointRevisionId, companyId]
        );
        if (!point.rows[0] || point.rows[0].facility_revision_id !== payload.facilityRevisionId ||
            (point.rows[0].process_revision_id || null) !== (payload.processRevisionId || null)) {
          blockers.push('MEASUREMENT_POINT_REFERENCE_INVALID');
        }
      }
    }
    return blockers;
  }

  async _evidenceMatches(companyId, sourceEvidence, suggested, requested, queryable) {
    if (Array.isArray(requested) && requested.length > 99) {
      return { error: blocked('AI_ACTIVITY_EVIDENCE_MATCH_LIMIT_EXCEEDED', 'At most 99 additional evidence-match decisions are allowed.') };
    }
    const normalized = [{ evidenceDocumentId: sourceEvidence.id, relationship: 'source_document', decision: 'accepted', rationale: 'Checksum-bound source of the reviewed extraction.' }];
    const seen = new Set([sourceEvidence.id]);
    for (const item of Array.isArray(requested) ? requested : []) {
      const evidenceDocumentId = text(item.evidenceDocumentId);
      const relationship = text(item.relationship || 'supports_activity');
      const decision = text(item.decision).toLowerCase();
      const rationale = text(item.rationale);
      if (!UUID.test(evidenceDocumentId) || seen.has(evidenceDocumentId) || !RELATIONSHIPS.has(relationship) ||
          !['accepted', 'rejected'].includes(decision) || rationale.length < 10) {
        return { error: blocked('AI_ACTIVITY_EVIDENCE_MATCH_INVALID', 'Evidence-match decisions must be unique, tenant-bound and carry a rationale.') };
      }
      seen.add(evidenceDocumentId);
      normalized.push({ evidenceDocumentId, relationship, decision, rationale });
    }
    const requestedIds = new Set(normalized.slice(1).map((item) => item.evidenceDocumentId));
    const missingSuggestion = (Array.isArray(suggested) ? suggested : [])
      .some((item) => !requestedIds.has(item.evidenceDocumentId));
    if (missingSuggestion) {
      return { error: blocked('AI_ACTIVITY_EVIDENCE_MATCH_DECISIONS_INCOMPLETE', 'Every governed evidence-match suggestion requires an explicit accept or reject decision.') };
    }
    const acceptedIds = normalized.filter((item) => item.decision === 'accepted').map((item) => item.evidenceDocumentId);
    const rows = await queryable.query(
      `SELECT id,document_name,evidence_type,status,checksum_sha256,file_size_bytes
       FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`, [companyId, acceptedIds]
    );
    if (rows.rows.length !== acceptedIds.length || rows.rows.some((row) => !LOCKED.has(row.status) || !/^[a-f0-9]{64}$/i.test(row.checksum_sha256 || '') || Number(row.file_size_bytes) <= 0)) {
      return { error: blocked('AI_ACTIVITY_EVIDENCE_MATCH_NOT_CONTROLLED', 'Every accepted evidence match must be locked, checksummed and tenant-bound.', 409) };
    }
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    return {
      items: normalized.map((item) => item.decision === 'accepted'
        ? { ...item, evidence: snapshotEvidence(byId.get(item.evidenceDocumentId), item.relationship) }
        : item),
      acceptedIds
    };
  }

  async createCandidate(companyId, userId, evidenceId, reviewId, input = {}) {
    const candidateReference = text(input.candidateReference);
    const notes = text(input.notes);
    if (!candidateReference || candidateReference.length > 160 || !notes || notes.length > 5000) {
      return blocked('AI_ACTIVITY_CANDIDATE_METADATA_INVALID', 'candidateReference and bounded review notes are required.');
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`ai-activity:${companyId}:${candidateReference}`]);
      const sourceLock = await client.query(
        'SELECT id FROM evidence_documents WHERE company_id=$1 AND id=$2 FOR SHARE',
        [companyId, evidenceId]
      );
      if (!sourceLock.rows[0]) { await client.query('ROLLBACK'); return null; }
      const context = await this._context(companyId, evidenceId, reviewId, client);
      if (!context) { await client.query('ROLLBACK'); return null; }
      const gate = this._contextGate(context);
      if (gate) { await client.query('ROLLBACK'); return gate; }
      const suggestions = await this._promotionSuggestions(companyId, context, client);
      if (text(input.suggestionSha256) !== suggestions.suggestionSha256) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_SUGGESTION_STALE', 'Reload semantic suggestions before creating a promotion candidate.', 409);
      }
      const matches = await this._evidenceMatches(
        companyId,
        context.evidence,
        suggestions.evidenceMatches.slice(1),
        input.evidenceMatches,
        client
      );
      if (matches.error) { await client.query('ROLLBACK'); return matches.error; }
      const reviewed = controls.validateCandidateInput(suggestions, input);
      reviewed.activityPayload.evidenceDocumentIds = matches.acceptedIds;
      const payloadValidation = validateActivityInput(reviewed.activityPayload);
      reviewed.activityPayload = payloadValidation.value;
      for (const error of payloadValidation.errors) {
        reviewed.anomalies.push({ code: 'ACTIVITY_PAYLOAD_INVALID', severity: 'blocking', fieldPaths: [], description: error });
        reviewed.blockerCodes.push('ACTIVITY_PAYLOAD_INVALID');
      }
      reviewed.blockerCodes.push(...await this._referenceBlockers(companyId, reviewed.activityPayload, client));
      reviewed.blockerCodes = [...new Set(reviewed.blockerCodes)];
      const next = await client.query(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision FROM evidence_ai_activity_candidates
         WHERE company_id=$1 AND candidate_reference=$2`, [companyId, candidateReference]
      );
      const revision = Number(next.rows[0].revision);
      const sourceSnapshot = snapshotEvidence(context.evidence, 'source_document');
      const status = reviewed.blockerCodes.length ? 'blocked' : 'ready_for_promotion';
      const payloadSha256 = candidateFingerprint({
        companyId, evidenceId, reviewId, candidateReference, revision, status,
        suggestionEngine: controls.ENGINE, suggestionEngineVersion: controls.ENGINE_VERSION,
        suggestionSha256: suggestions.suggestionSha256, sourceSnapshot, fieldDecisions: reviewed.fieldDecisions,
        anomalies: reviewed.anomalies, anomalyResolutions: reviewed.anomalyResolutions,
        evidenceMatches: matches.items, canonicalPayload: reviewed.activityPayload,
        blockerCodes: reviewed.blockerCodes, warningCodes: reviewed.warningCodes, notes
      });
      const inserted = await client.query(
        `INSERT INTO evidence_ai_activity_candidates(company_id,evidence_document_id,extraction_review_id,
           candidate_reference,revision,status,suggestion_engine,suggestion_engine_version,suggestion_sha256,
           source_evidence_snapshot,field_decisions,anomaly_snapshot,anomaly_resolutions,evidence_match_snapshot,
           canonical_payload,blocker_codes,warning_codes,notes,payload_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,
                $15::jsonb,$16,$17,$18,$19,$20) RETURNING *`,
        [companyId, evidenceId, reviewId, candidateReference, revision, status, controls.ENGINE,
          controls.ENGINE_VERSION, suggestions.suggestionSha256, JSON.stringify(sourceSnapshot),
          JSON.stringify(reviewed.fieldDecisions), JSON.stringify(reviewed.anomalies),
          JSON.stringify(reviewed.anomalyResolutions), JSON.stringify(matches.items),
          JSON.stringify(reviewed.activityPayload), reviewed.blockerCodes, reviewed.warningCodes,
          notes, payloadSha256, userId]
      );
      await this.audit({ client, strict: true, companyId, userId, evidenceDocumentId: evidenceId,
        dataGroup: 'evidence', changedField: 'evidence.ai_activity_candidate_created',
        newValue: inserted.rows[0].id, reason: 'evidence.ai_activity_candidate',
        notes: `${candidateReference} r${revision} ${status}` });
      await client.query('COMMIT');
      return this._formatCandidate(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async listCandidates(companyId, evidenceId) {
    if (!UUID.test(text(evidenceId))) return null;
    const result = await this.database.query(
      `SELECT candidate.*,promotion.id AS promotion_id,promotion.activity_id,promotion.promoted_at
       FROM evidence_ai_activity_candidates candidate
       LEFT JOIN evidence_ai_activity_promotions promotion
         ON promotion.company_id=candidate.company_id AND promotion.candidate_id=candidate.id
       WHERE candidate.company_id=$1 AND candidate.evidence_document_id=$2
       ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 200`, [companyId, evidenceId]
    );
    return result.rows.map((row) => this._formatCandidate(row));
  }

  async promote(companyId, userId, evidenceId, candidateId, input = {}) {
    const promoterRole = text(input.promoterRole);
    const attestation = text(input.attestation);
    if (promoterRole !== 'industrial_activity_promoter' || attestation.length < 20 || attestation.length > 5000) {
      return blocked('AI_ACTIVITY_PROMOTION_ATTESTATION_INVALID', 'A named industrial_activity_promoter attestation of at least 20 characters is required.');
    }
    if (![evidenceId, candidateId].every((value) => UUID.test(text(value)))) return null;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`ai-promotion:${companyId}:${candidateId}`]);
      const result = await client.query(
        `SELECT candidate.*,review.extraction_sha256,review.extraction_snapshot,evidence.status AS evidence_status,
              evidence.checksum_sha256,evidence.file_size_bytes,evidence.extracted_json,
              user_identity.email,user_identity.full_name
         FROM evidence_ai_activity_candidates candidate
         JOIN evidence_ai_extraction_reviews review ON review.id=candidate.extraction_review_id AND review.company_id=candidate.company_id
         JOIN evidence_documents evidence ON evidence.id=candidate.evidence_document_id AND evidence.company_id=candidate.company_id
         JOIN users user_identity ON user_identity.id=$4
         WHERE candidate.company_id=$1 AND candidate.evidence_document_id=$2 AND candidate.id=$3 FOR SHARE`,
        [companyId, evidenceId, candidateId, userId]
      );
      const candidate = result.rows[0];
      if (!candidate) { await client.query('ROLLBACK'); return null; }
      const prior = await client.query(
        'SELECT * FROM evidence_ai_activity_promotions WHERE company_id=$1 AND candidate_id=$2',
        [companyId, candidateId]
      );
      if (prior.rows[0]) { await client.query('COMMIT'); return { alreadyPromoted: true, ...camel(prior.rows[0]) }; }
      if (candidate.status !== 'ready_for_promotion' || candidate.blocker_codes.length) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_CANDIDATE_BLOCKED', 'Only a blocker-free ready candidate can be promoted.', 409, { blockerCodes: candidate.blocker_codes });
      }
      const currentCandidateSha256 = candidateFingerprint({
        companyId: candidate.company_id,
        evidenceId: candidate.evidence_document_id,
        reviewId: candidate.extraction_review_id,
        candidateReference: candidate.candidate_reference,
        revision: Number(candidate.revision),
        status: candidate.status,
        suggestionEngine: candidate.suggestion_engine,
        suggestionEngineVersion: candidate.suggestion_engine_version,
        suggestionSha256: candidate.suggestion_sha256,
        sourceSnapshot: candidate.source_evidence_snapshot,
        fieldDecisions: candidate.field_decisions,
        anomalies: candidate.anomaly_snapshot,
        anomalyResolutions: candidate.anomaly_resolutions,
        evidenceMatches: candidate.evidence_match_snapshot,
        canonicalPayload: candidate.canonical_payload,
        blockerCodes: candidate.blocker_codes,
        warningCodes: candidate.warning_codes,
        notes: candidate.notes
      });
      if (currentCandidateSha256 !== candidate.payload_sha256) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_CANDIDATE_INTEGRITY_FAILED', 'The immutable candidate payload hash does not match its stored content.', 409);
      }
      const sourceSnapshot = candidate.source_evidence_snapshot;
      if (!LOCKED.has(candidate.evidence_status) || candidate.checksum_sha256 !== sourceSnapshot.checksumSha256 ||
          candidate.checksum_sha256 !== candidate.canonical_payload.sourceSha256 ||
          controls.sha256(candidate.extracted_json || {}) !== controls.sha256(candidate.extraction_snapshot || {})) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_PROMOTION_SOURCE_CHANGED', 'Source evidence or reviewed extraction changed after candidate creation.', 409);
      }
      const acceptedMatches = candidate.evidence_match_snapshot.filter((item) => item.decision === 'accepted');
      const evidenceIds = acceptedMatches.map((item) => item.evidenceDocumentId);
      const currentEvidence = await client.query(
        `SELECT id,status,checksum_sha256,file_size_bytes FROM evidence_documents
         WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`, [companyId, evidenceIds]
      );
      const byId = new Map(currentEvidence.rows.map((row) => [row.id, row]));
      const evidenceChanged = acceptedMatches.some((item) => {
        const current = byId.get(item.evidenceDocumentId);
        return !current || !LOCKED.has(current.status) || current.checksum_sha256 !== item.evidence.checksumSha256 || Number(current.file_size_bytes) <= 0;
      });
      if (evidenceChanged) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_PROMOTION_EVIDENCE_CHANGED', 'An accepted evidence match is missing, unlocked or checksum-mismatched.', 409);
      }
      const validation = validateActivityInput({ ...candidate.canonical_payload, evidenceDocumentIds: evidenceIds });
      if (validation.errors.length) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_PROMOTION_PAYLOAD_INVALID', validation.errors.join(' '), 409);
      }
      const referenceBlockers = await this._referenceBlockers(companyId, validation.value, client);
      if (referenceBlockers.length) {
        await client.query('ROLLBACK');
        return blocked('AI_ACTIVITY_PROMOTION_REFERENCE_INVALID', 'Facility, process or measurement-point context is no longer valid.', 409, { blockerCodes: referenceBlockers });
      }
      const v = validation.value;
      const activity = await client.query(
        `INSERT INTO industrial_activity_records(company_id,facility_revision_id,process_revision_id,
           measurement_point_revision_id,activity_reference,activity_type,period_start,period_end,quantity,
           canonical_unit,source_kind,data_quality_level,raw_payload,source_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING *`,
        [companyId, v.facilityRevisionId, v.processRevisionId, v.measurementPointRevisionId,
          v.activityReference, v.activityType, v.periodStart, v.periodEnd, v.quantity, v.canonicalUnit,
          v.sourceKind, v.dataQualityLevel, JSON.stringify({ ...v.rawPayload, candidateId }), v.sourceSha256, userId]
      );
      for (const item of acceptedMatches) {
        await client.query(
          `INSERT INTO industrial_activity_evidence(company_id,activity_id,evidence_document_id,relationship,linked_by)
           VALUES($1,$2,$3,$4,$5)`, [companyId, activity.rows[0].id, item.evidenceDocumentId, item.relationship, userId]
        );
      }
      const promoterName = candidate.full_name || candidate.email;
      const promotionFingerprint = {
        companyId, candidateId, activityId: activity.rows[0].id, promoterId: userId,
        promoterName, promoterRole,
        evidenceChecksumSha256: candidate.checksum_sha256,
        extractionSha256: candidate.extraction_sha256,
        candidatePayloadSha256: candidate.payload_sha256,
        attestation
      };
      const promotion = await client.query(
        `INSERT INTO evidence_ai_activity_promotions(company_id,candidate_id,extraction_review_id,
           evidence_document_id,activity_id,promoter_id,promoter_name_snapshot,promoter_role,attestation,
           evidence_checksum_sha256,extraction_sha256,candidate_payload_sha256,promotion_sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [companyId, candidateId, candidate.extraction_review_id, evidenceId, activity.rows[0].id,
          userId, promoterName, promoterRole, attestation,
          candidate.checksum_sha256, candidate.extraction_sha256, candidate.payload_sha256,
          controls.sha256(promotionFingerprint)]
      );
      await this.audit({ client, strict: true, companyId, userId, evidenceDocumentId: evidenceId,
        dataGroup: 'industrial_activity', changedField: 'activity.promoted_from_ai_review',
        newValue: activity.rows[0].id, reason: 'industrial_activity.ai_promotion',
        notes: `Promoted blocker-free candidate ${candidateId}; AI did not choose an emission factor or calculation result.` });
      await client.query('COMMIT');
      return { promotion: camel(promotion.rows[0]), activity: camel(activity.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return blocked('AI_ACTIVITY_PROMOTION_DUPLICATE', 'The activity reference/source or candidate was already promoted.', 409);
      throw error;
    } finally { client.release(); }
  }

  _formatCandidate(row) {
    return {
      ...camel(row),
      revision: Number(row.revision),
      promoted: Boolean(row.promotion_id),
      promotionId: row.promotion_id || null,
      activityId: row.activity_id || null,
      promotedAt: row.promoted_at || null
    };
  }
}

module.exports = {
  AiActivityPromotionService,
  aiActivityPromotionService: new AiActivityPromotionService()
};
