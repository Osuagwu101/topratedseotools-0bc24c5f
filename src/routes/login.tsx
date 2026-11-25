import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

import { APP_NAME } from "@/lib/site-config";
import { useHydrated } from "@/hooks/use-hydrated";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { emailConfirmationRedirect, isEmailNotConfirmed, turnitinAuthDestination } from "@/lib/email-confirmation";

const searchSchema = z.object({
  redirect: z.string().optional(),
  confirmation: z.enum(["check", "expired", "error"]).optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Sign in — Top Rated SEO Tools" },
      { name: "description", content: "Sign in to your Top Rated SEO Tools account." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const hydrated = useHydrated();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountBanned, setAccountBanned] = useState(false);
  const [confirmation, setConfirmation] = useState<string | undefined>(search.confirmation);
  const [resending, setResending] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const dest = search.redirect ?? "/dashboard";
  const turnitinDestination = turnitinAuthDestination(search.redirect);

  useEffect(() => {
    if (search.confirmation !== "check") return;
    let active = true;
    async function checkConfirmation() {
      try {
        // Wait for implicit-flow processing, then verify the user with Auth.
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          if (active) setConfirmation("error");
          return;
        }
        const { data: verified, error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (!userError && verified.user?.email_confirmed_at) {
          if (turnitinDestination) {
            void navigate({ to: turnitinDestination, replace: true });
          } else {
            setConfirmation("confirmed");
          }
        } else {
          setConfirmation("error");
        }
      } catch {
        if (active) setConfirmation("error");
      }
    }
    void checkConfirmation();
    return () => { active = false; };
  }, [navigate, search.confirmation, turnitinDestination]);

  useEffect(() => {
    if (!resendAfter) return;
    const tick = () => setCooldown(Math.max(0, Math.ceil((resendAfter - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [resendAfter]);

  async function resendConfirmation() {
    if (resending || Date.now() < resendAfter) return;
    const parsed = z.string().email().safeParse(email.trim());
    if (!parsed.success) return toast.error("Enter your email address in the Email field first.");
    setResending(true);
    setConfirmationSent(false);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: parsed.data,
        options: { emailRedirectTo: emailConfirmationRedirect(window.location.origin, turnitinDestination) },
      });
      if (error) {
        if (error.status === 429) setResendAfter(Date.now() + 60_000);
        return toast.error(error.status === 429 ? "Please wait a minute before requesting another confirmation email." : error.message);
      }
      setResendAfter(Date.now() + 60_000);
      setConfirmationSent(true);
    } catch {
      toast.error("Could not request a confirmation email. Please try again.");
    } finally {
      setResending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hydrated || loading) return;
    setAccountBanned(false);
    setLoading(true);
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      if (isEmailNotConfirmed(error)) {
        setConfirmation("unconfirmed");
        setConfirmationSent(false);
        return;
      }
      if (/\bbanned\b/i.test(error.message)) {
        setAccountBanned(true);
        return;
      }
      return toast.error(error.message);
    }

    const userId = signInData.user?.id;
    if (!userId) return toast.error("Sign-in was incomplete. Please try again.");
    if (userId) {
      const { data: accountState } = await (supabase as any)
        .from("profiles")
        .select("account_status")
        .eq("id", userId)
        .maybeSingle();
      if (accountState?.account_status === "suspended") {
        await supabase.auth.signOut();
        setAccountBanned(true);
        return;
      }
    }

    // Read the signed-in user's role through the same authenticated Supabase client.
    // The server-only getIsAdmin() middleware expects an Authorization header that
    // this page's server-function transport does not supply after password sign-in.
    const { data: adminRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) {
      return toast.error("Could not verify your account. Please try again.");
    }
    if (adminRole) {
      await supabase.auth.signOut();
      return toast.error("Admin accounts must sign in from the Admin login page.");
    }
    toast.success("Welcome back!");
    navigate({ to: dest });
  }

  async function onGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${turnitinDestination ?? ""}` },
    });
    if (error) toast.error(error.message ?? "Google sign-in failed");
  }

  return (
    <AuthShell
      topNotice={accountBanned ? "Account Banned for using multiple devices" : undefined}
      title="Welcome back"
      subtitle="Sign in to manage your subscriptions, payments, and tool access."
      footer={<>Don't have an account?{" "}<Link to="/register" search={{ redirect: turnitinDestination }} className="font-medium text-primary hover:underline">Create one</Link></>}
    >
      {confirmation && (
        <div role="status" aria-live="polite" className="mb-4 rounded-md border border-input bg-muted p-4 text-sm">
          {confirmation === "check" ? <p>Checking your email confirmation…</p>
            : confirmation === "confirmed" ? <p>Your email is confirmed. You can now sign in.</p>
            : <>
              <p>{confirmation === "expired"
                ? "This email confirmation link has expired or has already been used. Your email may still need confirmation."
                : confirmation === "unconfirmed"
                  ? "Your email is not confirmed yet. Request a new confirmation email below."
                  : "This sign-in or confirmation link could not be verified. Try signing in, or request a new confirmation email below."}</p>
              <p className="mt-2">Enter your email address below, then request a new link. Open the newest email and check your spam folder too.</p>
              <button type="button" onClick={resendConfirmation} disabled={!hydrated || resending || cooldown > 0} className="mt-3 font-medium text-primary underline disabled:opacity-60">
                {resending ? "Sending…" : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend confirmation email"}
              </button>
              {confirmationSent && <p className="mt-2">If this address has an account awaiting confirmation, a new email is on its way. Use the newest link.</p>}
            </>}
        </div>
      )}
      <button type="button" onClick={onGoogle} disabled={!hydrated} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
        <GoogleIcon /> Continue with Google
      </button>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" /> or continue with email <div className="h-px flex-1 bg-border" /></div>
      <form onSubmit={onSubmit} className="space-y-3">
        <FieldEmail value={email} onChange={setEmail} />
        <FieldPassword value={password} onChange={setPassword} />
        <div className="flex justify-end text-sm">
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">Forgot password?</Link>
        </div>
        <button type="submit" disabled={loading || !hydrated} aria-busy={loading || !hydrated} className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-60">
          {!hydrated ? "Loading..." : loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children, footer, topNotice }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; topNotice?: string }) {
  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        {topNotice && (
          <div
            role="alert"
            className="mb-4 text-center text-base font-extrabold text-red-700 dark:text-red-500"
          >
            {topNotice}
          </div>
        )}
        <Link to="/" className="mb-8 inline-flex items-center gap-2 self-center font-semibold">
          <BrandLogo size={40} className="h-10 w-10 rounded-lg shadow-glow" />
          <span>{APP_NAME}</span>
        </Link>
        <div className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
      </div>
    </div>
  );
}

export function FieldEmail({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div><label className="mb-1 block text-sm font-medium">Email</label><input type="email" required autoComplete="email" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></div>;
}

export function FieldPassword({ value, onChange, label = "Password", autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; label?: string; autoComplete?: string }) {
  return <div><label className="mb-1 block text-sm font-medium">{label}</label><input type="password" required minLength={8} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></div>;
}

export function GoogleIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12S6.8 21.5 12 21.5c6.9 0 9.5-4.8 9.5-7.3 0-.5-.06-.9-.13-1.3H12z" /></svg>;
}
