# Phase 1 backup and rollback procedure

Status: prepared procedure; the actual VPS backup and restore rehearsal are not yet verified. No production deployment or rollback was executed.

## Resume safely

The backup driver was started from the authorized Windows operations directory. Its intended destination is a new host-local directory:

`/home/ubuntu/backups/phrasly-phase1-<UTC-timestamp>`

After the SSH bridge reconnects, inspect the existing process result and any partial backup first. A missing tool response does not prove that the SSH operation never ran. Do not repeat the driver blindly or overwrite partial evidence.

Keep original releases, Nginx configuration, source checkouts and permissions intact. Any permission correction needed for recovery applies only to newly created private backup files or restore-test directories.

## Required contents

| Bundle | Contents |
| --- | --- |
| Storefront | Actual port-3124 compiled runtime, metadata, protected host configuration and required runtime dependency targets |
| Login | Actual port-3126 runtime, source/build metadata, protected configuration and required dependency targets |
| Admin | Actual port-3202 runtime, source/build metadata, protected configuration and required dependency targets |
| Static files | Shared assets and static SEO files used by Nginx |
| Routing | Nginx configuration and required symlink targets |
| Evidence | Archive SHA-256; file hashes/modes; symlink targets; whitelisted PM2 name, script, cwd, port, PID, start time and restart count |

Use mode 0700 for the backup directory and 0600 for files. Required environment files stay in the protected backup on the original host. Do not transfer the backup to GitHub or the source package. Exclude SSH identities, TLS private-key directories, databases, customer sessions, logs, provider cookies and account credentials.

Do not assume a development node_modules directory is needed at runtime. Inspect compiled imports and symlinks: a link to another live release is not a self-contained backup. Preserve required targets privately or prove the restored runtime works independently of live directories.

## Restore rehearsal

1. Record live source/configuration hashes, PM2 identities/restart counters, Nginx syntax and expected public HTTP statuses.
2. Create archives with authorized read access. Do not change production permissions. Inspect members before extraction; reject absolute/traversal names, special files and unsafe descendant paths through symlinks.
3. Extract into a new private restore-test directory, never a live release or `/etc/nginx`.
4. Compare all file SHA-256 values and modes and each symlink target to the original manifest. Check runtime dependencies independently.
5. Write success metadata only after those checks pass. Keep original manifests private on the host.
6. Set PHRASLY_BACKUP_DIR to the actual verified backup path, then run the read-only verifier on the original host:

```sh
python3 scripts/phrasly/verify_phase1_backup.py "$PHRASLY_BACKUP_DIR"
```

The helper reads `SHA256SUMS`, `files.private.json`, `verification.private.json` and the existing isolated restore tree. It never extracts, modifies files or changes services. It verifies checksums, restored bytes, modes and symlink targets. It does not prove runtime dependency completeness or service startup.

Its seven fixture tests run with:

```sh
python3 -m unittest discover -s scripts/phrasly -p 'test_*.py' -v
```

7. Compare production hashes/process counters and HTTP results after rehearsal. Investigate any live change/restart before recording production integrity.
8. Keep the retired Phrasly 410 blocks and provider-session configuration unchanged.

## Future deployment rollback

These instructions apply to a future explicitly authorized deployment, not Phase 1 activation.

Before switching routes, pin then-current release paths, asset map, Nginx hash and process identities. Check for intervening changes before rollback; do not replace an entire Nginx tree blindly.

Prepare recovery under a new release directory using a verified backup. Keep secret configuration on the original host. Validate dependencies and use an isolated port/process only during the approved deployment window. Preserve the original releases.

Revert only route/asset mappings changed by that deployment. Validate Nginx syntax before the authorized reload, then verify public, login, admin and asset responses. Preserve the Phrasly 410 blocks until an authorized replacement has its own activation.

Application rollback does not restore customer databases, financial balances, payment records, usage ledgers or provider sessions. Future schema changes need a separate forward-compatible release/recovery plan.

Phase 1 made no production application or routing change, so there is currently no deployment change to roll back.
