import { Sparkles, Image, FileText, Mic, Code2, Languages, Video, PenLine, Bot, Wand2, Music, Palette, Search, MessageSquare, FileAudio, ScanText, Zap, LineChart, Mail, Presentation } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ToolCategory = "Writing" | "Image" | "Audio" | "Video" | "Code" | "Productivity" | "Data";

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
  "Image",
  "Audio",
  "Video",
  "Code",
  "Productivity",
  "Data",
];

export const TOOLS: Tool[] = [
  { slug: "ai-writer", name: "AI Writer", tagline: "Long-form drafts in seconds", description: "Generate blog posts, essays and marketing copy with a tunable brand voice.", icon: PenLine, category: "Writing", access: "free", featured: true },
  { slug: "image-generator", name: "Image Generator", tagline: "Text to photorealistic image", description: "Create original images from a prompt with support for styles, aspect ratios and seeds.", icon: Image, category: "Image", access: "pro", featured: true },
  { slug: "chat-assistant", name: "Chat Assistant", tagline: "Your everyday AI copilot", description: "Ask anything — research, brainstorm, summarize documents and browse your history.", icon: MessageSquare, category: "Productivity", access: "free", featured: true },
  { slug: "transcriber", name: "Audio Transcriber", tagline: "Speech → accurate text", description: "Upload audio or video and get timestamped transcripts in 50+ languages.", icon: Mic, category: "Audio", access: "pro" },
  { slug: "code-explainer", name: "Code Explainer", tagline: "Understand any codebase", description: "Paste code, get a plain-English walkthrough plus refactor suggestions.", icon: Code2, category: "Code", access: "pro" },
  { slug: "translator", name: "AI Translator", tagline: "Native-quality translations", description: "Translate documents and conversations across 100+ languages with tone control.", icon: Languages, category: "Writing", access: "free" },
  { slug: "video-summarizer", name: "Video Summarizer", tagline: "Long videos → key points", description: "Drop a video link or file and get a structured summary with chapter markers.", icon: Video, category: "Video", access: "pro" },
  { slug: "art-studio", name: "Art Studio", tagline: "Illustrations & concept art", description: "Design illustrations, avatars and concept art with layered style controls.", icon: Palette, category: "Image", access: "pro" },
  { slug: "music-lab", name: "Music Lab", tagline: "AI-composed audio tracks", description: "Compose royalty-free background music, loops and jingles from a description.", icon: Music, category: "Audio", access: "pro" },
  { slug: "seo-optimizer", name: "SEO Optimizer", tagline: "Content that ranks", description: "Analyze pages, generate meta tags and improve on-page SEO with actionable tips.", icon: Search, category: "Productivity", access: "free" },
  { slug: "agent-builder", name: "Agent Builder", tagline: "Custom AI agents", description: "Assemble multi-step AI agents with tools, memory and scheduled runs.", icon: Bot, category: "Productivity", access: "pro" },
  { slug: "prompt-lab", name: "Prompt Lab", tagline: "Test & version prompts", description: "Compare prompts side-by-side across models and save winning variations.", icon: Wand2, category: "Code", access: "free" },
  { slug: "doc-analyzer", name: "Document Analyzer", tagline: "Chat with your PDFs", description: "Upload PDFs, contracts and reports — extract structured data and Q&A.", icon: FileText, category: "Productivity", access: "pro" },
  { slug: "voiceover", name: "AI Voiceover", tagline: "Studio-grade narration", description: "Turn scripts into natural voiceovers with dozens of voices and languages.", icon: FileAudio, category: "Audio", access: "pro" },
  { slug: "ocr", name: "Smart OCR", tagline: "Scan any document", description: "Extract text from images, receipts and handwritten notes with layout awareness.", icon: ScanText, category: "Data", access: "free" },
  { slug: "quick-actions", name: "Quick Actions", tagline: "One-click AI shortcuts", description: "Summarize, rewrite, translate, or extract — one click across any text you paste.", icon: Zap, category: "Productivity", access: "free" },
  { slug: "data-insights", name: "Data Insights", tagline: "Ask questions of your data", description: "Upload CSVs and get charts, summaries and answers in natural language.", icon: LineChart, category: "Data", access: "pro" },
  { slug: "email-composer", name: "Email Composer", tagline: "Write great emails, fast", description: "Draft replies and outreach with tone, length and language controls.", icon: Mail, category: "Writing", access: "free" },
  { slug: "slide-generator", name: "Slide Generator", tagline: "Decks from a prompt", description: "Turn a topic into a polished slide deck with speaker notes and images.", icon: Presentation, category: "Productivity", access: "pro" },
  { slug: "brand-kit", name: "Brand Kit AI", tagline: "Logos, colors, guidelines", description: "Generate a full brand kit — logo, palette and typography — from a brief.", icon: Sparkles, category: "Image", access: "pro" },
];

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
