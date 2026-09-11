# Moving this app to your own Supabase project

Everything you need is in this folder.

| File | What it is |
| --- | --- |
| `schema.sql` | The complete database setup — all 62 tables, security rules, functions, triggers and seed rows, in the right order. |
| `export-data.sh` | Optional helper that saves the current rows of each table as CSV files, so you can load them into the new project. |
| `README.md` | This step-by-step guide. |

---

## 1. Create the database

In your new Supabase project → **SQL Editor** → paste the whole of `schema.sql` → **Run**.

It is safe to run once on an empty project. If you prefer the CLI:

```bash
supabase link --project-ref <your-new-project-ref>
psql "$YOUR_NEW_DB_URL" -f migrate/schema.sql
```

Extensions used: `pgcrypto`, `uuid-ossp`, and `pg_cron` (only if you want the scheduled jobs in step 5).

## 2. Authentication settings

In the new project → **Authentication**:

- **Providers → Email**: enabled, "Confirm email" ON. Anonymous sign-ins OFF.
- **Providers → Google**: enabled. Create an OAuth client in Google Cloud Console and paste the Client ID + Secret. Authorised redirect URI: `https://<new-project-ref>.supabase.co/auth/v1/callback`.
- **URL Configuration**: Site URL `https://topratedseotools.com`; Redirect URLs should also include `https://www.topratedseotools.com` and any preview/staging domain you use.
- **Email templates**: the app sends its own branded email through Resend, so leave Supabase's default templates alone except for password reset, which should point at `https://topratedseotools.com/reset-password`.

Accounts themselves do not travel with the schema. Existing customers can either be re-invited or moved with Supabase's user migration (Auth Admin API `createUser` with the old password hash). Admin accounts are recognised through the `admin_accounts` / `user_roles` tables, so after creating your own admin login you must insert the matching rows for it.

## 3. Storage

Create two buckets under **Storage**:

| Bucket | Public | Purpose |
| --- | --- | --- |
| `blog-images` | Public | Blog featured images and inline uploads |
| `tool-images` | Public | Tool icons (128×128 WebP) |

`schema.sql` already contains the access policies for both. Copy over existing files by downloading them from the current buckets and re-uploading.

## 4. Environment variables

Set these on whatever host runs the app. Browser values must keep the `VITE_` prefix.

**From your new Supabase project (Settings → API):**

```
SUPABASE_URL=https://<new-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_PROJECT_ID=<new-ref>
SUPABASE_DB_URL=<connection string>
VITE_SUPABASE_URL=https://<new-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon / publishable key>
VITE_SUPABASE_PROJECT_ID=<new-ref>
```

**Everything else the app needs (values you already hold):**

```
PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY
FLUTTERWAVE_SECRET_KEY, FLUTTERWAVE_PUBLIC_KEY, FLUTTERWAVE_ENCRYPTION_KEY, FLUTTERWAVE_WEBHOOK_HASH
MONNIFY_API_KEY, MONNIFY_SECRET_KEY
RESEND_API_KEY
CRON_SECRET
OPENAI_API_KEY and/or GOOGLE_GEMINI_API_KEY
META_CAPI_ACCESS_TOKEN   (only if you use Meta server-side tracking)
```

Payment keys can alternatively be entered in **Admin → Settings → Payments**, which stores them in the `internal_secrets` table instead of the host.

Not portable: `LOVABLE_API_KEY` only works on Lovable's AI gateway. If you leave Lovable, switch the article generator to OpenAI or Gemini in **Admin → Blog → AI Generator**.

## 5. Scheduled jobs and webhooks

Point these at your new domain:

- Paystack webhook → `POST /api/public/webhooks/paystack`
- Flutterwave webhook → `POST /api/public/webhooks/flutterwave`
- Monnify webhook → `POST /api/public/webhooks/monnify`
- Email dispatcher, every 5 min → `POST /api/public/hooks/email-dispatcher` with header `Authorization: Bearer $CRON_SECRET`
- Private-access auto-fulfil, every 15 min → `POST /api/public/hooks/auto-fulfil-private`, same header

## 6. One code change for Google sign-in

Google sign-in currently goes through Lovable's broker. On your own Supabase project, `src/routes/login.tsx` and `src/routes/register.tsx` must call Supabase directly instead:

```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${window.location.origin}/dashboard` },
});
```

Tell me when you're ready and I'll make that swap.

## 7. Check it works

1. Homepage, tools, pricing and blog all load.
2. Register a test customer, confirm the email arrives via Resend.
3. Buy the cheapest tool in Paystack test mode; confirm it appears in **Admin → Transactions** and on the customer dashboard.
4. Sign in as your admin account and open **Admin → Settings → System Health** — all probes green.
