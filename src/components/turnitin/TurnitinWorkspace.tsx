import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Coins,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  getMyTurnitinReportDownload,
  getMyTurnitinWorkspace,
  type TurnitinJobRow,
  type TurnitinJobStatus,
  type TurnitinReportRow,
} from "@/lib/turnitin.functions";

const UNIT_PRICE_NGN = 2300;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx"];

function formatNaira(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function cleanName(file: File) {
  return file.name.trim() || "Untitled document";
}

function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "Use a PDF, DOC or DOCX file.";
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_FILE_BYTES) return "The maximum file size is 100 MB.";
  return null;
}

const STATUS_LABEL: Record<TurnitinJobStatus, string> = {
  draft: "Draft",
  uploading: "Uploading",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_STYLE: Record<TurnitinJobStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  uploading: "bg-blue-500/10 text-blue-700",
  queued: "bg-amber-500/10 text-amber-700",
  processing: "bg-violet-500/10 text-violet-700",
  completed: "bg-emerald-500/10 text-emerald-700",
  failed: "bg-red-500/10 text-red-700",
};

type Props = {
  isAuthenticated: boolean;
};

export function TurnitinWorkspace({ isAuthenticated }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [excludeBibliography, setExcludeBibliography] = useState(false);
  const [excludeQuotes, setExcludeQuotes] = useState(false);
  const [excludeCitations, setExcludeCitations] = useState(false);
  const [excludeSmallMatches, setExcludeSmallMatches] = useState(false);
  const [smallMatchMode, setSmallMatchMode] = useState<"words" | "percent">("words");
  const [smallMatchThreshold, setSmallMatchThreshold] = useState(8);
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const workspace = useQuery({
    queryKey: ["turnitin-workspace"],
    queryFn: () => getMyTurnitinWorkspace(),
    enabled: isAuthenticated,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      return jobs.some((job) =>
        ["uploading", "queued", "processing"].includes(job.status),
      )
        ? 10_000
        : false;
    },
  });

  const jobs = workspace.data?.jobs ?? [];
  const visibleJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((job) => {
      const name = (job.display_name || job.original_filename || "").toLowerCase();
      return name.includes(q);
    });
  }, [jobs, search]);

  const onFile = (file: File | null) => {
    if (!file) return;
    const error = validateFile(file);
    setFileError(error);
    setSelectedFile(error ? null : file);
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadReport = async (report: TurnitinReportRow) => {
    setDownloadError(null);
    setDownloadingReport(report.id);
    try {
      const result = await getMyTurnitinReportDownload({
        data: { reportId: report.id },
      });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Could not download this report.",
      );
    } finally {
      setDownloadingReport(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
        <div className="grid gap-0 lg:grid-cols-[1.25fr_.75fr]">
          <div className="p-6 sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <ShieldCheck className="h-4 w-4" />
              Self-service Turnitin workspace
            </div>
            <h2 className="mt-4 text-2xl font-bold">Check documents from your account</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pre-fund your account with any number of check credits, upload PDF, DOC or DOCX
              files, choose your similarity exclusions, and keep your reports in one searchable
              history.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <FeatureMini title="₦2,300" text="per document check" />
              <FeatureMini title="7 days" text="credit validity" />
              <FeatureMini title="1 credit" text="per uploaded document" />
            </div>
          </div>
          <div className="flex flex-col justify-center border-t bg-muted/20 p-6 sm:p-8 lg:border-l lg:border-t-0">
            <div className="text-sm font-semibold">Sign in to continue</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your credit balance, uploaded files and reports are private to your account.
            </p>
            <Link
              to="/login"
              search={{ redirect: "/tools/turnitin" }}
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90"
            >
              Sign in to Turnitin Checks
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const summary = workspace.data?.summary ?? {
    available_credits: 0,
    reserved_credits: 0,
    next_expiry_at: null,
  };
  const foundationReady = workspace.data?.foundationReady ?? true;

  return (
    <div className="space-y-6">
      {!foundationReady ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <div className="font-semibold">Turnitin workspace preview</div>
            <p className="mt-1 text-xs text-muted-foreground">
              The Phase 3 Turnitin database foundation has not been applied in this environment
              yet. The interface is safe to preview, but balances and history remain empty.
            </p>
          </div>
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Coins}
          label="Available credits"
          value={String(summary.available_credits)}
          hint="1 credit = 1 document"
        />
        <StatCard
          icon={Clock3}
          label="Reserved"
          value={String(summary.reserved_credits)}
          hint="Checks waiting for acceptance"
        />
        <StatCard
          icon={CalendarClock}
          label="Next expiry"
          value={
            summary.next_expiry_at
              ? new Date(summary.next_expiry_at).toLocaleDateString()
              : "—"
          }
          hint="Unused purchase credits expire after 7 days"
        />
        <StatCard
          icon={ShoppingCart}
          label="Price"
          value={formatNaira(UNIT_PRICE_NGN)}
          hint="per check"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Buy check credits</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Buy any quantity you need. Every paid batch remains valid for seven days.
              </p>
            </div>
          </div>

          <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Number of checks
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={500}
              value={quantity}
              onChange={(e) =>
                setQuantity(
                  Math.min(500, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                )
              }
              className="w-28 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="text-sm text-muted-foreground">
              × {formatNaira(UNIT_PRICE_NGN)}
            </div>
          </div>

          <div className="mt-5 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Credits</span>
              <strong>{quantity}</strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3">
              <span className="font-semibold">Total</span>
              <strong className="text-xl">{formatNaira(quantity * UNIT_PRICE_NGN)}</strong>
            </div>
          </div>

          <button
            type="button"
            disabled
            className="mt-5 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground opacity-60"
          >
            <ShoppingCart className="h-4 w-4" />
            Buy {quantity} credit{quantity === 1 ? "" : "s"}
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            The dedicated credit checkout is connected in the payment phase. Existing tool
            subscriptions are not used for these credits.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Upload document</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                PDF, DOC or DOCX · maximum 100 MB · one accepted document uses one credit.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />

          {selectedFile ? (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{cleanName(selectedFile)}</div>
                  <div className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={removeFile}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Remove selected file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className="mt-5 flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition hover:border-primary/50 hover:bg-primary/[0.02]"
            >
              <UploadCloud className="h-7 w-7 text-primary" />
              <span className="mt-3 text-sm font-semibold">Choose a document</span>
              <span className="mt-1 text-xs text-muted-foreground">
                or drag and drop it here
              </span>
            </button>
          )}

          {fileError ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {fileError}
            </p>
          ) : null}

          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Similarity exclusions
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <OptionToggle
                checked={excludeBibliography}
                onChange={setExcludeBibliography}
                label="Exclude bibliography"
              />
              <OptionToggle
                checked={excludeQuotes}
                onChange={setExcludeQuotes}
                label="Exclude quotes"
              />
              <OptionToggle
                checked={excludeCitations}
                onChange={setExcludeCitations}
                label="Exclude cited text"
              />
              <OptionToggle
                checked={excludeSmallMatches}
                onChange={setExcludeSmallMatches}
                label="Exclude small matches"
              />
            </div>
          </div>

          {excludeSmallMatches ? (
            <div className="mt-4 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label className="text-xs font-medium">Small-match threshold</label>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Ignore matches below the selected word count or percentage.
                </p>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="number"
                  min={1}
                  value={smallMatchThreshold}
                  onChange={(e) =>
                    setSmallMatchThreshold(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                  className="min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm"
                />
                <select
                  value={smallMatchMode}
                  onChange={(e) =>
                    setSmallMatchMode(e.target.value === "percent" ? "percent" : "words")
                  }
                  className="rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  <option value="words">words</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            disabled
            className="mt-6 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            Run Turnitin check
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Submission activates when the Originality Reports adapter is connected in the next
            integration phase.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border bg-card shadow-card">
        <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Check history</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Search previous checks by the document name you uploaded.
            </p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search document name"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
        </div>

        {workspace.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading checks…
          </div>
        ) : workspace.isError ? (
          <div className="p-8 text-center text-sm text-destructive">
            Could not load your Turnitin history. Please refresh and try again.
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="p-10 text-center">
            <FileCheck2 className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {search ? "No document matches your search." : "No checks yet."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed and processing documents will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Similarity</th>
                    <th className="px-4 py-3">AI</th>
                    <th className="px-4 py-3 text-right">Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <HistoryRow
                      key={job.id}
                      job={job}
                      downloadingReport={downloadingReport}
                      onDownload={downloadReport}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {visibleJobs.map((job) => (
                <HistoryCard
                  key={job.id}
                  job={job}
                  downloadingReport={downloadingReport}
                  onDownload={downloadReport}
                />
              ))}
            </div>
          </>
        )}

        {downloadError ? (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {downloadError}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FeatureMini({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="font-bold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{text}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function OptionToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background/50 p-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function Score({
  value,
  unavailable,
}: {
  value: number | null;
  unavailable?: string | null;
}) {
  if (value != null) return <span className="font-semibold">{Number(value).toFixed(0)}%</span>;
  if (unavailable) {
    return <span className="text-xs text-muted-foreground">Unavailable</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

function reportFor(job: TurnitinJobRow, type: "similarity" | "ai") {
  return job.reports.find((report) => report.report_type === type);
}

function ReportButton({
  report,
  label,
  downloadingReport,
  onDownload,
}: {
  report: TurnitinReportRow | undefined;
  label: string;
  downloadingReport: string | null;
  onDownload: (report: TurnitinReportRow) => void;
}) {
  if (!report || report.status !== "available") return null;
  const pending = downloadingReport === report.id;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => void onDownload(report)}
      className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

function HistoryRow({
  job,
  downloadingReport,
  onDownload,
}: {
  job: TurnitinJobRow;
  downloadingReport: string | null;
  onDownload: (report: TurnitinReportRow) => void;
}) {
  const similarity = reportFor(job, "similarity");
  const ai = reportFor(job, "ai");
  return (
    <tr className="border-t">
      <td className="max-w-[300px] px-4 py-3">
        <div className="truncate font-medium">{job.display_name || job.original_filename}</div>
        {job.word_count != null ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {job.word_count.toLocaleString()} words
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatDate(job.submitted_at || job.created_at)}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-4 py-3">
        <Score value={job.similarity_percentage} />
      </td>
      <td className="px-4 py-3">
        <Score value={job.ai_percentage} unavailable={job.ai_unavailable_reason} />
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          <ReportButton
            report={similarity}
            label="Similarity"
            downloadingReport={downloadingReport}
            onDownload={onDownload}
          />
          <ReportButton
            report={ai}
            label="AI"
            downloadingReport={downloadingReport}
            onDownload={onDownload}
          />
          {!similarity && !ai ? (
            <span className="text-xs text-muted-foreground">
              {job.status === "completed" ? "Preparing" : "—"}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function HistoryCard({
  job,
  downloadingReport,
  onDownload,
}: {
  job: TurnitinJobRow;
  downloadingReport: string | null;
  onDownload: (report: TurnitinReportRow) => void;
}) {
  const similarity = reportFor(job, "similarity");
  const ai = reportFor(job, "ai");
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{job.display_name || job.original_filename}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatDate(job.submitted_at || job.created_at)}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/20 p-3 text-sm">
        <div>
          <div className="text-[11px] uppercase text-muted-foreground">Similarity</div>
          <Score value={job.similarity_percentage} />
        </div>
        <div>
          <div className="text-[11px] uppercase text-muted-foreground">AI</div>
          <Score value={job.ai_percentage} unavailable={job.ai_unavailable_reason} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ReportButton
          report={similarity}
          label="Similarity report"
          downloadingReport={downloadingReport}
          onDownload={onDownload}
        />
        <ReportButton
          report={ai}
          label="AI report"
          downloadingReport={downloadingReport}
          onDownload={onDownload}
        />
      </div>
      {job.status === "failed" && job.failure_message ? (
        <p className="mt-3 text-xs text-destructive">{job.failure_message}</p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: TurnitinJobStatus }) {
  const icon =
    status === "completed" ? (
      <CheckCircle2 className="h-3 w-3" />
    ) : status === "failed" ? (
      <AlertCircle className="h-3 w-3" />
    ) : ["uploading", "queued", "processing"].includes(status) ? (
      <LoaderCircle className="h-3 w-3 animate-spin" />
    ) : (
      <Clock3 className="h-3 w-3" />
    );

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[status]}`}
    >
      {icon}
      {STATUS_LABEL[status]}
    </span>
  );
}
