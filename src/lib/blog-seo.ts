/**
 * SEO post-processing utilities used by the AI article generator and admin flows.
 *
 * - Internal link injection (tool references + pricing/subscription/related).
 * - Keyword highlighting helpers (client-only rendering — never on public pages).
 * - Reading time already lives in blog-utils.
 */
import { TOOLS } from "@/lib/tools-data";

export interface InternalLinkOptions {
  /** Max total internal links to insert (excludes CTA). */
  max?: number;
  /** Optional related posts to link to. */
  related?: Array<{ title: string; slug: string }>;
  /** Optional category to link to. */
  category?: { name: string; slug: string } | null;
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace the first case-insensitive whole-word occurrence of `needle` in the
 * markdown body with a markdown link — but only if that occurrence is NOT
 * already inside a link, image, code block/inline code, or heading.
 * Returns the possibly-modified body and whether a link was inserted.
 */
function injectLinkOnce(
  body: string,
  needle: string,
  href: string,
): { body: string; inserted: boolean } {
  const pattern = new RegExp(`\\b(${escapeReg(needle)})\\b`, "i");
  // Walk the body line by line so we can skip code fences and headings.
  const lines = body.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(line)) continue; // headings
    // Skip lines that already contain a link to the same href
    if (line.includes(`](${href})`)) continue;

    const match = pattern.exec(line);
    if (!match) continue;
    const idx = match.index;
    // Reject if the match is inside an existing link/image/inline-code.
    // Look for the last unclosed `[`, `!`, or `` ` `` before idx.
    const before = line.slice(0, idx);
    const openBracket = before.lastIndexOf("[");
    const closeBracket = before.lastIndexOf("]");
    if (openBracket > closeBracket) continue; // inside link text
    const backticks = (before.match(/`/g) ?? []).length;
    if (backticks % 2 === 1) continue; // inside inline code

    const replaced =
      line.slice(0, idx) + `[${match[1]}](${href})` + line.slice(idx + match[1].length);
    lines[i] = replaced;
    return { body: lines.join("\n"), inserted: true };
  }
  return { body, inserted: false };
}

/**
 * Auto-insert internal links for tool references, pricing, subscription, and
 * related content. Only touches the first natural occurrence per target and
 * caps the total number of insertions to avoid over-linking.
 */
export function injectInternalLinks(markdown: string, opts: InternalLinkOptions = {}): string {
  const max = opts.max ?? 6;
  let body = markdown;
  let count = 0;

  // 1. Tool references
  for (const tool of TOOLS) {
    if (count >= max) break;
    const { inserted, body: next } = injectLinkOnce(body, tool.name, `/tools/${tool.slug}`);
    if (inserted) {
      body = next;
      count++;
    }
  }

  // 2. Pricing / subscription / plans
  if (count < max) {
    for (const phrase of ["pricing", "subscription", "subscribe", "plans"]) {
      const { inserted, body: next } = injectLinkOnce(body, phrase, "/pricing");
      if (inserted) {
        body = next;
        count++;
        break;
      }
    }
  }

  // 3. Category
  if (count < max && opts.category) {
    const { inserted, body: next } = injectLinkOnce(
      body,
      opts.category.name,
      `/blog/category/${opts.category.slug}`,
    );
    if (inserted) {
      body = next;
      count++;
    }
  }

  // 4. Related posts — try each title
  if (opts.related?.length) {
    for (const r of opts.related) {
      if (count >= max) break;
      const { inserted, body: next } = injectLinkOnce(body, r.title, `/blog/${r.slug}`);
      if (inserted) {
        body = next;
        count++;
      }
    }
  }

  return body;
}

/** Score a CTA template against topic tags + category. Higher = better fit. */
export interface CtaTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  button_label: string;
  button_url: string;
  target_tool_slugs: string[];
  target_category_slugs: string[];
  priority: number;
  enabled: boolean;
  is_default: boolean;
}

export function selectBestCta(
  templates: CtaTemplate[],
  context: { toolSlugs?: string[]; categorySlug?: string | null; text?: string },
): CtaTemplate | null {
  const enabled = templates.filter((t) => t.enabled);
  if (!enabled.length) return null;
  const text = (context.text ?? "").toLowerCase();

  const scored = enabled.map((t) => {
    let score = t.priority;
    for (const slug of t.target_tool_slugs) {
      if (context.toolSlugs?.includes(slug)) score += 20;
      if (text.includes(slug.replace(/-/g, " "))) score += 5;
    }
    if (context.categorySlug && t.target_category_slugs.includes(context.categorySlug)) score += 15;
    if (t.is_default) score += 1;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // If nothing matched targeting, prefer default; else top-scored
  const top = scored[0];
  if (!top) return null;
  const withTargets = scored.find(
    (s) => s.t.target_tool_slugs.length || s.t.target_category_slugs.length,
  );
  if (withTargets && withTargets.score > (top.t.is_default ? top.score : -1)) return withTargets.t;
  return top.t;
}

/** Detect which tool slugs are referenced in the article body. */
export function detectToolSlugs(markdown: string): string[] {
  const lower = markdown.toLowerCase();
  const hits: string[] = [];
  for (const tool of TOOLS) {
    const re = new RegExp(`\\b${escapeReg(tool.name.toLowerCase())}\\b`);
    if (re.test(lower)) hits.push(tool.slug);
  }
  return hits;
}
