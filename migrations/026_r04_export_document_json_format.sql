-- Permit the controlled R04 broker-handoff JSON artifact.
-- Existing export document rows remain unchanged.

ALTER TABLE public.export_documents
  DROP CONSTRAINT IF EXISTS chk_export_documents_output_format;

ALTER TABLE public.export_documents
  ADD CONSTRAINT chk_export_documents_output_format
  CHECK (output_format IN ('xlsx', 'pdf', 'csv', 'json'));
