/**
 * Admin action — create a customer account with a temporary password.
 * The account is ready for login immediately (no invitation, no email
 * confirmation). On first sign-in the customer is required to change the
 * password. Credentials are shown to the Admin exactly once — never stored
 * client-side, never written to audit logs.
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
import { UserPlus, Copy, Eye, EyeOff, ShieldAlert } from "lucide-react";

function randomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out + "!";
}

export function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [password, setPassword] = useState(() => randomPassword());
  const [showPw, setShowPw] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string; userId: string } | null>(
    null,
  );
  const navigate = useNavigate();

  const mut = useMutation({
    mutationFn: () =>
      adminCreateCustomer({
        data: {
          email: email.trim(),
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
          temporaryPassword: password,
        },
      }),
    onSuccess: (r) => {
      if (r.existed) {
        toast.info("Customer already exists — opening record. Password was not changed.");
        setOpen(false);
        resetForm();
        navigate({ to: "/admin/customers/$userId", params: { userId: r.userId } });
        return;
      }
      // Show credentials exactly once.
      setIssued({ email: email.trim(), password, userId: r.userId });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setEmail("");
    setFullName("");
    setPhone("");
    setNotes("");
    setPassword(randomPassword());
    setShowPw(false);
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          // Clear temp password from memory when closed.
          setIssued(null);
          resetForm();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Add customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{issued ? "Customer created" : "Add customer"}</DialogTitle>
        </DialogHeader>

        {issued ? (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" /> Shown once
              </div>
              Copy and send these securely to the customer now. They won't be shown again and are
              not stored anywhere you can view.
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Email</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={issued.email} className="font-mono text-sm" />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => copy(issued.email, "Email")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Temporary password</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={issued.password} className="font-mono text-sm" />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => copy(issued.password, "Password")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The customer will be required to set a new password on first sign-in.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  const id = issued.userId;
                  setIssued(null);
                  setOpen(false);
                  resetForm();
                  navigate({ to: "/admin/customers/$userId", params: { userId: id } });
                }}
              >
                Done — open customer
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="cus-name">Full name</Label>
              <Input
                id="cus-name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cus-email">Email</Label>
              <Input
                id="cus-email"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cus-phone">Phone (optional)</Label>
              <Input id="cus-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cus-pw">Temporary password</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="cus-pw"
                  required
                  minLength={8}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="font-mono"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPassword(randomPassword())}
                >
                  Regenerate
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Minimum 8 characters. Customer must change it on first sign-in.
              </p>
            </div>
            <div>
              <Label htmlFor="cus-notes">Admin notes (optional)</Label>
              <Textarea
                id="cus-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Creating…" : "Create customer"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
