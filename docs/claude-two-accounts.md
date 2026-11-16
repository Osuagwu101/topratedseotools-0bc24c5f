# Claude two provider accounts

Account 1 retains the existing private browser (9225), relay (6101), encrypted legacy vault and all existing writer assignments/history. Account 2 uses a separate Chrome user-data directory, CDP port 9227 and relay port 6102. Authentication for Account 2 stays in its browser profile; cookie pasting into the legacy vault configures Account 1 only.

Apply the committed additive migration before deploying the app. Install the committed Account 2 systemd units as trst-claude-account-2-browser.service and trst-claude-account-2-relay.service. Install the committed relay.mjs at /opt/trst-claude-account-2-relay/relay.mjs. Generate a private relay key in /etc/trst-claude-account-2-relay.env as CLAUDE_BROWSER_RELAY_KEY; set the same value on the app as CLAUDE_ACCOUNT_2_RELAY_KEY and set CLAUDE_ACCOUNT_2_RELAY_URL=http://127.0.0.1:6102/request. Never commit these values. All ports must remain loopback-only.

Sign into the dedicated Account 2 profile before using Admin > Tools > Claude > Session > Verify connection. Account 2 remains needs_login until a live organizations check succeeds. Customer pages select Account 1 or Account 2 alongside the daily message limit. The database trigger atomically revokes existing sessions on reassignment. Request checks also reject stale account bindings. Daily quotas stay per writer, irrespective of account. Histories and ownership probes include provider account. Browser storage markers change on account reassignment. There is no automatic fallback between accounts.

Validation: run tests/claude-two-accounts.test.ts, existing Claude policy suites, relay.test.mjs, tsc and the production build. Live acceptance requires two signed-in provider accounts and two authorized writer sessions. Do not claim Account 2 ready until simultaneous messages, reload, private histories and reassignment have passed.

Rollback: restore the prior app and vhost upstreams; leave additive data intact. Stop only the Account 2 services if necessary. Do not delete conversation ownership, writer quota or billing data.
