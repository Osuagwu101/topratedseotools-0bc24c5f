# Admin controls for Phrasly daily usage

At /admin/phrasly, Writer access lists each user's Humanizer and AI Detector grants. Use Requests per day and Save limit to add or edit a cap (1–10,000). Remove limit, or select Unlimited and save, removes that feature's daily cap. New assignments also offer an Unlimited checkbox for each feature. Changing a cap retains the user's source entitlement, access expiry, feature revocation and usage history. A smaller cap applies against attempts already used today. Counts reset at midnight Africa/Lagos.

Unlimited is represented by is_unlimited on the existing private grant table, retaining the most recent finite daily_limit. Runtime fulfillment, popup status, writer summaries and the atomic attempt counter honor it. The existing writer extension receives the text Unlimited and an unblocked launch. Its installed bytes and native navigation are unchanged. Provider account plan allowances continue to apply.

The set_limit action uses the existing authenticated owner/Admin endpoint. It validates the user, feature and explicit integer-or-null value, updates exactly one existing grant, and records an audit event. It never creates a source entitlement or enables a revoked feature. Anonymous users and ordinary writers cannot edit limits. The counter remains service-role-only; its fixed search_path and fully qualified table names prevent path injection.

Migration: 20261028190736_phrasly_user_usage_limits.sql (created with Supabase CLI). The additive migration adds the flag and replaces the counter in one transaction. No source assignments, orders, payments, balances, provider sessions or existing counters are rewritten.

Verification: 10 actual PostgreSQL/PGlite migration/counter checks; 10 tests executing the real backend/Admin modules; eight Chromium UI checks covering add/edit/remove, isolated user/feature changes, validation and revocation preservation. Existing cookie-exporter and entitlement regressions also run. GitHub workflow: phrasly-limits.yml.

Deployment and live evidence are recorded separately after activation. Rollback can restore the prior Phrasly upstream and its two static entry assets while retaining the additive flag. Keep a compatible backend while users have Unlimited set; a backend that ignores the flag would reinstate their stored numeric caps.

## Live activation — 28 October 2026

Activated the Phrasly runtime and Admin/writer entry assets from 15073bd8e03bca749eb99fe2a4b7f006ff064db0. The verified live nginx block contains eleven Phrasly upstream locations; the deployment guard was aligned to that exact count before activation. The prior runtime and static assets remain available for rollback. All 62 existing application processes retained their PIDs/status/restart counts. Existing writer extension bytes and all other public assets are unchanged.

The separately committed SQL transaction updated four currently entitled active users (eight enabled feature grants) to Unlimited and recorded eight audit events. The fifth feature-grant user has no current entitlement and was excluded. No expiry dates were extended and no revoked feature was re-enabled. All four users were authenticated with temporary verification sessions: status reported Unlimited for both features and both native feature handoffs were authorized. The real owner endpoint successfully saved a selected user limit; ordinary writers were rejected. The public Admin page rendered all eight Unlimited feature editors, new-assignment controls and the existing cookie exporter. Temporary verification sessions were revoked locally without ending existing user sessions.

Before/after fingerprints match exactly for all orders, source grants, daily usage rows and provider account records. Security advisors report no new findings. No provider generation was requested. Redacted evidence: evidence/usage-limits-live-20261028.json. Exact operational SQL: scripts/phrasly/grant-current-users-unlimited-20261028.sql.
