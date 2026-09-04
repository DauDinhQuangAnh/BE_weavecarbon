const fs = require('fs');
const evidenceService = require('./service');
const chatService = require('../shared/rag');
const { resolveStoragePath } = require('./fileStorage');

function collectionName(companyId) {
  const prefix = String(process.env.RAG_EVIDENCE_COLLECTION_PREFIX || 'evidence').trim() || 'evidence';
  return `${prefix}_${String(companyId).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

async function processStoredEvidence({ evidenceId, companyId }) {
  const stored = await evidenceService.repository.getStoredFile({ evidenceId, companyId });
  if (!stored || stored.storage_provider !== 'local' || !stored.storage_key) {
    throw new Error('Durable evidence file is unavailable.');
  }

  const buffer = await fs.promises.readFile(resolveStoragePath(stored.storage_key));
  const filename = stored.original_filename || stored.document_name || 'document';
  const mimeType = stored.mime_type || 'application/octet-stream';
  const kind = stored.evidence_type || 'other';

  const extractForm = new FormData();
  extractForm.append('file', new Blob([buffer], { type: mimeType }), filename);
  extractForm.append('kind', kind);
  extractForm.append('language', 'vi');

  let result;
  try {
    result = await chatService.callGlobalRagEndpoint('/extract', {
      method: 'POST', data: extractForm
    });
  } catch (error) {
    await evidenceService.markExtractionFailed(
      companyId,
      evidenceId,
      `AI processing failed: ${String(error?.message || error).slice(0, 200)}`
    );
    throw error;
  }

  const fields = result?.fields ?? result ?? {};
  const fieldCount = fields && typeof fields === 'object' ? Object.keys(fields).length : 0;
  if (fieldCount > 0) {
    await evidenceService.updateExtractedJson(companyId, evidenceId, fields, 'ocr_parsed');
  } else {
    await evidenceService.markExtractionFailed(
      companyId,
      evidenceId,
      'AI processed the document but did not find extractable fields.'
    );
  }

  const ingestForm = new FormData();
  ingestForm.append('file', new Blob([buffer], { type: mimeType }), filename);
  ingestForm.append('collection_name', collectionName(companyId));
  ingestForm.append('chunking_profile', 'hybrid');
  await chatService.callGlobalRagEndpoint('/ingest', { method: 'POST', data: ingestForm });
}

module.exports = { processStoredEvidence };
