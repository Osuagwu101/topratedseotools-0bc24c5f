import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Download, Eye, FileText, Filter, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import { getMyTurnitinReportDownload } from "@/lib/turnitin.functions";
import { applyMyTurnitinViewerFilters, getMyTurnitinInteractiveReport, getMyTurnitinViewerPageImage } from "@/lib/turnitin-viewer.functions";
import type { OriginalityViewerFilters } from "@/lib/turnitin-originality.server";

type Report = Awaited<ReturnType<typeof getMyTurnitinInteractiveReport>>;
type Source = Report["similarity"]["sources"][number];
type Match = Source["matches"][number];
type ActiveMatch = { source: Source; match: Match };
type FilterState = OriginalityViewerFilters;

const groupNames: Record<string, string> = {
  not_cited_or_quoted: "Not cited or quoted",
  missing_citation: "Missing citation",
  missing_quotations: "Missing quotations",
  cited_and_quoted: "Cited and quoted",
};
const palette = ["#c91873", "#235fc9", "#008a5b", "#7533e7", "#b9376c", "#3c72d6", "#03905d", "#8747e7"];

function cleanFilters(filters: FilterState): FilterState {
  return {
    collections: [...filters.collections],
    exclude_bibliography: filters.exclude_bibliography,
    exclude_quotes: filters.exclude_quotes,
    exclude_citations: filters.exclude_citations,
    small_matches: { ...filters.small_matches },
  };
}
const fallbackFilters: FilterState = {
  collections: ["internet", "publication", "submitted_work"],
  exclude_bibliography: false,
  exclude_quotes: false,
  exclude_citations: false,
  small_matches: { enabled: false, mode: "words", threshold: 8 },
};

function selectedMatches(report: Report, filters: FilterState): ActiveMatch[] {
  const excludedSources = new Set(report.exclusions.sources);
  const excludedMatches = new Set(report.exclusions.matches);
  const result: ActiveMatch[] = [];
  for (const source of report.similarity.sources) {
    if (excludedSources.has(source.index) || !filters.collections.includes(source.collection as FilterState["collections"][number])) continue;
    if (filters.small_matches.enabled && filters.small_matches.mode === "percent" && source.percent < filters.small_matches.threshold) continue;
    for (const match of source.matches) {
      if (excludedMatches.has(match.id)) continue;
      if (filters.exclude_bibliography && match.inBibliography) continue;
      if (filters.exclude_quotes && match.quoted) continue;
      if (filters.exclude_citations && match.cited) continue;
      if (filters.small_matches.enabled && filters.small_matches.mode === "words" && match.words < filters.small_matches.threshold) continue;
      result.push({ source, match });
    }
  }
  return result;
}

function matchingCoverage(matches: ActiveMatch[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const { match } of matches) {
    const key = `${match.charStart}:${match.charEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += Math.max(0, match.words);
  }
  return total;
}

function percentColour(value: number): string {
  return value >= 50 ? "text-red-600" : value >= 30 ? "text-amber-600" : "text-emerald-600";
}

function PageImage({ jobId, page, highlights, zoom }: {
  jobId: string;
  page: Report["pages"][number];
  highlights: ActiveMatch[];
  zoom: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "650px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const result = useQuery({
    queryKey: ["turnitin-viewer-page", jobId, page.index],
    queryFn: () => getMyTurnitinViewerPageImage({ data: { jobId, pageIndex: page.index } }),
    enabled: visible,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const width = Number(page.width) || 612;
  const height = Number(page.height) || 792;
  return (
    <div ref={root} id={`turnitin-page-${page.index}`} className="mx-auto mb-6 scroll-mt-5" style={{ width: `${Math.round(100 * zoom)}%`, maxWidth: `${Math.round(width * zoom)}px` }}>
      <div className="relative overflow-hidden border border-slate-200 bg-white shadow-lg" style={{ aspectRatio: `${width} / ${height}` }}>
        {result.data?.imageDataUrl ? (
          <img src={result.data.imageDataUrl} className="absolute inset-0 h-full w-full" alt={`Document page ${page.index + 1}`} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            {result.isError ? "This page could not be loaded." : <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading page…</>}
          </div>
        )}
        {highlights.flatMap(({ source, match }) =>
          (match.rects as number[][]).map((rect, index) => {
            if (!Array.isArray(rect) || rect.length !== 4) return null;
            const [left, top, right, bottom] = rect;
            return (
              <div key={`${source.index}:${match.id}:${index}`}
                title={source.linkText || source.url || "Matched source"}
                className="pointer-events-none absolute mix-blend-multiply"
                style={{
                  left: `${Math.max(0, left / width * 100)}%`,
                  top: `${Math.max(0, top / height * 100)}%`,
                  width: `${Math.max(0, (right - left) / width * 100)}%`,
                  height: `${Math.max(0, (bottom - top) / height * 100)}%`,
                  backgroundColor: palette[Math.max(0, source.index) % palette.length],
                  opacity: 0.26,
                }}
              />
            );
          }),
        )}
      </div>
      <div className="py-2 text-center text-xs text-slate-500">Page {page.index + 1}</div>
    </div>
  );
}

function CheckOption({ checked, onChange, title, subtitle }: {
  checked: boolean; onChange: (checked: boolean) => void; title: string; subtitle?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-teal-700" />
      <span className="min-w-0"><span className="block text-slate-800">{title}</span>
        {subtitle ? <span className="block text-xs text-slate-500">{subtitle}</span> : null}</span>
    </label>
  );
}

function FilterControls({ filters, setFilters }: {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
}) {
  const toggleCollection = (collection: FilterState["collections"][number], checked: boolean) =>
    setFilters({ ...filters, collections: checked
      ? Array.from(new Set([...filters.collections, collection]))
      : filters.collections.filter(v => v !== collection) });
  const exclude = (field: "exclude_bibliography" | "exclude_quotes" | "exclude_citations", value: boolean) =>
    setFilters({ ...filters, [field]: value });
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Compare submissions against</h3>
        <p className="mb-2 mt-1 text-xs text-slate-500">Select at least one source type.</p>
        <CheckOption title="Submitted works" checked={filters.collections.includes("submitted_work")} onChange={v => toggleCollection("submitted_work", v)} />
        <CheckOption title="Internet content" checked={filters.collections.includes("internet")} onChange={v => toggleCollection("internet", v)} />
        <CheckOption title="Publications" checked={filters.collections.includes("publication")} onChange={v => toggleCollection("publication", v)} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Exclusion filters</h3>
        <CheckOption title="Exclude bibliography" checked={filters.exclude_bibliography} onChange={v => exclude("exclude_bibliography",v)} />
        <CheckOption title="Exclude quoted text" checked={filters.exclude_quotes} onChange={v => exclude("exclude_quotes",v)} />
        <CheckOption title="Exclude cited text" checked={filters.exclude_citations} onChange={v => exclude("exclude_citations",v)} />
        <CheckOption title="Exclude small matches" checked={filters.small_matches.enabled}
          onChange={v => setFilters({...filters, small_matches:{...filters.small_matches, enabled:v}})} />
        {filters.small_matches.enabled ? (
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <span>Below</span>
            <input type="number" className="w-20 rounded border bg-white px-2 py-1.5"
              min={filters.small_matches.mode === "words" ? 8 : 1}
              max={filters.small_matches.mode === "words" ? 250 : 50}
              value={filters.small_matches.threshold}
              onChange={e => setFilters({...filters,small_matches:{...filters.small_matches,threshold:Number(e.target.value)}})} />
            <select className="min-w-0 flex-1 rounded border bg-white px-1 py-1.5"
              value={filters.small_matches.mode}
              onChange={e => {
                const mode=e.target.value as "words" | "percent";
                setFilters({...filters,small_matches:{enabled:true,mode,threshold:mode === "words" ? 8 : 1}});
              }}>
              <option value="words">words</option><option value="percent">%</option>
            </select>
          </div>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-slate-500">Filters update this report's existing matches without charging for a new check. Content omitted during the original check cannot be restored.</p>
    </div>
  );
}

export function TurnitinReportViewer({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const report = useQuery({
    queryKey: ["turnitin-live-report", jobId],
    queryFn: () => getMyTurnitinInteractiveReport({ data: { jobId } }),
    staleTime: 10_000,
    retry: 1,
  });
  const data = report.data;
  const [tab, setTab] = useState<"similarity" | "ai">("similarity");
  const [panel, setPanel] = useState<"sources" | "match_groups" | "filters">("sources");
  const [draft, setDraft] = useState<FilterState | null>(null);
  const [updating, setUpdating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const savedFilters = data?.exclusions.filters ?? fallbackFilters;
  const appliedFilters = savedFilters;
  const active = useMemo(() => data ? selectedMatches(data, appliedFilters) : [], [data, appliedFilters]);
  const previewMatches = useMemo(() => data && panel === "filters" && draft
    ? selectedMatches(data, draft) : active, [data, draft, panel, active]);

  const activeCoverage = useMemo(() => matchingCoverage(active), [active]);
  const previewCoverage = useMemo(() => matchingCoverage(previewMatches), [previewMatches]);
  const baseSimilarity = Number(data?.similarity.overallPercent ?? 0);
  const totalWords = Number(data?.similarity.totalWords ?? 0);
  // The provider supplies a word count for each match and the report's total
  // word count. Deduplicating match character spans avoids double counting
  // identical source matches while exclusions change the visible total.
  const activeSimilarity = totalWords > 0 ? Math.min(100, activeCoverage / totalWords * 100) : baseSimilarity;
  const previewScore = totalWords > 0 ? Math.min(100, previewCoverage / totalWords * 100) : activeSimilarity;
  const previewDiffers = panel === "filters" && draft && JSON.stringify(draft) !== JSON.stringify(savedFilters);
  const scoreText = previewDiffers ? `≈${Math.round(previewScore)}%` : `${Math.round(activeSimilarity)}%`;

  const download = async () => {
    if (!data?.similarityReportId) return;
    setDownloading(true); setProblem(null);
    try {
      const link = await getMyTurnitinReportDownload({ data: { reportId: data.similarityReportId } });
      const node = document.createElement("a");
      node.href = link.url;
      node.download = link.filename;
      document.body.appendChild(node); node.click(); node.remove();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Unable to download the report.");
    } finally { setDownloading(false); }
  };

  const saveFilters = async () => {
    if (!draft || !draft.collections.length || updating) return;
    if (draft.small_matches.enabled) {
      const { mode, threshold } = draft.small_matches;
      if (threshold < (mode === "words" ? 8 : 1) || threshold > (mode === "words" ? 250 : 50)) {
        setProblem("The small-match threshold is outside the permitted range."); return;
      }
    }
    setUpdating(true); setProblem(null); setNotice(null);
    try {
      const result = await applyMyTurnitinViewerFilters({ data: { jobId, filters: draft } });
      await qc.invalidateQueries({ queryKey: ["turnitin-live-report", jobId] });
      await qc.invalidateQueries({ queryKey: ["turnitin-workspace"] });
      setPanel("sources");
      setDraft(null);
      setNotice(result.pdfUpdated
        ? "Filters applied. The updated Similarity PDF is ready to download."
        : result.warning || "Filters applied to your interactive report.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Unable to apply filters.");
    } finally { setUpdating(false); }
  };

  if (report.isLoading) return <div className="flex min-h-screen items-center justify-center gap-3 bg-slate-50 text-slate-600"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading your report…</div>;
  if (report.isError || !data) return (
    <div className="mx-auto max-w-lg px-5 py-20 text-center">
      <AlertCircle className="mx-auto h-9 w-9 text-amber-600" />
      <h1 className="mt-3 text-xl font-semibold">Report viewer unavailable</h1>
      <p className="mt-2 text-sm text-slate-600">{report.error instanceof Error ? report.error.message : "This report is not currently available."}</p>
      <Link to="/turnitin" className="mt-5 inline-block text-sm font-semibold text-blue-700 hover:underline">Return to Check History</Link>
    </div>
  );

  const filtersChanged = draft && JSON.stringify(draft) !== JSON.stringify(savedFilters);
  return (
    <div className="min-h-screen bg-[#f3f4f7] text-slate-900">
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3 shadow-sm sm:px-7">
        <Link to="/turnitin" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-800 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Check History
        </Link>
        <div className="min-w-0 max-w-[55vw] truncate text-sm font-semibold" title={data.title}>{data.title}</div>
        <button type="button" disabled={downloading || !data.similarityReportId}
          onClick={() => void download()}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download
        </button>
      </header>
      <div className="flex flex-wrap items-center justify-center gap-5 border-b bg-white px-4 py-3 text-sm">
        <button type="button" onClick={() => setTab("similarity")}
          className={`inline-flex items-center gap-2 border-b-2 px-2 py-1.5 ${tab === "similarity" ? "border-primary font-semibold text-blue-800" : "border-transparent text-slate-600"}`}>
          Similarity <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{Math.round(activeSimilarity)}%</span>
        </button>
        <button type="button" onClick={() => setTab("ai")}
          className={`inline-flex items-center gap-2 border-b-2 px-2 py-1.5 ${tab === "ai" ? "border-primary font-semibold text-blue-800" : "border-transparent text-slate-600"}`}>
          AI Writing <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs">{data.aiPercentage == null ? "—" : Math.round(data.aiPercentage) + "%"}</span>
        </button>
      </div>
      {problem ? <div role="alert" className="mx-auto mt-3 max-w-6xl rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{problem}</div> : null}
      {notice ? <div role="status" className="mx-auto mt-3 flex max-w-6xl items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" />{notice}</div> : null}
      <main className="flex min-h-[calc(100dvh-125px)] flex-col lg:flex-row">
        <section className="min-w-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6" aria-label="Report document">
          <div className="mx-auto mb-4 flex max-w-xl items-center justify-between gap-3 text-xs text-slate-500">
            <span><FileText className="mr-1 inline h-4 w-4" /> {data.pageCount} pages · {data.wordCount.toLocaleString()} words</span>
            <div className="inline-flex items-center gap-2">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom(v => Math.max(0.65, v - 0.15))} className="rounded border bg-white p-1.5"><ZoomOut className="h-4 w-4" /></button>
              {Math.round(zoom * 100)}%
              <button type="button" aria-label="Zoom in" onClick={() => setZoom(v => Math.min(2, v + 0.15))} className="rounded border bg-white p-1.5"><ZoomIn className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mx-auto max-w-4xl overflow-x-auto">
            {data.pages.map((page: Report["pages"][number]) => (
              <PageImage key={page.index} jobId={jobId} page={page}
                highlights={tab === "similarity" ? previewMatches.filter(m => m.match.page === page.index) : []} zoom={zoom} />
            ))}
          </div>
        </section>
        <aside className="flex max-h-[80dvh] w-full shrink-0 flex-col border-t bg-white shadow-sm lg:sticky lg:top-16 lg:max-h-[calc(100dvh-64px)] lg:w-[365px] lg:border-l lg:border-t-0" aria-label="Report details and filters">
          <div className="border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{panel === "filters" ? "Filters" : tab === "ai" ? "AI Writing" : `${scoreText} Overall Similarity`}</h2>
              {panel !== "filters" && tab === "similarity" ? (
                <button type="button" onClick={() => { setDraft(cleanFilters(savedFilters)); setPanel("filters"); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium hover:bg-slate-200">
                  <Filter className="h-3.5 w-3.5" /> Filters
                </button>
              ) : null}
            </div>
            {panel === "filters" ? (
              <button type="button" className="mt-2 text-xs font-semibold text-blue-700 hover:underline" onClick={() => { setPanel("sources"); setDraft(null); }}>← Back to Similarity Report</button>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                {tab === "ai" ? "AI detection results remain unchanged by similarity filters." : `${active.length} visible matching text blocks`}
              </p>
            )}
            {previewDiffers ? <p className="mt-1 text-xs text-amber-700">≈ indicates a preview estimate. The downloaded PDF uses Originality.report's applied filters.</p> : null}
          </div>
          {panel === "filters" && draft ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <FilterControls filters={draft} setFilters={setDraft} />
                {filtersChanged ? <p className="mt-4 text-xs text-teal-700">Changes are previewed; click Apply Filters to save.</p> : null}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-white p-3">
                <button type="button" onClick={() => { setPanel("sources"); setDraft(null); }} disabled={updating} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Cancel</button>
                <button type="button" onClick={() => void saveFilters()} disabled={!filtersChanged || !draft.collections.length || updating}
                  className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {updating ? "Applying…" : "Apply Filters"}
                </button>
              </div>
            </>
          ) : tab === "ai" ? (
            <div className="px-5 py-5 text-sm text-slate-600">AI writing score: <strong>{data.aiPercentage == null ? "Not available" : Math.round(data.aiPercentage) + "%"}</strong>. Download the AI report from Check History for full details.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 border-b p-3">
                <button type="button" onClick={() => setPanel("match_groups")} className={`rounded-lg px-2 py-2 text-sm ${panel === "match_groups" ? "bg-blue-100 font-semibold text-blue-800" : "border"}`}>Match groups</button>
                <button type="button" onClick={() => setPanel("sources")} className={`rounded-lg px-2 py-2 text-sm ${panel === "sources" ? "bg-blue-100 font-semibold text-blue-800" : "border"}`}>Sources</button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {panel === "sources" ? data.similarity.sources.filter((s: Source) => previewMatches.some(m => m.source.index === s.index)).map((source: Source) => {
                  const matches = previewMatches.filter(m => m.source.index === source.index);
                  return <button key={source.index} type="button" onClick={() => document.getElementById(`turnitin-page-${matches[0]?.match.page ?? 0}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="w-full rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-primary/50">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <span className="rounded px-2 py-1 text-white" style={{backgroundColor:palette[Math.max(0,source.index)%palette.length]}}>{source.number || source.index + 1}</span>
                      <span className="rounded bg-slate-100 px-2 py-1 font-normal capitalize text-slate-700">{source.collection.replace("_", " ")}</span>
                      <span className="ml-auto">{Math.round(source.percent)}%</span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">{source.linkText || source.url || "Matching source"}</div>
                    <div className="mt-1 text-xs text-slate-500">{matches.length} text blocks · {matches.reduce((n,m) => n + m.match.words,0)} matched words</div>
                  </button>;
                }) : Object.entries(groupNames).map(([key, label]) => {
                  const matches = previewMatches.filter(({ match }) => match.group === key);
                  return <div key={key} className="rounded-xl border bg-white p-3">
                    <div className="flex items-center justify-between text-sm font-semibold"><span>{label}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{matches.length}</span></div>
                    {matches.length ? <button type="button" onClick={() => document.getElementById(`turnitin-page-${matches[0].match.page}`)?.scrollIntoView({ behavior: "smooth" })}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"><Eye className="h-3.5 w-3.5" /> Go to first match <ChevronDown className="h-3 w-3" /></button> : <p className="mt-2 text-xs text-slate-500">No visible matches.</p>}
                  </div>;
                })}
                {!previewMatches.length ? <p className="py-8 text-center text-sm text-slate-500">No sources match the selected filters.</p> : null}
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
