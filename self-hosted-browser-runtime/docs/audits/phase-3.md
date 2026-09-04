# Phase 3 Audit — Secure Restricted Browser Viewer

Status: TECHNICAL EXIT GATE GREEN, subject to final branch-head CI rerun after this audit commit. Overall Blueprint conformance still carries the inherited Phase 1 separate-repository issue `SB-001-001`.

## Scope

Phase 3 implements and validates the secure remote viewer layer required by Master Blueprint v1.1. The viewer must let an authorized writer interact with the isolated Chromium page using mouse, keyboard, and scroll; reconnect to the same running browser; and do so without exposing raw CDP, DevTools, shell access, cookies, credentials, or other unrestricted browser-control surfaces.

Phase 3 does not implement the Laravel session API from Phase 4, multi-session scheduling, tool profiles, Phrasly authentication/session injection, production provider routing, or any change to the existing Browser Use production path.

## Repository-state discrepancy discovered before implementation

At the beginning of this work, the repository contained `self-hosted-browser-phase2` but no persisted `self-hosted-browser-phase3` branch or Phase 3 implementation. Earlier conversational status had described a viewer as already built, but that state was not present in GitHub and therefore was not accepted as evidence.

Corrective action:

1. verified the Phase 2 head `15d176f4dfbbf7f75157dfd069c524276adf98e5`;
2. created `self-hosted-browser-phase3` from that verified Phase 2 head;
3. rebuilt Phase 3 from repository evidence rather than conversational claims; and
4. added this discrepancy to the issue register as `SB-003-001`.

The reason the previously described Phase 3 work was not persisted cannot be established from repository evidence, so no unsupported root cause is asserted.

## Implementation evidence

- Viewer access uses HMAC-SHA256 signed, short-lived, session-bound tokens: PASS.
- Viewer signing secret must contain at least 32 bytes: PASS.
- Viewer token TTL is bounded to a maximum of 900 seconds: PASS.
- Viewer token is delivered in the URL fragment, not the query string: PASS.
- Browser-side viewer removes the fragment from the visible URL and keeps the token in `sessionStorage`: PASS.
- Authenticated viewer API calls use the token as a Bearer credential: PASS.
- Token is never embedded into the viewer HTML response: PASS.
- Missing, forged, expired, and cross-session authorization are rejected: PASS by unit/integration coverage.
- Viewer shell is protected by no-store, no-referrer, nosniff, frame-denial, CSP, permissions-policy, COOP, and CORP headers: PASS.
- Viewer endpoints do not emit permissive CORS headers: PASS.
- Worker is published only on host loopback in the Phase 3 Compose topology: PASS.
- Chromium CDP binds only to `127.0.0.1` on a dynamically allocated port: PASS.
- No raw CDP/DevTools port is published by Docker Compose: PASS.
- Browser start response does not expose `webSocketDebuggerUrl`, DevTools port, or raw CDP details: PASS.
- Viewer receives JPEG frames through the restricted frame endpoint: PASS.
- Mouse click interaction changes the deterministic test page state: PASS.
- Keyboard focus, text input, and Enter key interaction change the deterministic test page state: PASS.
- Scroll interaction changes the deterministic test page state: PASS.
- Unsupported `shell` input is rejected by the restricted input contract: PASS.
- Three viewer reconnect cycles preserve the same browser session ID and Chromium PID: PASS.
- Browser stop invalidates the viewer session: PASS.
- Browser cleanup reports no tracked orphan or zombie Chromium PIDs: PASS.
- Independent `/proc` scan after stop finds no Chromium processes: PASS.
- Worker remains healthy after viewer lifecycle tests: PASS.
- Runtime production source remains generic and contains no Phrasly-specific logic: PASS.
- Existing Browser Use production routing remains untouched: PASS.

## CI evidence

### First Phase 3 run — RED

GitHub Actions run `33849230455` failed at the static generic-runtime check.

Observed behavior:
The workflow searched both production source and test files for the string `phrasly`. A unit test intentionally contained that word in an assertion confirming that runtime output does *not* contain it. The audit check therefore failed on its own regression-test fixture.

Root cause:
The CI grep scope was overly broad and treated test assertions as production runtime logic.

Corrective action:
The generic-runtime scan was narrowed to production runtime source only: `browser-worker/src` and `api`.

Issue ID: `SB-003-002`.

### Corrected Phase 3 run — GREEN

GitHub Actions run `33849349374`, job `100948349815` — SUCCESS.

Verified evidence from the corrected run includes:

1. worker unit tests: 7 passed, 0 failed;
2. Phase 3 API and worker health contracts: PASS;
3. worker host publication: `127.0.0.1:18081`;
4. raw CDP port publication check: PASS;
5. secure viewer shell/header and token-nondisclosure checks: PASS;
6. unauthorized, forged, and cross-session viewer requests rejected: PASS;
7. authenticated viewer JPEG captured (`28784` bytes): PASS;
8. mouse interaction produced page title `Clicked`: PASS;
9. keyboard/text interaction produced `Typed:hello-phase3`: PASS;
10. scroll interaction produced `Scrolled:800`: PASS;
11. reconnect 1, 2, and 3 retained the same session and Chromium PID: PASS;
12. unsupported shell input rejected: PASS;
13. stop reported `rootExited=true`, `orphanPids=[]`, and `zombiePids=[]`: PASS;
14. independent Chromium process scan: clean;
15. worker remained healthy and browser status became inactive after stop: PASS; and
16. Docker Compose teardown completed successfully.

Because this audit/README/issue-register documentation changes the branch head, Phase 3 is not declared finally complete until the CI workflow also passes on the final documentation commit. That final run must be added below before closure.

## Security notes and limits

- Phase 3 proves that the writer-facing viewer does not expose raw CDP through the tested runtime/API surface. CDP still exists internally because the worker needs it to control Chromium; it is loopback-bound inside the worker container and is not published as a writer interface.
- TLS termination is not claimed by this localhost CI test. HTTPS/TLS belongs to the deployment/hardening path on the fixed-price VPS and must be validated at the relevant later phase.
- The current worker remains intentionally single-session. Per-writer ownership and multi-session isolation are later Blueprint phases and are not falsely claimed here.
- Phase 3 does not yet provide Phase 4 Laravel session orchestration or lifecycle/lease policy.

## Root-cause register

### SB-003-001 — Previously described Phase 3 implementation was absent from GitHub

Severity: High.

Status: FIXED for Phase 3 implementation continuity.

Evidence and corrective action are documented above. Repository evidence does not establish why the earlier state was not persisted; root cause is therefore recorded as unknown rather than guessed.

Regression evidence:
The Phase 3 branch was rebuilt from the verified Phase 2 head and the corrected full viewer CI gate passed in run `33849349374`.

### SB-003-002 — Generic-runtime CI scan produced a false positive

Severity: Medium.

Status: FIXED.

Root cause:
The Phrasly-specificity grep included test files that intentionally referenced the word in a negative assertion.

Corrective action:
Restricted the scan to production source directories while retaining the unit assertion that runtime output stays generic.

Regression evidence:
Corrected run `33849349374` completed successfully.

### Inherited issue — SB-001-001

Severity: High Blueprint-conformance issue; no production impact.

Status: OPEN.

The Phase 1 audit requires the self-hosted runtime to live in its own repository. The available connected GitHub action set does not expose repository creation, so the runtime remains isolated under `self-hosted-browser-runtime/` and unmerged phase branches in the existing repository. This limitation is not concealed by the Phase 3 technical green result. It must be resolved before claiming full repository-topology conformance with Master Blueprint v1.1.

## Blueprint / sequencing conformance

- Secure interactive viewer: PASS.
- Mouse interaction: PASS.
- Keyboard/text interaction: PASS.
- Scroll interaction: PASS.
- Reconnect to the same running browser: PASS.
- Writer-facing raw CDP/DevTools exposure: NOT PRESENT in validated surface.
- Restricted input surface instead of shell/DevTools: PASS.
- Short-lived session-bound viewer authorization: PASS.
- Generic browser runtime: PASS.
- Browser Use production flow unchanged: PASS.
- Phase 4 Laravel session API started: NO — sequencing preserved.
- Separate runtime repository: OPEN inherited issue `SB-001-001`.

## Exit gate

The Phase 3 **technical** exit criterion is GREEN on corrected run `33849349374`: the restricted viewer supports mouse, keyboard, scroll, and reconnect while the tested writer-facing surface exposes no raw CDP/DevTools access.

Final closure requires one additional green CI run at the final Phase 3 branch head after this audit documentation is committed. Full Master Blueprint repository-topology conformance remains separately blocked by inherited issue `SB-001-001`; this does not change the technical Phase 3 viewer result and is not being hidden.
