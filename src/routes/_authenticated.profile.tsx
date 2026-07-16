import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile settings — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      return data;
    },
  });

  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setAvatarUrl(profile?.avatar_url ?? "");
  }, [profile]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, avatar_url: avatarUrl })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  }

  const [newPass, setNewPass] = useState("");
  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPass.length < 8) return toast.error("Password must be at least 8 characters");
    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) return toast.error(error.message);
    toast.success("Password changed");
    setNewPass("");
  }

  const [newEmail, setNewEmail] = useState("");
  async function updateEmail(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) return toast.error(error.message);
    toast.success("Check your inbox to confirm the new email.");
    setNewEmail("");
  }

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight">Profile settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account details and preferences.</p>

        <Card title="Profile">
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Full name" value={fullName} onChange={setFullName} />
            <Field label="Avatar URL" value={avatarUrl} onChange={setAvatarUrl} placeholder="https://..." />
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </form>
        </Card>

        <Card title="Change email">
          <form onSubmit={updateEmail} className="space-y-4">
            <p className="text-xs text-muted-foreground">Current: {user.email}</p>
            <Field label="New email" type="email" value={newEmail} onChange={setNewEmail} required />
            <button className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted">
              Send confirmation
            </button>
          </form>
        </Card>

        <Card title="Change password">
          <form onSubmit={updatePassword} className="space-y-4">
            <Field
              label="New password"
              type="password"
              value={newPass}
              onChange={setNewPass}
              autoComplete="new-password"
              required
            />
            <button className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted">
              Update password
            </button>
          </form>
        </Card>

        <Card title="Notification preferences">
          <div className="space-y-3 text-sm">
            {[
              { k: "product", label: "Product updates & announcements" },
              { k: "billing", label: "Billing & subscription notices" },
              { k: "tips", label: "Tips and best practices" },
            ].map((p) => (
              <label key={p.k} className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-input" />
                {p.label}
              </label>
            ))}
          </div>
        </Card>
      </div>
    </SiteLayout>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}
