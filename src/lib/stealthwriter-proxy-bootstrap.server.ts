import { stealthWriterAllowedAssetHosts } from "@/lib/stealthwriter-controls.server";

export function stealthWriterProxyBootstrapResponse() {
  const assetHosts = JSON.stringify(stealthWriterAllowedAssetHosts());
  const script = String.raw`(() => {
  const PROXY = "/api/stealthwriter-proxy";
  const MAIN_HOST = "stealthwriter.ai";
  const ASSET_HOSTS = new Set(${assetHosts});
  let policy = null;
  let refreshTimer = null;
  let secondsLeft = 0;

  function mapUrl(value) {
    if (!value) return value;
    let raw;
    try {
      raw = value instanceof Request ? value.url : value instanceof URL ? value.href : String(value);
      const u = new URL(raw, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith(PROXY)) return raw;
      if (u.hostname === MAIN_HOST) {
        return PROXY + u.pathname + u.search + u.hash;
      }
      if (ASSET_HOSTS.has(u.hostname)) {
        return PROXY + "/__host/" + u.hostname + u.pathname + u.search + u.hash;
      }
      if (u.origin === window.location.origin && u.pathname.startsWith("/")) {
        return PROXY + u.pathname + u.search + u.hash;
      }
      return raw;
    } catch {
      return value;
    }
  }

  function logicalPath(value) {
    if (!value) return null;
    try {
      const u = new URL(
        value instanceof URL ? value.href : String(value),
        window.location.href,
      );
      if (u.hostname === MAIN_HOST) return u.pathname;
      if (u.origin === window.location.origin) {
        if (u.pathname.startsWith(PROXY + "/__host/")) return null;
        if (u.pathname.startsWith(PROXY)) {
          return u.pathname.slice(PROXY.length) || "/";
        }
        return u.pathname;
      }
      return null;
    } catch {
      return null;
    }
  }

  function pathMatches(pathname, rule) {
    if (!rule) return false;
    if (rule.endsWith("$")) return pathname === rule.slice(0, -1);
    return pathname.startsWith(rule);
  }

  function isAllowedNavigation(pathname) {
    if (!policy || !pathname) return true;
    const paths = policy.allowed_document_paths || {};
    const common = Array.isArray(paths.common) ? paths.common : [];
    if (common.some((rule) => pathMatches(pathname, rule))) return true;
    const granted = Array.isArray(policy.granted_features) ? policy.granted_features : [];
    return granted.some((feature) => {
      const rules = Array.isArray(paths[feature]) ? paths[feature] : [];
      return rules.some((rule) => pathMatches(pathname, rule));
    });
  }

  function safeLanding() {
    const landing = policy && typeof policy.landing_path === "string"
      ? policy.landing_path
      : "/dashboard/humanizer";
    return PROXY + landing;
  }

  function enforceNavigation(value) {
    const path = logicalPath(value);
    if (!path) return mapUrl(value);
    if (isAllowedNavigation(path)) return mapUrl(value);
    return safeLanding();
  }

  function markLinks() {
    if (!policy) return;
    for (const a of document.querySelectorAll("a[href]")) {
      const raw = a.getAttribute("href") || "";
      if (!raw || raw.startsWith("#")) continue;
      const path = logicalPath(raw);
      if (!path) continue;
      if (isAllowedNavigation(path)) {
        const mapped = mapUrl(raw);
        if (mapped && mapped !== raw) a.setAttribute("href", mapped);
        a.removeAttribute("data-trst-sw-blocked");
        a.style.removeProperty("opacity");
        a.style.removeProperty("cursor");
      } else {
        a.setAttribute("data-trst-sw-blocked", "1");
        a.style.setProperty("opacity", "0.45", "important");
        a.style.setProperty("cursor", "not-allowed", "important");
      }
    }
  }

  function text(tag, value, cssText) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (cssText) el.style.cssText = cssText;
    return el;
  }

  function renderUsageWidget() {
    if (!policy) return;
    let box = document.getElementById("trst-sw-usage");
    if (!box) {
      box = document.createElement("div");
      box.id = "trst-sw-usage";
      box.style.cssText =
        "position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
        "min-width:235px;max-width:310px;background:#0f172a;color:white;" +
        "border:1px solid #3f7fd1;border-radius:12px;padding:12px 14px;" +
        "font:12px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)";
      document.body.appendChild(box);
    }

    box.replaceChildren();
    box.appendChild(text("div", "TOP RATED SEO TOOLS", "font-weight:800;letter-spacing:.08em;color:#93c5fd;margin-bottom:4px"));
    box.appendChild(text("div", policy.user_label || "Customer", "font-size:11px;color:#cbd5e1;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"));

    const features = policy.features || {};
    for (const key of ["humanizer", "ai_detector"]) {
      const f = features[key];
      if (!f || !f.enabled) continue;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;gap:14px;margin:4px 0";
      row.appendChild(text("span", f.label || key));
      row.appendChild(text("strong", String(f.used || 0) + " / " + String(f.limit || 0)));
      box.appendChild(row);
    }

    const reset = text("div", "Resets in " + formatDuration(secondsLeft), "margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14);color:#cbd5e1");
    reset.id = "trst-sw-reset";
    box.appendChild(reset);
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + "h " + m + "m";
  }

  function tick() {
    secondsLeft = Math.max(0, secondsLeft - 60);
    const reset = document.getElementById("trst-sw-reset");
    if (reset) reset.textContent = "Resets in " + formatDuration(secondsLeft);
  }

  async function refreshPolicy() {
    try {
      const res = await nativeFetch(PROXY + "/__trst/usage", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return;
      policy = await res.json();
      secondsLeft = Number(policy.resets_in || 0);
      markLinks();
      renderUsageWidget();
    } catch {
      // Widget/policy refresh is best-effort; server-side gates remain authoritative.
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let raw = input instanceof Request ? input.url : String(input);
    const path = logicalPath(raw);
    const isHumanize = path === "/api/humanize" || (path && path.startsWith("/api/humanize/"));
    const freeRehumanize =
      isHumanize &&
      window.__trstSwFreeRehumanizeAt &&
      Date.now() - window.__trstSwFreeRehumanizeAt < 4000;

    let nextInit = init;
    if (freeRehumanize) {
      window.__trstSwFreeRehumanizeAt = 0;
      const headers = new Headers(
        init && init.headers
          ? init.headers
          : input instanceof Request
            ? input.headers
            : undefined,
      );
      headers.set("X-OC-Free-Rehumanize", "1");
      nextInit = { ...(init || {}), headers };
    }

    if (input instanceof Request) {
      const mapped = mapUrl(input);
      if (mapped !== input.url) input = new Request(mapped, input);
    } else {
      input = mapUrl(input);
    }

    const result = nativeFetch(input, nextInit);
    const isUsageCall =
      path === "/api/humanize" ||
      path === "/api/scan" ||
      path === "/api/detect" ||
      (path && (
        path.startsWith("/api/humanize/") ||
        path.startsWith("/api/scan/") ||
        path.startsWith("/api/detect/")
      ));
    if (isUsageCall) {
      result.then(() => refreshPolicy()).catch(() => {});
    }
    return result;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeOpen.call(this, method, mapUrl(url), ...rest);
  };

  document.addEventListener("click", (event) => {
    const button = event.target && event.target.closest ? event.target.closest("button") : null;
    if (button && button.textContent && button.textContent.trim() === "Rehumanize") {
      window.__trstSwFreeRehumanizeAt = Date.now();
    }

    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const raw = anchor.getAttribute("href") || "";
    const path = logicalPath(raw);
    if (path && !isAllowedNavigation(path)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = safeLanding();
      return;
    }
    const mapped = mapUrl(raw);
    if (mapped && mapped !== raw) anchor.setAttribute("href", mapped);
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form || !form.getAttribute) return;
    const action = form.getAttribute("action");
    if (!action) return;
    const mapped = mapUrl(action);
    if (mapped && mapped !== action) form.setAttribute("action", mapped);
  }, true);

  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);
  history.pushState = (state, title, url) =>
    nativePush(state, title, url == null ? url : enforceNavigation(url));
  history.replaceState = (state, title, url) =>
    nativeReplace(state, title, url == null ? url : enforceNavigation(url));

  function schedule() {
    refreshPolicy();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshPolicy, 30000);
    setInterval(tick, 60000);
    setTimeout(markLinks, 800);
  }

  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });

  new MutationObserver(() => {
    markLinks();
    if (policy && !document.getElementById("trst-sw-usage")) renderUsageWidget();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
