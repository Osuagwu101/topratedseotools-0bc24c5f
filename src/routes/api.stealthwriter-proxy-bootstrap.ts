import { createFileRoute } from "@tanstack/react-router";

const script = String.raw`(() => {
  const PROXY = "/api/stealthwriter-proxy";
  const UPSTREAM_HOSTS = new Set(["stealthwriter.ai", "www.stealthwriter.ai"]);

  function mapUrl(value) {
    if (!value) return value;
    let raw;
    try {
      raw = value instanceof Request ? value.url : value instanceof URL ? value.href : String(value);
      const u = new URL(raw, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith(PROXY)) return raw;
      if (UPSTREAM_HOSTS.has(u.hostname)) {
        return PROXY + u.pathname + u.search + u.hash;
      }
      if (u.origin === window.location.origin && u.pathname.startsWith("/")) {
        return PROXY + u.pathname + u.search + u.hash;
      }
      return raw;
    } catch {
      return value;
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const mapped = mapUrl(input);
      if (mapped !== input.url) {
        input = new Request(mapped, input);
      }
    } else {
      input = mapUrl(input);
    }
    return nativeFetch(input, init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeOpen.call(this, method, mapUrl(url), ...rest);
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const mapped = mapUrl(anchor.getAttribute("href"));
    if (mapped && mapped !== anchor.getAttribute("href")) anchor.setAttribute("href", mapped);
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
  history.pushState = (state, title, url) => nativePush(state, title, url == null ? url : mapUrl(url));
  history.replaceState = (state, title, url) => nativeReplace(state, title, url == null ? url : mapUrl(url));
})();`;

export const Route = createFileRoute("/api/stealthwriter-proxy-bootstrap")({
  server: {
    handlers: {
      GET: async () =>
        new Response(script, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
          },
        }),
    },
  },
});
