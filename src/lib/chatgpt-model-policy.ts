/*
 * ChatGPT OneClick model policy (pure, no I/O).
 *
 * - "Astra" models (GPT-6 Astra, GPT-6.2 Astra, any later Astra) are not
 *   available to writers: they are removed from model lists and refused if a
 *   request still names one.
 * - The "Extra high" and "Max" thinking levels are not offered and are lowered
 *   to "High" if a request still carries them.
 * Only model lists and thinking-level lists are touched; chat titles and
 * messages that merely contain the word "astra" are left alone.
 */
export const CHATGPT_WRITER_MAX_EFFORT = "high";

const ASTRA = /(?:^|[-_.\s])astra(?:$|[-_.\s0-9])/i;
export const isDisabledChatGptModel = (v: unknown) => typeof v === "string" && ASTRA.test(v);

const letters = (v: unknown) => (typeof v === "string" ? v.toLowerCase().replace(/[^a-z]/g, "") : "");
const DISABLED_EFFORTS = new Set(["xhigh", "extrahigh", "extra", "max", "maximum"]);
const KNOWN_EFFORTS = new Set([
  "none", "minimal", "min", "low", "light", "medium", "standard", "high", "extended", "heavy",
  ...DISABLED_EFFORTS,
]);
export const isDisabledChatGptEffort = (v: unknown) => DISABLED_EFFORTS.has(letters(v));

/** Keys that hold a thinking-level id or label inside a level option. */
const LEVEL_KEYS = ["thinking_effort", "reasoning_effort", "effort", "effort_level", "reasoning_level", "level", "id", "value", "slug", "label", "full_label", "short_label", "title", "name"];
/** Keys that hold the writer's chosen/default thinking level. */
const EFFORT_VALUE_KEYS = /^(?:thinking_effort|reasoning_effort|effort|effort_level|reasoning_level|default_thinking_effort|default_reasoning_effort|default_effort|selected_thinking_effort|max_thinking_effort|max_reasoning_effort)$/;

const levelValues = (o: any): string[] =>
  o && typeof o === "object" && !Array.isArray(o)
    ? LEVEL_KEYS.map((k) => o[k]).filter((x): x is string => typeof x === "string")
    : typeof o === "string" ? [o] : [];

const isLevelList = (arr: any[]) =>
  arr.length > 0 && arr.some((e) => levelValues(e).some((s) => KNOWN_EFFORTS.has(letters(s))));

/** An entry in a model list: it has a model id/slug, and that names an Astra model. */
function isAstraModelEntry(entry: any): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const id = entry.slug ?? entry.model_slug ?? entry.model;
  if (typeof id !== "string") return false;
  return isDisabledChatGptModel(id) || isDisabledChatGptModel(entry.title) || isDisabledChatGptModel(entry.display_name);
}

/** Rewrites a ChatGPT JSON response for writers. */
export function applyChatGptWriterModelPolicy(value: any, depth = 0): any {
  if (depth > 40 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let out = value.map((v) => applyChatGptWriterModelPolicy(v, depth + 1));
    out = out.filter((v) => !isAstraModelEntry(v));
    if (isLevelList(out)) out = out.filter((v) => !levelValues(v).some(isDisabledChatGptEffort));
    return out;
  }
  const out: any = {};
  for (const [key, item] of Object.entries(value)) {
    if (EFFORT_VALUE_KEYS.test(key) && isDisabledChatGptEffort(item)) out[key] = CHATGPT_WRITER_MAX_EFFORT;
    else out[key] = applyChatGptWriterModelPolicy(item, depth + 1);
  }
  return out;
}

/** True when a writer request names an Astra model. */
export function requestUsesDisabledChatGptModel(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  return [payload.model, payload.model_slug, payload.model_id, payload.model_name, payload.settings?.model]
    .some(isDisabledChatGptModel);
}

/** Lowers any Extra high / Max level in a writer request to High. Returns true if changed. */
export function clampChatGptRequestEffort(payload: any, depth = 0): boolean {
  if (depth > 20 || !payload || typeof payload !== "object") return false;
  let changed = false;
  for (const [key, item] of Object.entries(payload)) {
    if (EFFORT_VALUE_KEYS.test(key) && isDisabledChatGptEffort(item)) {
      payload[key] = CHATGPT_WRITER_MAX_EFFORT;
      changed = true;
    } else if (item && typeof item === "object" && clampChatGptRequestEffort(item, depth + 1)) changed = true;
  }
  return changed;
}
