# ChatGPT Phase 3

The dashboard authenticates directly to the dedicated gateway with its existing TopRatedSEOTools token. The gateway verifies that token with Supabase and checks the ChatGPT switch, profile, controls, active paid order/grant, access type/plan, assigned account, account health and device limit.

Host-only Secure/HttpOnly/SameSite=Lax __Host cookies bind the browser to a 60-second opaque ChatGPT ticket at the exact dedicated origin. Filesystem locks enforce one-time consumption. Entitlement, account and device checks repeat on redemption and gateway-session requests.

State resides at /home/ubuntu/state/chatgpt-phase3 with 0700/0600 permissions. Tickets, gateway session tokens, proof/device values and dashboard auth-session IDs are hashed. Dashboard bearer tokens are not persisted. This is a single-VPS, single-gateway implementation; multiple hosts require transactional shared storage.

PM2 must execute server.mjs, which starts the gateway on 127.0.0.1:3006. gateway.mjs is importable for tests. No OpenAI browser session, cookie-vault payload or upstream request is used. Accepted launches create only gateway sessions and then show a controlled 503 indicating the ChatGPT connection is not configured.

The legacy dashboard-origin ticket issuer/proxy fallback is disabled. Old tabs receive a safe reload message. StealthWriter and Phrasly source/processes are unchanged.

ChatGPT Nginx access logs are disabled; its error sink is /dev/null. Application diagnostics contain only an allowlisted category and request ID.

Run node --test ops/chatgpt-phase3/gateway.test.mjs for security tests. The live audit needs the existing server-side SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. It creates temporary confirmed site users, ChatGPT account metadata and grants, exercises public launch/expiry/replay/cookie/assignment/redaction checks and removes its fixtures. It never creates or uses OpenAI credentials.

Back up before deployment. PM2 configuration filenames must end in .config.js. Target only the actual main process on 3005 and the dedicated gateway on 3006. Validate nginx -t before reload.

Before rebuilding the main site, copy previous and intermediate live .output/public/assets into staging public/assets. Exclude these generated files from source commits. This preserves old asset URLs for already-open browser tabs in Nitro's static manifest.

Phase 4 remains fixed-host proxy route/asset/redirect/streaming/upgrade parity and controlled errors, without login or anti-bot bypass.
Phase 5 remains the separately authorized account-specific encrypted session adapter and rotation, bound to the exact Phase 3 assignment.
