/**
 * AI Article Generator — server functions.
 *
 * Providers are pluggable via `src/lib/ai-providers/registry.ts`.
 * Persistence reuses the same `blog_posts` shape as manual posts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { estimateReadingTime, slugify } from "@/lib/blog-utils";
import { getProvider, providerCatalog } from "@/lib/ai-providers/registry";

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
});

export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: existing } = await context.supabase
      .from("ai_generator_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await context.supabase
        .from("ai_generator_settings")
        .update({
          provider: data.provider,
          model: data.model,
          default_language: data.default_language,
          default_country: data.default_country ?? null,
          default_tone: data.default_tone,
          default_audience: data.default_audience,
          default_reading_level: data.default_reading_level,
          default_writing_style: data.default_writing_style,
          default_length: data.default_length,
          brand_voice: data.brand_voice ?? null,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("ai_generator_settings")
      .insert({
        provider: data.provider,
        model: data.model,
        default_language: data.default_language,
        default_country: data.default_country ?? null,
        default_tone: data.default_tone,
        default_audience: data.default_audience,
        default_reading_level: data.default_reading_level,
        default_writing_style: data.default_writing_style,
        default_length: data.default_length,
        brand_voice: data.brand_voice ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

/* ---------------- generation ---------------- */

const generateSchema = z.object({
  mode: z.enum(["quick", "advanced"]),
  // Quick mode fields
  keyword: z.string().min(2),
  language: z.string().optional(),
  country: z.string().optional().nullable(),
  // Advanced mode fields (all optional; server fills defaults)
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
  // Persistence
  save: z.enum(["none", "draft", "published"]).default("none"),
  category_id: z.string().uuid().nullable().optional(),
});

export type GenerateInput = z.infer<typeof generateSchema>;

export interface GeneratedArticle {
  title: string;
  slug: string;
  excerpt: string;
  seo_title: string;
  seo_description: string;
  content: string; // markdown
  tags: string[];
}

function buildSystemPrompt() {
  return [
    "You are an elite SEO content strategist and long-form writer.",
    "Produce natural, human-sounding, plagiarism-free articles that read like a subject matter expert wrote them.",
    "Avoid repetitive AI phrasing and clichés (e.g. 'in today's fast-paced world', 'delve into', 'unlock the power of', 'in conclusion').",
    "Vary sentence length. Use concrete details, first-hand style observations, and real-world examples.",
    "Use proper Markdown: # for the article H1, ## for major sections, ### for sub-sections.",
    "Never wrap the whole answer in triple backticks. Only fence real code blocks.",
    "Return ONLY minified JSON matching the requested schema. No prose before or after the JSON.",
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
  includeCta: boolean;
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

  req.push("Required article structure:");
  req.push("- A compelling introduction that hooks the reader (no meta preamble).");
  req.push("- Proper heading hierarchy (# H1, ## H2, ### H3).");
  if (opts.includeExamples) req.push("- Concrete, relatable examples woven into sections.");
  if (opts.includeTables) req.push("- At least one useful Markdown table comparing options or data.");
  if (opts.includeLists) req.push("- Well-formatted bullet or numbered lists where they add clarity.");
  req.push("- A 'Pros and Cons' section (unless clearly irrelevant to the topic).");
  req.push("- A 'Tips' section with 4-7 actionable, non-obvious tips.");
  if (opts.includeStats) req.push("- Credible statistics presented plainly (do NOT invent citations).");
  if (opts.includeCaseStudies) req.push("- A brief case-study style example illustrating the topic.");
  if (opts.includeFaq)
    req.push("- An '## FAQ' section with 5-7 questions/answers people actually search for.");
  if (opts.includeConclusion) req.push("- A conclusion that summarises without saying 'in conclusion'.");
  if (opts.includeCta)
    req.push(
      "- A context-aware call to action tailored to the topic and audience (do NOT mention Top Rated SEO Tools by name unless the topic is directly SEO tools).",
    );
  req.push("Write ORIGINAL prose; no plagiarism; do not invent quotes or specific citations.");

  req.push("");
  req.push(
    "Output ONLY a JSON object with this exact shape (no code fence, no extra text):",
  );
  req.push(
    JSON.stringify(
      {
        title: "string (SEO-friendly H1 title, <= 70 chars)",
        slug: "string (kebab-case slug)",
        excerpt: "string (140-180 chars, no marketing fluff)",
        seo_title: "string (<= 60 chars)",
        seo_description: "string (<= 160 chars)",
        tags: ["array of 3-8 short topical tags"],
        content: "string (the full article in Markdown, starting with the # H1)",
      },
      null,
      0,
    ),
  );
  return req.join("\n");
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip common code fences
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Try to find first {...} block
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
          ? "Anthropic is selected but ANTHROPIC_API_KEY is not set. Add it in backend secrets or pick another provider."
          : `${provider.label} is not available in this environment.`,
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
      includeCta: data.include_cta ?? true,
      includeConclusion: data.include_conclusion ?? true,
    };

    const system = buildSystemPrompt();
    const user = buildUserPrompt(opts);

    const raw = await provider.complete({
      model: settings.model,
      system,
      user,
      temperature: 0.75,
      maxTokens: 8000,
    });

    const parsed = tryParseJson(raw) as Partial<GeneratedArticle>;
    if (!parsed || typeof parsed !== "object" || !parsed.title || !parsed.content) {
      throw new Error("AI output missing required fields (title/content).");
    }

    const article: GeneratedArticle = {
      title: String(parsed.title).trim(),
      slug: (parsed.slug ? String(parsed.slug) : slugify(String(parsed.title))).slice(0, 120),
      excerpt: parsed.excerpt ? String(parsed.excerpt).slice(0, 300) : "",
      seo_title: parsed.seo_title ? String(parsed.seo_title).slice(0, 70) : String(parsed.title).slice(0, 70),
      seo_description: parsed.seo_description ? String(parsed.seo_description).slice(0, 180) : "",
      content: String(parsed.content),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10).map((t) => String(t)) : [],
    };

    // Optional persistence
    let post_id: string | null = null;
    if (data.save === "draft" || data.save === "published") {
      const status = data.save;
      const publishedAt = status === "published" ? new Date().toISOString() : null;
      const readingTime = estimateReadingTime(article.content);
      const { data: inserted, error } = await context.supabase
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
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      post_id = inserted.id;
    }

    return { article, post_id, used: { provider: provider.id, model: settings.model } };
  });
