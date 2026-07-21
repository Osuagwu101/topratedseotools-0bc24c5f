import type { AIProvider } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Currently supported Gemini text-generation models on the v1beta
 * generateContent endpoint. Keep this list in sync with the models the
 * connected API key can call. Anything not in this list is rejected at save.
 */
export const GOOGLE_GEMINI_MODELS = [
  { id: "gemini-flash-latest", label: "Gemini Flash (latest, recommended)" },
  { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite (latest, cheapest)" },
  { id: "gemini-pro-latest", label: "Gemini Pro (latest, highest quality)" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
] as const;

const VALID_IDS = new Set<string>(GOOGLE_GEMINI_MODELS.map((m) => m.id));

/**
 * Normalize an admin-supplied model value. Strips whitespace, surrounding
 * quotes, `models/` API prefix, provider prefixes such as `google/` or
 * `google-gemini/`, and any accidentally pasted full endpoint URL.
 */
export function sanitizeGeminiModel(raw: string): string {
  let v = String(raw ?? "").trim();
  // strip surrounding quotes
  v = v.replace(/^["'`]+|["'`]+$/g, "").trim();
  // collapse line breaks / internal whitespace
  v = v.replace(/\s+/g, "");
  // if a full URL was pasted, take the last path segment
  if (/^https?:\/\//i.test(v)) {
    v = v.split("?")[0]!.replace(/:generateContent$/i, "");
    const parts = v.split("/");
    v = parts[parts.length - 1] ?? "";
  }
  // strip `models/` prefix and any vendor prefix like `google/`
  v = v.replace(/^models\//i, "");
  v = v.replace(/^(google|google-gemini|gemini-api|vertex_ai|vertex)\//i, "");
  // strip `:generateContent` if still present
  v = v.replace(/:generateContent.*$/i, "");
  return v;
}

export function isValidGeminiModel(raw: string): boolean {
  return VALID_IDS.has(sanitizeGeminiModel(raw));
}

export const googleProvider: AIProvider = {
  id: "google",
  label: "Google Gemini (direct)",
  defaultModel: "gemini-2.5-flash",
  models: GOOGLE_GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label })),
  isConfigured: () => !!process.env.GOOGLE_GEMINI_API_KEY,
  async complete({ model, system, user, temperature, maxTokens }) {
    const key = process.env.GOOGLE_GEMINI_API_KEY;
    if (!key)
      throw new Error(
        "AI_PROVIDER_NOT_CONFIGURED: GOOGLE_GEMINI_API_KEY is not set.",
      );
    const cleanModel = sanitizeGeminiModel(model);
    if (!VALID_IDS.has(cleanModel)) {
      throw new Error(
        `AI_PROVIDER_NOT_CONFIGURED: Invalid Gemini model "${model}". Choose one of: ${[...VALID_IDS].join(", ")}`,
      );
    }
    const url = `${GEMINI_BASE}/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(key)}`;
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
      // Log full detail server-side for admins
      console.error("[gemini] request failed", {
        status: res.status,
        model: cleanModel,
        body: text.slice(0, 1000),
      });
      if (res.status === 429)
        throw new Error("AI_RATE_LIMITED: Gemini rate limit exceeded. Try again shortly.");
      if (res.status === 400 || res.status === 404) {
        throw new Error(
          `AI_PROVIDER_NOT_CONFIGURED: Gemini rejected model "${cleanModel}".`,
        );
      }
      throw new Error(`AI_PROVIDER_ERROR: Gemini returned ${res.status}.`);
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
    if (!text) throw new Error("AI_PROVIDER_ERROR: Gemini returned an empty response.");
    return text;
  },
};
