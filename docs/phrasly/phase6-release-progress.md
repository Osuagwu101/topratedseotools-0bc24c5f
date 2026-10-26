# Phase 6 release preparation — 26 October 2026

Status: IN PROGRESS. Phase 5 is complete; an actual candidate is staged and verified on the OVH production host. Public activation has not occurred.

## Verified candidate

- Directory: /home/ubuntu/staging/phrasly-phase6-20261026, protected with mode 0700.
- Process: PID 95741, listening only on 127.0.0.1:3336.
- Verified at 2026-10-26T09:32:24Z.
- Runtime source: e698b9b533ae9a1d979dc4fb8952b82751b9e523. Later Phase 5 commits add acceptance evidence and the final matrix without changing runtime code.
- Archive SHA-256: 67f5dee307d301a75434e9ee0d405216c366698056a5004d1bfbed49057f48ea, verified after transfer.
- Packaged 652 files. No platform-specific .node modules. Exact service-role, HMAC and encryption-secret scan passed before transfer.
- Candidate successfully ran on the destination Linux host; the original build was produced on the operator's Windows device.

Eight checks passed: signed-out popup identity, unauthenticated handoff rejection, missing-token fulfillment rejection, real Supabase-authenticated popup identity, real signed fulfillment, exact AWS cookie count (33), all existing production PM2 processes unchanged, and Nginx configuration unchanged.

Server settings, QA credentials, cookie state and runtime evidence are protected operational files outside Git. No live provider generation requests were made during VPS candidate verification.

## Rollback and remaining release work

The current Nginx file and 60-process baseline were saved in /home/ubuntu/backups/phrasly-phase6-20261026. The exact rollback procedure is in ../phrasly/phase5-rollback.md. Stopping only the verified candidate PID restores the pre-candidate service state; it does not affect public traffic.

Remaining Phase 6 work: prepare the in-house writer activation and extension distribution against this verified candidate, validate public first-party routing and assigned staff access, then perform controlled activation, post-activation checks and monitoring. Existing authorizations apply; this report does not request another approval.

The provider account displayed a Free plan during live acceptance. A final rollout must report its actual remaining provider allowance and distinguish it from TopRated's independent request-attempt quotas; neither quota may be represented as unlimited.
