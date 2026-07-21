/**
 * Admin action — create a new customer account (or open an existing one).
 * Never creates admin roles. Uses adminCreateCustomer which sends an
 * invitation via Supabase Auth for password setup.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { adminCreateCustomer } from "@/lib/customer-admin.functions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserPlus } from "lucide-react";

export function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const navigate = useNavigate();

  const mut = useMutation({
    mutationFn: () =>
      adminCreateCustomer({
        data: {
          email: email.trim(),
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      if (r.existed) {
        toast.info("Customer already exists — opening record.");
      } else {
        toast.success("Customer created — invitation email sent.");
      }
      setOpen(false);
      setEmail(""); setFullName(""); setPhone(""); setNotes("");
      navigate({ to: "/admin/customers/$userId", params: { userId: r.userId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Add customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="cus-name">Full name</Label>
            <Input id="cus-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cus-email">Email</Label>
            <Input id="cus-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">A secure invitation link will be emailed for password setup.</p>
          </div>
          <div>
            <Label htmlFor="cus-phone">Phone (optional)</Label>
            <Input id="cus-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cus-notes">Admin notes (optional)</Label>
            <Textarea id="cus-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Creating…" : "Create customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
