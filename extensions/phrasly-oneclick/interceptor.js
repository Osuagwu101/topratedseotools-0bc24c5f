// Preserve the AWS browser-native action boundary; no server-side processing.
(() => {
  const features = new Map([["/api/ai/rewrite", "humanizer"], ["/api/ai/detect", "ai_detector"]]);
  const original = window.fetch.bind(window);
  function selected(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input?.url || String(input), window.location.href);
      return url.origin === window.location.origin ? features.get(url.pathname) : undefined;
    } catch { return undefined; }
  }
  function permission(feature) {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      let finished = false;
      const finish = allowed => { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener("message", reply); resolve(allowed); };
      const reply = event => {
        if (event.source === window && event.origin === window.location.origin &&
            event.data?.source === "trst-interceptor-reply" && event.data.requestId === requestId) finish(event.data.allowed === true);
      };
      const timer = setTimeout(() => finish(false), 4_000);
      window.addEventListener("message", reply);
      window.postMessage({ source: "trst-interceptor", type: "check", requestId, feature }, window.location.origin);
    });
  }
  window.fetch = async (input, init) => {
    const feature = selected(input);
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    if (!feature || method !== "POST") return original(input, init);
    if (!(await permission(feature))) return new Response(JSON.stringify({ error: "TopRated access is unavailable or the daily limit was reached." }), { status: 429, headers: { "Content-Type": "application/json" } });
    return original(input, init);
  };
})();
