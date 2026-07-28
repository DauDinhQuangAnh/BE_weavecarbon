-- Fix: evidence_documents.status CHECK only allowed ('uploaded','reviewed','locked','rejected'),
-- but the app writes 'ocr_parsed' (and other lifecycle statuses) after AI extraction.
-- That constraint violation made every successful extraction's UPDATE throw, so extracted_json
-- was never saved and the UI showed "AI chưa trích xuất được trường nào".
-- This migration widens the allowed status set and adds fields to surface extraction feedback
-- to the frontend (so users see WHY a document could not be read, instead of a silent empty state).

ALTER TABLE public.evidence_documents
  DROP CONSTRAINT IF EXISTS evidence_documents_status_check;

ALTER TABLE public.evidence_documents
  ADD CONSTRAINT evidence_documents_status_check
  CHECK (status IN (
    'uploaded', 'pending', 'processing',
    'ocr_parsed', 'extracted', 'needs_review',
    'logic_checked', 'source_matched', 'cross_checked',
    'reviewed', 'verified', 'locked', 'rejected',
    'ready_for_calculation', 'third_party_verified',
    'extract_failed'
  ));

-- Human-readable warnings/notes shown in the review modal (already read by formatEvidence()).
ALTER TABLE public.evidence_documents
  ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Detailed reason for the most recent extraction failure (null when extraction succeeded).
ALTER TABLE public.evidence_documents
  ADD COLUMN IF NOT EXISTS extraction_error TEXT;
