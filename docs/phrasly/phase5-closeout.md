# Phase 5 closeout — 26 October 2026

Status: COMPLETE. Proceed to Phase 6 release preparation. This is an acceptance closeout, not a claim that the public site has been activated.

## Real provider success

See phase5-live-provider-results.md: a 50-word input produced a real streamed Humanizer rewrite (HTTP 200). The real native Detector displayed 100% AI, 0% human, 4/4 sentences likely AI generated. Both used the destination backend/Auth/database, the AWS cookie bundle and original MV3 identity. No provider responses were substituted.

## Final destination matrix

tests/phrasly-phase5-final-matrix.mjs ran against the actual destination Supabase project and compiled Nitro backend at 2026-10-26T09:27:55Z: 12/12 PASS, zero restoration errors.

1. Verified real handoff, exact cookie-array parity and free opening.
2. Missing/invalid bearer rejected.
3. Expired handoff/record and incorrect signature rejected.
4. Popup identity, expiry and revocation enforced.
5. Expired/revoked staff access rejected.
6. Suspended acceptance writer rejected.
7. Account exhaustion returned 503 no_accounts_available.
8. Capacity-one pool denied four additional concurrent assignment attempts.
9. Eight concurrent fulfillments reused one assignment without incrementing usage.
10. Quota denial blocked opening/actions and reported the correct WAT reset.
11. Six concurrent counted attempts incremented atomically, with distinct consecutive counts.
12. Disabled tool configuration blocked fulfillment.

Tests temporarily changed only the dedicated internal acceptance writer and the unexposed Phrasly configuration/account; original settings were restored. Final attempt totals are humanizer 15, ai_detector 2, including diagnostics and six direct counter tests. No provider generation requests were made by this final matrix.

Backend authentication failures are verified against the real destination. Synthetic extension/provider failure paths remain explicitly synthetic; prior Chromium/worker tests cover provider rejection, cookie cleanup and AWS request behavior. The successful live service run also observed the provider's CAPTCHA-required response and its own application retry before generation succeeded.

## Site and financial regression boundary

Final read-only OVH comparison: Nginx hash unchanged; all 60 established PM2 process records (including PID, status and restart count) unchanged; all eight HTTP statuses matched baseline. Home/login/admin, StealthWriter, ChatGPT, Turnitin and Turnitin buy pages returned 200. Public ext-whoami.php remained 404, confirming the new backend had not been switched into public routing.

Earlier cross-service CI, payment/credit synthetic regressions, full website compilation and 56 protocol/launcher/worker tests passed. No charges, refunds, balance changes, financial-table writes or live provider requests for unrelated tools were made.

The exact restoration/rollback boundary is in phase5-rollback.md. Phase 6 starts by packaging the verified runtime, scanning for embedded secrets, transferring it to a protected release directory, and verifying a loopback-only OVH candidate before any public activation.
