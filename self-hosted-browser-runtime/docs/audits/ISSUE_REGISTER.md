# Self-Hosted Browser Issue Register

Every material issue receives an ID in the form `SB-PHASE-SEQUENCE` and records severity, observed behavior, expected behavior, root cause, corrective action, regression evidence, Blueprint impact, and closure status.

## Severity gates

- Critical — phase cannot advance.
- High — phase cannot advance.
- Medium — normally fix before advancing.
- Low — may advance only when documented.
- Observation — record for future optimization.

No issue is closed until its regression test or equivalent validation passes.

## Open inherited issues

### SB-001-001 — Runtime is not yet in the Blueprint-required separate repository

Severity: High (Blueprint topology/conformance; no production impact).

Observed behavior:
The self-hosted runtime currently lives under `self-hosted-browser-runtime/` on isolated, unmerged phase branches inside the existing Top Rated SEO Tools repository.

Expected behavior:
Master Blueprint v1.1 calls for a completely separate, portable runtime repository, intended as `toprated-browser-runtime`.

Root cause:
The connected GitHub action set available in this development session does not expose repository creation. The GitHub account owner action required to create the empty repository has not been completed through an available tool.

Containment:
Self-hosted work remains isolated to dedicated phase branches. Production Browser Use routing is not switched to the self-hosted runtime.

Corrective action required:
Create the separate repository, move/copy the isolated runtime into it, rerun the applicable CI gates there, and confirm production remains unchanged.

Status: OPEN. This inherited issue prevents a claim of full repository-topology conformance, even when an individual technical phase is green.

## Phase 3 issues

### SB-003-001 — Previously described Phase 3 implementation was absent from GitHub

Severity: High.

Observed behavior:
At the start of the Phase 3 completion work, GitHub contained the verified `self-hosted-browser-phase2` branch but no persisted `self-hosted-browser-phase3` implementation.

Expected behavior:
Any claimed Phase 3 implementation must exist in the source-of-truth repository and be reproducible from a known Phase 2 baseline.

Root cause:
Unknown from repository evidence. No unsupported explanation is asserted.

Corrective action:
Created `self-hosted-browser-phase3` from verified Phase 2 head `15d176f4dfbbf7f75157dfd069c524276adf98e5`, rebuilt the secure viewer from repository evidence, and added a dedicated Phase 3 CI gate.

Regression evidence:
Corrected full Phase 3 GitHub Actions run `33849349374`, job `100948349815`, completed successfully with viewer interaction, reconnect, security, cleanup, and generic-runtime checks.

Blueprint impact:
Restored Phase 3 implementation continuity and auditable evidence. Production Browser Use remained untouched.

Status: FIXED.

### SB-003-002 — Generic-runtime CI scan produced a false positive

Severity: Medium.

Observed behavior:
First Phase 3 GitHub Actions run `33849230455` failed the Phrasly-specificity scan even though the match came from a negative unit-test assertion rather than production runtime code.

Expected behavior:
The generic-runtime static check should reject tool-specific production logic without failing on tests that assert the absence of such logic.

Root cause:
The workflow grep scope included both runtime source and test files.

Corrective action:
Restricted the tool-specificity scan to production source directories (`browser-worker/src` and `api`) while retaining the unit regression assertion.

Regression evidence:
Corrected Phase 3 run `33849349374`, job `100948349815`, completed successfully.

Blueprint impact:
No change to architecture; this repaired the accuracy of the audit gate.

Status: FIXED.

## Phase 3 closure rule

Phase 3 is not closed merely because one intermediate run is green. After the Phase 3 audit, README, and issue register are committed, the CI workflow must pass again at the final branch head. Any new red result must be investigated and fixed rather than waived.
