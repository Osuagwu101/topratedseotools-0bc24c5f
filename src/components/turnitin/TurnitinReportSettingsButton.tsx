import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LoaderCircle, RotateCcw, Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMyTurnitinReportPreferences, resetMyTurnitinReportPreferences, saveMyTurnitinReportPreferences } from "@/lib/turnitin-report-preferences.functions";
import {
  DEFAULT_TURNITIN_REPORT_PREFERENCES,
  reportDownloadFilename,
  turnitinReportPreferencesSchema,
  type TurnitinReportPreferences,
} from "@/lib/turnitin-report-preferences";

type ToggleKey =
  | "compareInternet" | "comparePublications" | "compareSubmittedWorks"
  | "excludeSmallMatches" | "excludeBibliography" | "excludeQuotes" | "excludeCitations";

const COMPARISON_OPTIONS: { key: ToggleKey; title: string; hint: string }[] = [
  { key: "compareInternet", title: "Internet", hint: "Web pages and online sources" },
  { key: "comparePublications", title: "Publications", hint: "Academic journals, articles and books" },
  { key: "compareSubmittedWorks", title: "Submitted works", hint: "Previously submitted documents" },
];
const EXCLUSION_OPTIONS: { key: ToggleKey; title: string; hint: string }[] = [
  { key: "excludeSmallMatches", title: "Small matches", hint: "Ignore matches under the chosen word count or percentage" },
  { key: "excludeBibliography", title: "Bibliography", hint: "Reference lists and standalone reference entries" },
  { key: "excludeQuotes", title: "Quotes", hint: "Text within quotation marks" },
  { key: "excludeCitations", title: "Citations", hint: "In-text references, for example (Smith, 2019)" },
];

function OptionRow({
  value, title, hint, onChange, disabled = false,
}: { value: boolean; title: string; hint: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/10 p-3 hover:bg-muted/20">
      <input
        type="checkbox" checked={value} disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export function TurnitinReportSettingsButton({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TurnitinReportPreferences>({ ...DEFAULT_TURNITIN_REPORT_PREFERENCES });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["turnitin-report-preferences"],
    queryFn: getMyTurnitinReportPreferences,
    enabled: open && isAuthenticated,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open && settings.data && !pending) setForm({ ...settings.data });
  }, [open, settings.data]);

  const setBoolean = (key: ToggleKey, value: boolean) => {
    setNotice(null);
    setError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const save = async () => {
    setError(null);
    setNotice(null);
    const parsed = turnitinReportPreferencesSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Please check your preferences.");
      return;
    }
    setPending(true);
    try {
      const saved = await saveMyTurnitinReportPreferences({ data: parsed.data });
      qc.setQueryData(["turnitin-report-preferences"], saved);
      setNotice("Your report settings have been saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your settings.");
    } finally {
      setPending(false);
    }
  };
  const reset = async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const defaults = await resetMyTurnitinReportPreferences();
      qc.setQueryData(["turnitin-report-preferences"], defaults);
      setForm({ ...defaults });
      setNotice("Default report settings restored.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset your settings.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button" onClick={() => { setError(null); setNotice(null); setOpen(true); }}
        className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/10"
      >
        <Settings2 className="h-4 w-4" /> Report settings
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
            <DialogTitle>Similarity Report Settings</DialogTitle>
            <DialogDescription>
              Choose your saved upload defaults and the names of downloaded reports.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            {settings.isLoading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading settings…
              </div>
            ) : settings.isError ? (
              <p role="alert" className="text-sm text-destructive">Could not load settings. Please close and retry.</p>
            ) : (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-bold">Compare submissions with</h3>
                  <p className="text-xs text-muted-foreground">Select at least one collection.</p>
                  <div className="grid gap-2">
                    {COMPARISON_OPTIONS.map((option) => (
                      <OptionRow
                        key={option.key} title={option.title} hint={option.hint}
                        value={form[option.key]}
                        onChange={(v) => setBoolean(option.key, v)}
                      />
                    ))}
                  </div>
                  <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                    Originality.report controls the actual comparison collections. Saving these preferences here does not change its active upstream source databases.
                  </p>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-bold">Exclude from Similarity Report</h3>
                  <p className="text-xs text-muted-foreground">These defaults automatically pre-fill Advanced Options when you submit a document. You can change them for each file.</p>
                  <div className="grid gap-2">
                    {EXCLUSION_OPTIONS.map((option) => (
                      <OptionRow
                        key={option.key} title={option.title} hint={option.hint}
                        value={form[option.key]} onChange={(v) => setBoolean(option.key, v)}
                      />
                    ))}
                  </div>
                  {form.excludeSmallMatches ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/10 p-3">
                      <label className="text-xs font-semibold">Ignore below</label>
                      <input type="number"
                        min={form.smallMatchMode === "words" ? 8 : 1}
                        max={form.smallMatchMode === "words" ? 200 : 50}
                        value={form.smallMatchThreshold}
                        onChange={(e) => setForm((p) => ({ ...p, smallMatchThreshold: Number(e.target.value) }))}
                        className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"
                      />
                      <select value={form.smallMatchMode}
                        onChange={(e) => {
                          const mode = e.target.value as "words" | "percent";
                          setForm((p) => ({ ...p, smallMatchMode: mode, smallMatchThreshold: mode === "words" ? 8 : 1 }));
                        }} className="rounded-md border bg-background px-2 py-1.5 text-sm">
                        <option value="words">words</option>
                        <option value="percent">percentage (%)</option>
                      </select>
                    </div>
                  ) : null}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-bold">Default report view</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ["sources", "Sources", "Numbered, colour-coded sources"],
                      ["match_groups", "Match groups", "Grouped highlights and match icons"],
                    ] as const).map(([value, title, detail]) => (
                      <button key={value} type="button" aria-pressed={form.reportView === value}
                        onClick={() => setForm((p) => ({ ...p, reportView: value }))}
                        className={`rounded-lg border p-4 text-left text-sm transition ${form.reportView === value ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30" : "hover:border-primary/40"}`}>
                        <span className="block font-semibold">{title}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-bold">Downloaded report file names</h3>
                  <p className="text-xs text-muted-foreground">Choose whether to add a prefix to downloaded AI and Similarity PDFs.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" aria-pressed={form.useFilenamePrefixes}
                      onClick={() => setForm((p) => ({ ...p, useFilenamePrefixes: true }))}
                      className={`rounded-lg border p-3 text-left text-sm ${form.useFilenamePrefixes ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}>
                      With prefix
                    </button>
                    <button type="button" aria-pressed={!form.useFilenamePrefixes}
                      onClick={() => setForm((p) => ({ ...p, useFilenamePrefixes: false }))}
                      className={`rounded-lg border p-3 text-left text-sm ${!form.useFilenamePrefixes ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}>
                      Original file name
                    </button>
                  </div>
                  {form.useFilenamePrefixes ? (
                    <div className="grid gap-3 rounded-lg border bg-primary/5 p-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-primary">
                        AI report prefix
                        <input value={form.aiReportPrefix} maxLength={40} aria-label="AI report prefix"
                          onChange={(e) => setForm((p) => ({ ...p, aiReportPrefix: e.target.value }))}
                          className="mt-1.5 block w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal text-foreground" />
                      </label>
                      <label className="text-xs font-semibold text-primary">
                        Similarity report prefix
                        <input value={form.similarityReportPrefix} maxLength={40} aria-label="Similarity report prefix"
                          onChange={(e) => setForm((p) => ({ ...p, similarityReportPrefix: e.target.value }))}
                          className="mt-1.5 block w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal text-foreground" />
                      </label>
                    </div>
                  ) : null}
                  <p className="text-xs leading-5 text-muted-foreground">
                    Example: My Essay.docx becomes <strong>{reportDownloadFilename("My Essay.docx", "ai", form)}</strong> (AI) and <strong>{reportDownloadFilename("My Essay.docx", "similarity", form)}</strong> (Similarity).
                  </p>
                </section>
                {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
                {notice ? <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {notice}</p> : null}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-background px-4 py-3 sm:px-6">
            <button type="button" disabled={pending || settings.isLoading || settings.isError}
              onClick={() => void reset()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
            <button type="button" disabled={pending || settings.isLoading || settings.isError}
              onClick={() => void save()} className="rounded-lg bg-gradient-primary px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pending ? "Saving…" : "Save settings"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
