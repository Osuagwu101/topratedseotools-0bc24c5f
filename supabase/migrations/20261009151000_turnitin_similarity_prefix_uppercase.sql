-- Match the AI_ default by capitalizing the Similarity filename prefix.
-- Existing customers' saved preferences are not overwritten.
ALTER TABLE public.turnitin_report_preferences
  ALTER COLUMN similarity_report_prefix SET DEFAULT 'SI_';
