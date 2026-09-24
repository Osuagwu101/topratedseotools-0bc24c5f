# Phase 4 — StealthWriter Validation Audit

## Scope

Phase 4 validates only the StealthWriter Phase 2 admin-session vault and Phase 3 one-click proxy flow. It does not deploy, merge, or alter another tool.

## Sources of truth

- Uploaded StealthWriter walkthrough video
  - admin copies exactly two Better Auth cookie values
  - admin replaces session data through the StealthWriter tool page
  - writer-facing StealthWriter destination is the Humanizer dashboard
- AWS recovered source repository: `Osuagwu101/topratedseotools.com.ng-source`
  - `oneclick/core/gate.php`
  - `oneclick/core/proxy.php`
  - `oneclick/public/index.php`
  - `platform/public-app/access.php`
  - `platform/public/tools.php`

## Validation matrix

| Requirement | Evidence |
| --- | --- |
| Admin can replace the authorised StealthWriter session | Phase 2 vault regression + Phase 4 replacement test |
| Only the two video/AWS Better Auth cookie names are accepted | Phase 2 + Phase 4 validation tests |
| Stored secret remains encrypted/write-only | Phase 2 vault test + source-conformance audit |
| 60-second value is only the one-click handoff | Phase 4 validation test |
| Customer proxy session is long-lived (7–30 days, default 30) | Phase 3 + Phase 4 validation tests |
| Active paid access passes | Phase 4 policy test |
| Expired/unpaid/unapproved access fails | Phase 4 policy test |
| Active grant passes; expired/revoked grant fails | Phase 4 policy test |
| Upstream 401/403 is treated as invalid/expired master auth | Phase 4 policy test |
| Better Auth cookie rotation replaces stored master values | Phase 3 + Phase 4 rotation tests |
| Unrelated upstream cookies are ignored | Phase 4 rotation test |
| Upstream Set-Cookie is never exposed to customer browser | Phase 4 source-conformance audit |
| Master-account logout/billing/account/subscription paths are blocked | Phase 3 + Phase 4 tests |
| Proxy is fixed to StealthWriter and is not an open proxy | Phase 4 source-conformance audit |
| Proxy route executes server-side before normal React routing | Phase 4 source-conformance audit |
| SneakWrite remains healthy | Existing regression test PASS |
| Phrasly remains healthy | Existing regression test PASS |
| Payment gateway behavior remains healthy | Existing gateway regression suite PASS |
| TypeScript and production build remain healthy | PASS |

## Red-run history

### P4-001 — code defect caught by Phase 4
- Observed: Phase 4 import failed because the exported handoff constant had accidentally become `STEALTHWRITER_STEALTHWRITER_HANDOFF_TTL_SECONDS`.
- Root cause: mechanical rename applied twice during the testability refactor.
- Fix: restored the intended `STEALTHWRITER_HANDOFF_TTL_SECONDS` symbol.
- Regression: Phase 4 validation matrix subsequently passed.

### P4-002 — test false positive
- Observed: cookie-header test reported that a `Secure` attribute leaked.
- Root cause: the assertion matched `Secure` inside the legitimate cookie name `__Secure-better-auth...`.
- Fix: assertion now checks actual attribute forms (`Path=`, `HttpOnly`, `; Secure`).
- Production code change: none.

### P4-003 — source-audit test targeting error
- Observed: source-conformance check claimed the proxy route ran after React routing.
- Root cause: the test compared the proxy check with the top-level `getServerEntry` function declaration rather than the call inside `fetch()`.
- Fix: source audit now scopes the comparison to the server `fetch()` body.
- Production code change: none.

## Final automated gate

GitHub Actions run: **35994824206**

All steps passed:
- Phase 2 admin-session vault
- Phase 3 proxy regressions
- Phase 4 AWS/video validation matrix
- Phase 4 source-conformance audit
- SneakWrite regression
- Phrasly regression
- Custom payment regressions
- TypeScript
- Production build

## Limitation

This phase validates the implementation and failure paths without committing or exposing a real StealthWriter master session to CI. A true live-vendor smoke test requires the Phase 2 migration/environment key and Phase 3 proxy to exist in a deployed environment. That deployment is intentionally outside Phase 4 and belongs to the release phase.

## Gate

**TECHNICALLY GREEN / AWAITING OWNER APPROVAL**

No production deployment has occurred.
