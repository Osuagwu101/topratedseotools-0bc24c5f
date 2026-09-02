import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { listAwaitingOtpSessions } from "@/lib/browser-auth-otp.functions";
import { OtpVerificationModal } from "@/components/admin/OtpVerificationModal";

export function AdminOtpQueue({ toolSlug }: { toolSlug: string }) {
  type QueueSession = {
    id: string;
    tool_slug: string;
    expires_at: string;
    otp_context?: { detected_type?: string } | null;
  };
  const [selected, setSelected] = useState<QueueSession | null>(null);
  const queue = useQuery({
    queryKey: ["awaiting-otp-sessions", toolSlug],
    queryFn: () => listAwaitingOtpSessions({ data: { tool_slug: toolSlug } }),
    refetchInterval: 3000,
  });
  const sessions = queue.data?.sessions ?? [];
  if (!sessions.length) return null;

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" /> OTP verification required
      </div>
      <p className="mt-1 text-sm">A customer is waiting for {toolSlug} verification.</p>
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
    </section>
  );
}
