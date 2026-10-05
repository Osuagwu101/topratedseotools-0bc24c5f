import { Link } from "@tanstack/react-router";
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
  { section: "submit" as const, to: "/turnitin/submit", label: "Submit File", icon: UploadCloud },
  { section: "buy" as const, to: "/turnitin/buy", label: "Buy Checks", icon: ShoppingCart },
  { section: "history" as const, to: "/turnitin/history", label: "History", icon: FileClock },
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

  const meta = SECTION_META[section];
  const PageIcon = meta.icon;

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
            className="-mb-px flex gap-1 overflow-x-auto"
            aria-label="Turnitin Checks sections"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = tab.section === section;
              return (
                <Link
                  key={tab.section}
                  to={tab.to}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <TurnitinWorkspace
          isAuthenticated={session.data?.isAuthenticated ?? false}
          view={section}
        />
      </section>
    </SiteLayout>
  );
}
