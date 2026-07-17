import type { AIProvider } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const googleProvider: AIProvider = {
  id: "google",
  label: "Google Gemini (direct)",
  defaultModel: "gemini-1.5-flash-latest",
  models: [
    { id: "gemini-1.5-flash-latest", label: "Gemini 1.5 Flash (fast)" },
    { id: "gemini-1.5-pro-latest", label: "Gemini 1.5 Pro (highest quality)" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash (experimental)" },
  ],
  isConfigured: () => !!process.env.GOOGLE_GEMINI_API_KEY,
  async complete({ model, system, user, temperature, maxTokens }) {
    const key = process.env.GOOGLE_GEMINI_API_KEY;
    if (!key)
      throw new Error(
        "GOOGLE_GEMINI_API_KEY is not set. Add it in the backend secrets to use Gemini.",
      );
    const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const body: Record<string, unknown> = {
      systemInstruction: { role: "system", parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429)
        throw new Error("Gemini rate limit exceeded. Try again shortly.");
      throw new Error(`Gemini error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  },
};
