
# Multi-Currency & International Payment Surcharge

Add customer-facing currency switching (NGN, GHS, KES, ZAR, USD) with a transparent 3% international surcharge on non-NGN payments, without disturbing existing NGN customers or Paystack webhook security.

## 1. Database (single migration)

New table `currency_settings` (singleton row):
- `switching_enabled boolean` (default true)
- `surcharge_enabled boolean` (default true)
- `surcharge_percent numeric` (default 3.00)
- `supported_currencies text[]` (default `{NGN,GHS,KES,ZAR,USD}`)
- timestamps

New table `exchange_rates`:
- `base_currency` (always `NGN`), `quote_currency`, `rate numeric`, `source text`, `fetched_at`, `expires_at`
- unique on (`base_currency`,`quote_currency`)

New table `exchange_rate_logs` (append-only) for admin visibility: currency, rate, source, fetched_at.

Add columns to `tool_payments`:
- `base_amount_ngn`, `payment_currency`, `exchange_rate`, `converted_amount`,
  `international_fee_percent`, `international_fee_amount`, `final_amount`

Add columns to `tool_orders`:
- `payment_currency` (default `NGN`), `exchange_rate_snapshot`, `international_fee_amount`, `final_amount_charged`

Add columns to `user_subscriptions` / `paystack_plan_mappings`:
- `subscription_currency` (default `NGN`), `renewal_currency`

Grants + RLS: admin-only for `currency_settings`, `exchange_rates`, `exchange_rate_logs`. New columns inherit table policies.

## 2. Exchange rates

- Server function `refreshExchangeRates` (admin-only) — fetches NGN→{GHS,KES,ZAR,USD} from a free provider (exchangerate.host, no key) and upserts into `exchange_rates`, appending an audit row to `exchange_rate_logs`.
- Public server function `getPublicCurrencyConfig` — returns `{ enabled, surcharge_percent, currencies: [{code, rate, fetched_at}] }` from `exchange_rates` (never calls external API on the hot path).
- Cron entry documented in the migration guide; caches are read from DB.

## 3. Pricing conversion helpers (`src/lib/currency-convert.ts`)

Pure functions:
- `convertFromNgn(ngn, rate)` → converted amount, rounded per-currency (USD: 2dp; GHS/KES/ZAR: 2dp; NGN: 0dp).
- `applySurcharge(amount, pct)` → `{ fee, total }`; skipped for NGN.
- `buildPricingBreakdown(ngn, currency, rate, surchargePct)` returning base/converted/fee/total for display and checkout.

## 4. Client currency context

- `src/components/currency/CurrencyProvider.tsx` — React context holding selected currency in `sessionStorage` (`ts_currency`), default `NGN`, hydrated from `getPublicCurrencyConfig` on mount.
- `src/components/currency/CurrencySwitcher.tsx` — compact dropdown; hidden when `switching_enabled=false` or only NGN available.
- Mount switcher in Navbar (desktop + mobile) and above the pricing cards on `/pricing` and `/tools/$slug`.

## 5. Display

Pricing cards / order page show:
- Original: `₦X,XXX`
- When non-NGN: converted amount, `1 NGN = x CUR`, rate updated `<relative time>`, and a breakdown row before the CTA — Base / Intl fee (3%) / Total payable.
- All existing NGN copy unchanged.

## 6. Checkout (`src/lib/paystack-checkout.ts`)

- Accept `payment_currency` from client; server re-validates against `currency_settings.supported_currencies`.
- Server re-fetches rate from `exchange_rates` (ignores client-sent rate) and recomputes converted + surcharge; if the rate is missing/stale (>24h) fall back to NGN with a clear error.
- Initialize Paystack with `currency` = selected code and `amount` = final amount in that currency's minor units.
- Persist `payment_currency`, `exchange_rate`, `converted_amount`, `international_fee_*`, `final_amount`, `base_amount_ngn` on `tool_orders` + `tool_payments`.

## 7. Subscriptions / recurring

- On plan creation via `paystack-plans.ts`, tag the mapping row with `currency` used and store `subscription_currency` on the order.
- Webhook (`paystack-webhook.ts`) untouched security-wise; it now also writes `payment_currency`/`final_amount`/`base_amount_ngn` from the transaction payload into `tool_payments`. Renewals reuse the stored subscription currency (Paystack drives this automatically once the plan is created in that currency).
- Existing NGN subscriptions: no changes, no re-charge, no schema break (all new columns nullable with NGN defaults).

## 8. Admin UI (`admin.settings.payments` new tab "Currency")

- Toggle: enable currency switching.
- Toggle + numeric input: enable surcharge, percent (default 3).
- Table: supported currencies with current rate, source, fetched_at, expires_at; "Refresh rates now" button.
- Read-only table: recent `exchange_rate_logs`.
- Link to Admin → Transactions filtered by non-NGN for international payment audits.
- Existing Admin Transactions table gains columns: Currency, Final Amount, Intl Fee.

## 9. Tests (`tests/currency-*.test.ts`)

- `currency-convert.test.ts` — rounding, surcharge math, NGN skip.
- `paystack-checkout-currency.test.ts` — supported/unsupported currency, stale rate fallback, correct final amount + currency sent to Paystack, DB fields written.
- `paystack-webhook-currency.test.ts` — webhook stores currency fields without changing signature/idempotency behaviour.
- Regression: existing 313+ tests remain green.

## Guarantees

- Default remains NGN; no change for existing customers.
- Paystack webhook signature verification and idempotency logic unchanged.
- Confirmation email templates unchanged; new merge vars (`payment_currency`, `final_amount`) added only where safe.
- Access assignment logic (`assign_tool_account_for_order`) untouched.

## Technical notes

- Rate source: `https://api.exchangerate.host/latest?base=NGN&symbols=GHS,KES,ZAR,USD` (no key, permissive). Swappable via `EXCHANGE_RATE_URL` env.
- Minor-unit conversion: NGN/GHS/KES/ZAR/USD all use ×100 for Paystack.
- Session persistence via `sessionStorage`; SSR reads default `NGN` to avoid hydration mismatch, then swaps client-side.
