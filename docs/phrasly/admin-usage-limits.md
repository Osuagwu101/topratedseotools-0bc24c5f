# Admin controls for Phrasly daily usage

At /admin/phrasly, Writer access lists each user's Humanizer and AI Detector grants. Use Requests per day and Save limit to add or edit a cap (1–10,000). Remove limit, or select Unlimited and save, removes that feature's daily cap. New assignments also offer an Unlimited checkbox for each feature. Changing a cap retains the user's source entitlement, access expiry, feature revocation and usage history. A smaller cap applies against attempts already used today. Counts reset at midnight Africa/Lagos.

Unlimited is represented by is_unlimited on the existing private grant table, retaining the most recent finite daily_limit. Runtime fulfillment, popup status, writer summaries and the atomic attempt counter honor it. The existing writer extension receives the text Unlimited and an unblocked launch. Its installed bytes and native navigation are unchanged. Provider account plan allowances continue to apply.

The set_limit action uses the existing authenticated owner/Admin endpoint. It validates the user, feature and explicit integer-or-null value, updates exactly one existing grant, and records an audit event. It never creates a source entitlement or enables a revoked feature. Anonymous users and ordinary writers cannot edit limits. The counter remains service-role-only; its fixed search_path and fully qualified table names prevent path injection.

Migration: 20261028190203_phrasly_user_usage_limits.sql (created with Supabase CLI). The additive migration adds the flag and replaces the counter in one transaction. No source assignments, orders, payments, balances, provider sessions or existing counters are rewritten.

Verification: 10 actual PostgreSQL/PGlite migration/counter checks; 10 tests executing the real backend/Admin modules; eight Chromium UI checks covering add/edit/remove, isolated user/feature changes, validation and revocation preservation. Existing cookie-exporter and entitlement regressions also run. GitHub workflow: phrasly-limits.yml.

Deployment and live evidence are recorded separately after activation. Rollback can restore the prior Phrasly upstream and its two static entry assets while retaining the additive flag. Keep a compatible backend while users have Unlimited set; a backend that ignores the flag would reinstate their stored numeric caps.
