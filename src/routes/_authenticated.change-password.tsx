/**
 * Forced password-change screen. Reached after an Admin-created customer
 * signs in with a temporary password. Sensitive account features remain
 * blocked (by the `_authenticated` layout redirect) until the customer
 * chooses a new password here.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { changeMyPassword, getMustChangePassword } from "@/lib/customer-admin.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [
      { title: "Change your temporary password — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");

  const flag = useQuery({
    queryKey: ["must-change-password"],
    queryFn: () => getMustChangePassword(),
  });

  const mut = useMutation({
    mutationFn: () => changeMyPassword({ data: { newPassword: pw } }),
    onSuccess: async () => {
      // Re-establish the session with the new password so the local access token stays valid.
      const { data: userRes } = await supabase.auth.getUser();
      const email = userRes.user?.email;
      if (email) await supabase.auth.signInWithPassword({ email, password: pw });
      await qc.invalidateQueries({ queryKey: ["must-change-password"] });
      toast.success("Password updated");
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mustChange = flag.data?.mustChange !== false;

  return (
    <section className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <div className="rounded-2xl border bg-card p-6 shadow-card">
        {mustChange && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Your account was created by Admin. Please change your temporary password to continue.
            </p>
          </div>
        )}
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a strong password you don't use elsewhere. Minimum 8 characters.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
            if (pw !== confirm) return toast.error("Passwords do not match.");
            mut.mutate();
          }}
        >
          <div>
            <Label htmlFor="new-pw">New password</Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div>
            <Label htmlFor="new-pw2">Confirm password</Label>
            <Input
              id="new-pw2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={mut.isPending}>
            {mut.isPending ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </section>
  );
}
