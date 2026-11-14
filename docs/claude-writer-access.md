# Claude writer isolation and daily messages

The native text-chat pilot is verified with two separate existing writer grants. Writers use the official Claude interface through the dedicated subdomain. Provider authentication stays in the private server browser; writer cookies, tokens and credentials are not replayed upstream.

## Writer behavior

- Each conversation is reserved against its writer before provider creation. Fresh client UUIDs are preserved only after verifying the provider has no existing conversation at that UUID.
- Conversation pages, transcripts and streaming reads require matching ownership. Existing untracked account conversations cannot be claimed.
- Both legacy arrays and v2 `{data,has_more}` history responses are filtered by writer ownership.
- Owned chat URLs receive a neutral SPA shell; the transcript loads through the authorized API instead of accepting embedded account-wide HTML.
- Browser storage is cleared when the writer marker changes.
- Account memory, profile preferences, shared connectors and tool declarations are disabled for the verified text-chat path. Files, projects, account settings and unverified features remain closed.
- Streaming RPC reads enforce ownership. RPC mutations remain closed pending independent memory/tool semantics verification; fresh writer profiles use the verified REST chat path.

## Limits and Admin controls

The default is **25 messages per writer per day**, resetting at midnight Africa/Lagos. In Admin ??? Customers ??? a customer ??? **Claude message limit**, Admin can set an integer from 0 through 10,000. Zero prevents new messages; changing the limit does not reset usage.

Quota reservation locks the user's control row, so concurrent requests cannot overrun the allowance. The message request ID is hashed for duplicate prevention. Confirmed upstream rejections release reservations once; ambiguous transport outcomes retain the reservation to avoid free duplicate sends.

Quota rejection returns HTTP 429. Fetch/XHR hooks and a send-attempt usage check display the centered red limit message for three seconds. Rejected sends do not consume an extra message.

The new quota tables have RLS and no client privileges. Only authenticated server functions use the service role. Admin updates verify the database Admin role; customer usage reads derive the user from the authenticated context. The quota RPCs are security-invoker and executable only by service_role.

Migration: `supabase/migrations/20261114055306_claude_writer_controls.sql`. This version is already applied to the production database. No balances or billing records were changed.

## Validation ??? 14 November 2026

- Two distinct writer sessions opened the native composer without a provider login form.
- Parallel native sends produced visible replies and independently verified stored assistant messages.
- Each writer's history excluded the other writer's conversations.
- Direct foreign page, transcript and streaming requests were rejected.
- Reload preserved each writer's private transcript.
- A live quota test issued ten simultaneous reservations with two slots available: exactly two were admitted.
- Increasing the Admin limit applied immediately; zero blocked sends.
- Native quota rejection showed the centered message, automatically dismissed it, and left usage unchanged.
- Nigeria midnight boundary, duplicate reservation, idempotent release, server-only permissions, TypeScript and production build checks passed.
- Eleven registered policy tests and the existing assertion-based Claude suites passed in isolated Bun processes.

Reproduction scripts are under `scripts/claude-writers/`. They require the private environment and two existing active writer grants. The browser probe uses a separate, unauthenticated QA Chrome on loopback port 9226, keeping its renderer memory outside the authenticated transport service. Temporary writer contexts are disposed after testing.

The provider browser and relay remain at loopback ports 9225 and 6101. Normal provider reauthentication may be required when its session expires. Provider account limits still apply.

## Deployment and rollback

Pilot: PM2 `trst-claude-writers-candidate`, app port 3274, HTTPS port 4173. The tested build must be deployed with the main public origin `https://claude.topratedseotools.com`, the same private relay configuration, and the existing production environment for all other tools.

Production release target: `/home/ubuntu/releases/trst-claude-writers-20261114`, app port 3275. Keep `trst-main-3271` running for rollback. Only replace references to 127.0.0.1:3271 in the main-site and Claude vhosts; preserve the separate tool upstreams.

Before cutover, save:
- `/home/ubuntu/deploy-backups/topratedseotools-before-claude-writers-20261114.conf`
- `/home/ubuntu/deploy-backups/claude-before-writers-production-20261114.conf`

Rollback restores these two vhost files, runs `nginx -t`, then reloads Nginx. Do not delete quota, ownership, account, billing or conversation data. The prior browser-viewer rollback snapshot remains separate and is not the native text-chat rollback.
