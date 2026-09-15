-- Phase 15 audit hardening:
-- Self Hosted browser access is intentionally limited to the three runtime profiles
-- that have production authentication definitions. Any stale unsupported override
-- is rolled back to Browser Use rather than leaving an unlaunchable tool.
update public.tool_settings
set auth_provider = 'browser_use'
where auth_provider = 'self_hosted'
  and tool_slug not in ('phrasly', 'stealthwriter', 'chatgpt');
