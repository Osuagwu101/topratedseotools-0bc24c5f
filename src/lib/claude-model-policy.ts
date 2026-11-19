/*
 * Claude OneClick model policy (pure, no I/O).
 *
 * - Fable, Opus and Mythos (the same model as Fable) are unavailable to writers.
 * - New conversations default to Sonnet 5.5 at low effort; writers may still
 *   pick another allowed model or effort themselves.
 */
export const CLAUDE_WRITER_DEFAULT_MODEL = "claude-sonnet-5-5";
export const CLAUDE_WRITER_DEFAULT_EFFORT = "low";

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
  for (const [key, item] of Object.entries(value)) out[key] = applyClaudeWriterModelPolicy(item, depth + 1);
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
