# QuillBot writer rollout checks — 17 November 2026

Do not treat a saved cookie bundle or a successful short-term launch as a completed rollout gate.

## Implemented controls and fixes

- Authenticated writer ownership on history, operations, device registration and active-session checks.
- Provider cookies and native/refresh tokens stay server-side; native tokens must match the imported account subject.
- Same-version cookie imports are serialized; importing cookies no longer deletes the dedicated browser's persistent sign-in storage.
- Failed primary paraphrases with no successful output refund once. A submission that already produced output is not refunded by a later failure.
- Daily allowance follows Africa/Lagos. Limits, usage and encrypted history persist in SQLite; tests cover restart durability and a refund crossing midnight. Unfinished submissions have durable reservations that are refunded exactly once after a service restart.
- Unverified QuillBot features show a Paraphraser-only message; their provider endpoints remain blocked.
- CI runs the transport/security control regressions.

## Evidence in this revision

22 transport/control tests and 21 launch/access tests passed locally. Full production-build workflow must pass before merge. Database checks confirm private QuillBot tables have RLS enabled with no anon/authenticated read privileges and no direct writer/anon device-registration execution permission.

The live acceptance harness (`rollout-acceptance.mjs`) uses only the two existing disposable QA writer identities. It exercises concurrent real processing, separate history, direct cross-writer rejection, expiration/revocation, suspension, quota changes, device removal/limits, blocked features and scans responses for actual provider secrets. Its `finally` block revokes QA access and restores QA quotas.

**Live rollout remains blocked:** the acceptance run returned 503 while establishing its first Premium writer session. The imported useridtoken expired at 2026-11-17 16:20:34 UTC (17:20:34 Lagos); the dedicated native browser had no renewable user token. Metadata inspection confirmed this without exposing session values. Earlier cookie imports cleared IndexedDB/localStorage, removing persistent native authentication. The preservation fix prevents repeating that deletion, but cannot reconstruct an already deleted sign-in.

Re-establish an authorized native provider sign-in, save a fresh Admin cookie export, then run the acceptance harness. Recheck token renewal beyond the imported token expiry and a service restart before marking this gate passed. No claim of current two-writer live acceptance is made. The previous single-writer UI checks proved Standard/Formal operations and saved history, not long-term renewal.

## Operator procedure

From the deployed repository, run `python3 scripts/quillbot-cookie-connect/install-rollout.py` for the scoped runtime installation, then run the acceptance harness from the dedicated runtime using Node 22 with TypeScript stripping. Never print the encrypted QA credentials, provider cookie values, or service keys. Do not run the older reverification scripts: their historical fixture encryption and cleanup assumptions predate the vault-key alignment.

Scope remains the **Paraphraser**. Grammar Checker, plagiarism, AI Humanizer, projects and uploads are not supported or advertised as verified.
