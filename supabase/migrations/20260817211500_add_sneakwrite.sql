-- SneakWrite catalogue seed.
-- SneakWrite is a built-in customer-facing humanizer positioned between
-- Stealthwriter and Phrasly in src/lib/tools-data.ts. This row provides
-- editable customer-facing overrides and production settings/pricing.

insert into public.tool_overrides (
  tool_slug,
  name,
  tagline,
  description,
  category,
  domain,
  image_url,
  is_visible,
  is_custom,
  access,
  features,
  featured,
  updated_at
) values (
  'sneakwrite',
  'SneakWrite',
  'Next-generation AI humanizer for natural, polished writing',
  'SneakWrite is a premium AI humanizer built for writers who want AI-assisted drafts to read with stronger flow, more natural phrasing and a convincingly human voice. It refines essays, articles, reports and everyday content while preserving the core meaning, making it a standout option in the new generation of AI rewriting tools.',
  'AI Detection Bypass',
  'sneakwrite.net',
  null,
  true,
  false,
  'pro',
  '["Humanizes AI-assisted drafts into natural, fluent writing","Preserves the original meaning while improving rhythm and phrasing","Refines tone for essays, articles, reports and professional content","Built for fast, polished rewriting with a clean human voice"]'::jsonb,
  true,
  now()
)
on conflict (tool_slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  category = excluded.category,
  domain = excluded.domain,
  is_visible = excluded.is_visible,
  is_custom = excluded.is_custom,
  access = excluded.access,
  features = excluded.features,
  featured = excluded.featured,
  updated_at = now();

insert into public.tool_settings (
  tool_slug,
  enabled,
  access_level,
  one_click_auth_enabled,
  official_login_url,
  auth_provider,
  launch_mode,
  display_manual_credentials,
  shared_access_enabled,
  private_access_enabled,
  shared_access_authorization,
  private_access_authorization,
  full_pool_policy,
  updated_at
) values (
  'sneakwrite',
  true,
  'purchased',
  false,
  'https://sneakwrite.net',
  null,
  'new_tab',
  true,
  true,
  false,
  'confirmed',
  'confirmed',
  'awaiting_assignment',
  now()
)
on conflict (tool_slug) do update set
  enabled = true,
  access_level = 'purchased',
  official_login_url = 'https://sneakwrite.net',
  shared_access_enabled = true,
  private_access_enabled = false,
  updated_at = now();

-- SneakWrite currently has one standard Shared monthly plan.
delete from public.tool_pricing where tool_slug = 'sneakwrite';
insert into public.tool_pricing (
  tool_slug,
  label,
  amount,
  unit,
  currency,
  contact_admin,
  sort_order,
  duration_days,
  grace_days,
  warning_days,
  access_type,
  enabled,
  note,
  badge,
  paystack_plan_code,
  billing_period,
  created_at,
  updated_at
) values (
  'sneakwrite',
  null,
  8500,
  null,
  '₦',
  false,
  0,
  28,
  0,
  0,
  'shared',
  true,
  null,
  null,
  null,
  'monthly',
  now(),
  now()
);
