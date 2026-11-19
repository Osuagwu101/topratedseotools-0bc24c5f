# Claude two provider accounts

Account 1 retains the existing private browser (9225), relay (6101), encrypted legacy vault and all existing writer assignments/history. Account 2 uses a separate Chrome user-data directory, CDP port 9227 and relay port 6112.

Apply the committed additive migration before deploying the app. Install the committed Account 2 systemd units as trst-claude-account-2-browser.service and trst-claude-account-2-relay.service. Install the committed relay.mjs at /opt/trst-claude-account-2-relay/relay.mjs. Generate a private relay key in /etc/trst-claude-account-2-relay.env as CLAUDE_BROWSER_RELAY_KEY; set the same value on the app as CLAUDE_ACCOUNT_2_RELAY_KEY and set CLAUDE_ACCOUNT_2_RELAY_URL=http://127.0.0.1:6112/request. Never commit these values. All ports must remain loopback-only.

Sign into the dedicated Account 2 profile before using Admin > Tools > Claude > Session > Verify connection. Account 2 remains needs_login until a live organizations check succeeds. Customer pages select Account 1 or Account 2 alongside the daily message limit. The database trigger atomically revokes existing sessions on reassignment. Request checks also reject stale account bindings. Daily quotas stay per writer, irrespective of account. Histories and ownership probes include provider account. Browser storage markers change on account reassignment. There is no automatic fallback between accounts.

Validation: run tests/claude-two-accounts.test.ts, existing Claude policy suites, relay.test.mjs, tsc and the production build. Live acceptance requires two signed-in provider accounts and two authorized writer sessions. Do not claim Account 2 ready until simultaneous messages, reload, private histories and reassignment have passed.

Rollback: restore the prior app and vhost upstreams; leave additive data intact. Stop only the Account 2 services if necessary. Do not delete conversation ownership, writer quota or billing data.

Deploy from the verified clean GitHub checkout with `python3 scripts/claude-browser-transport/deploy-two-accounts.py`. The script preserves the existing main process environment, backs up both vhosts, tests the new app on loopback before cutover and restores vhost files if nginx validation fails.

## Per-account session JSON cards (StealthWriter-style)

Admin > Tools > Claude > Session shows one card per account. Pasting a session JSON (bundle object or browser cookie-export array with a current `sessionKey`) on a card and pressing Save & activate:

1. normalises and encrypts the bundle (Account 1 → legacy `tool_authorized_sessions` vault, unchanged; Account 2 → `claude_provider_accounts.encrypted_payload`);
2. revokes that account's existing writer launches;
3. POSTs the cookies to that account's relay `/session` endpoint (loopback, same bearer key), which clears the profile's claude.ai cookies and storage, sets the pasted cookies and reloads `https://claude.ai/new`;
4. verifies `/api/organizations` through that account and sets it `connected` (or `needs_login`).

Card 1 only ever touches Account 1's browser and Card 2 only Account 2's; there is no fallback between them. Signing in manually inside a server browser still works; Verify connection checks either way.

Deployment for this change: apply `20261119150000_claude_account_session_vault.sql`, then install the updated `relay.mjs` to both `/opt/trst-claude-native-relay/relay.mjs` and `/opt/trst-claude-account-2-relay/relay.mjs` and restart the two relay services (browsers do not need restarting), then deploy the app. Until the relays are updated, Save & activate stores the session and reports that the relay must be updated. Tests: `bun run tests/claude-account-sessions.test.ts`, `node scripts/claude-browser-transport/relay-session.test.mjs`.
