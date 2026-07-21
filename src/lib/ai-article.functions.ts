/**
 * AI Article Generator — server functions.
 *
 * Generates SEO-rich articles with:
 * - Semantic keywords (3-5) researched from search intent
 * - FAQ Q&A (3-5) from the same intent
 * - Full SEO metadata (canonical, OG, Twitter, image alts)
 * - Auto internal linking to tools/pricing/categories/related posts
 * - Best-fit CTA selection from admin templates
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { estimateReadingTime, slugify } from "@/lib/blog-text";
import { getProvider, providerCatalog } from "@/lib/ai-providers/registry";
import { sanitizeGeminiModel, isValidGeminiModel } from "@/lib/ai-providers/google";
import {
  detectToolSlugs,
  injectInternalLinks,
  selectBestCta,
  type CtaTemplate,
} from "@/lib/blog-seo";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/* ---------------- settings ---------------- */

export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_generator_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { settings: data, catalog: providerCatalog() };
  });

const settingsSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum(["openai", "google", "anthropic"]),
  model: z.string().min(1),
  default_language: z.string().min(1),
  default_country: z.string().nullable().optional(),
  default_tone: z.string().min(1),
  default_audience: z.string().min(1),
  default_reading_level: z.string().min(1),
  default_writing_style: z.string().min(1),
  default_length: z.string().min(1),
  brand_voice: z.string().nullable().optional(),
  brand_name: z.string().trim().min(1).max(120).optional(),
  brand_url: z.string().trim().url().max(300).optional(),
  brand_description: z.string().trim().max(600).optional(),
  promo_position: z.number().int().min(1).max(5).optional(),
  promo_tone: z.string().trim().min(1).max(200).optional(),
  promo_enabled: z.boolean().optional(),
});

export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Sanitize + validate the model against the provider's allowlist so no
    // malformed value (URL, quotes, whitespace, `models/` or `google/` prefix)
    // ever reaches the API.
    let model = String(data.model ?? "").trim();
    if (data.provider === "google") {
      const clean = sanitizeGeminiModel(model);
      if (!clean || !isValidGeminiModel(clean)) {
        throw new Error(
          `Invalid Gemini model "${data.model}". Pick a supported model from the list.`,
        );
      }
      model = clean;
    } else {
      // Basic hygiene for other providers.
      model = model.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
      if (!model) throw new Error("Model is required.");
    }

    const { data: existing } = await context.supabase
      .from("ai_generator_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    const payload: Record<string, unknown> = {
      provider: data.provider,
      model,
      default_language: data.default_language,
      default_country: data.default_country ?? null,
      default_tone: data.default_tone,
      default_audience: data.default_audience,
      default_reading_level: data.default_reading_level,
      default_writing_style: data.default_writing_style,
      default_length: data.default_length,
      brand_voice: data.brand_voice ?? null,
    };
    if (data.brand_name !== undefined) payload.brand_name = data.brand_name;
    if (data.brand_url !== undefined) payload.brand_url = data.brand_url;
    if (data.brand_description !== undefined) payload.brand_description = data.brand_description;
    if (data.promo_position !== undefined) payload.promo_position = data.promo_position;
    if (data.promo_tone !== undefined) payload.promo_tone = data.promo_tone;
    if (data.promo_enabled !== undefined) payload.promo_enabled = data.promo_enabled;
    if (existing) {
      const { error } = await context.supabase
        .from("ai_generator_settings")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("ai_generator_settings")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

/* ---------------- generation ---------------- */

const generateSchema = z.object({
  mode: z.enum(["quick", "advanced"]),
  keyword: z.string().min(2),
  language: z.string().optional(),
  country: z.string().optional().nullable(),
  secondary_keywords: z.array(z.string()).optional(),
  tone: z.string().optional(),
  audience: z.string().optional(),
  reading_level: z.string().optional(),
  length: z.string().optional(),
  writing_style: z.string().optional(),
  search_intent: z.string().optional(),
  brand_voice: z.string().optional(),
  number_of_headings: z.number().int().min(3).max(20).optional(),
  include_tables: z.boolean().optional(),
  include_lists: z.boolean().optional(),
  include_examples: z.boolean().optional(),
  include_statistics: z.boolean().optional(),
  include_case_studies: z.boolean().optional(),
  include_faq: z.boolean().optional(),
  include_cta: z.boolean().optional(),
  include_conclusion: z.boolean().optional(),
  save: z.enum(["none", "draft", "published"]).default("none"),
  category_id: z.string().uuid().nullable().optional(),
});

export type GenerateInput = z.infer<typeof generateSchema>;

export interface FaqItem {
  question: string;
  answer: string;
}

export interface GeneratedArticle {
  title: string;
  slug: string;
  excerpt: string;
  seo_title: string;
  seo_description: string;
  content: string;
  tags: string[];
  semantic_keywords: string[];
  faq: FaqItem[];
  og_title: string;
  og_description: string;
  twitter_title: string;
  twitter_description: string;
  featured_image_alt: string;
  image_alts: Record<string, string>;
  cta_template_id: string | null;
  detected_tool_slugs: string[];
}

function buildSystemPrompt() {
  return [
    "You are an elite SEO content strategist, semantic-search expert, and long-form writer.",
    "You research search intent using knowledge of Google Autocomplete, People Also Ask (PAA), and People Also Search For (PASF) patterns.",
    "Produce natural, human-sounding, plagiarism-free articles that read like a subject-matter expert wrote them.",
    "Avoid AI clichés ('in today's fast-paced world', 'delve into', 'unlock the power of', 'in conclusion').",
    "Vary sentence length. Use concrete details and real-world examples.",
    "Use proper Markdown: # for the H1, ## for major sections, ### for sub-sections.",
    "Never wrap the whole answer in triple backticks. Only fence real code blocks.",
    "Return ONLY minified JSON matching the requested schema — no prose, no code fences.",
  ].join(" ");
}

function buildUserPrompt(opts: {
  keyword: string;
  secondary: string[];
  language: string;
  country: string | null;
  tone: string;
  audience: string;
  readingLevel: string;
  length: string;
  writingStyle: string;
  searchIntent: string;
  brandVoice: string;
  headings: number;
  includeTables: boolean;
  includeLists: boolean;
  includeExamples: boolean;
  includeStats: boolean;
  includeCaseStudies: boolean;
  includeFaq: boolean;
  includeConclusion: boolean;
}) {
  const req: string[] = [
    `Write an SEO-optimized article about: "${opts.keyword}".`,
    `Language: ${opts.language}.` + (opts.country ? ` Target country: ${opts.country}.` : ""),
    `Tone: ${opts.tone}. Audience: ${opts.audience}. Reading level: ${opts.readingLevel}.`,
    `Writing style: ${opts.writingStyle}. Search intent: ${opts.searchIntent}.`,
    `Target length: ${opts.length}.`,
    `Use ${opts.headings} well-crafted H2/H3 sections with logical hierarchy.`,
  ];
  if (opts.secondary.length)
    req.push(`Naturally weave in these secondary keywords: ${opts.secondary.join(", ")}.`);
  if (opts.brandVoice) req.push(`Brand voice: ${opts.brandVoice}.`);

  req.push("");
  req.push("SEMANTIC SEO — CRITICAL:");
  req.push(
    "- Research the topic's semantic field using Google Autocomplete, People Also Ask, and People Also Search For patterns.",
  );
  req.push(
    "- Select 3-5 semantic keywords/phrases (NOT the main keyword; NOT duplicates of secondary keywords). Prefer ones with genuine user demand.",
  );
  req.push(
    "- Naturally integrate EACH semantic keyword into the article body at least once (not stuffed).",
  );
  req.push(
    "- Also generate 3-5 FAQ questions that reflect the same search intent (People Also Ask style). FAQ questions do NOT count as semantic keywords unless those exact terms also appear naturally in the body.",
  );

  req.push("");
  req.push("ARTICLE STRUCTURE:");
  req.push("- A compelling introduction that hooks the reader (no meta preamble).");
  req.push("- Proper heading hierarchy (# H1, ## H2, ### H3).");
  if (opts.includeExamples) req.push("- Concrete, relatable examples woven into sections.");
  if (opts.includeTables) req.push("- At least one useful Markdown table.");
  if (opts.includeLists) req.push("- Well-formatted lists where they add clarity.");
  req.push("- A 'Pros and Cons' section unless clearly irrelevant.");
  req.push("- A 'Tips' section with 4-7 actionable, non-obvious tips.");
  if (opts.includeStats) req.push("- Credible statistics presented plainly (do NOT invent citations).");
  if (opts.includeCaseStudies) req.push("- A brief case-study style example.");
  if (opts.includeFaq)
    req.push("- An '## FAQ' section rendering ALL the FAQ questions/answers you generate.");
  if (opts.includeConclusion) req.push("- A conclusion that summarises without saying 'in conclusion'.");
  req.push("Write ORIGINAL prose; do not invent quotes or specific citations.");

  req.push("");
  req.push("Output ONLY a JSON object with this EXACT shape (no code fence, no extra text):");
  req.push(
    JSON.stringify({
      title: "SEO-friendly H1 title, <= 70 chars",
      slug: "kebab-case slug",
      excerpt: "140-180 chars, no marketing fluff",
      seo_title: "<= 60 chars, includes primary keyword",
      seo_description: "<= 160 chars, actionable",
      og_title: "<= 65 chars social title",
      og_description: "<= 200 chars social description",
      twitter_title: "<= 65 chars twitter title",
      twitter_description: "<= 200 chars twitter description",
      featured_image_alt: "descriptive alt text for the featured image",
      semantic_keywords: ["3-5 semantic phrases"],
      faq: [{ question: "PAA-style question", answer: "concise answer (40-80 words)" }],
      tags: ["3-8 short topical tags"],
      content: "the FULL article in Markdown, starting with the # H1",
    }),
  );
  return req.join("\n");
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* noop */
      }
    }
    throw new Error("AI output was not valid JSON");
  }
}

/** Extract image URLs from a markdown body. */
function extractImageUrls(md: string): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) urls.push(m[1]);
  return urls;
}

/** Ensure every image in the markdown has non-empty alt text; fills gaps from map or fallback. */
function backfillImageAlts(md: string, alts: Record<string, string>, fallback: string): string {
  return md.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (_all, alt, url, tail) => {
    const clean = String(alt).trim();
    if (clean) return `![${clean}](${url}${tail})`;
    const a = alts[url] || fallback || "Illustration";
    return `![${a}](${url}${tail})`;
  });
}

export const generateArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: settings } = await context.supabase
      .from("ai_generator_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!settings) throw new Error("AI generator not configured. Open Settings first.");

    const provider = getProvider(settings.provider);
    if (!provider.isConfigured()) {
      throw new Error(
        provider.id === "anthropic"
          ? "Anthropic is selected but ANTHROPIC_API_KEY is not set."
          : provider.id === "openai"
            ? "OpenAI is selected but OPENAI_API_KEY is not set."
            : "Google Gemini is selected but GOOGLE_GEMINI_API_KEY is not set.",
      );
    }

    const opts = {
      keyword: data.keyword.trim(),
      secondary: data.secondary_keywords?.filter(Boolean) ?? [],
      language: data.language || settings.default_language,
      country: (data.country ?? settings.default_country) || null,
      tone: data.tone || settings.default_tone,
      audience: data.audience || settings.default_audience,
      readingLevel: data.reading_level || settings.default_reading_level,
      length: data.length || settings.default_length,
      writingStyle: data.writing_style || settings.default_writing_style,
      searchIntent: data.search_intent || "Informational",
      brandVoice: data.brand_voice || settings.brand_voice || "",
      headings: data.number_of_headings ?? 8,
      includeTables: data.include_tables ?? true,
      includeLists: data.include_lists ?? true,
      includeExamples: data.include_examples ?? true,
      includeStats: data.include_statistics ?? true,
      includeCaseStudies: data.include_case_studies ?? false,
      includeFaq: data.include_faq ?? true,
      includeConclusion: data.include_conclusion ?? true,
    };

    let raw: string;
    try {
      raw = await provider.complete({
        model: settings.model,
        system: buildSystemPrompt(),
        user: buildUserPrompt(opts),
        temperature: 0.75,
        maxTokens: 8000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ai-article] provider.complete failed", {
        provider: provider.id,
        model: settings.model,
        error: msg,
      });
      if (msg.startsWith("AI_PROVIDER_NOT_CONFIGURED")) {
        throw new Error(
          "The AI provider is not configured correctly. Please check the model settings or contact Admin.",
        );
      }
      if (msg.startsWith("AI_RATE_LIMITED")) {
        throw new Error("The AI provider is temporarily rate-limited. Please try again shortly.");
      }
      if (msg.startsWith("AI_PROVIDER_ERROR")) {
        throw new Error("The AI provider could not generate the article right now. Please try again.");
      }
      throw new Error("The AI provider could not generate the article right now. Please try again.");
    }

    const parsed = tryParseJson(raw) as Partial<GeneratedArticle> & {
      faq?: FaqItem[];
      semantic_keywords?: string[];
    };
    if (!parsed || typeof parsed !== "object" || !parsed.title || !parsed.content) {
      throw new Error("AI output missing required fields (title/content).");
    }

    let content = String(parsed.content);
    const title = String(parsed.title).trim();

    // ---- Fetch category + related posts for internal linking + CTA context.
    let category: { name: string; slug: string } | null = null;
    if (data.category_id) {
      const { data: catRow } = await context.supabase
        .from("blog_categories")
        .select("name,slug")
        .eq("id", data.category_id)
        .maybeSingle();
      if (catRow) category = { name: catRow.name, slug: catRow.slug };
    }
    const { data: relatedRows } = await context.supabase
      .from("blog_posts")
      .select("title,slug")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(20);
    const related = (relatedRows ?? []).slice(0, 5);

    // ---- Auto internal linking (capped, natural).
    content = injectInternalLinks(content, { related, category, max: 6 });

    // ---- Backfill missing image alt text
    const imageAlts = (parsed.image_alts as Record<string, string> | undefined) ?? {};
    const featuredAlt = parsed.featured_image_alt
      ? String(parsed.featured_image_alt).slice(0, 200)
      : title;
    content = backfillImageAlts(content, imageAlts, featuredAlt);
    const finalImageAlts: Record<string, string> = { ...imageAlts };
    for (const url of extractImageUrls(content)) {
      if (!finalImageAlts[url]) finalImageAlts[url] = featuredAlt;
    }

    // ---- Detect referenced tools and select best CTA.
    const detectedToolSlugs = detectToolSlugs(content);
    let cta_template_id: string | null = null;
    if (data.include_cta !== false) {
      const { data: ctas } = await context.supabase
        .from("blog_cta_templates" as never)
        .select("*")
        .eq("enabled", true);
      const best = selectBestCta((ctas ?? []) as unknown as CtaTemplate[], {
        toolSlugs: detectedToolSlugs,
        categorySlug: category?.slug ?? null,
        text: content,
      });
      cta_template_id = best?.id ?? null;
    }

    const semantic_keywords = Array.isArray(parsed.semantic_keywords)
      ? parsed.semantic_keywords
          .slice(0, 5)
          .map((k) => String(k).trim())
          .filter(Boolean)
      : [];
    const faq: FaqItem[] = Array.isArray(parsed.faq)
      ? parsed.faq
          .slice(0, 6)
          .map((f) => ({
            question: String(f.question ?? "").trim(),
            answer: String(f.answer ?? "").trim(),
          }))
          .filter((f) => f.question && f.answer)
      : [];

    const article: GeneratedArticle = {
      title,
      slug: (parsed.slug ? String(parsed.slug) : slugify(title)).slice(0, 120),
      excerpt: parsed.excerpt ? String(parsed.excerpt).slice(0, 300) : "",
      seo_title: parsed.seo_title ? String(parsed.seo_title).slice(0, 70) : title.slice(0, 70),
      seo_description: parsed.seo_description ? String(parsed.seo_description).slice(0, 180) : "",
      og_title: parsed.og_title ? String(parsed.og_title).slice(0, 90) : title.slice(0, 90),
      og_description: parsed.og_description
        ? String(parsed.og_description).slice(0, 220)
        : (parsed.excerpt ? String(parsed.excerpt).slice(0, 220) : ""),
      twitter_title: parsed.twitter_title
        ? String(parsed.twitter_title).slice(0, 90)
        : title.slice(0, 90),
      twitter_description: parsed.twitter_description
        ? String(parsed.twitter_description).slice(0, 220)
        : (parsed.excerpt ? String(parsed.excerpt).slice(0, 220) : ""),
      featured_image_alt: featuredAlt,
      content,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10).map((t) => String(t)) : [],
      semantic_keywords,
      faq,
      image_alts: finalImageAlts,
      cta_template_id,
      detected_tool_slugs: detectedToolSlugs,
    };

    // ---- Optional persistence
    let post_id: string | null = null;
    if (data.save === "draft" || data.save === "published") {
      const status = data.save;
      const publishedAt = status === "published" ? new Date().toISOString() : null;
      const readingTime = estimateReadingTime(article.content);
      const canonicalUrl = `https://topratedseotools.lovable.app/blog/${article.slug}`;
      const { data: inserted, error } = await (context.supabase as any)
        .from("blog_posts")
        .insert({
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt || null,
          content: article.content,
          category_id: data.category_id ?? null,
          author_id: context.userId,
          status,
          published_at: publishedAt,
          is_featured: false,
          reading_time_minutes: readingTime,
          seo_title: article.seo_title || null,
          seo_description: article.seo_description || null,
          canonical_url: canonicalUrl,
          og_title: article.og_title,
          og_description: article.og_description,
          twitter_title: article.twitter_title,
          twitter_description: article.twitter_description,
          semantic_keywords: article.semantic_keywords,
          faq: article.faq,
          image_alts: article.image_alts,
          cta_template_id: article.cta_template_id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      post_id = inserted.id as string;
    }

    return { article, post_id, used: { provider: provider.id, model: settings.model } };
  });
