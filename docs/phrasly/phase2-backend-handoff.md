# Phase 2 backend handoff for Phase 3

The decision is complete: implement the recovered AWS cookie-extension workflow. The original allocator, endpoints, helper functions, schema and extension are preserved in the [private AWS source repository](https://github.com/Osuagwu101/topratedseotools.com.ng-source/blob/4c420f5d054653d4dc3eb12ecf74e0508556b184/reference/phrasly-oneclick/aws-canonical/README.md), under `reference/phrasly-oneclick/aws-canonical/`. These files establish behavior; they are not live routes on TopRated's Node website.

## HTTP contracts

| Path | AWS input | Result and source behavior |
| --- | --- | --- |
| `ext-handoff.php` | GET `tool_id`, `feature`; authenticated PHP session | `{ok,payload,signature}`; 60-second capability; validates tool and feature grant |
| `ext-fulfill.php` | GET `payload`, `signature` | `{ok,url,cookies,block_paths,used,limit,record_token}`; rechecks active user/subscription/grant/quota; assigns cookie account; no usage increment |
| `ext-check-usage.php` | POST form `record_token`, `feature` | `{ok,allowed,used,limit,resets_in}`; rechecks access; transaction around per-feature daily count; counts attempts before processing |
| `ext-whoami.php` | GET with first-party session via `X-Ext-Session` | `{ok,email,full_name,subscription_end,tools}`; feature limits/usage and launch handoffs for the popup |

Extension-facing CORS on AWS is `chrome-extension://lpgnjkafilbopdojcfnagooojifkccek`. Handoff JSON field order is `uid,tool_id,feature,exp`; record JSON is `uid,tool_id,exp`, valid 14,400 seconds. Record format is `payload.hex_hmac`. Expiry is rejected only when `exp < now`. Signed handoffs remain reusable within the TTL; a record verifier does not enforce token purpose. The original source code does not persist a redemption ledger or action ID.

Fulfillment errors include `missing_token` (400), `bad_signature` (403), `bad_token` (400), `token_expired` (403), `account_inactive` (403), `subscription_expired` (403), `tool_not_found` (404), `no_access` (403), `limit_reached` (429), and `no_accounts_available` (503). Quota denial includes `limit` and `resets_in`. Usage rejects inactive or expired users as `account_inactive`; its ordinary quota denial is HTTP 200 with `ok:true, allowed:false`.

## Account assignment and storage

| AWS object | Required behavior |
| --- | --- |
| `tool_cookie_accounts` | Per-tool account: target URL, cookie JSON, label, nullable capacity; NULL means unlimited reuse |
| `cookie_account_assignments` | Account/user assignment, unique `(account_id,user_id)` |
| `oc_assign_cookie_account` | Reuse this user's existing account for this tool; otherwise fill in account ID order; skip full accounts; return NULL when no account is available |
| `user_tool_access` | Feature grant and daily limit; key `(user_id,tool_id,feature_key)` |
| `tool_usage` | Daily feature attempt count; key `(user_id,tool_id,feature_key,day)` |
| `tools` | Feature URL map, cookie-extension fulfillment type, block paths, status and target metadata |
| `users` | Active status and subscription expiry |
| `activity_log` | Access/fulfillment audit without cookie or token values |

All CREATE statements are in the recovered `backend/platform/data/schema.sql`. The other included user/auth/session tables let the unchanged reference run in isolation. There are no production rows in the package.

The allocator does not serialize count-and-assign operations. Existing capacity is not rechecked when reusing an assignment. Its unique constraint does not impose one account per user/tool. SQLite usage uses a transaction; this rehearsal verifies sequential behavior and does not establish a concurrency guarantee under load. Preserve these facts in the implementation and test report.

## Binding to the existing TopRated website

TopRated currently uses Node/TanStack and Supabase UUID identities. PHP execution and AWS integer identities cannot be assumed. Phase 3 must expose the same HTTP contracts in Node and connect the server helpers to TopRated's verified user identity, account status and current paid/granted access. `src/lib/phrasly-extension/protocol.server.ts` already accepts UUIDs without changing the wire field names.

The original popup needs a first-party opaque session cookie and the `X-Ext-Session` bridge. TopRated must supply an equivalent server-backed bridge from its existing verified login; a successful mock `PHPSESSID` test does not establish that production bridge. Keep Supabase service keys and bearer credentials on the server. The original extension-facing session contract is retained rather than replaced with an unrelated authentication scheme.

Use isolated, additive Phrasly account/assignment/feature-counter storage so the existing `tool_usage` launch log and financial records are not repurposed. Treat the recovered SQLite schema as a specification for the Node/Postgres adapter; it is not a SQL migration to run against Supabase. Phase 3 must keep original account reuse/capacity selection and feature limit semantics. No table, account, balance, payment or customer grant was changed in Phase 2.

Phase 3 validation should exercise signed-in handoff and popup identity on the actual TopRated backend, account reuse/exhaustion, Humanizer and Detector grants, free opens, both feature limits, WAT reset, expiry and access revocation. Phase 4 wires the website buttons and extension installation. Phase 5 verifies a real authorized account and real Phrasly processing. Fixture success does not replace those checks.

## Deployment and rollback boundary

Keep `PHRASLY_EXTENSION_ENABLED=false` and retain the Phase 1 retired-proxy HTTP 410 rules until the backend exists and staging passes. The original AWS account-management and cookie permissions are retained in the package. The manifest key preserves the AWS ID, so use a disposable browser profile for staging; existing installations with that same ID cannot coexist in one profile.

A later rollout uses the Phase 1 filesystem/process backup and rollback procedure, a separate Node release and the existing per-service routing split. Phase 2 performs no merge to main, production release, proxy change, database migration, account import, service restart or route switch. Sensitive account values belong in protected operational storage during the later implementation, not in this source repository.
