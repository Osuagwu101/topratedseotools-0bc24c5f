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

Pending deployment of this exact version-controlled migration and read-only verification of the affected user's native status and download/handoff authorization.
