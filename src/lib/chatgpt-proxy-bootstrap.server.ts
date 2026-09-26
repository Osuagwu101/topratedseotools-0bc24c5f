export function chatgptProxyBootstrapResponse(
  proxyBase = "/api/chatgpt-proxy",
) {
  const proxyBaseJson = JSON.stringify(proxyBase);
  const assetHosts = JSON.stringify(
    Array.from(
      new Set(
        ["cdn.oaistatic.com", "persistent.oaistatic.com", ...String(process.env.CHATGPT_ASSET_HOSTS ?? "")
          .split(",")]
          .map((value) => value.trim().toLowerCase())
          .filter(
            (host) =>
              host &&
              ((host.endsWith(".chatgpt.com") && host !== "chatgpt.com") ||
                host === "oaistatic.com" ||
                host.endsWith(".oaistatic.com")),
          ),
      ),
    ),
  );
  const script = String.raw`(() => {
  const PROXY = ${proxyBaseJson};
  const MAIN = "https://chatgpt.com";
  const ASSET_HOSTS = new Set(${assetHosts});

  function mapUrl(value) {
    if (!value) return value;
    try {
      const raw = value instanceof Request
        ? value.url
        : value instanceof URL
          ? value.href
          : String(value);
      const u = new URL(raw, window.location.href);

      if (u.origin === window.location.origin && u.pathname.startsWith(PROXY)) {
        return raw;
      }
      if (u.origin === MAIN) {
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

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const mapped = mapUrl(input);
      if (mapped !== input.url) input = new Request(mapped, input);
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
    const anchor = event.target && event.target.closest
      ? event.target.closest("a[href]")
      : null;
    if (!anchor) return;
    const raw = anchor.getAttribute("href") || "";
    if (!raw || raw.startsWith("#")) return;
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
    nativePush(state, title, url == null ? url : mapUrl(url));
  history.replaceState = (state, title, url) =>
    nativeReplace(state, title, url == null ? url : mapUrl(url));

  const observer = new MutationObserver(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const raw = a.getAttribute("href") || "";
      if (!raw || raw.startsWith("#")) continue;
      const mapped = mapUrl(raw);
      if (mapped && mapped !== raw) a.setAttribute("href", mapped);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
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
