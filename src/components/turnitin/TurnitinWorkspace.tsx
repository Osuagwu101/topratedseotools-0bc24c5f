import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getMyTurnitinReportDownload,
  getMyTurnitinWorkspace,
  type TurnitinJobRow,
  type TurnitinJobStatus,
  type TurnitinReportRow,
} from "@/lib/turnitin.functions";
import {
  cancelTurnitinUpload,
  createTurnitinUploadIntent,
  submitTurnitinJob,
  syncMyTurnitinJobs,
} from "@/lib/turnitin-jobs.functions";
import { supabase } from "@/integrations/supabase/client";
import { getActiveGatewayInfo } from "@/lib/active-gateway.functions";
import {
  initializeTurnitinCreditPurchase,
  reconcileLatestTurnitinCreditPurchase,
  verifyTurnitinCreditPurchase,
} from "@/lib/turnitin-credit-payments.functions";
import {
  TURNITIN_CREDIT_MAX_QUANTITY,
  TURNITIN_CREDIT_UNIT_PRICE_NGN,
} from "@/lib/turnitin-pricing";
import {
  getMyTurnitinPostpaidSettlements,
  initializeTurnitinPostpaidSettlement,
  reconcileLatestTurnitinPostpaidSettlement,
  verifyTurnitinPostpaidSettlement,
} from "@/lib/turnitin-postpaid-settlements.functions";

const UNIT_PRICE_NGN = TURNITIN_CREDIT_UNIT_PRICE_NGN;
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

function mimeForFile(file: File): string {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  return file.type || "application/octet-stream";
}

function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "Use a PDF, DOC or DOCX file.";
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size >= MAX_FILE_BYTES) return "The file must be below 100 MB.";
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

export type TurnitinWorkspaceView = "overview" | "submit" | "buy" | "history" | "all";

type Props = {
  isAuthenticated: boolean;
  view?: TurnitinWorkspaceView;
  onOpenSubmit?: () => void;
  onSubmitSuccess?: () => void;
};

const TURNITIN_VIEW_PATH: Record<Exclude<TurnitinWorkspaceView, "all">, string> = {
  overview: "/turnitin",
  submit: "/turnitin/submit",
  buy: "/turnitin/buy",
  history: "/turnitin/history",
};

export function TurnitinWorkspace({ isAuthenticated, view = "all", onOpenSubmit, onSubmitSuccess }: Props) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [authorFirstName, setAuthorFirstName] = useState("Top Rated");
  const [authorLastName, setAuthorLastName] = useState("Writing Services");
  const [reportView, setReportView] = useState<"sources" | "match_groups">("sources");
  const [excludeBibliography, setExcludeBibliography] = useState(true);
  const [excludeQuotes, setExcludeQuotes] = useState(true);
  const [excludeCitations, setExcludeCitations] = useState(false);
  const [excludeSmallMatches, setExcludeSmallMatches] = useState(false);
  const [smallMatchMode, setSmallMatchMode] = useState<"words" | "percent">("words");
  const [smallMatchThreshold, setSmallMatchThreshold] = useState(8);
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);
  const [buyingCredits, setBuyingCredits] = useState(false);
  const [settlingPostpaid, setSettlingPostpaid] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [reconcilingPayment, setReconcilingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
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

  const postpaidSettlements = useQuery({
    queryKey: ["turnitin-postpaid-settlements"],
    queryFn: () => getMyTurnitinPostpaidSettlements(),
    enabled:
      isAuthenticated && workspace.data?.account.billing_mode === "postpaid",
    staleTime: 10_000,
  });

  const activeGateway = useQuery({
    queryKey: ["active-gateway"],
    queryFn: () => getActiveGatewayInfo(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const callbackFromUrl =
      params.get("reference") ||
      params.get("trxref") ||
      params.get("tx_ref");
    const storedSettlementReference = window.sessionStorage.getItem(
      "turnitin-postpaid-settlement-reference",
    );
    const storedCreditReference = window.sessionStorage.getItem(
      "turnitin-credit-reference",
    );
    const callbackReference =
      callbackFromUrl || storedSettlementReference || storedCreditReference;

    if (!callbackReference) return;

    const isSettlementReference =
      callbackReference.startsWith("TRST-TP-") ||
      callbackReference === storedSettlementReference;

    let cancelled = false;
    setVerifyingPayment(true);
    setPaymentError(null);

    void (async () => {
      if (isSettlementReference) {
        const result = await verifyTurnitinPostpaidSettlement({
          data: { reference: callbackReference },
        });
        if (cancelled) return;

        if (result.status === "confirmed") {
          window.sessionStorage.removeItem(
            "turnitin-postpaid-settlement-reference",
          );
          setPaymentMessage(
            `Postpaid settlement of ${formatNaira(result.amountNgn)} confirmed successfully.`,
          );
          await Promise.all([
            qc.invalidateQueries({ queryKey: ["turnitin-workspace"] }),
            qc.invalidateQueries({
              queryKey: ["turnitin-postpaid-settlements"],
            }),
          ]);
        } else if (result.status === "pending") {
          setPaymentMessage(
            "Your Postpaid settlement is still being confirmed by the payment provider.",
          );
        } else {
          window.sessionStorage.removeItem(
            "turnitin-postpaid-settlement-reference",
          );
          setPaymentError(
            "The payment provider did not confirm this Postpaid settlement.",
          );
        }
      } else {
        const result = await verifyTurnitinCreditPurchase({
          data: { reference: callbackReference },
        });
        if (cancelled) return;

        if (result.status === "paid") {
          window.sessionStorage.removeItem("turnitin-credit-reference");
          setPaymentMessage(
            `${result.quantity} Turnitin credit${result.quantity === 1 ? "" : "s"} added successfully.`,
          );
          await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
        } else if (result.status === "pending") {
          setPaymentMessage(
            "Your payment is still being confirmed. Your credits will appear after verification.",
          );
        } else {
          window.sessionStorage.removeItem("turnitin-credit-reference");
          setPaymentError(
            "The payment provider did not confirm this Turnitin credit purchase.",
          );
        }
      }

      if (params.toString()) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })()
      .catch((error) => {
        if (cancelled) return;
        setPaymentError(
          error instanceof Error
            ? error.message
            : "Could not verify this Turnitin payment.",
        );
      })
      .finally(() => {
        if (!cancelled) setVerifyingPayment(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, qc]);

  useEffect(() => {
    if (workspace.data?.account.billing_mode !== "postpaid") return;
    const outstanding = workspace.data.postpaid.outstanding_ngn;
    setSettlementAmount((current) => {
      if (outstanding <= 0) return 0;
      if (current <= 0 || current > outstanding) return outstanding;
      return current;
    });
  }, [
    workspace.data?.account.billing_mode,
    workspace.data?.postpaid.outstanding_ngn,
  ]);

  const buyCredits = async () => {
    if (!workspace.data?.foundationReady) {
      setPaymentError("The Turnitin credit system is not ready in this environment.");
      return;
    }

    setBuyingCredits(true);
    setPaymentError(null);
    setPaymentMessage(null);
    try {
      const checkout = await initializeTurnitinCreditPurchase({
        data: { quantity },
      });
      window.sessionStorage.setItem(
        "turnitin-credit-reference",
        checkout.reference,
      );
      window.location.href = checkout.authorization_url;
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Could not start the Turnitin credit payment.",
      );
      setBuyingCredits(false);
    }
  };

  const settlePostpaidBalance = async () => {
    const outstanding = workspace.data?.postpaid.outstanding_ngn ?? 0;
    if (outstanding <= 0) {
      setPaymentError("There is no outstanding Postpaid balance to settle.");
      return;
    }
    if (
      !Number.isInteger(settlementAmount) ||
      settlementAmount < 1 ||
      settlementAmount > outstanding
    ) {
      setPaymentError("Enter a settlement amount within your outstanding balance.");
      return;
    }

    setSettlingPostpaid(true);
    setPaymentError(null);
    setPaymentMessage(null);
    try {
      const checkout = await initializeTurnitinPostpaidSettlement({
        data: { amountNgn: settlementAmount },
      });
      window.sessionStorage.setItem(
        "turnitin-postpaid-settlement-reference",
        checkout.reference,
      );
      window.location.href = checkout.authorization_url;
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Could not start the Postpaid settlement.",
      );
      setSettlingPostpaid(false);
    }
  };

  const reconcileLatestPostpaidPayment = async () => {
    setReconcilingPayment(true);
    setPaymentError(null);
    setPaymentMessage(null);
    try {
      const result = await reconcileLatestTurnitinPostpaidSettlement();
      if (result.status === "confirmed") {
        setPaymentMessage(
          `Postpaid settlement of ${formatNaira(result.amountNgn)} confirmed successfully.`,
        );
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["turnitin-workspace"] }),
          qc.invalidateQueries({
            queryKey: ["turnitin-postpaid-settlements"],
          }),
        ]);
      } else if (result.status === "pending") {
        setPaymentMessage(
          "The payment provider still reports this Postpaid settlement as pending.",
        );
      } else if (result.status === "failed") {
        setPaymentError(
          "The payment provider reports the latest Postpaid settlement as failed.",
        );
      } else {
        setPaymentError("No pending Postpaid settlement was found.");
      }
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Could not reconcile the latest Postpaid settlement.",
      );
    } finally {
      setReconcilingPayment(false);
    }
  };

  const reconcileLatestPayment = async () => {
    setReconcilingPayment(true);
    setPaymentError(null);
    setPaymentMessage(null);
    try {
      const result = await reconcileLatestTurnitinCreditPurchase();
      if (result.status === "paid") {
        setPaymentMessage(
          `${result.quantity} Turnitin credit${result.quantity === 1 ? "" : "s"} added successfully.`,
        );
        await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
      } else if (result.status === "pending") {
        setPaymentMessage(
          "Paystack still reports this payment as pending. Please wait a moment and retry.",
        );
      } else if (result.status === "failed") {
        setPaymentError(
          "Paystack reports the latest Turnitin credit payment as failed.",
        );
      } else {
        setPaymentError("No pending Turnitin credit payment was found.");
      }
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Could not reconcile the latest Turnitin credit payment.",
      );
    } finally {
      setReconcilingPayment(false);
    }
  };

  const jobs = workspace.data?.jobs ?? [];
  const hasActiveJobs = jobs.some((job) =>
    ["queued", "processing"].includes(job.status),
  );

  useQuery({
    queryKey: ["turnitin-upstream-sync", hasActiveJobs],
    queryFn: async () => {
      const result = await syncMyTurnitinJobs();
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
      return result;
    },
    enabled: isAuthenticated && hasActiveJobs,
    refetchInterval: hasActiveJobs ? 10_000 : false,
    staleTime: 0,
    retry: false,
  });

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
    if (error) {
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setReportTitle(file.name);
  };

  const removeFile = () => {
    setSelectedFile(null);
    setReportTitle("");
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

      // The signed storage URL is generated with Content-Disposition:
      // attachment, so the browser downloads the PDF instead of opening its
      // PDF viewer in a new tab. This avoids the Firefox "not responding"
      // pause seen when large reports are opened inline.
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      link.rel = "noopener";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Could not download this report.",
      );
    } finally {
      setDownloadingReport(null);
    }
  };

  const runCheck = async () => {
    if (!selectedFile) {
      setSubmitError("Choose a PDF, DOC or DOCX file first.");
      return;
    }
    const validation = validateFile(selectedFile);
    if (validation) {
      setSubmitError(validation);
      return;
    }

    const summary = workspace.data?.summary;
    const isPostpaid = workspace.data?.account.billing_mode === "postpaid";
    if (!workspace.data?.foundationReady) {
      setSubmitError("The Turnitin workspace is not ready in this environment.");
      return;
    }
    if (!summary || (!isPostpaid && summary.available_credits < 1)) {
      setSubmitError("You need at least one available Turnitin check credit.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(null);
    let intent: Awaited<ReturnType<typeof createTurnitinUploadIntent>> | null = null;
    let sourceUploaded = false;

    try {
      intent = await createTurnitinUploadIntent({
        data: {
          filename: selectedFile.name,
          mimeType: mimeForFile(selectedFile),
          sizeBytes: selectedFile.size,
          options: {
            excludeBibliography,
            excludeQuotes,
            excludeCitations,
            excludeSmallMatches,
            smallMatchMode,
            smallMatchThreshold: excludeSmallMatches ? smallMatchThreshold : null,
            reportView,
            reportTitle: reportTitle.trim() || selectedFile.name,
            authorFirstName: authorFirstName.trim() || null,
            authorLastName: authorLastName.trim() || null,
            reportFormat: null,
          },
        },
      });

      const { error: uploadError } = await supabase.storage
        .from(intent.bucket)
        .uploadToSignedUrl(intent.path, intent.token, selectedFile, {
          contentType: mimeForFile(selectedFile),
        });

      if (uploadError) {
        throw new Error(`Private document upload failed: ${uploadError.message}`);
      }
      sourceUploaded = true;

      await submitTurnitinJob({ data: { jobId: intent.jobId } });
      setSubmitMessage(
        "Document accepted. Processing continues automatically; you can remain on this page.",
      );
      removeFile();
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
      onSubmitSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not submit this Turnitin check.";
      setSubmitError(message);

      // Only cancel/release when the file never reached our private storage.
      // Once source upload succeeded, the server decides whether failure is
      // explicit (release) or ambiguous (keep reservation + same upload_token).
      if (intent && !sourceUploaded) {
        try {
          await cancelTurnitinUpload({
            data: {
              jobId: intent.jobId,
              reason: "Private source upload failed before upstream submission.",
            },
          });
        } catch {
          /* server-side cleanup is best effort */
        }
      }
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
    } finally {
      setSubmitting(false);
    }
  };

  const retrySubmission = async (jobId: string) => {
    setRetryingJob(jobId);
    setSubmitError(null);
    try {
      await submitTurnitinJob({ data: { jobId } });
      setSubmitMessage("Submission retry accepted. Processing will continue automatically.");
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not retry this Turnitin check.",
      );
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
    } finally {
      setRetryingJob(null);
    }
  };

  if (!isAuthenticated) {
    const redirectTo =
      view === "all" ? "/turnitin" : TURNITIN_VIEW_PATH[view];

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
              search={{ redirect: redirectTo }}
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
  const account = workspace.data?.account ?? {
    billing_mode: "prepaid" as const,
    postpaid_rate_ngn: null,
  };
  const postpaid = workspace.data?.postpaid ?? {
    total_charges: 0,
    unpaid_checks: 0,
    outstanding_ngn: 0,
    paid_ngn: 0,
  };
  const isPostpaid = account.billing_mode === "postpaid";
  const settlements = postpaidSettlements.data ?? [];

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

      {(view === "all" || view === "overview") ? (
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {isPostpaid ? (
          <>
            <StatCard
              icon={ShoppingCart}
              label="Postpaid rate"
              value={
                account.postpaid_rate_ngn == null
                  ? "—"
                  : `${formatNaira(account.postpaid_rate_ngn)} / check`
              }
              hint="Agreed amount per accepted check"
            />
            <StatCard
              icon={Clock3}
              label="Unpaid checks"
              value={String(postpaid.unpaid_checks)}
              hint="Accepted checks awaiting settlement"
            />
            <StatCard
              icon={Coins}
              label="Outstanding"
              value={formatNaira(postpaid.outstanding_ngn)}
              hint="Current Postpaid balance"
            />
            <StatCard
              icon={CalendarClock}
              label="Saved prepaid credits"
              value={String(summary.available_credits)}
              hint="Not consumed while Postpaid is active"
            />
          </>
        ) : (
          <>
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
          </>
        )}
      </section>

      ) : null}

      {view === "overview" ? (
        <>
          <section className="grid gap-2 sm:grid-cols-3" aria-label="Quick actions">
            <button type="button" onClick={() => onOpenSubmit?.()}
              className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-primary/[0.03]">
              <UploadCloud className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Submit file</h2>
                <p className="text-[11px] text-muted-foreground">Upload and run a check</p>
              </div>
            </button>
            <Link to="/turnitin/buy"
              className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 shadow-sm transition hover:border-primary/40 hover:bg-primary/[0.03]">
              <ShoppingCart className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{isPostpaid ? "Postpaid account" : "Buy checks"}</h2>
                <p className="text-[11px] text-muted-foreground">{isPostpaid ? "View your balance" : "Add check credits"}</p>
              </div>
            </Link>
            <a href="#turnitin-check-history"
              className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 shadow-sm transition hover:border-primary/40 hover:bg-primary/[0.03]">
              <FileCheck2 className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Check history</h2>
                <p className="text-[11px] text-muted-foreground">Scores and reports</p>
              </div>
            </a>
          </section>

        </>
      ) : null}

      {(view === "all" || view === "buy" || view === "submit") ? (
      <section className={view === "all" ? "grid gap-6 xl:grid-cols-[0.8fr_1.2fr]" : "grid gap-6"}>
        {(view === "all" || view === "buy") ? (
        isPostpaid ? (
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Postpaid account</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  You do not need to buy prepaid checks while Postpaid is active.
                  Each accepted document is billed at your agreed rate.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={ShoppingCart}
                label="Agreed rate"
                value={
                  account.postpaid_rate_ngn == null
                    ? "—"
                    : `${formatNaira(account.postpaid_rate_ngn)} / check`
                }
                hint="Applied when Originality accepts a new check"
              />
              <StatCard
                icon={Clock3}
                label="Unpaid checks"
                value={String(postpaid.unpaid_checks)}
                hint="Checks not fully settled"
              />
              <StatCard
                icon={Coins}
                label="Outstanding"
                value={formatNaira(postpaid.outstanding_ngn)}
                hint="Current Postpaid balance"
              />
              <StatCard
                icon={CheckCircle2}
                label="Paid"
                value={formatNaira(postpaid.paid_ngn)}
                hint="Allocated to Postpaid checks"
              />
            </div>

            {postpaid.outstanding_ngn > 0 ? (
              <div className="mt-5 rounded-xl border bg-muted/20 p-4">
                <div className="text-sm font-semibold">Settle your balance</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Pay all or part of your outstanding balance through the active payment provider.
                  Confirmed money is allocated to your oldest unpaid checks first.
                </p>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Amount to pay
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="number"
                    min={1}
                    max={postpaid.outstanding_ngn}
                    value={settlementAmount}
                    onChange={(e) =>
                      setSettlementAmount(
                        Math.max(
                          1,
                          Math.min(
                            postpaid.outstanding_ngn,
                            Math.floor(Number(e.target.value) || 1),
                          ),
                        ),
                      )
                    }
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 sm:max-w-[220px]"
                  />
                  <button
                    type="button"
                    onClick={() => void settlePostpaidBalance()}
                    disabled={
                      settlingPostpaid ||
                      verifyingPayment ||
                      !foundationReady ||
                      settlementAmount < 1
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-primary px-4 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {settlingPostpaid || verifyingPayment ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShoppingCart className="h-4 w-4" />
                    )}
                    {settlingPostpaid
                      ? "Opening payment…"
                      : `Pay ${formatNaira(settlementAmount)} with ${activeGateway.data?.displayName ?? "payment provider"}`}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void reconcileLatestPostpaidPayment()}
                  disabled={reconcilingPayment || settlingPostpaid || verifyingPayment}
                  className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  {reconcilingPayment ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Retry last Postpaid payment verification
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700">
                <div className="font-semibold">Your Postpaid balance is fully settled.</div>
                <p className="mt-1 text-xs">
                  New accepted checks will appear here automatically at your agreed rate.
                </p>
              </div>
            )}

            {paymentMessage ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {paymentMessage}
              </div>
            ) : null}
            {paymentError ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {paymentError}
              </div>
            ) : null}

            <div className="mt-5 overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Settlement history</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Website and Admin-recorded settlements remain permanently visible.
                  </div>
                </div>
              </div>
              {settlements.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No Postpaid settlements recorded yet.
                </div>
              ) : (
                <div className="divide-y">
                  {settlements.slice(0, 10).map((row: {
                    id: string;
                    amountNgn: number;
                    allocatedAmountNgn: number;
                    method: string;
                    status: string;
                    confirmedAt: string | null;
                    createdAt: string;
                  }) => (
                    <div
                      key={row.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="text-sm font-semibold">
                          {formatNaira(row.amountNgn)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {row.method.replaceAll("_", " ")} · {formatDate(row.confirmedAt || row.createdAt)}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold capitalize text-foreground">
                          {row.status}
                        </span>
                        {" · "}
                        {formatNaira(row.allocatedAmountNgn)} allocated
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Your existing prepaid credits stay on the account and are not consumed
              while Postpaid billing is active.
            </p>
          </div>
        ) : (
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
                    Math.min(
                      TURNITIN_CREDIT_MAX_QUANTITY,
                      Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    ),
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
                <strong className="text-xl">
                  {formatNaira(quantity * UNIT_PRICE_NGN)}
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void buyCredits()}
              disabled={buyingCredits || verifyingPayment || !foundationReady}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buyingCredits || verifyingPayment ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
              {buyingCredits
                ? "Opening payment…"
                : verifyingPayment
                  ? "Confirming payment…"
                  : `Pay ${formatNaira(quantity * UNIT_PRICE_NGN)} with ${activeGateway.data?.displayName ?? "payment provider"}`}
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              One-time payment only. Credits are added after verified payment and remain
              valid for seven days. Existing tool subscriptions are not used.
            </p>
            <button
              type="button"
              onClick={() => void reconcileLatestPayment()}
              disabled={reconcilingPayment || buyingCredits || verifyingPayment}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-input px-4 py-2 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reconcilingPayment ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {reconcilingPayment
                ? "Checking Paystack…"
                : "Retry last payment verification"}
            </button>
            {paymentMessage ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {paymentMessage}
              </div>
            ) : null}
            {paymentError ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {paymentError}
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {(view === "all" || view === "submit") ? (
        <div className="rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Upload document</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                PDF, DOC or DOCX · file must be under 100 MB · one accepted document uses one credit.
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

          <div className="mt-5 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Submission details
            </div>
            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-xs font-medium">Title</span>
                <input
                  type="text"
                  value={reportTitle}
                  maxLength={500}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="Defaults to the file name"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium">Author first name</span>
                  <input
                    type="text"
                    value={authorFirstName}
                    maxLength={200}
                    onChange={(e) => setAuthorFirstName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Author last name</span>
                  <input
                    type="text"
                    value={authorLastName}
                    maxLength={200}
                    onChange={(e) => setAuthorLastName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </label>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                The title and author name entered here are sent to Originality Reports and are used for the generated report. Default author: Top Rated Writing Services.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Similarity report view
              </div>
              <div className="text-[11px] text-muted-foreground">Choose how your report looks</div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setReportView("sources")}
                className={`rounded-xl border p-4 text-left transition ${
                  reportView === "sources"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "bg-background/50 hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-semibold">Sources</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Classic layout with numbered, colour-coded sources.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setReportView("match_groups")}
                className={`rounded-xl border p-4 text-left transition ${
                  reportView === "match_groups"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "bg-background/50 hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-semibold">Match groups</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Highlights coloured by match group, with the group icon beside every source.
                </p>
              </button>
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Similarity exclusions
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <OptionToggle
                checked={excludeBibliography}
                onChange={setExcludeBibliography}
                label="Exclude bibliography"
                description="Reference lists and reference entries."
              />
              <OptionToggle
                checked={excludeQuotes}
                onChange={setExcludeQuotes}
                label="Exclude quotes"
                description="Text inside quotation marks."
              />
              <OptionToggle
                checked={excludeCitations}
                onChange={setExcludeCitations}
                label="Exclude cited text"
                description="In-text citations such as (Smith, 2019)."
              />
              <OptionToggle
                checked={excludeSmallMatches}
                onChange={setExcludeSmallMatches}
                label="Exclude small matches"
                description="Ignore matches below a word count, or sources below a percentage."
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
                  min={smallMatchMode === "percent" ? 1 : 8}
                  max={smallMatchMode === "percent" ? 50 : 200}
                  value={smallMatchThreshold}
                  onChange={(e) => {
                    const min = smallMatchMode === "percent" ? 1 : 8;
                    const max = smallMatchMode === "percent" ? 50 : 200;
                    setSmallMatchThreshold(
                      Math.min(max, Math.max(min, Math.floor(Number(e.target.value) || min))),
                    );
                  }}
                  className="min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm"
                />
                <select
                  value={smallMatchMode}
                  onChange={(e) => {
                    const mode = e.target.value === "percent" ? "percent" : "words";
                    setSmallMatchMode(mode);
                    setSmallMatchThreshold((current) =>
                      mode === "percent"
                        ? Math.min(50, Math.max(1, current))
                        : Math.min(200, Math.max(8, current)),
                    );
                  }}
                  className="rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  <option value="words">words</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-blue-700" />
              Requirements for AI Detection
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <li><strong className="text-foreground">File size:</strong> must be below 100 MB.</li>
              <li><strong className="text-foreground">Length:</strong> at least 300 words in paragraph format.</li>
              <li><strong className="text-foreground">Maximum:</strong> 30,000 words for AI detection.</li>
              <li><strong className="text-foreground">Language:</strong> English, Spanish, or Japanese.</li>
            </ul>
            <div className="mt-3 border-t pt-3 text-[11px] leading-5 text-muted-foreground">
              <strong className="text-foreground">Privacy:</strong> your source file is kept private and removed from TRST storage after Originality Reports accepts the submission.
            </div>
          </div>

          <div className="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
            <strong>
              {isPostpaid
                ? `This check will add ${formatNaira(account.postpaid_rate_ngn ?? 0)} to your Postpaid balance after Originality Reports accepts the document.`
                : "This check will use 1 credit after Originality Reports accepts the document."}
            </strong>
            <div className="mt-1 text-xs text-muted-foreground">
              {isPostpaid ? (
                <>
                  No prepaid credit is required. You currently have {postpaid.unpaid_checks} unpaid
                  check{postpaid.unpaid_checks === 1 ? "" : "s"} with an outstanding balance of{" "}
                  {formatNaira(postpaid.outstanding_ngn)}.
                </>
              ) : (
                <>
                  You currently have {summary.available_credits} available credit
                  {summary.available_credits === 1 ? "" : "s"}.
                </>
              )}{" "}
              If AI detection is unavailable because a document does not meet the AI requirements,
              a completed similarity report is still a completed check.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={
              submitting ||
              !selectedFile ||
              !foundationReady ||
              (!isPostpaid && summary.available_credits < 1)
            }
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {submitting ? "Submitting…" : "Run Turnitin check"}
          </button>
          {submitMessage ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {submitMessage}
            </div>
          ) : null}
          {submitError ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {submitError}
            </div>
          ) : null}
        </div>
        ) : null}
      </section>
      ) : null}

      {(view === "all" || view === "history" || view === "overview") ? (
      <section id="turnitin-check-history" className="scroll-mt-24 overflow-hidden rounded-2xl border bg-card shadow-card">
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
            {!search && onOpenSubmit ? (
              <button type="button" onClick={onOpenSubmit} className="mt-3 text-xs font-semibold text-primary hover:underline">
                Submit your first document
              </button>
            ) : null}
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
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <HistoryRow
                      key={job.id}
                      job={job}
                      downloadingReport={downloadingReport}
                      onDownload={downloadReport}
                      retryingJob={retryingJob}
                      onRetry={retrySubmission}
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
                  retryingJob={retryingJob}
                  onRetry={retrySubmission}
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
      </section>      ) : null}

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
    <div className="rounded-xl border bg-card px-3 py-3 shadow-sm sm:px-4">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-xl font-bold leading-tight tracking-tight text-primary">{value}</div>
      <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{hint}</div>
    </div>
  );
}

function OptionToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background/50 p-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span>
        <span className="block">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
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
  if (value != null) {
    const scoreColour = value >= 50 ? "text-red-700" : value >= 30 ? "text-amber-700" : "text-emerald-700";
    return <span className={`font-bold ${scoreColour}`}>{Number(value).toFixed(0)}%</span>;
  }
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
      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
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
  job, downloadingReport, onDownload, retryingJob, onRetry,
}: {
  job: TurnitinJobRow;
  downloadingReport: string | null;
  onDownload: (report: TurnitinReportRow) => void;
  retryingJob: string | null;
  onRetry: (jobId: string) => void;
}) {
  const similarity = reportFor(job, "similarity");
  const ai = reportFor(job, "ai");
  const canRetry = job.status === "uploading" &&
    (job.billing_mode === "postpaid" || job.credit_state === "reserved") &&
    !!job.upstream_last_error;
  return (
    <tr className="border-t">
      <td className="max-w-[300px] px-4 py-3">
        <div className="truncate font-medium" title={job.display_name || job.original_filename}>
          {job.display_name || job.original_filename}
        </div>
        {job.word_count != null ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{job.word_count.toLocaleString()} words</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatDate(job.submitted_at || job.created_at)}
      </td>
      <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <Score value={job.similarity_percentage} />
          <ReportButton report={similarity} label="Download" downloadingReport={downloadingReport} onDownload={onDownload} />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <Score value={job.ai_percentage} unavailable={job.ai_unavailable_reason} />
          <ReportButton report={ai} label="Download" downloadingReport={downloadingReport} onDownload={onDownload} />
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {canRetry ? (
          <button type="button" onClick={() => void onRetry(job.id)}
            disabled={retryingJob === job.id}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
            {retryingJob === job.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
            Retry
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{job.status === "completed" && !similarity && !ai ? "Preparing" : "—"}</span>
        )}
      </td>
    </tr>
  );
}

function HistoryCard({
  job, downloadingReport, onDownload, retryingJob, onRetry,
}: {
  job: TurnitinJobRow;
  downloadingReport: string | null;
  onDownload: (report: TurnitinReportRow) => void;
  retryingJob: string | null;
  onRetry: (jobId: string) => void;
}) {
  const similarity = reportFor(job, "similarity");
  const ai = reportFor(job, "ai");
  const canRetry = job.status === "uploading" &&
    (job.billing_mode === "postpaid" || job.credit_state === "reserved") &&
    !!job.upstream_last_error;
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-medium">{job.display_name || job.original_filename}</div>
          {job.word_count != null ? (
            <div className="text-[11px] text-muted-foreground">{job.word_count.toLocaleString()} words</div>
          ) : null}
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatDate(job.submitted_at || job.created_at)}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-muted/20 p-3 text-sm">
        <div className="flex flex-col items-start gap-1.5">
          <div className="text-[11px] uppercase text-muted-foreground">Similarity</div>
          <Score value={job.similarity_percentage} />
          <ReportButton report={similarity} label="Download" downloadingReport={downloadingReport} onDownload={onDownload} />
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <div className="text-[11px] uppercase text-muted-foreground">AI</div>
          <Score value={job.ai_percentage} unavailable={job.ai_unavailable_reason} />
          <ReportButton report={ai} label="Download" downloadingReport={downloadingReport} onDownload={onDownload} />
        </div>
      </div>
      {canRetry ? (
        <button type="button" onClick={() => void onRetry(job.id)}
          disabled={retryingJob === job.id}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
          {retryingJob === job.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
          Retry submission
        </button>
      ) : null}
      {job.status === "failed" && job.failure_message ? (
        <p className="mt-3 text-xs text-destructive">{job.failure_message}</p>
      ) : job.status === "uploading" && job.upstream_last_error ? (
        <p className="mt-3 text-xs text-amber-700">{job.upstream_last_error}</p>
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
