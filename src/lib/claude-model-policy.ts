/*
 * Claude OneClick model policy (pure, no I/O).
 *
 * - Fable, Opus and Mythos (the same model as Fable) are unavailable to writers.
 * - New conversations default to Sonnet 5.5 at low effort; writers may still
 *   pick another allowed model or effort themselves.
 * - The "Extra" (xhigh) and "Max" effort levels are not offered and are clamped
 *   to "high" if a request still carries them.
 */
export const CLAUDE_WRITER_DEFAULT_MODEL = "claude-sonnet-5-5";
export const CLAUDE_WRITER_DEFAULT_EFFORT = "low";
export const CLAUDE_WRITER_MAX_EFFORT = "high";
const DISABLED_EFFORTS = new Set(["xhigh", "max"]);
const EFFORT_KEYS = /^(?:effort|effort_level|requested_effort|requested_effort_level|org_enforced_default_effort|admin_default_effort_level)$/;
export const isDisabledClaudeEffort = (v: unknown) => typeof v === "string" && DISABLED_EFFORTS.has(v.toLowerCase());

/** Opus, Fable and Mythos model ids or names, any version. */
export function isDisabledClaudeModel(value: unknown): boolean {
  return typeof value === "string" && /(?:^|[-_.\s])(?:opus|fable|mythos)(?:$|[-_.\s0-9[])/i.test(value);
}

const MODEL_ID = /^claude-[a-z0-9-]+(?:\[[0-9a-z]+\])?$/i;
const modelOf = (entry: any): unknown =>
  typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry.model ?? entry.model_id ?? entry.id) : undefined;
const isModelEntry = (entry: any) => {
  const m = modelOf(entry);
  return typeof m === "string" && MODEL_ID.test(m);
};

/**
 * Rewrites any Claude JSON response for writers: removes Fable/Opus from model
 * lists, puts Sonnet 5.5 first and marks it (with low effort) as the default.
 * Only model-list arrays and known default fields are touched.
 */
export function applyClaudeWriterModelPolicy(value: any, depth = 0): any {
  if (depth > 40 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const listsModels = value.length > 0 && value.some(isModelEntry);
    let out = value.map((v) => applyClaudeWriterModelPolicy(v, depth + 1));
    if (listsModels) {
      out = out.filter((v) => !(isModelEntry(v) && isDisabledClaudeModel(modelOf(v))));
      const i = out.findIndex((v) => modelOf(v) === CLAUDE_WRITER_DEFAULT_MODEL);
      if (i > 0) out.unshift(...out.splice(i, 1));
    }
    return out;
  }
  const out: any = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "effort_options" && Array.isArray(item)) {
      out[key] = item.filter((o: any) => !isDisabledClaudeEffort(o?.id)).map((o) => applyClaudeWriterModelPolicy(o, depth + 1));
    } else if (EFFORT_KEYS.test(key) && isDisabledClaudeEffort(item)) {
      out[key] = CLAUDE_WRITER_MAX_EFFORT;
    } else {
      out[key] = applyClaudeWriterModelPolicy(item, depth + 1);
    }
  }
  // Account settings default model.
  if ("default_model" in out && (out.default_model == null || isDisabledClaudeModel(out.default_model)))
    out.default_model = CLAUDE_WRITER_DEFAULT_MODEL;
  // Organisation objects carrying the model catalogue: pin defaults.
  if (Array.isArray(value.claude_ai_bootstrap_models_config)) {
    out.org_enforced_default_model = CLAUDE_WRITER_DEFAULT_MODEL;
    out.admin_default_effort_level = CLAUDE_WRITER_DEFAULT_EFFORT;
    out.org_enforced_default_effort = CLAUDE_WRITER_DEFAULT_EFFORT;
    out.org_enforced_default_effort_model = CLAUDE_WRITER_DEFAULT_MODEL;
  }
  return out;
}

/** True when any model field in a writer request names Fable or Opus. */
export function requestUsesDisabledModel(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const fields = [payload.model, payload.model_id, payload.model_name, payload.settings?.model, payload.create_conversation_params?.model];
  return fields.some(isDisabledClaudeModel);
}

/** New conversations start on Sonnet 5.5 / low unless the writer chose otherwise. */
export function applyClaudeNewConversationDefaults(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  if (typeof payload.model !== "string" || !payload.model) payload.model = CLAUDE_WRITER_DEFAULT_MODEL;
  const settings = payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings) ? payload.settings : {};
  if (settings.effort_level == null || settings.effort_level === "") settings.effort_level = CLAUDE_WRITER_DEFAULT_EFFORT;
  payload.settings = settings;
  return payload;
}

/** Clamps Extra/Max effort in a writer request to High. Returns true if anything changed. */
export function clampClaudeRequestEffort(payload: any, depth = 0): boolean {
  if (depth > 20 || !payload || typeof payload !== "object") return false;
  let changed = false;
  for (const [key, item] of Object.entries(payload)) {
    if (EFFORT_KEYS.test(key) && isDisabledClaudeEffort(item)) {
      payload[key] = CLAUDE_WRITER_MAX_EFFORT;
      changed = true;
    } else if (item && typeof item === "object") {
      if (clampClaudeRequestEffort(item, depth + 1)) changed = true;
    }
  }
  return changed;
}
