import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { listAwaitingOtpSessions } from "@/lib/browser-auth-otp.functions";
import { adminRefreshAccountAuthentication } from "@/lib/admin-account-auth.functions";
import { adminListAccountsForTool } from "@/lib/account-pool.functions";
import { OtpVerificationModal } from "@/components/admin/OtpVerificationModal";

export function AdminOtpQueue({ toolSlug }: { toolSlug: string }) {
  type QueueSession = {
    id: string;
    tool_slug: string;
    expires_at: string;
    otp_context?: { detected_type?: string } | null;
  };
  const [selected, setSelected] = useState<QueueSession | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const queue = useQuery({
    queryKey: ["awaiting-otp-sessions", toolSlug],
    queryFn: () => listAwaitingOtpSessions({ data: { tool_slug: toolSlug } }),
    refetchInterval: 3000,
  });
  const accountsQuery = useQuery({
    queryKey: ["tool-accounts-auth-refresh", toolSlug],
    queryFn: () => adminListAccountsForTool({ data: { tool_slug: toolSlug } }),
  });
  const sessions = queue.data?.sessions ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  const refreshAccount = async (account: any) => {
    setRefreshing(account.id);
    try {
      const result = await adminRefreshAccountAuthentication({ data: { account_id: account.id } });
      if (result.status === "awaiting_otp") {
        toast.info("Phrasly needs an OTP. Use the verification queue below.");
        await queue.refetch();
      } else {
        toast.success("Authenticated session refreshed. Writers can launch independently now.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not refresh authentication.");
    } finally {
      setRefreshing(null);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4" /> Shared authentication
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Authenticate each account here. Writers only receive isolated browsers copied from this
          saved admin session; they never enter credentials or OTP.
        </p>
        <div className="mt-3 space-y-2">
          {accounts.map((account: any) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {account.label ?? account.login_email ?? "Tool account"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {account.login_email ?? "No login email"}
                </div>
              </div>
              <button
                type="button"
                disabled={refreshing === account.id || !account.enabled}
                onClick={() => refreshAccount(account)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing === account.id ? "animate-spin" : ""}`}
                />
                {refreshing === account.id ? "Authenticating…" : "Authenticate / Refresh session"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {sessions.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" /> Admin OTP verification required
          </div>
          <p className="mt-1 text-sm">
            Complete verification here. Writers do not see this challenge.
          </p>
          <div className="mt-3 space-y-2">
            {(sessions as QueueSession[]).map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelected(session)}
                className="w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
              >
                Enter {(session.otp_context?.detected_type ?? "OTP").toUpperCase()} code
              </button>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <OtpVerificationModal
          open
          adminMode
          sessionId={selected.id}
          otpType={selected.otp_context?.detected_type ?? "unknown"}
          message={`Enter the code received for ${selected.tool_slug}.`}
          expiresAt={selected.expires_at}
          onSuccess={() => {
            setSelected(null);
            queue.refetch();
          }}
          onCancel={() => {
            setSelected(null);
            queue.refetch();
          }}
        />
      )}
    </div>
  );
}
