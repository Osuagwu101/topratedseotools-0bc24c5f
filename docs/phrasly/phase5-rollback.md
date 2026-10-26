# Phrasly rollback — native Phase 6 release

The active release is /home/ubuntu/releases/trst-phrasly-native-20261026, PM2 trst-phrasly-native-oct26 on 127.0.0.1:3339. The previous /home/ubuntu/releases/trst-phrasly-aws-20261026 release on port 3338 is retained but stopped.

The effective Nginx file is /etc/nginx/sites-enabled/topratedseotools. Do not substitute the similarly named sites-available file.

## Restore the previous Phrasly release

1. Start only the retained service: pm2 start trst-phrasly-aws-oct26.
2. Verify its loopback /ext-whoami.php and /phrasly endpoints on port 3338.
3. Copy /home/ubuntu/releases/trst-phrasly-native-20261026/nginx-before.conf to /etc/nginx/sites-enabled/topratedseotools using sudo cp.
4. Run sudo nginx -t. Reload with sudo systemctl reload nginx only after validation succeeds.
5. Allow graceful worker transition, verify Phrasly and ordinary public routes, then stop only trst-phrasly-native-oct26 if needed and run pm2 save.

This restores the earlier manual-launch writer page. It retains native phrasly.ai processing and the separate Admin controls.

## Restore the pre-Phrasly routing

The protected original snapshot is /home/ubuntu/backups/phrasly-phase6-live-20261026/nginx-active.conf, SHA-256 8f6283835c54e51e0edfaa092ebd3d52d54ef943461c2d92744acc5f72f90c53.

Copy that snapshot to the effective file, validate nginx -t, reload, wait for worker transition, and verify home/login/Admin, StealthWriter, ChatGPT, Turnitin and Turnitin buy. The retired /api/phrasly-proxy must remain HTTP 410. Stop only the two added Phrasly services when appropriate and persist PM2 state. Leave the original 60 services untouched.

Both activation scripts exercised automatic restoration on failed checks. For the native correction, raw HTML hashes initially differed because ordinary pages include per-request SSR timestamps. The successful retry normalized only the observed timestamp fields and retained all other response/process checks.

## Preserve data

Do not drop additive tables, delete audit/attempt rows, reset usage, change balances or revoke unrelated access. Use the owner screen for intended writer revocation and encrypted cookie updates.

The temporary QA grant retains its original expiry. Final native browser acceptance used the existing owner with explicit writer grants; no expired historical grant was revived. No rollback requires financial-table writes.
