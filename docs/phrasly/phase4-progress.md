# Phase 4 frontend implementation — 26 October 2026

**State:** Frontend feature integration implemented and isolated CI passed. Staging extension installation and live browser acceptance remain unverified. No production activation.

## What changed
- New `src/lib/phrasly-extension/launch-from-website.ts` reuses Phase 2's `createPhraslyLauncher` and calls the Phase 3 `/ext-handoff.php` route with the current verified Supabase token. The handoff produces only HMAC launch claims, not provider credentials.
- New `src/components/tools/PhraslyOneClickActions.tsx` adds separately labeled Humanizer and AI Detector controls with busy, error, and extension readiness feedback.
- Existing `ToolAccessPanel` retains login, paywall and entitlement gating and uses feature-specific buttons for Phrasly when one-click is enabled; other tools are unchanged.
- Existing `extensions/phrasly-oneclick` still contains the original AWS extension and `config.js` remains `enabled:false`. Distribution is not activated.
- `.github/workflows/phrasly-phase4-frontend.yml` builds the website and tests the unchanged launcher protocol with the extension disabled.

## Evidence
- Phase 4 branch `phrasly/phase4-frontend-20261026`; draft PR #107.
- Phase 4 frontend job `121452997503` passed its frozen dependency installation, compiled website, original extension launcher tests, and disabled-package guard.
- Original AWS extension parity CI is independently tracked; do not claim completion until its last run finishes successfully.

## Explicit release boundary
- No PR merged to main and no production update.
- No Phrasly account cookie data or service secrets are checked into the website repo.
- Browser extension installation/distribution and real native browser login are not yet proven on an authorized staging client; those checks are needed before declaring all Phase 4 browser acceptance complete.
- Phase 5 real third-party processing verification and Phase 6 production release remain untouched.
