const fs = require('fs');
const evidenceService = require('./service');
const chatService = require('../shared/rag');
const logger = require('../shared/logger');
const pool = require('../shared/database');
const { resolveStoragePath } = require('./fileStorage');
const { analyzeEvidenceFile } = require('./aiExtractor');

function collectionName(companyId) {
  const prefix = String(process.env.RAG_EVIDENCE_COLLECTION_PREFIX || 'evidence').trim() || 'evidence';
  return `${prefix}_${String(companyId).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

async function processStoredEvidence({ evidenceId, companyId }) {
  const stored = await evidenceService.repository.getStoredFile({ evidenceId, companyId });
  if (!stored || stored.storage_provider !== 'local' || !stored.storage_key) {
    throw new Error('Durable evidence file is unavailable.');
  }

  const filePath = resolveStoragePath(stored.storage_key);
  const buffer = await fs.promises.readFile(filePath);
  const filename = stored.original_filename || stored.document_name || 'document';
  const mimeType = stored.mime_type || 'application/octet-stream';
  const kind = stored.evidence_type || 'other';

  let analysis;
  try {
    analysis = await analyzeEvidenceFile({
      buffer,
      mimeType,
      filename,
      hintKind: kind
    });
  } catch (error) {
    logger.warn({ err: error.message, evidenceId, companyId }, '[processor] analyzeEvidenceFile failed');
    await evidenceService.markExtractionFailed(
      companyId,
      evidenceId,
      `AI processing failed: ${String(error?.message || error).slice(0, 200)}`
    );
    throw error;
  }

  const fields = analysis?.raw_fields || {};
  const fieldCount = Object.keys(fields).length;

  if (fieldCount > 0) {
    await evidenceService.updateExtractedJson(companyId, evidenceId, fields, 'ocr_parsed');

    // Automatically update vendor, periods, and evidence_type if they were previously unpopulated
    try {
      await pool.query(
        `UPDATE evidence_documents
         SET source_vendor = COALESCE(source_vendor, $1),
             reporting_period_start = COALESCE(reporting_period_start, $2::date),
             reporting_period_end = COALESCE(reporting_period_end, $3::date),
             evidence_type = CASE WHEN (evidence_type = 'other' OR evidence_type IS NULL) AND $4 <> 'other' THEN $4 ELSE evidence_type END,
             updated_at = now()
         WHERE id = $5 AND company_id = $6`,
        [
          analysis.supplier_name || null,
          analysis.period_start || null,
          analysis.period_end || null,
          analysis.detected_kind || kind,
          evidenceId,
          companyId
        ]
      );
    } catch (updateErr) {
      logger.warn({ err: updateErr.message, evidenceId }, '[processor] Non-fatal error updating document metadata');
    }

    // Auto-sync into electricity_invoices for CBAM Scope 2
    if ((analysis.detected_kind === 'electricity_bill' || kind === 'electricity_bill') && analysis.kwh_total) {
      try {
        const existing = await pool.query(
          `SELECT id FROM public.electricity_invoices WHERE evidence_document_id = $1 AND company_id = $2 LIMIT 1`,
          [evidenceId, companyId]
        );
        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO public.electricity_invoices
             (company_id, facility_name, billing_period, kwh, emission_factor_kg_per_kwh, emission_factor_source, status, evidence_document_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', $7)`,
            [
              companyId,
              analysis.facility_name || 'Main Facility',
              analysis.billing_period || (analysis.period_start ? String(analysis.period_start).slice(0, 7) : '2024-Q2'),
              analysis.kwh_total,
              analysis.emission_factor || 0.4290,
              analysis.emission_factor_source || 'VN Ministry of Natural Resources 2024',
              evidenceId
            ]
          );
          logger.info({ evidenceId, kwh: analysis.kwh_total }, '[processor] Auto-synced electricity bill to electricity_invoices');
        }
      } catch (syncErr) {
        logger.warn({ err: syncErr.message, evidenceId }, '[processor] Non-fatal error auto-syncing electricity invoice');
      }
    }

    // Auto-sync into fuel_invoices for CBAM Scope 1
    if ((analysis.detected_kind === 'fuel_receipt' || kind === 'fuel_receipt') && analysis.fuel_liters) {
      try {
        const existing = await pool.query(
          `SELECT id FROM public.fuel_invoices WHERE evidence_document_id = $1 AND company_id = $2 LIMIT 1`,
          [evidenceId, companyId]
        );
        if (existing.rows.length === 0) {
          const ef = analysis.emission_factor || (analysis.fuel_type === 'diesel' ? 2.688 : 2.352);
          const co2e = Number((analysis.fuel_liters * ef).toFixed(4));
          await pool.query(
            `INSERT INTO public.fuel_invoices
             (company_id, billing_period, fuel_type, quantity_liters, emission_factor_kg_per_liter, scope1_co2e_kg, status, evidence_document_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', $7)`,
            [
              companyId,
              analysis.billing_period || (analysis.period_start ? String(analysis.period_start).slice(0, 7) : '2024-Q2'),
              analysis.fuel_type || 'diesel',
              analysis.fuel_liters,
              ef,
              co2e,
              evidenceId
            ]
          );
          logger.info({ evidenceId, liters: analysis.fuel_liters }, '[processor] Auto-synced fuel receipt to fuel_invoices');
        }
      } catch (syncErr) {
        logger.warn({ err: syncErr.message, evidenceId }, '[processor] Non-fatal error auto-syncing fuel invoice');
      }
    }
  } else {
    await evidenceService.markExtractionFailed(
      companyId,
      evidenceId,
      'AI đã đọc chứng từ nhưng chưa tìm thấy các trường định lượng.'
    );
  }

  // Attempt RAG collection ingestion if possible, but never fail the extraction if RAG is offline
  try {
    const ingestForm = new FormData();
    ingestForm.append('file', new Blob([buffer], { type: mimeType }), filename);
    ingestForm.append('collection_name', collectionName(companyId));
    ingestForm.append('chunking_profile', 'hybrid');
    await chatService.callGlobalRagEndpoint('/ingest', { method: 'POST', data: ingestForm });
  } catch (ingestErr) {
    logger.warn({ err: ingestErr.message, evidenceId }, '[processor] RAG collection ingest skipped or unavailable');
  }
}

module.exports = { processStoredEvidence };
