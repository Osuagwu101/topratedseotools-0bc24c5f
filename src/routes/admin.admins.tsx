/**
 * Admin — Super Admin management (Super Admin only).
 *
 * Only the Super Admin may view or use this page. Ordinary admins are
 * redirected back to /admin/dashboard.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, MailPlus, Power, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  getAdminContext,
  listAdmins,
  createAdmin,
  setAdminActive,
  resendAdminInvite,
  removeAdmin,
} from "@/lib/admin-management.functions";

const adminsQuery = queryOptions({
  queryKey: ["admin-admins"],
  queryFn: () => listAdmins(),
});

export const Route = createFileRoute("/admin/admins")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin management — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getAdminContext();
    if (!ctx.isSuperAdmin) throw redirect({ to: "/admin/dashboard" });
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(adminsQuery);
  },
  component: AdminAdminsPage,
});

function AdminAdminsPage() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(adminsQuery);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createAdmin({ data: { email, fullName: fullName || undefined } });
      toast.success("Admin created / invited");
      setEmail("");
      setFullName("");
      await qc.invalidateQueries({ queryKey: ["admin-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create admin");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(userId: string, isActive: boolean) {
    try {
      await setAdminActive({ data: { userId, isActive: !isActive } });
      toast.success(!isActive ? "Admin activated" : "Admin deactivated");
      await qc.invalidateQueries({ queryKey: ["admin-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function resend(email: string | null) {
    if (!email) return toast.error("No email on file");
    try {
      await resendAdminInvite({ data: { email } });
      toast.success("Invitation resent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(userId: string) {
    if (!confirm("Remove this admin? They will lose all admin access.")) return;
    try {
      await removeAdmin({ data: { userId } });
      toast.success("Admin removed");
      await qc.invalidateQueries({ queryKey: ["admin-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin management</h1>
            <p className="text-sm text-muted-foreground">
              Only the Super Admin can create, activate or remove other admins.
            </p>
          </div>
        </div>

        <form onSubmit={onCreate} className="mt-8 rounded-2xl border bg-card p-5 shadow-card">
          <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4" /> Invite a new admin
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="email"
              required
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="text"
              placeholder="Full name (optional)"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {busy ? "Sending…" : "Invite admin"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Use an email that is not registered as a customer. Existing customer accounts cannot be
            reused for Admin access.
          </p>
        </form>

        <div className="mt-8 rounded-2xl border bg-card shadow-card">
          <div className="border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Existing admins
          </div>
          <ul className="divide-y">
            {data.admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {a.fullName || a.email || a.userId}
                    {a.isSuperAdmin && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        Super Admin
                      </span>
                    )}
                    {!a.isActive && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.email ?? "—"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => resend(a.email)}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <MailPlus className="h-3.5 w-3.5" /> Resend invite
                  </button>
                  {!a.isSuperAdmin && (
                    <>
                      <button
                        onClick={() => toggleActive(a.userId, a.isActive)}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => remove(a.userId)}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {data.admins.length === 0 && (
              <li className="p-6 text-sm text-muted-foreground">No admins yet.</li>
            )}
          </ul>
        </div>
      </section>
    </AdminShell>
  );
}
