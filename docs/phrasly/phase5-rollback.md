# Phrasly Phase 5 rollback and Phase 6 boundary

Phase 5 has not changed production Nginx, production PM2 processes, public tool settings or financial records. Its additive tables and audit/attempt rows are retained. Never roll back by dropping tables, deleting audit data, resetting usage or changing balances.

## Acceptance matrix restoration

tests/phrasly-phase5-final-matrix.mjs registers restoration before each temporary mutation and restores every snapshot in finally. It changes only the internal acceptance writer's profile/grant/feature settings and the currently unexposed Phrasly account/configuration. The successful run reported restoration_errors: [].

Verified restored state: account enabled, capacity null; Phrasly configuration enabled inside the private backend; both acceptance feature limits 20 and enabled. The real production backend enable flag/routing remains unchanged.

If this matrix is interrupted, use the protected operator settings and original snapshots: restore the acceptance profile account_status, staff grant status/expires_at, feature daily_limit/enabled, account enabled/capacity and tool configuration enabled. Re-run the read-only verification before continuing. Retain all attempt/audit rows.

## Private candidate rollback

Candidate target: /home/ubuntu/staging/phrasly-phase6-20261026.
The Phase 6 stage launcher writes candidate.pid and candidate-evidence.json. Stop only that PID after checking /proc/PID/cmdline refers to this candidate's .output/server/index.mjs. The release is loopback-only; stopping it does not change public traffic.

The launcher snapshots /etc/nginx/sites-available/topratedseotools and the baseline PM2 inventory in /home/ubuntu/backups/phrasly-phase6-20261026, with directory mode 0700 and file mode 0600. Before a later public route switch, preserve a fresh copy and validate nginx -t.

If a later Phase 6 route switch requires rollback:
1. Restore the exact saved Nginx configuration with sudo cp /home/ubuntu/backups/phrasly-phase6-20261026/nginx.conf /etc/nginx/sites-available/topratedseotools.
2. Run sudo nginx -t. Reload with sudo systemctl reload nginx only if validation succeeds.
3. Verify the established public home/login/admin, StealthWriter, ChatGPT, Turnitin and Turnitin buy pages and compare the established PM2 processes to the protected snapshot.
4. Stop only the new candidate if required. Keep existing releases and database records.

No public route switch has occurred at this Phase 5 boundary. A backup alone is not evidence that a public rollback was exercised.
