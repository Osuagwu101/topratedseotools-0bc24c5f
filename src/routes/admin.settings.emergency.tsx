import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { getEmergencyControls, setEmergencyControl } from "@/lib/system-ops.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings/emergency")({
  ssr: false,
  head: () => ({ meta: [{ title: "Emergency Controls — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("emergency.use")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  component: EmergencyPage,
});

type Key = "maintenance_mode" | "orders_paused" | "payments_paused" | "emails_paused";
const CONTROLS: { key: Key; label: string; description: string }[] = [
  { key: "maintenance_mode", label: "Maintenance mode", description: "Blocks new checkouts and shows a maintenance notice to customers." },
  { key: "orders_paused", label: "Pause new orders", description: "Customers can browse tools but cannot start a new order." },
  { key: "payments_paused", label: "Pause payments", description: "Payment initialisation is blocked. Existing sessions may still complete." },
  { key: "emails_paused", label: "Pause outgoing emails", description: "The dispatcher stops sending. Queued emails remain and resume when re-enabled." },
];

function EmergencyPage() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["emergency-controls"], queryFn: () => getEmergencyControls() });
  const [pending, setPending] = useState<{ key: Key; enabled: boolean } | null>(null);

  const toggle = useMutation({
    mutationFn: (v: { key: Key; enabled: boolean }) =>
      setEmergencyControl({ data: { key: v.key, enabled: v.enabled, confirmation: "CONFIRM" } }),
    onSuccess: () => {
      toast.success("Setting updated. Action recorded in the activity log.");
      qc.invalidateQueries({ queryKey: ["emergency-controls"] });
      setPending(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setPending(null);
    },
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Emergency Controls</h1>
          <p className="text-sm text-muted-foreground">
            Use these switches during an incident. Every change is confirmed and appears in
            the admin activity log.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Kill switches</CardTitle>
            <CardDescription>Turn a control on to pause that part of the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {CONTROLS.map((c) => {
                const cur = Boolean((state.data as any)?.[c.key]);
                return (
                  <li key={c.key} className="flex items-start justify-between gap-4 py-4">
                    <div>
                      <div className="font-medium">{c.label}</div>
                      <div className="text-sm text-muted-foreground">{c.description}</div>
                    </div>
                    <Switch
                      checked={cur}
                      disabled={state.isLoading || toggle.isPending}
                      onCheckedChange={(next) => setPending({ key: c.key, enabled: next })}
                    />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </section>

      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.enabled ? "Enable" : "Disable"} {CONTROLS.find((c) => c.key === pending?.key)?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.enabled
                ? "This change affects live customers immediately. Continue?"
                : "The platform will resume normal operation for this area."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && toggle.mutate(pending)}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
