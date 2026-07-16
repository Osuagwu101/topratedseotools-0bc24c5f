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

export const TOOLS: Tool[] = [
  {
    slug: "stealthwriter",
    name: "Stealthwriter",
    tagline: "Humanize AI text — undetectable",
    description:
      "Rewrite AI-generated content so it passes GPTZero, Originality.ai and Turnitin AI detection while keeping the original meaning.",
    icon: Feather,
    category: "AI Detection Bypass",
    access: "pro",
    featured: true,
  },
  {
    slug: "phrasly",
    name: "Phrasly",
    tagline: "AI humanizer & paraphraser",
    description:
      "Bypass AI detectors and paraphrase essays, blogs and reports into natural, human-sounding writing.",
    icon: Shuffle,
    category: "AI Detection Bypass",
    access: "pro",
    featured: true,
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    tagline: "The world's best AI assistant",
    description:
      "Full access to ChatGPT for research, writing, coding, brainstorming and everyday questions — powered by the latest GPT models.",
    icon: MessageSquare,
    category: "Writing",
    access: "pro",
    featured: true,
  },
  {
    slug: "quillbot",
    name: "QuillBot",
    tagline: "Paraphrase, summarize & rewrite",
    description:
      "Rewrite sentences, improve fluency, summarize long documents and check grammar with QuillBot's premium modes.",
    icon: PenLine,
    category: "Writing",
    access: "pro",
    featured: true,
  },
  {
    slug: "grammarly",
    name: "Grammarly",
    tagline: "Grammar, clarity & tone",
    description:
      "Advanced grammar, spelling, clarity, tone and plagiarism checks — polish every email, essay and article.",
    icon: CheckCircle2,
    category: "Grammar & Proofreading",
    access: "pro",
    featured: true,
  },
  {
    slug: "capcut",
    name: "CapCut Pro",
    tagline: "Pro-grade video editing",
    description:
      "Edit videos with premium templates, effects, transitions, background removal and AI captions from CapCut Pro.",
    icon: Video,
    category: "Video",
    access: "pro",
    featured: true,
  },
  {
    slug: "semrush",
    name: "Semrush",
    tagline: "Keyword & competitor research",
    description:
      "Full Semrush SEO toolkit — keyword research, rank tracking, backlink analysis and competitor insights.",
    icon: Search,
    category: "SEO",
    access: "pro",
    featured: true,
  },
  {
    slug: "turnitin",
    name: "Turnitin Checks",
    tagline: "Plagiarism & AI detection reports",
    description:
      "Run Turnitin plagiarism and AI-writing detection reports on essays and papers before you submit.",
    icon: ShieldCheck,
    category: "Plagiarism",
    access: "pro",
    featured: true,
  },
  {
    slug: "ahrefs",
    name: "Ahrefs",
    tagline: "Backlinks & keyword explorer",
    description:
      "Analyze backlinks, keyword difficulty, top pages and content gaps with the full Ahrefs suite.",
    icon: BarChart3,
    category: "SEO",
    access: "pro",
  },
  {
    slug: "canva-pro",
    name: "Canva Pro",
    tagline: "Design without limits",
    description:
      "Create social posts, thumbnails, presentations and brand kits with premium Canva Pro templates and assets.",
    icon: Palette,
    category: "Image",
    access: "pro",
  },
  {
    slug: "midjourney",
    name: "Midjourney",
    tagline: "Stunning AI images",
    description:
      "Generate high-quality AI artwork, illustrations and photorealistic images from a text prompt.",
    icon: Image,
    category: "Image",
    access: "pro",
  },
  {
    slug: "elevenlabs",
    name: "ElevenLabs",
    tagline: "Realistic AI voices",
    description:
      "Convert scripts into studio-quality voiceovers in dozens of languages with lifelike AI voices.",
    icon: Mic,
    category: "Audio",
    access: "pro",
  },
  {
    slug: "originality-ai",
    name: "Originality.ai",
    tagline: "AI & plagiarism scanner",
    description:
      "Scan any document for AI-generated content and plagiarism with detailed, shareable reports.",
    icon: ScanText,
    category: "Plagiarism",
    access: "pro",
  },
  {
    slug: "gptzero",
    name: "GPTZero",
    tagline: "AI content detector",
    description:
      "Detect AI-written text with sentence-level breakdowns from GPTZero's classroom-grade detector.",
    icon: Bot,
    category: "AI Detection Bypass",
    access: "free",
  },
  {
    slug: "deepl",
    name: "DeepL Pro",
    tagline: "Best-in-class translation",
    description:
      "Translate documents and text between 30+ languages with DeepL Pro's natural, context-aware output.",
    icon: Languages,
    category: "Writing",
    access: "pro",
  },
  {
    slug: "notion-ai",
    name: "Notion AI",
    tagline: "AI inside your workspace",
    description:
      "Summarize meetings, draft docs, translate and brainstorm — right inside Notion.",
    icon: FileText,
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "gamma",
    name: "Gamma",
    tagline: "AI presentations & decks",
    description:
      "Turn a prompt or outline into a polished slide deck, webpage or document in seconds.",
    icon: Presentation,
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "suno",
    name: "Suno",
    tagline: "AI music generator",
    description:
      "Compose full songs — vocals, lyrics and instruments — from a short description with Suno.",
    icon: Music,
    category: "Audio",
    access: "pro",
  },
  {
    slug: "perplexity",
    name: "Perplexity Pro",
    tagline: "Answer engine with sources",
    description:
      "Ask any question and get a sourced, up-to-date answer powered by the latest AI models.",
    icon: Sparkles,
    category: "Productivity",
    access: "pro",
  },
  {
    slug: "prompt-lab",
    name: "Prompt Lab",
    tagline: "Test & save winning prompts",
    description:
      "Compare prompts side-by-side across models and save your best-performing variations.",
    icon: Wand2,
    category: "Productivity",
    access: "free",
  },
];

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
