import {
  PenLine,
  Shuffle,
  MessageSquare,
  Feather,
  CheckCircle2,
  Video,
  Search,
  ShieldCheck,
  Sparkles,
  FileText,
  Image,
  Mic,
  Languages,
  Bot,
  BarChart3,
  Wand2,
  Presentation,
  Music,
  Palette,
  ScanText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ToolCategory =
  | "Writing"
  | "AI Detection Bypass"
  | "Grammar & Proofreading"
  | "SEO"
  | "Plagiarism"
  | "Video"
  | "Image"
  | "Audio"
  | "Productivity";

export interface Tool {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** Official brand domain — used to fetch the real product logo. */
  domain: string;
  category: ToolCategory;
  access: "free" | "pro";
  featured?: boolean;
  /** Tool-specific feature bullets shown on the product page. Keep truthful and concrete. */
  features?: string[];
  /** Pay-per-use tools do not follow the Shared/Private + Monthly/Quarterly/Yearly model. */
  pricingModel?: "subscription" | "per_use";
  /** Only relevant when pricingModel === "per_use". */
  perUse?: {
    unit: string;
    amount: number;
    currency?: string;
  };
}

export const CATEGORIES: ToolCategory[] = [
  "Writing",
  "AI Detection Bypass",
  "Grammar & Proofreading",
  "SEO",
  "Plagiarism",
  "Video",
  "Image",
  "Audio",
  "Productivity",
];

export function getToolLogo(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

export const TOOLS: Tool[] = [
  {
    slug: "stealthwriter",
    name: "Stealthwriter",
    tagline: "Humanize AI text — undetectable",
    description:
      "Stealthwriter rewrites AI-generated content into natural, human-sounding writing that reliably bypasses GPTZero, Originality.ai, Turnitin and Copyleaks. Preserve meaning, tone and SEO keywords while making essays, blogs and reports read as if a person wrote them.",
    icon: Feather,
    domain: "stealthwriter.ai",
    category: "AI Detection Bypass",
    access: "pro",
    featured: true,
    features: [
      "Rewrites AI text into natural, human-sounding writing",
      "Designed to bypass GPTZero, Originality.ai, Turnitin and Copyleaks",
      "Preserves original meaning, tone and keywords",
      "Multiple humanising modes for essays, blogs and reports",
    ],
  },
  {
    slug: "sneakwrite",
    name: "SneakWrite",
    tagline: "Next-generation AI humanizer for natural, polished writing",
    description:
      "SneakWrite is a premium AI humanizer built for writers who want AI-assisted drafts to read with stronger flow, more natural phrasing and a convincingly human voice. It refines essays, articles, reports and everyday content while preserving the core meaning, making it a standout option in the new generation of AI rewriting tools.",
    icon: Wand2,
    domain: "sneakwrite.net",
    category: "AI Detection Bypass",
    access: "pro",
    featured: true,
    features: [
      "Humanizes AI-assisted drafts into natural, fluent writing",
      "Preserves the original meaning while improving rhythm and phrasing",
      "Refines tone for essays, articles, reports and professional content",
      "Built for fast, polished rewriting with a clean human voice",
    ],
  },
  {
    slug: "phrasly",
    name: "Phrasly",
    tagline: "AI humanizer & paraphraser",
    description:
      "Phrasly is an all-in-one AI humanizer, paraphraser and grammar checker. Rewrite ChatGPT drafts into undetectable, plagiarism-free content, adjust tone from academic to casual, and export polished essays, articles and reports in seconds.",
    icon: Shuffle,
    domain: "phrasly.ai",
    category: "AI Detection Bypass",
    access: "pro",
    featured: true,
    features: [
      "Humanises AI text and paraphrases in one click",
      "Tone controls from academic to casual",
      "Built-in grammar and plagiarism checks",
      "Exports clean, ready-to-submit documents",
    ],
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    tagline: "The world's best AI assistant",
    description:
      "Full ChatGPT Plus access on the latest GPT models. Draft blog posts, research topics, generate code, brainstorm campaigns, analyze data and get long-form answers with vision, file uploads and advanced reasoning — all inside one workspace.",
    icon: MessageSquare,
    domain: "openai.com",
    category: "Writing",
    access: "pro",
    featured: true,
    features: [
      "Chat, research, writing and coding in one interface",
      "File uploads, vision and long-form reasoning",
      "Web browsing and image generation when your plan allows",
      "Save chats and continue conversations later",
    ],
  },
  {
    slug: "quillbot",
    name: "QuillBot",
    tagline: "Paraphrase, summarize & rewrite",
    description:
      "QuillBot Premium unlocks unlimited paraphrasing modes, a powerful summarizer, grammar checker, plagiarism scanner and citation generator. Rewrite sentences, condense long documents and refine fluency without losing the original meaning.",
    icon: PenLine,
    domain: "quillbot.com",
    category: "Writing",
    access: "pro",
    featured: true,
    features: [
      "Unlimited paraphrasing modes, including Fluency and Formal",
      "Summariser condenses long documents into key points",
      "Grammar checker and citation generator",
      "Plagiarism scanner included on Premium",
    ],
  },
  {
    slug: "grammarly",
    name: "Grammarly",
    tagline: "Grammar, clarity & tone",
    description:
      "Grammarly Premium checks grammar, spelling, punctuation, clarity, engagement, tone and delivery across every app you write in. Get full-sentence rewrites, vocabulary suggestions and a built-in plagiarism detector to polish essays, emails and articles.",
    icon: CheckCircle2,
    domain: "grammarly.com",
    category: "Grammar & Proofreading",
    access: "pro",
    featured: true,
    features: [
      "Grammar, spelling, clarity, tone and engagement checks",
      "Full-sentence rewrite suggestions",
      "Works across your browser, desktop and mobile",
      "Built-in plagiarism detector on Premium",
    ],
  },
  {
    slug: "capcut",
    name: "CapCut Pro",
    tagline: "Pro-grade video editing",
    description:
      "CapCut Pro is a full video editing suite with premium templates, effects, transitions, keyframe animation, AI auto-captions, background removal, noise reduction and 4K exports — perfect for TikTok, Reels, YouTube Shorts and long-form content.",
    icon: Video,
    domain: "capcut.com",
    category: "Video",
    access: "pro",
    featured: true,
    features: [
      "Cut, trim and layer video with keyframe animation",
      "AI auto-captions, background removal and noise reduction",
      "Premium templates, effects and transitions",
      "Export up to 4K without watermarks",
    ],
  },
  {
    slug: "semrush",
    name: "Semrush",
    tagline: "Keyword & competitor research",
    description:
      "Semrush is the industry-standard SEO platform. Run keyword research, track daily rankings, audit sites, analyze competitor traffic and backlinks, explore SERP features and plan content that ranks — all from one dashboard.",
    icon: Search,
    domain: "semrush.com",
    category: "SEO",
    access: "pro",
    featured: true,
    features: [
      "Keyword research with volume, difficulty and intent",
      "Daily rank tracking and site audits",
      "Competitor traffic, backlink and content-gap analysis",
      "SERP feature and PPC research",
    ],
  },
  {
    slug: "turnitin",
    name: "Turnitin Checks",
    tagline: "Pay-per-check plagiarism & AI detection",
    description:
      "Order individual Turnitin plagiarism and AI-writing detection checks — ₦2,300 per check, paid once. You tell us how many checks you need, pay for the total, and we return the official Turnitin similarity report and AI-content percentage for each document you submit.",
    icon: ShieldCheck,
    domain: "turnitin.com",
    category: "Plagiarism",
    access: "pro",
    featured: true,
    pricingModel: "per_use",
    perUse: { unit: "check", amount: 2300, currency: "₦" },
    features: [
      "Full Turnitin similarity report per document",
      "AI-writing detection percentage included",
      "Source-by-source matches with links",
      "Priced per check — no subscription and no auto-renewal",
    ],
  },
  {
    slug: "ahrefs",
    name: "Ahrefs",
    tagline: "Backlinks & keyword explorer",
    description:
      "Ahrefs gives you the world's largest live backlink index plus Keywords Explorer, Site Audit, Rank Tracker and Content Explorer. Uncover keyword difficulty, top pages, content gaps and link-building opportunities to outrank the competition.",
    icon: BarChart3,
    domain: "ahrefs.com",
    category: "SEO",
    access: "pro",
  },
  {
    slug: "canva-pro",
    name: "Canva Pro",
    tagline: "Design without limits",
    description:
      "Canva Pro unlocks 100M+ premium photos, videos, fonts and templates plus Magic Studio AI tools, background remover, brand kits and one-click resizing. Design social posts, thumbnails, presentations and marketing assets in minutes.",
    icon: Palette,
    domain: "canva.com",
    category: "Image",
    access: "pro",
    features: [
      "100M+ premium photos, videos, fonts and templates",
      "Magic Studio AI tools and background remover",
      "Brand kits and one-click resize across formats",
      "Team folders and unlimited cloud storage on Pro",
    ],
  },
  {
    slug: "midjourney",
    name: "Midjourney",
    tagline: "Stunning AI images",
    description:
      "Midjourney generates breathtaking AI artwork, illustrations and photorealistic images from a simple text prompt. Perfect for blog visuals, ad creatives, thumbnails, moodboards and concept art — with fine control over style, aspect ratio and detail.",
    icon: Image,
    domain: "midjourney.com",
    category: "Image",
    access: "pro",
  },
  {
    slug: "elevenlabs",
    name: "ElevenLabs",
    tagline: "Realistic AI voices",
    description:
      "ElevenLabs turns any script into studio-quality voiceovers with hyper-realistic AI voices in 30+ languages. Clone your own voice, control emotion and pacing, and export narrations for videos, podcasts, audiobooks and IVR systems.",
    icon: Mic,
    domain: "elevenlabs.io",
    category: "Audio",
    access: "pro",
  },
  {
    slug: "originality-ai",
    name: "Originality.ai",
    tagline: "AI & plagiarism scanner",
    description:
      "Originality.ai scans any document for AI-generated content and plagiarism with industry-leading accuracy. Get shareable PDF reports, team seats, Chrome extension checks and readability scores — trusted by publishers and SEO agencies worldwide.",
    icon: ScanText,
    domain: "originality.ai",
    category: "Plagiarism",
    access: "pro",
  },
  {
    slug: "gptzero",
    name: "GPTZero",
    tagline: "AI content detector",
    description:
      "GPTZero is the classroom-grade AI content detector used by millions of teachers and editors. Get sentence-level highlighting, a mixed AI/human probability score and support for ChatGPT, Claude, Gemini and Llama-generated text.",
    icon: Bot,
    domain: "gptzero.me",
    category: "AI Detection Bypass",
    access: "free",
  },
  {
    slug: "deepl",
    name: "DeepL Pro",
    tagline: "Best-in-class translation",
    description:
      "DeepL Pro delivers the most natural, context-aware translations available across 30+ languages. Translate entire Word, PDF and PowerPoint files, fine-tune tone and formality, and integrate with your browser and favorite tools.",
    icon: Languages,
    domain: "deepl.com",
    category: "Writing",
    access: "pro",
  },
  {
    slug: "notion-ai",
    name: "Notion AI",
    tagline: "AI inside your workspace",
    description:
      "Notion AI lives inside your docs and databases. Summarize meeting notes, draft blog outlines, translate content, extract action items and ask questions across your entire workspace — without leaving the page you're writing on.",
    icon: FileText,
    domain: "notion.so",
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "gamma",
    name: "Gamma",
    tagline: "AI presentations & decks",
    description:
      "Gamma turns a prompt, outline or existing document into a polished slide deck, webpage or PDF in seconds. Restyle with a click, edit in a doc-like editor, add charts and embeds, and export to PowerPoint or share as a live link.",
    icon: Presentation,
    domain: "gamma.app",
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "suno",
    name: "Suno",
    tagline: "AI music generator",
    description:
      "Suno composes full original songs — vocals, lyrics, melody and instrumentation — from a short text description. Generate jingles, background tracks, demos and social-ready songs in any genre, then download the stems in high quality.",
    icon: Music,
    domain: "suno.com",
    category: "Audio",
    access: "pro",
  },
  {
    slug: "perplexity",
    name: "Perplexity Pro",
    tagline: "Answer engine with sources",
    description:
      "Perplexity Pro is the AI answer engine that cites its sources. Ask any question and get an up-to-date, cited response powered by GPT-4o, Claude and Sonar — with file uploads, Pro Search and focus modes for academic, coding and Reddit research.",
    icon: Sparkles,
    domain: "perplexity.ai",
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "prompt-lab",
    name: "Prompt Lab",
    tagline: "Test & save winning prompts",
    description:
      "Prompt Lab lets you compare prompts side-by-side across GPT, Claude and Gemini, score outputs and save your best-performing variations to a personal library. Perfect for marketers, developers and content teams building repeatable AI workflows.",
    icon: Wand2,
    domain: "",
    category: "Productivity",
    access: "free",
  },
];

const extraTools = new Map<string, Tool>();

export function registerExtraTools(tools: Tool[]): void {
  for (const t of tools) if (!TOOLS.some((b) => b.slug === t.slug)) extraTools.set(t.slug, t);
}

export function getExtraTools(): Tool[] {
  return [...extraTools.values()];
}

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug) ?? extraTools.get(slug);
}
