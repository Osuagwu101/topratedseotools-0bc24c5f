# Phrasly Phase 3: AWS backend port (review branch, not deployed)

Source-of-truth: `docs/phrasly/phase2-backend-handoff.md` and the original immutable source in private `Osuagwu101/topratedseotools.com.ng-source` at `4c420f5d054653d4dc3eb12ecf74e0508556b184`.

## Implemented in this branch
- Server handlers for `/ext-handoff.php`, `/ext-fulfill.php`, `/ext-check-usage.php`, `/ext-whoami.php`; plus `/ext-session` for obtaining an opaque, HttpOnly first-party popup session from an already verified Supabase login.
- Reuse of the Phase 2 AWS HMAC field order, 60-second handoff, four-hour usage record, feature names, error shapes and Africa/Lagos daily reset.
- Postgres tables for Phrasly-specific encrypted account snapshots, account assignments, per-user feature grants, per-feature attempt counters, audit events, first-party popup sessions and URL/path configuration. No production rows imported.
- Server-only allocator that reuses an existing assignment or chooses the earliest enabled account with capacity, returning null if exhausted. Unlike the source's nonserializing count/insert, this adapter serializes capacity decisions to avoid oversubscription in Postgres.
- Configured feature URLs, blocked paths and a fail-closed `PHRASLY_EXTENSION_ENABLED` switch.

## Required protected settings (do not put secrets into Git)
- `PHRASLY_EXTENSION_ENABLED=false` until reviewed, migrated, seeded, and Phase 4 prepared.
- `PHRASLY_AWS_EXTENSION_GATE_SECRET`: strong server-only 32+ byte secret; not interchangeable with client credentials.
- Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `PHRASLY_SESSION_ENCRYPTION_KEY` or established vault key derivation.
- `phrasly_oneclick_tool_config`: explicit enabled flag, scoped feature URLs and blocked paths.
- `phrasly_oneclick_accounts`: encrypted valid authorized account state, a verified target URL, capacity, and enabled flag.
- `phrasly_oneclick_feature_grants`: explicit active staff grants; avoid copying financial or subscription records.
- The existing extension must be enabled/configured only after backend and Phase 4 tests pass.

## Verification boundary
This branch is not a deployment. No migration has been applied to live Supabase. No customer grants, cookies or credentials have been imported. The AWS regression fixtures exercise synthetic providers and do not prove live Phrasly processing.

Before marking the phase complete: run migrations in disposable Postgres, test authorization, CSRF and expiry with a real destination login, compare response contracts to unchanged AWS PHP, validate the actual generated routes and CI, review cookie-account sharing authorization, and verify that the backend controls are not publicly reachable without a signed capability. Resolve any red CI result first.

Phase 4 (website controls and extension distribution), Phase 5 (real end-to-end processing) and Phase 6 (production release) remain explicitly outside this branch.
