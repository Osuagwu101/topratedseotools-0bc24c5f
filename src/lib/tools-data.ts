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

/** Returns a high-quality logo URL for a given brand domain. */
export function getToolLogo(domain: string): string {
  return `https://unavatar.io/${domain}?fallback=https://www.google.com/s2/favicons?domain=${domain}%26sz=256`;
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
  },
  {
    slug: "turnitin",
    name: "Turnitin Checks",
    tagline: "Plagiarism & AI detection reports",
    description:
      "Run the same Turnitin plagiarism and AI-writing detection reports universities use, before you submit. Get a detailed similarity score, source-by-source matches and an AI-generated content percentage on essays, theses and dissertations.",
    icon: ShieldCheck,
    domain: "turnitin.com",
    category: "Plagiarism",
    access: "pro",
    featured: true,
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
    domain: "toolratedseotools.com",
    category: "Productivity",
    access: "free",
  },
];

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
