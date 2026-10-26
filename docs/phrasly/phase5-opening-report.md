> Historical opening report. Phase 5 is now COMPLETE; see [verified closeout](phase5-closeout.md), [real provider results](phase5-live-provider-results.md), and [rollback](phase5-rollback.md). Open items below describe the earlier state and are superseded by those results.

# Phase 5 opening verification — 26 October 2026

Status: **IN PROGRESS**. Isolated cross-service checks passed; real third-party Phrasly acceptance and production-adjacent regression verification not yet complete.

## Phase 4 handoff
- Phase 4 frontend branch `phrasly/phase4-frontend-20261026`, draft PR #107, closeout commit `afdd8782267211544dcf7264d2dd806a01fe7180`.
- AWS parity and Chromium staging extension runs on `bcc68addd435fb4d327ce25dfe104d500b01d774` passed: `121454117188` and `121454117219`.
- The real AWS MV3 was installed in a disposable Chromium browser; loopback staging exercises signed handoff, native simulated tabs and action quotas with synthetic cookies. **No real Phrasly provider contact or customer account validation is claimed.**

## Phase 5 first checks
- Phase 5 branch `phrasly/phase5-e2e-20261026`, draft PR #108.
- CI job `121454888290`: **SUCCESS** for Phrasly protocol/server tests, selected StealthWriter, ChatGPT and Turnitin regression tests, full site build and disabled-release gate.
- Additional run may be queued independently by PR events.
- No production deployment or financial mutation.

## Remaining Phase 5 acceptance
1. Confirm organization is authorized to use each test account and extension workflow.
2. Validate native Phrasly Humanizer and Detector processing with authorized accounts and representative texts; distinguish successful action from an attempted request.
3. Verify quotas, expiration, provider authentication failure, account exhaustion, simultaneous launch and consent boundaries.
4. Run broader live regression checks for unaffected services and payments using non-financial smoke requests; never create charges or modify balances.
5. Record test results and exact rollback steps before production deployment Phase 6.

## Expanded verification (26 October 2026)
- Commit `66ed06c132502a2403d8f63b1896ccc4de0878f1` expanded CI to include synthetic payment checkout/regressions, StealthWriter and ChatGPT vault contracts, Phrasly extension worker, Phrasly session/proxy regressions, and complete application build.
- Isolated-regressions job `121457893563`: SUCCESS, including all test stages and the final disabled-release gate.
- These checks do not create or refund money, do not modify balances, and do not exercise live Phrasly provider generation.

## Final outstanding gate
- No valid authorized live Phrasly processing result has been obtained or independently verified from the website's target environment. A synthetic browser response is not equivalent to live processing.
- Until this gate passes, **Phase 5 remains open** and the next phase must not activate production access. No fake acceptance evidence should be used.
- Phase 6 deployment activities are not yet authorized by this report.

## Direct AWS source parity review (26 October 2026)
Compared private canonical AWS sources `platform/public-app/ext-handoff.php`, `ext-fulfill.php`, and `ext-check-usage.php` at source commit `4c420f5d054653d4dc3eb12ecf74e0508556b184` to the actual TopRated Phase 5 branch. Verified contracts: short-lived HMAC feature-scoped token, entitlement recheck at fulfillment, provider account selection, no usage increment on opening, longer-lived record token and per-action usage recheck. TopRated adapts numeric AWS tool/user IDs to named tool slug and Supabase UUID.

**Defect fixed:** Original AWS platform has a PHPSESSID browser session that the extension popup reads. TopRated uses Supabase bearer authentication; its previously implemented `/ext-session` endpoint was never called by the website launcher. Commit `8250b8db6aff5262e9001462479680f3872bb723` now creates the secure first-party popup session before requesting a signed handoff. The Phase 5 CI workflow checks call order and same-origin cookies, in addition to existing backend and browser tests. This preserves the original AWS popup contract, not a new authentication architecture.

**Remaining evidence:** CI and synthetic fixtures cannot prove that an actual authorized Phrasly account has been configured in the TopRated server vault, nor that the real Phrasly service accepts an action from TopRated staging. This final provider-integration acceptance remains OPEN. Do not claim Phase 5 fully closed or activate production until actually confirmed.
