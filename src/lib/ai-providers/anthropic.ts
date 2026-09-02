import type { AIProvider } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export const anthropicProvider: AIProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  defaultModel: "claude-3-5-sonnet-latest",
  models: [
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (fast)" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  ],
  isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  async complete({ model, system, user, temperature, maxTokens }) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      throw new Error("ANTHROPIC_API_KEY is not set. Add it in the backend secrets to use Claude.");
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: maxTokens ?? 8000,
        temperature: temperature ?? 0.7,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty response");
    return text;
  },
};
