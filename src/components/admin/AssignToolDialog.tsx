/**
 * Admin action — assign a tool to a customer, recording the sale as a
 * successful OFFLINE one-time payment. Never creates a Paystack subscription
 * and never mutates the tool's public price. If a similar offline payment
 * already exists for the same customer + tool + amount + date/reference,
 * the server returns a duplicate warning that the admin must confirm.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminAssignTool } from "@/lib/customer-admin.functions";
import { useCatalogRegistration } from "@/hooks/use-catalog-registration";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, AlertTriangle } from "lucide-react";

export function AssignToolDialog({
  userId,
  onDone,
}: {
  userId: string;
  onDone?: () => void;
}) {
  const catalog = useCatalogRegistration();
  const [open, setOpen] = useState(false);
  const [toolSlug, setToolSlug] = useState(catalog[0]?.slug ?? "");
  const [accessType, setAccessType] = useState<"shared" | "private">("shared");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [paymentDate, setPaymentDate] = useState(today);
  const [amount, setAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"bank_transfer" | "cash" | "whatsapp" | "other">("bank_transfer");
  const [referenceNote, setReferenceNote] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [duplicates, setDuplicates] = useState<
    { id: string; amount: number | null; paid_at: string | null; reference_note: string | null }[]
  >([]);

  const mut = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      adminAssignTool({
        data: {
          userId,
          toolSlug,
          accessType,
          billingPeriod,
          startDate,
          paymentDate,
          amount: Number(amount),
          paymentMethod,
          referenceNote: referenceNote || undefined,
          adminNote: adminNote || undefined,
          confirmDuplicate,
        },
      }),
    onSuccess: (r) => {
      if ("duplicate" in r && r.duplicate) {
        setDuplicates(r.duplicates);
        return;
      }
      toast.success("Tool assigned and offline payment recorded.");
      setOpen(false); setDuplicates([]);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent, confirmDuplicate = false) {
    e.preventDefault();
    if (!toolSlug) return toast.error("Pick a tool");
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) return toast.error("Enter a valid amount");
    mut.mutate(confirmDuplicate);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDuplicates([]); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Assign tool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign tool & record offline payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => submit(e, false)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Tool</Label>
              <select
                value={toolSlug}
                onChange={(e) => setToolSlug(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {catalog.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Access type</Label>
              <select
                value={accessType}
                onChange={(e) => setAccessType(e.target.value as "shared" | "private")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="shared">Shared</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <Label>Billing period</Label>
              <select
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value as "monthly" | "quarterly" | "yearly")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly (28 days)</option>
                <option value="quarterly">Quarterly (90 days)</option>
                <option value="yearly">Yearly (365 days)</option>
              </select>
            </div>
            <div>
              <Label>Subscription start</Label>
              <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Amount paid (₦)</Label>
              <Input
                type="number" min="0" step="0.01" required
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Does not change the public price.</p>
            </div>
            <div>
              <Label>Payment date</Label>
              <Input type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <Label>Payment method</Label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="whatsapp">WhatsApp sale</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="col-span-2">
              <Label>Payment reference (optional)</Label>
              <Input value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="e.g. bank txn ID" />
            </div>
            <div className="col-span-2">
              <Label>Admin note (optional)</Label>
              <Textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
            </div>
          </div>

          {duplicates.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Similar offline payment already recorded
              </div>
              <ul className="mt-1.5 list-disc pl-4 text-muted-foreground">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    ₦{Number(d.amount ?? 0).toLocaleString()} on{" "}
                    {d.paid_at ? new Date(d.paid_at).toLocaleDateString() : "—"}
                    {d.reference_note ? ` · ${d.reference_note}` : ""}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setDuplicates([])}>
                  Review
                </Button>
                <Button
                  type="button" size="sm"
                  onClick={(e) => submit(e as unknown as React.FormEvent, true)}
                  disabled={mut.isPending}
                >
                  Save anyway
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending || duplicates.length > 0}>
              {mut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
