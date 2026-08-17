/**
 * Admin sign-in page at /admin — separate from the public /login page.
 */
import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getIsAdmin } from "@/lib/site-settings.functions";
import { APP_NAME } from "@/lib/site-config";
import { BrandLogo } from "@/components/brand/BrandLogo";

export const Route = createFileRoute("/admin/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin sign in — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    try {
      const { isAdmin } = await getIsAdmin();
      if (isAdmin) throw redirect({ to: "/admin/dashboard" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in (e as Record<string, unknown>)) throw e;
    }
  },
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    try {
      const { isAdmin } = await getIsAdmin();
      if (!isAdmin) {
        await supabase.auth.signOut();
        setLoading(false);
        return toast.error("This account is not an administrator.");
      }
      toast.success("Welcome, admin.");
      navigate({ to: "/admin/dashboard" });
    } catch {
      await supabase.auth.signOut();
      setLoading(false);
      toast.error("Could not verify admin access. Try again.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 self-center font-semibold">
          <BrandLogo size={40} className="h-10 w-10 rounded-lg shadow-glow" />
          <span>{APP_NAME}</span>
        </Link>

        <div className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Admin sign in</h1>
              <p className="text-sm text-muted-foreground">Restricted area — admins only.</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Admin email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in to admin"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Not an admin?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Go to user sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
