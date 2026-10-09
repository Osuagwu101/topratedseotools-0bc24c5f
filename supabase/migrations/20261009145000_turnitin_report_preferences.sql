-- User-owned Turnitin report defaults; no change to credits, check records, or billing.
CREATE TABLE IF NOT EXISTS public.turnitin_report_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  compare_internet boolean NOT NULL DEFAULT true,
  compare_publications boolean NOT NULL DEFAULT true,
  compare_submitted_works boolean NOT NULL DEFAULT true,
  exclude_small_matches boolean NOT NULL DEFAULT false,
  exclude_bibliography boolean NOT NULL DEFAULT true,
  exclude_quotes boolean NOT NULL DEFAULT true,
  exclude_citations boolean NOT NULL DEFAULT false,
  small_match_mode text NOT NULL DEFAULT 'words' CHECK (small_match_mode IN ('words','percent')),
  small_match_threshold integer NOT NULL DEFAULT 8,
  report_view text NOT NULL DEFAULT 'sources' CHECK (report_view IN ('sources','match_groups')),
  use_filename_prefixes boolean NOT NULL DEFAULT true,
  ai_report_prefix text NOT NULL DEFAULT 'AI_',
  similarity_report_prefix text NOT NULL DEFAULT 'si_',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turnitin_report_prefs_collection_selected CHECK (compare_internet OR compare_publications OR compare_submitted_works),
  CONSTRAINT turnitin_report_prefs_small_matches CHECK (
    (small_match_mode = 'words' AND small_match_threshold BETWEEN 8 AND 200) OR
    (small_match_mode = 'percent' AND small_match_threshold BETWEEN 1 AND 50)
  ),
  CONSTRAINT turnitin_report_prefs_ai_prefix CHECK (length(ai_report_prefix) <= 40 AND ai_report_prefix !~ '[[:cntrl:]\\/<>:"|?*]'),
  CONSTRAINT turnitin_report_prefs_similarity_prefix CHECK (length(similarity_report_prefix) <= 40 AND similarity_report_prefix !~ '[[:cntrl:]\\/<>:"|?*]')
);
ALTER TABLE public.turnitin_report_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "turnitin report prefs owner read" ON public.turnitin_report_preferences
FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
-- Writes are performed only by authenticated server functions with exact user_id.
COMMENT ON TABLE public.turnitin_report_preferences IS
'Customer defaults for TRST Turnitin submissions and downloaded report names; comparison collections are upstream-controlled.';
