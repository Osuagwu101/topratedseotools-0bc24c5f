
ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS badge text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tool_pricing_access_type_check'
  ) THEN
    ALTER TABLE public.tool_pricing
      ADD CONSTRAINT tool_pricing_access_type_check
      CHECK (access_type IN ('shared','private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tool_pricing_tool_access_idx
  ON public.tool_pricing (tool_slug, access_type, enabled);
