/**
 * Placeholder for Phase 2–8 items that live in the Settings menu but are not
 * yet implemented. Renders "Coming in Phase N" — no fake data, no buttons.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Clock } from "lucide-react";

export function PhasePlaceholder({
  phase,
  name,
  description,
}: {
  phase: number;
  name: string;
  description?: string;
}) {
  return (
    <AdminShell>
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-card">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Clock className="h-6 w-6" />
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            Coming in Phase {phase}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{name}</h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
