# Phrasly entitlement synchronization

The standard Admin assignment flow and approved paid purchases wrote TopRated access records without creating the Humanizer and AI Detector grants required by the native extension. This let the storefront report access while /ext-status, downloads and handoff returned no_access.

The additive migration attaches a transaction-local trigger to both tool_access_grants and tool_orders. A current active Admin grant, or a current approved/successful order (with active fulfilment for private access), inserts any missing Humanizer and AI Detector permissions. The existing owner-screen default is 20 requests per feature per day. ON CONFLICT DO NOTHING preserves Admin-set limits and explicit native-feature revocations. Duplicate assignments and repeated payment confirmations do not duplicate permissions.

Existing currently entitled users receive the same missing-permission repair. Expired/unpaid users do not. The migration never updates or deletes orders, payments, balances, source access grants, usage counters or account cookies. It requires no application restart, extension update or provider-session replacement.

The trigger is SECURITY DEFINER in an unexposed phrasly_internal schema because authenticated Admins can write orders through existing RLS but cannot directly write native grants. Anonymous and ordinary authenticated customer writes cannot provision permissions. The schema and trigger function are inaccessible to those roles; all relation references are qualified and search_path is empty.

## Verification

Run:
```sh
npm ci --prefix tests/phrasly-entitlements --ignore-scripts --no-audit --no-fund
npm test --prefix tests/phrasly-entitlements
```

The isolated PostgreSQL/PGlite suite executes the actual migration and source-table INSERT/UPDATE operations: 35 checks pass. It covers backfill, both assignment/purchase paths, both payment/approval orderings, fulfilment, expired and renewed access, revoked access, duplicate webhooks, custom limits, rollback/atomicity, effective expiry/revocation, unrelated tools and caller privileges. Production financial records are never used as test fixtures. The dedicated GitHub workflow runs this suite on changes.

Expiry and source revocation continue to be enforced by activeTopRatedAccess at each native status/handoff/processing check. Feature revocation remains an explicit Admin decision; automatic provisioning does not undo it.

## Production verification

Applied successfully on 27 October 2026 as migration 20261027071059_phrasly_entitlement_feature_sync. The source filename matches the recorded production migration version; its SQL is identical to the tested and deployed content.

The affected user's existing approved entitlement received exactly the missing Humanizer and AI Detector grants, each at 20/day. Live acceptance using a temporary verification session confirmed:
- Signed-out access is rejected.
- The affected user's /ext-status succeeds and both handoffs are authorized.
- The authenticated download matches the unchanged enabled extension ZIP.
- The actual customer tool panel no longer falsely denies access.
- Both native phrasly.ai editors open and become ready through the installed extension.
- No provider generation was requested; both daily counters remain at zero.
- The temporary verification session was revoked without signing out the user's existing sessions.

Evidence: evidence/entitlement-live-20261027.json. Live test: tests/phrasly-entitlement-live.cjs (requires an explicitly supplied private verification session; it does not send messages).

Before/after row fingerprints match for all 48 tool_orders, all 12 tool_access_grants and both existing phrasly_oneclick_daily_usage rows. Existing account cookies and extension bytes were not modified. The security advisor reports no new findings; the internal schema and function deny USAGE/EXECUTE to anon and authenticated. Existing unrelated advisor findings remain outside this fix.

GitHub entitlement regression and cross-service regression both passed at implementation commit 488d11eb5ac85dd419863db9393708d5a03fcfac. Final-head CI is checked before merge.

## Rollback

If synchronization must be disabled, disable only phrasly_seed_features_after_admin_access on tool_access_grants and phrasly_seed_features_after_paid_order on tool_orders in a versioned transaction. Do not delete repaired permissions, counters or source entitlements. Runtime launch code and native provider behavior are unchanged.
