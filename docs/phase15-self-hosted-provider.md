# Phase 15 — Self Hosted provider integration

## Baseline and gate

- Main application baseline: `ccd8b51a15bf564479ac8a3022f639011dcbb5d0`
- Standalone runtime baseline: `92b37369ab48d456dd1ed43e3108b2c0b639121a`
- Exit gate: Browser Use and Self Hosted coexist without corrupting grants or saved tool state.

## Configuration

The main application reads these values from server environment configuration or the existing write-only `internal_secrets` store:

- `SELF_HOSTED_RUNTIME_BASE_URL` — clean HTTPS origin such as `https://runtime.example.com`.
- `SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET` — the same minimum-32-character HMAC secret configured as `RUNTIME_SERVICE_AUTH_SECRET` in the standalone runtime.

The signing secret must never be exposed to browser code, writers, logs, or repository files.

## Coexistence and rollback

- `browser_use` remains the database and application fallback default.
- Existing Browser Use and Cloudflare launch functions are not modified by the Self Hosted adapter.
- Self Hosted launches use the standalone runtime's persistent browser identity. They do not read, overwrite, expire, or invalidate `tool_account_sessions` rows in the main application.
- Existing paid-order and complimentary-grant authorization checks run before any provider launch.
- Changing the global or per-tool provider back to `browser_use` is sufficient rollback; no code repair or database surgery is required.
- Main-app OTP/session capture is deliberately rejected when Self Hosted is selected because its administrator authentication state belongs to the standalone runtime.

## Runtime request contract

The server-only adapter signs each request with HMAC-SHA256 over method, path, timestamp, nonce, writer identity, and the SHA-256 hash of the exact transmitted body. It sends only writer ID and tool slug. It returns only the runtime-issued viewer URL and lifecycle identifiers.

## Deployment order

1. Apply the Phase 15 database migration.
2. Configure and validate the two Self Hosted settings in Admin → One-Click Browser Login.
3. Leave Browser Use as the default during validation.
4. Select Self Hosted only for the intended test tool.
5. Run owner acceptance after the main website hosting is renewed.
