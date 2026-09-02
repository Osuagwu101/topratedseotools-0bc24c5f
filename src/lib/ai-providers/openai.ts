import type { AIProvider } from "./types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const openaiProvider: AIProvider = {
  id: "openai",
  label: "OpenAI (direct)",
  defaultModel: "gpt-4o-mini",
  models: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini (fast)" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "o3-mini", label: "o3-mini (reasoning)" },
  ],
  isConfigured: () => !!process.env.OPENAI_API_KEY,
  async complete({ model, system, user, temperature, maxTokens }) {
    const key = process.env.OPENAI_API_KEY;
    if (!key)
      throw new Error("OPENAI_API_KEY is not set. Add it in the backend secrets to use OpenAI.");
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("OpenAI rate limit exceeded. Try again shortly.");
      throw new Error(`OpenAI error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response");
    return content;
  },
};
