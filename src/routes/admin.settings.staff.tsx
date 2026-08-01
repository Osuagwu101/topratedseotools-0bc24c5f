import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  getMyAdminContext,
  listStaff,
  createStaff,
  resendInvitation,
  revokeInvitation,
  updateStaffRole,
  setStaffPermission,
  resetStaffToRoleDefaults,
  setStaffActive,
  requirePasswordReset,
  endStaffSessions,
} from "@/lib/admin-permissions.functions";
import {
  ROLE_KEYS,
  ROLE_LABEL,
  PERMISSION_GROUPS,
  ROLE_DEFAULTS,
  type RoleKey,
  type Permission,
} from "@/lib/admin-permissions";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { UserPlus, MailPlus, Power, KeyRound, LogOut, X } from "lucide-react";

const staffQuery = queryOptions({
  queryKey: ["admin-staff"],
  queryFn: () => listStaff(),
});
export const ctxQuery = queryOptions({
  queryKey: ["admin-my-context"],
  queryFn: () => getMyAdminContext(),
});

export const Route = createFileRoute("/admin/settings/staff")({
  ssr: false,
  head: () => ({ meta: [{ title: "Staff, Roles & Permissions — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin) throw redirect({ to: "/admin/dashboard" });
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(staffQuery),
      context.queryClient.ensureQueryData(ctxQuery),
    ]);
  },
  component: StaffPage,
});

function StaffPage() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(staffQuery);
  const { data: myCtx } = useSuspenseQuery(ctxQuery);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin-staff"] });
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Staff, Roles & Permissions</h1>
            <p className="text-sm text-muted-foreground">Super Admin only. Invite admins, assign roles, tune permissions.</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-glow"
          >
            <UserPlus className="h-4 w-4" /> Add Admin
          </button>
        </div>

        <div className="rounded-2xl border bg-card shadow-card">
          <ul className="divide-y">
            {data.admins.map((a: Admin) => (
              <StaffRow
                key={a.userId}
                a={a}
                canEndSessions={myCtx.capabilities.canEndSessions}
                onEdit={() => setEditing(a.userId)}
                onRefresh={refresh}
              />
            ))}
            {data.admins.length === 0 && <li className="p-6 text-sm text-muted-foreground">No admins yet.</li>}
          </ul>
        </div>

        {showAdd && <AddAdminDialog onClose={() => setShowAdd(false)} onDone={refresh} />}
        {editing && (
          <PermissionsDrawer
            admin={data.admins.find((a: Admin) => a.userId === editing)!}
            onClose={() => setEditing(null)}
            onRefresh={refresh}
          />
        )}
      </section>
    </AdminShell>
  );
}

type Admin = Awaited<ReturnType<typeof listStaff>>["admins"][number];

function StaffRow({
  a, canEndSessions, onEdit, onRefresh,
}: { a: Admin; canEndSessions: boolean; onEdit: () => void; onRefresh: () => Promise<void> }) {
  const [confirm, setConfirm] = useState<null | {
    title: string; description: string; destructive?: boolean; run: () => Promise<void>;
  }>(null);

  const roleLabel = a.isSuperAdmin
    ? "Super Admin"
    : a.roleKey
      ? ROLE_LABEL[a.roleKey as RoleKey]
      : "No role";
  const invStatus = a.invitation?.status ?? (a.lastSignInAt ? "accepted" : "unknown");

  return (
    <li className="flex flex-wrap items-center gap-3 p-4 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {a.fullName || a.email}
          {a.isSuperAdmin && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
              Super Admin
            </span>
          )}
          {!a.isActive && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Disabled
            </span>
          )}
          {a.mustChangePassword && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
              Password reset required
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {a.email} · {roleLabel} · Invitation: {invStatus}
          {a.lastSignInAt && ` · Last sign-in: ${new Date(a.lastSignInAt).toLocaleString()}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!a.isSuperAdmin && (
          <button onClick={onEdit} className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">Edit permissions</button>
        )}
        <button
          onClick={() =>
            setConfirm({
              title: "Resend invitation",
              description: `Send a new invitation email to ${a.email}?`,
              run: async () => {
                await resendInvitation({ data: { userId: a.userId } });
                toast.success("Invitation resent");
                await onRefresh();
              },
            })
          }
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
        >
          <MailPlus className="h-3.5 w-3.5" /> Resend
        </button>
        {a.invitation?.status === "pending" && (
          <button
            onClick={() =>
              setConfirm({
                title: "Revoke invitation",
                description: `Revoke the pending invitation for ${a.email}?`,
                destructive: true,
                run: async () => {
                  await revokeInvitation({ data: { userId: a.userId } });
                  toast.success("Invitation revoked");
                  await onRefresh();
                },
              })
            }
            className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            Revoke
          </button>
        )}
        {!a.isSuperAdmin && (
          <button
            onClick={() =>
              setConfirm({
                title: a.isActive ? "Disable admin" : "Restore admin",
                description: `${a.isActive ? "Disable" : "Restore"} ${a.email}? ${a.isActive ? "They lose all admin access immediately." : "They regain admin access on next sign-in."}`,
                destructive: a.isActive,
                run: async () => {
                  await setStaffActive({ data: { userId: a.userId, isActive: !a.isActive } });
                  toast.success(a.isActive ? "Admin disabled" : "Admin restored");
                  await onRefresh();
                },
              })
            }
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
          >
            <Power className="h-3.5 w-3.5" /> {a.isActive ? "Disable" : "Restore"}
          </button>
        )}
        <button
          onClick={() =>
            setConfirm({
              title: "Require password reset",
              description: `Force ${a.email} to reset their password on next sign-in?`,
              run: async () => {
                await requirePasswordReset({ data: { userId: a.userId } });
                toast.success("Password reset required");
                await onRefresh();
              },
            })
          }
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
        >
          <KeyRound className="h-3.5 w-3.5" /> Reset password
        </button>
        {canEndSessions && !a.isSuperAdmin && (
          <button
            onClick={() =>
              setConfirm({
                title: "End sessions",
                description: `Sign ${a.email} out of every active session?`,
                destructive: true,
                run: async () => {
                  await endStaffSessions({ data: { userId: a.userId } });
                  toast.success("Sessions ended");
                  await onRefresh();
                },
              })
            }
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" /> End sessions
          </button>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          description={confirm.description}
          destructive={confirm.destructive}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try { await confirm.run(); }
            catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
          }}
        />
      )}
    </li>
  );
}

function AddAdminDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>("operations");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await createStaff({ data: { email, fullName: fullName || undefined, roleKey } });
      toast.success(res.invited ? "Invitation sent" : "Admin updated (no duplicate email sent)");
      onClose();
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add Admin</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3">
          <input
            type="email" required placeholder="admin@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            type="text" placeholder="Full name (optional)" value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value as RoleKey)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>{ROLE_LABEL[k]}</option>
            ))}
          </select>
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            Default permissions: {ROLE_DEFAULTS[roleKey].join(", ") || "none"}
          </div>
          <p className="text-xs text-muted-foreground">
            One invitation email will be sent. Cannot reuse a customer email.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-md bg-gradient-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-60">
            {busy ? "Sending…" : "Send Invitation"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PermissionsDrawer({
  admin, onClose, onRefresh,
}: { admin: Admin; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [pending, setPending] = useState<Record<string, boolean | null>>({});
  const [busy, setBusy] = useState(false);
  const [roleKey, setRoleKey] = useState<RoleKey>(admin.roleKey ?? "operations");

  const effective = (perm: Permission): boolean => {
    if (perm in pending) {
      const v = pending[perm];
      if (v === null) return ROLE_DEFAULTS[roleKey].includes(perm);
      return !!v;
    }
    return admin.permissions.includes(perm);
  };

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      if (roleKey !== admin.roleKey) {
        await updateStaffRole({ data: { userId: admin.userId, roleKey } });
      }
      for (const [perm, granted] of Object.entries(pending)) {
        await setStaffPermission({
          data: { userId: admin.userId, permission: perm as any, granted: granted },
        });
      }
      toast.success("Permissions updated");
      onClose();
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (busy) return;
    setBusy(true);
    try {
      await resetStaffToRoleDefaults({ data: { userId: admin.userId } });
      toast.success("Reset to role defaults");
      onClose();
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function toggle(perm: Permission) {
    const cur = effective(perm);
    setPending((p) => ({ ...p, [perm]: !cur }));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Permissions — {admin.email}</h2>
            <p className="text-xs text-muted-foreground">Role defaults apply unless overridden per permission.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">Role</label>
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value as RoleKey)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>{ROLE_LABEL[k]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.key} className={`rounded-md border p-3 ${g.sensitive ? "border-destructive/30 bg-destructive/5" : ""}`}>
              <div className="mb-2 text-sm font-semibold">
                {g.label}
                {g.sensitive && <span className="ml-2 text-[10px] uppercase text-destructive">Sensitive</span>}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={effective(item.id)} onChange={() => toggle(item.id)} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetAll} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60">
            Reset to role defaults
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-md bg-gradient-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-glow disabled:opacity-60">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
