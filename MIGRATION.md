# Migration & Environment Variables

Everything below is **host-agnostic**. If you export this project to your own
server (Vercel, Fly.io, Cloudflare, Railway, a VPS, etc.) copy the same
environment variables into that host and the app works unchanged.

## Marketing / conversion tracking

| Variable                    | Where read                              | Required for                             | Notes                                                                                       |
| --------------------------- | --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `META_CAPI_ACCESS_TOKEN`    | server-side, inside CAPI dispatch only  | Meta Conversions API server events       | Generate in Meta Events Manager → Settings → Conversions API → "Generate access token". Standard `process.env`. Never referenced in browser code. |

Meta Pixel ID and GTM container ID are **not** environment variables — they
are entered in **Admin → Marketing** and stored in the database
(`marketing_integrations`), so a non-technical admin can change them without
a redeploy.

## Payments (Paystack)

| Variable                | Where read | Required for                                    |
| ----------------------- | ---------- | ----------------------------------------------- |
| `PAYSTACK_SECRET_KEY`   | server     | Initializing checkouts, verifying transactions  |
| `PAYSTACK_WEBHOOK_SECRET` | server   | Verifying webhook signatures (`sha512` HMAC)    |

## Email (Resend)

| Variable          | Where read | Required for                    |
| ----------------- | ---------- | ------------------------------- |
| `RESEND_API_KEY`  | server     | Sending all transactional email |

## Cron

| Variable       | Where read | Required for                                       |
| -------------- | ---------- | -------------------------------------------------- |
| `CRON_SECRET`  | server     | Authorising the `email-dispatcher` cron endpoint   |

## AI providers (used by the AI Article Generator)

| Variable            | Provider      |
| ------------------- | ------------- |
| `OPENAI_API_KEY`    | OpenAI        |
| `ANTHROPIC_API_KEY` | Anthropic     |
| `GOOGLE_API_KEY`    | Google Gemini |

## Supabase (Lovable Cloud managed)

If you leave Lovable Cloud, replicate these:

| Variable                        | Where used            |
| ------------------------------- | --------------------- |
| `SUPABASE_URL`                  | server                |
| `SUPABASE_PUBLISHABLE_KEY`      | server (public reads) |
| `SUPABASE_SERVICE_ROLE_KEY`     | server (admin ops)    |
| `VITE_SUPABASE_URL`             | browser               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser               |
| `VITE_SUPABASE_PROJECT_ID`      | browser               |

## Consent, attribution, deduplication — how it works

1. **Consent** — the `ConsentBanner` (footer link to re-open) writes a
   `mkt_consent` entry to `localStorage`. Nothing loads Meta or GTM until the
   visitor accepts the "Marketing" category. Server events are additionally
   gated by the `consent_choices` table for signed-in users.
2. **Attribution** — every page load captures UTM / `fbclid` / `gclid` and
   stores them in `localStorage` (`mkt_attr`) plus the database
   (`marketing_attribution`, keyed by `visitor_id`). At sign-in we link the
   `visitor_id` to `user_id`. At checkout we snapshot attribution onto the
   `tool_orders.attribution` column.
3. **Deduplication** — for every purchase / subscription / renewal we build a
   deterministic `event_id` from the order (`kind:orderId` or
   `kind:paystack_reference`). The browser Pixel and the server CAPI use the
   same value, so Meta dedupes automatically. Our own audit table
   `marketing_events` has a unique index on `(platform, event_id) WHERE
   status='sent'` so retries and duplicate webhooks cannot double-count.
4. **Kill switch** — Admin → Marketing has "Pause all marketing tracking",
   backed by `site_settings.marketing_pause`. When on, no server events are
   dispatched even if provider credentials are configured.
