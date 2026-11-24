-- Migration 054: Add regulation_tag to data_gaps
ALTER TABLE public.data_gaps ADD COLUMN IF NOT EXISTS regulation_tag TEXT DEFAULT 'Kiểm toán nội bộ';
