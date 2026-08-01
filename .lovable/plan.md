# Flutterwave Browser Verification and Runtime Fix

Verify the exact preview Admin workflow using the supplied credentials without storing or reproducing them. Treat browser/network evidence as authoritative, fix the runtime path only if the live action still reaches stale validation, then validate activation and customer checkout.

## 1. Actual Admin button verification

- Sign in through the preview as the supplied Admin account.
- Open Admin → Settings → Payment Providers and capture the Flutterwave card’s initial status.
- Click the real **Test** control while recording the browser request, response, console output, toast, and persisted card status.
- Confirm the UI reports exactly `Connection successful — merchant account reachable` and no request reaches `/v3/subaccounts`.

## 2. Runtime diagnosis and targeted fix if it still fails

The current source trace is:

```text
Payment Providers Test button
  → runTest
  → adminTestProviderConnection
  → loadGatewaySecrets(admin, true)
  → dynamic import provider-validation.server
  → GET /v3/transactions?page=1
```

If browser evidence still returns `Subaccounts not found`:

- Identify the exact served server-function bundle/request and compare it with the current source path.
- Search every reachable provider-validation implementation for `/subaccounts` and remove the stale reachable branch, without changing unrelated gateway behavior.
- Ensure all provider actions—Test, Save & validate, Enable, and Make active—use the same merchant-only validator.
- Re-run the actual Admin button after the change; automated tests alone will not count as completion.

## 3. Credential and webhook alignment

- Verify by credential names/status only that secure storage supplies Flutterwave public key, secret key, encryption key, and webhook hash; never display or log their values.
- Confirm the Admin card exposes `https://topratedseotools.com/api/public/webhooks/flutterwave`.
- Verify the endpoint force-refreshes secure credentials and compares the stored webhook hash with the `verif-hash` header.
- Exercise valid and invalid signature cases safely; confirm invalid signatures return 401 and valid, structurally safe test events are accepted without creating a false paid order.

## 4. Activate Flutterwave in the Admin UI

- Enable Flutterwave through the actual edit/save workflow after its test passes.
- Click **Make active** and verify the visible card state becomes enabled and active, with the successful last-test status persisted after refresh.
- Capture browser evidence of the final provider status.

## 5. Customer checkout browser verification

- Sign out cleanly, then sign in through the preview using the supplied customer account.
- Select an inexpensive eligible test tool, choose a one-time option where required, switch display/payment currency to GHS, and initialize checkout.
- Verify the customer is redirected to a genuine Flutterwave-hosted checkout URL and that Ghana Mobile Money is offered.
- Capture the order reference and return/callback behavior without exposing credentials or sensitive payment data.

## 6. Real transaction boundary

- Do not invent card/mobile-money details, bypass provider authorization, or claim success without a completed provider transaction.
- If the checkout can be completed with already available authorized payment context, use the smallest legitimate amount and verify the full chain.
- Otherwise stop at the hosted Flutterwave payment authorization screen and mark completion as requiring the user’s payment authorization.
- After a genuine success, verify database/runtime evidence for one accepted webhook, duplicate-safe replay, approved order, immediate eligible access assignment, updated customer dashboard, Resend confirmation delivery, and an Admin transaction showing Flutterwave with correct GHS amount/currency.

## 7. Regression checks and final report

- Run focused provider-validation, Flutterwave gateway, currency, checkout, webhook/idempotency, access-assignment, and email tests after any code change.
- Report separately:
  1. **Browser verified** — exact Admin Test result, activation state, checkout redirect, and Ghana Mobile Money visibility.
  2. **Automated verified** — webhook security, idempotency, order/access, currency, and email logic.
  3. **Real transaction verified** — only facts backed by an actual completed Flutterwave payment.
- Include the exact root cause and file/function changed only if runtime browser evidence requires a code fix; otherwise state that the issue was stale preview/deployment state and show the refreshed UI proof.