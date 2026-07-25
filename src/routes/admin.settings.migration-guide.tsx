import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";

export const Route = createFileRoute("/admin/settings/migration-guide")({
  ssr: false,
  head: () => ({ meta: [{ title: "Migration Guide — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("migration.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  component: GuidePage,
});

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="text-sm space-y-2 leading-relaxed">{children}</CardContent>
    </Card>
  );
}

function GuidePage() {
  return (
    <AdminShell>
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Migration Guide</h1>
          <p className="text-sm text-muted-foreground">
            Everything a new owner or hosting provider needs to keep this platform running.
            Secret values are never shown here — only the names of what must be configured.
          </p>
        </div>

        <Section title="1. Required services" description="Third-party accounts the platform depends on.">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Postgres database</strong> (managed cloud database with row-level security).</li>
            <li><strong>Paystack account</strong> — for payments and recurring subscriptions in ₦.</li>
            <li><strong>Resend account</strong> — for transactional email delivery (with a verified sending domain).</li>
            <li><strong>Object storage</strong> — required for blog images and tool images.</li>
            <li><strong>AI provider</strong> — Lovable AI (default) or OpenAI / Google Gemini for the blog AI generator.</li>
            <li><strong>Scheduler / cron</strong> — pg_cron or equivalent, calling the email dispatcher and auto-fulfil endpoints every 5–15 minutes.</li>
          </ul>
        </Section>

        <Section title="2. Required environment variables" description="Set the values in the new host's secrets manager. Values are never shown here.">
          <ul className="list-disc pl-5 space-y-1">
            <li><code>PAYSTACK_SECRET_KEY</code>, <code>PAYSTACK_PUBLIC_KEY</code></li>
            <li><code>RESEND_API_KEY</code></li>
            <li><code>CRON_SECRET</code> — shared secret used by the scheduler when calling public hook routes.</li>
            <li><code>LOVABLE_API_KEY</code> and/or <code>OPENAI_API_KEY</code> / <code>GOOGLE_GEMINI_API_KEY</code></li>
            <li>Database connection variables (<code>SUPABASE_URL</code>, <code>SUPABASE_PUBLISHABLE_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>SUPABASE_DB_URL</code>).</li>
          </ul>
          <p className="text-muted-foreground">
            All secrets are managed through the host's secret store — never committed to the codebase.
          </p>
        </Section>

        <Section title="3. Required API integrations" description="Wire these up in the third-party dashboards.">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Paystack webhook</strong> → <code>/api/public/webhooks/paystack</code>. Use the same secret key
              configured above; the endpoint verifies the SHA-256 signature.
            </li>
            <li>
              <strong>Email dispatcher cron</strong> → <code>POST /api/public/hooks/email-dispatcher</code> every 5 min,
              header <code>Authorization: Bearer $CRON_SECRET</code>.
            </li>
            <li>
              <strong>Private access auto-fulfil cron</strong> → <code>POST /api/public/hooks/auto-fulfil-private</code>
              every 15 min, same bearer.
            </li>
            <li>
              <strong>Resend</strong> — verify the sending domain (SPF, DKIM, DMARC) and paste the "From" address in
              <em> Settings → Email</em>.
            </li>
          </ul>
        </Section>

        <Section title="4. Database requirements">
          <ul className="list-disc pl-5 space-y-1">
            <li>Postgres 14+ with row-level security enabled.</li>
            <li>Extensions used: <code>pg_cron</code>, <code>pgcrypto</code>, <code>uuid-ossp</code>.</li>
            <li>All application tables live in the <code>public</code> schema with explicit <code>GRANT</code>s to <code>authenticated</code> and <code>service_role</code>.</li>
            <li>Do not modify <code>auth</code>, <code>storage</code>, <code>realtime</code>, or <code>vault</code> schemas manually.</li>
            <li>Take a full snapshot before migrating (use <em>Settings → Backup & Recovery</em> plus a database-level dump).</li>
          </ul>
        </Section>

        <Section title="5. Deployment checklist">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Provision the new database and restore the snapshot.</li>
            <li>Set all environment variables listed above in the new host.</li>
            <li>Deploy the application build.</li>
            <li>Re-verify the Resend sending domain (DNS records) on the new host if the domain changed.</li>
            <li>Register the two cron endpoints with the new scheduler using <code>CRON_SECRET</code>.</li>
            <li>Update the Paystack webhook URL to the new domain.</li>
            <li>Sign in as the super admin and visit <em>Settings → Production Readiness</em> — everything should be green.</li>
          </ol>
        </Section>

        <Section title="6. Post-migration testing">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Public site: homepage, tools page, tool detail, pricing page, blog — all render.</li>
            <li>Sign up a test customer, purchase a low-priced tool via Paystack test mode.</li>
            <li>Confirm the payment appears under <em>Admin → Transactions</em> and the tool shows on the customer's dashboard.</li>
            <li>Trigger the email dispatcher cron manually and confirm the payment email is delivered.</li>
            <li>Toggle <em>Emergency → Maintenance Mode</em> on and off; verify the action lands in the activity log.</li>
            <li>Generate a fresh backup from <em>Settings → Backup & Recovery</em>.</li>
            <li>Open <em>Settings → System Health</em> — all probes green.</li>
          </ol>
        </Section>

        <Section title="7. Ongoing operations">
          <ul className="list-disc pl-5 space-y-1">
            <li>Take a backup before every risky change (staff onboarding, price restructures, tool migrations).</li>
            <li>Check <em>Access Health</em> weekly for expiring accounts and shared-pool capacity.</li>
            <li>Rotate <code>CRON_SECRET</code> and Paystack keys yearly, or immediately on staff turnover.</li>
            <li>Only super admins can manage staff roles. Grant the minimum permission per role.</li>
          </ul>
        </Section>
      </section>
    </AdminShell>
  );
}
