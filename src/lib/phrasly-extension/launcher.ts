/** Browser bridge for the recovered trst_access protocol. No provider credentials. */
export type LaunchFeature = "humanizer" | "ai_detector" | "default";
export interface ExtensionRuntime {
  readonly lastError?: { message?: string };
  sendMessage(id: string, message: unknown, reply: (response: unknown) => void): void;
}
export interface Handoff { payload: string; signature: string }
export interface LaunchResult {
  ok: boolean;
  error?: string;
  provider_login?: "not_performed";
}
interface Options {
  extensionId: string;
  runtime?: ExtensionRuntime;
  requestHandoff: (feature: LaunchFeature) => Promise<Handoff>;
  timeoutMs?: number;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createPhraslyLauncher(options: Options) {
  const timeout = options.timeoutMs ?? 4_000;
  if (!/^[a-p]{32}$/.test(options.extensionId) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
    throw new Error("invalid_extension_configuration");
  }
  function send(message: unknown, timeoutError: string): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
      let finished = false;
      const finish = (data: Record<string, unknown>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(data);
      };
      const timer = setTimeout(() => finish({ ok: false, error: timeoutError }), timeout);
      if (!options.runtime) return finish({ ok: false, error: "extension_unavailable" });
      try {
        options.runtime.sendMessage(options.extensionId, message, response => {
          // Consume lastError inside the callback; never expose raw browser errors or tokens.
          if (options.runtime?.lastError || !object(response)) return finish({ ok: false, error: "extension_unavailable" });
          finish(response);
        });
      } catch { finish({ ok: false, error: "extension_unavailable" }); }
    });
  }
  async function probe(): Promise<LaunchResult> {
    const result = await send({ type: "trst_ping" }, "extension_unavailable");
    if (result.ok !== true || result.protocol !== 2) return { ok: false, error: "extension_unavailable" };
    return result.enabled === true ? { ok: true } : { ok: false, error: "extension_disabled" };
  }
  async function launch(feature: LaunchFeature): Promise<LaunchResult> {
    if (!["humanizer", "ai_detector", "default"].includes(feature)) return { ok: false, error: "invalid_feature" };
    const ready = await probe();
    if (!ready.ok) return ready;
    let token: Handoff;
    try { token = await options.requestHandoff(feature); }
    catch { return { ok: false, error: "handoff_unavailable" }; }
    if (!token || typeof token.payload !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(token.payload) ||
        typeof token.signature !== "string" || !/^[a-f0-9]{64}$/.test(token.signature)) return { ok: false, error: "invalid_handoff" };
    const result = await send({ type: "trst_access", payload: token.payload, signature: token.signature }, "launch_state_unknown");
    if (result.ok === true && result.provider_login === "not_performed") return { ok: true, provider_login: "not_performed" };
    const error = typeof result.error === "string" && /^[a-z_]{1,80}$/.test(result.error) ? result.error : "launch_failed";
    return { ok: false, error };
  }
  return { probe, launch };
}
