# Claude native browser transport trial — 2026-11-14

Status: isolated trial on https://claude.topratedseotools.com:4173. Main production launch and :443 remain unchanged.

## Verified
- Native HTML and authenticated bootstrap returned HTTP 200 through persistent browser transport.
- Current native Claude UI loaded the paid account, model selector and shared conversation history.
- Compatibility added for /edge-api bootstrap routes and Connect protobuf ConversationService RPCs.
- UI submitted test prompt asking for NATIVE_PROXY_OK; navigation reached a new /chat/ URL.
- Independent authenticated provider read of that conversation returned HTTP 200 and two saved messages: human and assistant; both contained the test marker.
- Latest build and TypeScript checks completed successfully.
- Five assertion-based Bun test files completed exit 0 (Bun reports 0 registered test cases because these files use top-level assertions). Node relay test passed.
- Temporary browser diagnostic injection removed from staging Nginx; nginx -t passed and reload completed.

## Remaining limitations
- Browser inspection timed out after chat submission. The assistant reply is confirmed from stored conversation data, but final visible streaming and reload behavior have not been confirmed.
- File uploads, voice, projects and cross-device/concurrent writers have not been verified.
- Shared account history is visible in this explicit prototype mode; per-writer conversation isolation is deferred.
- Staging body limit is 2 MB.
- Browser/relay units are active but not enabled for startup; this is not a production deployment.
- Saved browser may require normal reauthentication when the provider session expires. No guarantee of permanent avoidance of verification.

## Boundaries
- Browser profile owns provider credentials; writer request cookies/authorization/identity headers are not replayed upstream.
- CDP and authenticated relay listen only on loopback; no public remote-desktop viewer is used.
- Existing TopRated launch authorization, grant revocation and origin checks remain enforced.
- Only approved ConversationService RPC methods are permitted; account/settings/auth RPCs are excluded.
- Environment files, relay key, browser profile and private HTML are excluded from source control.

## Runtime
- Worktree: /home/ubuntu/releases/trst-claude-browser-transport-20261114
- PM2: trst-claude-native-transport-pilot on 127.0.0.1:3273
- Browser: trst-claude-native-browser.service, private CDP 127.0.0.1:9225
- Relay: trst-claude-native-relay.service, 127.0.0.1:6101
- Nginx: /etc/nginx/sites-available/claude-native-transport-pilot, HTTPS port 4173
- Main production app continues on 3271.

## Disable isolated trial
Remove the trial sites-enabled symlink and reload Nginx after nginx -t. Stop only PM2 trst-claude-native-transport-pilot and trst-claude-native-relay / trst-claude-native-browser services. Do not modify main production vhosts or other OneClick services. Dedicated display may be stopped only when no Claude browser service is using it.

Earlier rejected browser-viewer rollback snapshot remains intact at /home/ubuntu/deploy-backups/claude-browser-rollback-20261113-204623; use its RESTORE.md only if deliberately restoring that older interface. It is separate from this native transport trial.
