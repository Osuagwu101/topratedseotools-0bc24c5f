-- AWS tools.cookie_feature_urls and tools.block_paths are configuration,
-- not part of the encrypted account cookie data.
BEGIN;
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_tool_config (
 tool_id text PRIMARY KEY DEFAULT 'phrasly',
 enabled boolean NOT NULL DEFAULT false,
 feature_urls jsonb NOT NULL DEFAULT '{}'::jsonb,
 block_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
 CONSTRAINT phrasly_feature_urls_obj CHECK(jsonb_typeof(feature_urls)='object'),
 CONSTRAINT phrasly_block_paths_array CHECK(jsonb_typeof(block_paths)='array')
);
ALTER TABLE public.phrasly_oneclick_tool_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phrasly_oneclick_tool_config FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.phrasly_oneclick_tool_config TO service_role;
COMMIT;
