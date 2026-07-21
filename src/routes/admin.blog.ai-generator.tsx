import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { BlogAdminNav } from "@/components/blog/BlogAdminNav";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { listCategories } from "@/lib/blog.functions";
import {
  generateArticle,
  getAiSettings,
  updateAiSettings,
  type GeneratedArticle,
} from "@/lib/ai-article.functions";

const settingsQ = queryOptions({
  queryKey: ["ai", "settings"],
  queryFn: () => getAiSettings(),
});
const catsQ = queryOptions({
  queryKey: ["blog", "categories"],
  queryFn: () => listCategories(),
});

export const Route = createFileRoute("/admin/blog/ai-generator")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "AI Article Generator — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(settingsQ),
      context.queryClient.ensureQueryData(catsQ),
    ]),
  component: AiGeneratorPage,
});

/* ------------- shared UI atoms ------------- */

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/* ------------- component ------------- */

const TONES = [
  "Informative",
  "Conversational",
  "Authoritative",
  "Friendly",
  "Persuasive",
  "Formal",
  "Playful",
];
const READING_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];
const WRITING_STYLES = ["Blog", "Journalistic", "How-to guide", "Listicle", "Case study", "Editorial"];
const LENGTHS = [
  "Short (600-900 words)",
  "Medium (1200-1500 words)",
  "Long (2000-2500 words)",
  "In-depth (3000+ words)",
];
const INTENTS = ["Informational", "Commercial", "Transactional", "Navigational"];
const AUDIENCES = [
  "General readers",
  "Beginners",
  "Marketers",
  "Students",
  "Business owners",
  "Developers",
  "Content creators",
];

function AiGeneratorPage() {
  const { data: settingsData } = useSuspenseQuery(settingsQ);
  const { data: catsData } = useSuspenseQuery(catsQ);
  const qc = useQueryClient();
  const router = useRouter();

  const saveSettings = useServerFn(updateAiSettings);
  const runGenerate = useServerFn(generateArticle);

  const s = settingsData.settings!;
  const [tab, setTab] = useState<"quick" | "advanced" | "settings">("quick");
  const [result, setResult] = useState<GeneratedArticle | null>(null);

  /* provider settings form state */
  const [prov, setProv] = useState({
    provider: s.provider as "openai" | "google" | "anthropic",
    model: s.model,
    default_language: s.default_language,
    default_country: s.default_country ?? "",
    default_tone: s.default_tone,
    default_audience: s.default_audience,
    default_reading_level: s.default_reading_level,
    default_writing_style: s.default_writing_style,
    default_length: s.default_length,
    brand_voice: s.brand_voice ?? "",
    brand_name: (s as any).brand_name ?? "Top Rated SEO Tools",
    brand_url: (s as any).brand_url ?? "https://topratedseotools.lovable.app",
    brand_description:
      (s as any).brand_description ??
      "Affordable access to premium SEO, AI, writing, research and productivity tools with Shared and Private Access plans (monthly, quarterly, yearly) via secure Paystack payments and a simple customer dashboard.",
    promo_position: Number((s as any).promo_position ?? 1),
    promo_tone: (s as any).promo_tone ?? "Natural, professional and persuasive",
    promo_enabled: (s as any).promo_enabled !== false,
  });

  const providerCatalog = settingsData.catalog;
  const currentProvMeta = providerCatalog.find((p) => p.id === prov.provider);

  const settingsMut = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      toast.success("AI settings saved");
      qc.invalidateQueries({ queryKey: ["ai", "settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  /* Quick form */
  const [quick, setQuick] = useState({
    keyword: "",
    language: s.default_language,
    country: s.default_country ?? "",
    save: "draft" as "none" | "draft" | "published",
    category_id: "",
  });

  /* Advanced form */
  const [adv, setAdv] = useState({
    keyword: "",
    secondary_keywords: "",
    tone: s.default_tone,
    audience: s.default_audience,
    reading_level: s.default_reading_level,
    length: s.default_length,
    writing_style: s.default_writing_style,
    country: s.default_country ?? "",
    language: s.default_language,
    search_intent: "Informational",
    brand_voice: s.brand_voice ?? "",
    number_of_headings: 8,
    include_tables: true,
    include_lists: true,
    include_examples: true,
    include_statistics: true,
    include_case_studies: false,
    include_faq: true,
    include_cta: true,
    include_conclusion: true,
    save: "draft" as "none" | "draft" | "published",
    category_id: "",
  });

  const genMut = useMutation({
    mutationFn: runGenerate,
    onSuccess: (res) => {
      setResult(res.article);
      toast.success(
        res.post_id ? "Article generated and saved" : "Article generated",
      );
      if (res.post_id) {
        qc.invalidateQueries({ queryKey: ["blog"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });

  function runQuick() {
    if (!quick.keyword.trim()) return toast.error("Enter a main keyword");
    genMut.mutate({
      data: {
        mode: "quick",
        keyword: quick.keyword.trim(),
        language: quick.language,
        country: quick.country || null,
        save: quick.save,
        category_id: quick.category_id || null,
      },
    });
  }

  function runAdvanced() {
    if (!adv.keyword.trim()) return toast.error("Enter a main keyword");
    genMut.mutate({
      data: {
        mode: "advanced",
        keyword: adv.keyword.trim(),
        secondary_keywords: adv.secondary_keywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        tone: adv.tone,
        audience: adv.audience,
        reading_level: adv.reading_level,
        length: adv.length,
        writing_style: adv.writing_style,
        country: adv.country || null,
        language: adv.language,
        search_intent: adv.search_intent,
        brand_voice: adv.brand_voice || undefined,
        number_of_headings: adv.number_of_headings,
        include_tables: adv.include_tables,
        include_lists: adv.include_lists,
        include_examples: adv.include_examples,
        include_statistics: adv.include_statistics,
        include_case_studies: adv.include_case_studies,
        include_faq: adv.include_faq,
        include_cta: adv.include_cta,
        include_conclusion: adv.include_conclusion,
        save: adv.save,
        category_id: adv.category_id || null,
      },
    });
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">AI Article Generator</h1>
            <p className="text-sm text-muted-foreground">
              Provider: <span className="font-medium">{currentProvMeta?.label ?? s.provider}</span>{" "}
              · Model: <span className="font-mono text-xs">{s.model}</span>
            </p>
          </div>
        </div>
        <div className="mt-6">
          <BlogAdminNav />
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2 border-b">
          {(["quick", "advanced", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize " +
                (tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t === "settings" ? "Provider Settings" : `${t} mode`}
            </button>
          ))}
        </div>

        {/* Quick mode */}
        {tab === "quick" && (
          <div className="mt-6 grid gap-4 rounded-2xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Enter a main keyword — everything else is generated automatically using the current
              provider defaults.
            </p>
            <Field label="Main keyword *">
              <input
                value={quick.keyword}
                onChange={(e) => setQuick({ ...quick, keyword: e.target.value })}
                placeholder="e.g. how to check plagiarism online"
                className={inputCls}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Language">
                <input
                  value={quick.language}
                  onChange={(e) => setQuick({ ...quick, language: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Country (optional)">
                <input
                  value={quick.country}
                  onChange={(e) => setQuick({ ...quick, country: e.target.value })}
                  placeholder="e.g. Nigeria, United States"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="After generation">
                <select
                  value={quick.save}
                  onChange={(e) =>
                    setQuick({ ...quick, save: e.target.value as typeof quick.save })
                  }
                  className={inputCls}
                >
                  <option value="draft">Save as draft</option>
                  <option value="published">Publish immediately</option>
                  <option value="none">Preview only (don't save)</option>
                </select>
              </Field>
              <Field label="Category (optional)">
                <select
                  value={quick.category_id}
                  onChange={(e) => setQuick({ ...quick, category_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— none —</option>
                  {catsData.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div>
              <button
                onClick={runQuick}
                disabled={genMut.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {genMut.isPending ? "Generating…" : "Generate article"}
              </button>
            </div>
          </div>
        )}

        {/* Advanced mode */}
        {tab === "advanced" && (
          <div className="mt-6 grid gap-4 rounded-2xl border bg-card p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Main keyword *">
                <input
                  value={adv.keyword}
                  onChange={(e) => setAdv({ ...adv, keyword: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Secondary keywords" hint="Comma-separated">
                <input
                  value={adv.secondary_keywords}
                  onChange={(e) => setAdv({ ...adv, secondary_keywords: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Tone">
                <select
                  value={adv.tone}
                  onChange={(e) => setAdv({ ...adv, tone: e.target.value })}
                  className={inputCls}
                >
                  {TONES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Audience">
                <select
                  value={adv.audience}
                  onChange={(e) => setAdv({ ...adv, audience: e.target.value })}
                  className={inputCls}
                >
                  {AUDIENCES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reading level">
                <select
                  value={adv.reading_level}
                  onChange={(e) => setAdv({ ...adv, reading_level: e.target.value })}
                  className={inputCls}
                >
                  {READING_LEVELS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Article length">
                <select
                  value={adv.length}
                  onChange={(e) => setAdv({ ...adv, length: e.target.value })}
                  className={inputCls}
                >
                  {LENGTHS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Writing style">
                <select
                  value={adv.writing_style}
                  onChange={(e) => setAdv({ ...adv, writing_style: e.target.value })}
                  className={inputCls}
                >
                  {WRITING_STYLES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Search intent">
                <select
                  value={adv.search_intent}
                  onChange={(e) => setAdv({ ...adv, search_intent: e.target.value })}
                  className={inputCls}
                >
                  {INTENTS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Language">
                <input
                  value={adv.language}
                  onChange={(e) => setAdv({ ...adv, language: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Country">
                <input
                  value={adv.country}
                  onChange={(e) => setAdv({ ...adv, country: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Number of headings" hint="H2 sections in the outline">
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={adv.number_of_headings}
                  onChange={(e) =>
                    setAdv({ ...adv, number_of_headings: Number(e.target.value) || 8 })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Brand voice (optional)">
                <input
                  value={adv.brand_voice}
                  onChange={(e) => setAdv({ ...adv, brand_voice: e.target.value })}
                  placeholder="e.g. warm, expert, no hype"
                  className={inputCls}
                />
              </Field>
            </div>

            <fieldset className="grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-4">
              <legend className="px-2 text-xs font-medium text-muted-foreground">
                Include in article
              </legend>
              {(
                [
                  ["include_tables", "Tables"],
                  ["include_lists", "Lists"],
                  ["include_examples", "Examples"],
                  ["include_statistics", "Statistics"],
                  ["include_case_studies", "Case studies"],
                  ["include_faq", "FAQ"],
                  ["include_cta", "CTA"],
                  ["include_conclusion", "Conclusion"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={adv[k]}
                    onChange={(e) => setAdv({ ...adv, [k]: e.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="After generation">
                <select
                  value={adv.save}
                  onChange={(e) => setAdv({ ...adv, save: e.target.value as typeof adv.save })}
                  className={inputCls}
                >
                  <option value="draft">Save as draft</option>
                  <option value="published">Publish immediately</option>
                  <option value="none">Preview only (don't save)</option>
                </select>
              </Field>
              <Field label="Category (optional)">
                <select
                  value={adv.category_id}
                  onChange={(e) => setAdv({ ...adv, category_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— none —</option>
                  {catsData.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <button
                onClick={runAdvanced}
                disabled={genMut.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {genMut.isPending ? "Generating…" : "Generate article"}
              </button>
            </div>
          </div>
        )}

        {/* Settings tab */}
        {tab === "settings" && (
          <div className="mt-6 grid gap-4 rounded-2xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Choose which AI provider generates articles and set global defaults. New providers can
              be added by dropping an adapter in <code>src/lib/ai-providers/</code>.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <select
                  value={prov.provider}
                  onChange={(e) => {
                    const id = e.target.value as typeof prov.provider;
                    const meta = providerCatalog.find((p) => p.id === id);
                    setProv({ ...prov, provider: id, model: meta?.defaultModel ?? prov.model });
                  }}
                  className={inputCls}
                >
                  {providerCatalog.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} {p.configured ? "" : "— not configured"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model">
                <select
                  value={prov.model}
                  onChange={(e) => setProv({ ...prov, model: e.target.value })}
                  className={inputCls}
                >
                  {(currentProvMeta?.models ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              {currentProvMeta && !currentProvMeta.configured && (
                <p className="sm:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  {currentProvMeta.id === "anthropic"
                    ? "Anthropic Claude needs an ANTHROPIC_API_KEY. Add it in backend secrets to enable this provider."
                    : `${currentProvMeta.label} is not currently configured.`}
                </p>
              )}

              <Field label="Default language">
                <input
                  value={prov.default_language}
                  onChange={(e) => setProv({ ...prov, default_language: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Default country">
                <input
                  value={prov.default_country}
                  onChange={(e) => setProv({ ...prov, default_country: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Default tone">
                <select
                  value={prov.default_tone}
                  onChange={(e) => setProv({ ...prov, default_tone: e.target.value })}
                  className={inputCls}
                >
                  {TONES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default audience">
                <select
                  value={prov.default_audience}
                  onChange={(e) => setProv({ ...prov, default_audience: e.target.value })}
                  className={inputCls}
                >
                  {AUDIENCES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default reading level">
                <select
                  value={prov.default_reading_level}
                  onChange={(e) => setProv({ ...prov, default_reading_level: e.target.value })}
                  className={inputCls}
                >
                  {READING_LEVELS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default writing style">
                <select
                  value={prov.default_writing_style}
                  onChange={(e) => setProv({ ...prov, default_writing_style: e.target.value })}
                  className={inputCls}
                >
                  {WRITING_STYLES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default length">
                <select
                  value={prov.default_length}
                  onChange={(e) => setProv({ ...prov, default_length: e.target.value })}
                  className={inputCls}
                >
                  {LENGTHS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Brand voice (optional)">
                <input
                  value={prov.brand_voice}
                  onChange={(e) => setProv({ ...prov, brand_voice: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="mt-2 rounded-xl border bg-muted/30 p-4">
              <h3 className="text-sm font-semibold">Brand promotion</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                When the article topic is relevant (SEO / AI / writing / marketing tools, group buying,
                subscription platforms, comparisons), the generator features this brand naturally and
                prominently — usually in the position below.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Brand name">
                  <input
                    value={prov.brand_name}
                    onChange={(e) => setProv({ ...prov, brand_name: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Website URL">
                  <input
                    value={prov.brand_url}
                    onChange={(e) => setProv({ ...prov, brand_url: e.target.value })}
                    placeholder="https://…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Default promotional position" hint="1 = first in list articles">
                  <select
                    value={String(prov.promo_position)}
                    onChange={(e) => setProv({ ...prov, promo_position: Number(e.target.value) })}
                    className={inputCls}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        Position {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Promotional tone">
                  <input
                    value={prov.promo_tone}
                    onChange={(e) => setProv({ ...prov, promo_tone: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Short brand description" hint="Only mention features that exist on the platform">
                  <textarea
                    value={prov.brand_description}
                    onChange={(e) => setProv({ ...prov, brand_description: e.target.value })}
                    rows={3}
                    className={inputCls}
                  />
                </Field>
                <Field label="Enable brand promotion">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={prov.promo_enabled}
                      onChange={(e) => setProv({ ...prov, promo_enabled: e.target.checked })}
                    />
                    <span>Feature the brand in relevant articles</span>
                  </label>
                </Field>
              </div>
            </div>

            <div>
              <button
                onClick={() => {
                  const url = prov.brand_url.trim();
                  if (prov.promo_enabled && !/^https?:\/\/.+/i.test(url)) {
                    toast.error("Brand URL must be a full http(s) URL");
                    return;
                  }
                  settingsMut.mutate({
                    data: {
                      id: s.id,
                      provider: prov.provider,
                      model: prov.model,
                      default_language: prov.default_language,
                      default_country: prov.default_country || null,
                      default_tone: prov.default_tone,
                      default_audience: prov.default_audience,
                      default_reading_level: prov.default_reading_level,
                      default_writing_style: prov.default_writing_style,
                      default_length: prov.default_length,
                      brand_voice: prov.brand_voice || null,
                      brand_name: prov.brand_name.trim() || "Top Rated SEO Tools",
                      brand_url: url,
                      brand_description: prov.brand_description.trim(),
                      promo_position: prov.promo_position,
                      promo_tone: prov.promo_tone.trim() || "Natural, professional and persuasive",
                      promo_enabled: prov.promo_enabled,
                    },
                  });
                }}
                disabled={settingsMut.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {settingsMut.isPending ? "Saving…" : "Save AI settings"}
              </button>
            </div>
          </div>
        )}


        {/* Result */}
        {result && (
          <div className="mt-8 rounded-2xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Generated: {result.title}</h2>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.content);
                  toast.success("Markdown copied");
                }}
                className="rounded-md border px-3 py-1.5 text-xs"
              >
                Copy Markdown
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Slug: <span className="font-mono">{result.slug}</span> · Tags:{" "}
              {result.tags.join(", ") || "—"}
            </p>
            {result.excerpt && (
              <p className="mt-3 text-sm text-muted-foreground">{result.excerpt}</p>
            )}
            {result.semantic_keywords && result.semantic_keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {result.semantic_keywords.map((k) => (
                  <span key={k} className="rounded-full border bg-primary/10 px-2 py-0.5 text-xs">
                    {k}
                  </span>
                ))}
              </div>
            )}
            {result.faq && result.faq.length > 0 && (
              <details className="mt-3 rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">FAQ ({result.faq.length})</summary>
                <ul className="mt-2 space-y-2">
                  {result.faq.map((q, i) => (
                    <li key={i}>
                      <p className="font-medium">{q.question}</p>
                      <p className="text-muted-foreground">{q.answer}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <pre className="mt-4 max-h-[500px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs">
              {result.content}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => router.navigate({ to: "/admin/blog" })}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                Open Posts
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
