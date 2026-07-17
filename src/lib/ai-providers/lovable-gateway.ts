import type { AIProvider } from "./types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callGateway(args: {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (args.maxTokens !== undefined) body.max_tokens = args.maxTokens;
  // GPT-5.6 chat completions require reasoning_effort: "none" when tools are absent it's still safe.
  if (args.model.startsWith("openai/gpt-5.6")) body.reasoning_effort = "none";

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "raw-fetch",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI rate limit exceeded. Try again shortly.");
    if (res.status === 402)
      throw new Error("Lovable AI credits exhausted. Add credits from workspace billing.");
    throw new Error(`AI gateway error (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI gateway returned an empty response");
  return content;
}

export const openaiProvider: AIProvider = {
  id: "openai",
  label: "OpenAI (via Lovable AI)",
  defaultModel: "openai/gpt-5.4-mini",
  models: [
    { id: "openai/gpt-5.4", label: "GPT-5.4" },
    { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini (fast)" },
    { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano (fastest)" },
    { id: "openai/gpt-5.5", label: "GPT-5.5 (highest quality)" },
    { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  ],
  isConfigured: () => !!process.env.LOVABLE_API_KEY,
  complete: callGateway,
};

export const googleProvider: AIProvider = {
  id: "google",
  label: "Google Gemini (via Lovable AI)",
  defaultModel: "google/gemini-3-flash-preview",
  models: [
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (default)" },
    { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (highest quality)" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  isConfigured: () => !!process.env.LOVABLE_API_KEY,
  complete: callGateway,
};
