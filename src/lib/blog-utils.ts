/**
 * Client-safe blog helpers: slug generation, reading time, markdown rendering,
 * and table-of-contents extraction. Used by both public pages and admin editor.
 */
import { marked } from "marked";
import { slugify, estimateReadingTime, formatDate } from "@/lib/blog-text";

export { slugify, estimateReadingTime, formatDate };

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

/** Configure marked once with heading id anchors. */
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = tokens.map((t) => ("text" in t ? String(t.text) : "")).join("");
      const id = slugify(plain);
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
  },
});

export function renderMarkdown(markdown: string): string {
  const escapedMarkdown = escapeRawHtml(markdown || "");
  const html = marked.parse(escapedMarkdown, { async: false }) as string;
  return sanitizeRenderedHtml(html);
}

function escapeRawHtml(markdown: string): string {
  return markdown.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeRenderedHtml(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select|option|link|meta)[^>]*>/gi, "")
    .replace(/\s+on[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)=("|')\s*javascript:[^"']*\2/gi, "")
    .replace(/\s+(href|src)=\s*javascript:[^\s>]*/gi, "");
}

export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  const lines = (markdown || "").split("\n");
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    if (level < 2 || level > 3) continue;
    const text = m[2].trim();
    let id = slugify(text);
    const count = seen.get(id) ?? 0;
    if (count > 0) id = `${id}-${count}`;
    seen.set(slugify(text), count + 1);
    entries.push({ id, text, level });
  }
  return entries;
}

