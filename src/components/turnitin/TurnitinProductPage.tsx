import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  ShoppingCart,
  UploadCloud,
} from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import {
  TurnitinWorkspace,
  type TurnitinWorkspaceView,
} from "@/components/turnitin/TurnitinWorkspace";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Section = Exclude<TurnitinWorkspaceView, "all">;

const SECTION_META: Record<
  Section,
  { title: string; description: string; icon: typeof LayoutDashboard }
> = {
  overview: {
    title: "Turnitin Checks",
    description:
      "Manage your check balance, recent submissions and reports from one place.",
    icon: LayoutDashboard,
  },
  submit: {
    title: "Submit File",
    description:
      "Upload one document, set the Originality report options and run your check.",
    icon: UploadCloud,
  },
  buy: {
    title: "Buy Checks",
    description:
      "Purchase the exact number of prepaid checks you need. Each paid batch is valid for seven days.",
    icon: ShoppingCart,
  },
  history: {
    title: "Check History",
    description:
      "Search previous submissions, follow processing status and download available reports.",
    icon: FileClock,
  },
};

const TABS = [
  { section: "overview" as const, to: "/turnitin", label: "Overview", icon: LayoutDashboard },
  { section: "buy" as const, to: "/turnitin/buy", label: "Buy Checks", icon: ShoppingCart },
];

export function TurnitinProductPage({ section }: { section: Section }) {
  const session = useQuery({
    queryKey: ["turnitin-session-flag"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return { isAuthenticated: !!data.session };
    },
    staleTime: 30_000,
  });

  const navigate = useNavigate();
  const [submitOpen, setSubmitOpen] = useState(section === "submit");
  const [submissionNotice, setSubmissionNotice] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const [canSubmit, setCanSubmit] = useState(false);
  const [submittingFile, setSubmittingFile] = useState(false);
  const activeSection = section === "submit" ? "overview" : section;
  const meta = SECTION_META[activeSection];
  const PageIcon = meta.icon;

  useEffect(() => {
    if (section === "submit") setSubmitOpen(true);
  }, [section]);

  const closeSubmit = () => {
    setSubmitOpen(false);
    if (section === "submit") void navigate({ to: "/turnitin" });
  };

  return (
    <SiteLayout>
      <section className="border-b bg-gradient-hero">
        <div className="mx-auto max-w-6xl px-4 pb-0 pt-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 pb-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs font-semibold text-primary backdrop-blur">
                <ClipboardCheck className="h-3.5 w-3.5" />
                Self-service document checking
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <PageIcon className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {meta.title}
                  </h1>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <nav
            className="-mb-px flex items-center gap-2 pb-1"
            aria-label="Turnitin Checks sections"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = tab.section === activeSection;
              const tabClass = cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs font-semibold transition sm:text-sm",
                tab.section === "buy"
                  ? "ml-auto rounded-lg bg-gradient-primary px-3 py-2.5 text-white shadow-glow hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4"
                  : cn(
                      "border-b-2 px-2 py-3 sm:px-4",
                      active
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    ),
              );
              return (
                <Link key={tab.section} to={tab.to} className={tabClass}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={submitOpen}
              onClick={() => setSubmitOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-gradient-primary px-3 py-2.5 text-xs font-semibold text-white shadow-glow transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4 sm:text-sm"
            >
              <UploadCloud className="h-4 w-4" />
              Submit File
            </button>
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        {submissionNotice ? (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Document submitted. Track its status and download your reports in Check History below.
          </div>
        ) : null}
        <TurnitinWorkspace
          isAuthenticated={session.data?.isAuthenticated ?? false}
          view={activeSection}
          onOpenSubmit={() => setSubmitOpen(true)}
        />
      </section>
      <Dialog open={submitOpen} onOpenChange={(open) => { if (!open) closeSubmit(); else setSubmitOpen(true); }}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.25rem)] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
            <DialogTitle>Submit New File</DialogTitle>
            <DialogDescription className="sr-only">
              Upload a document and choose your report preferences.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <TurnitinWorkspace
              isAuthenticated={session.data?.isAuthenticated ?? false}
              view="submit"
              compactSubmit
              submitButtonRef={submitButtonRef}
              onSubmitStateChange={(ready, pending) => {
                setCanSubmit(ready);
                setSubmittingFile(pending);
              }}
              onSubmitSuccess={() => {
                setSubmissionNotice(true);
                closeSubmit();
              }}
            />
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-background px-5 py-3">
            <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted" onClick={closeSubmit}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit || submittingFile}
              onClick={() => submitButtonRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingFile ? "Submitting…" : "Submit File"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SiteLayout>
  );
}
