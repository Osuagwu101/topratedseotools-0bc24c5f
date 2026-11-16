/* URL mapping, fetch/XHR and navigation hooks adapted from StealthWriter bootstrap. */
export function quillBotProxyBootstrapResponse(base = "/__qbtest") {
  const script = String.raw`(() => {
  if (window.__trstQbBootstrap) return;
  window.__trstQbBootstrap = true;
  const PROXY = ${JSON.stringify(base)};
  const MAIN_HOST = "quillbot.com";
  const ASSET_HOSTS = new Set(["media.quillbot.com", "libs.quillbot.com", "assets.quillbot.com"]);
  const inProxy = p => p === PROXY || p.startsWith(PROXY + "/");
  function mapUrl(value) {
    if (!value) return value;
    try {
      const raw = value instanceof Request ? value.url : value instanceof URL ? value.href : String(value);
      const u = new URL(raw, window.location.href);
      if (u.origin === window.location.origin && inProxy(u.pathname)) return raw;
      if (u.protocol === "https:" && u.hostname === MAIN_HOST && !u.port) return PROXY + u.pathname + u.search + u.hash;
      if (u.protocol === "https:" && ASSET_HOSTS.has(u.hostname) && !u.port) return PROXY + "/__host/" + u.hostname + u.pathname + u.search + u.hash;
      if (u.origin === window.location.origin) return PROXY + u.pathname + u.search + u.hash;
      return raw;
    } catch { return value; }
  }
  function logicalPath(value) {
    try {
      const u = new URL(String(value), window.location.href);
      if (u.hostname === MAIN_HOST || ASSET_HOSTS.has(u.hostname)) return u.pathname;
      if (u.origin !== window.location.origin) return null;
      let p = inProxy(u.pathname) ? u.pathname.slice(PROXY.length) : u.pathname;
      p = p.replace(/^\/__host\/[^/]+/, "");
      return decodeURIComponent(p || "/");
    } catch { return null; }
  }
  function blocked(value) {
    const p = logicalPath(value);
    return p && (/^\/(?:logout|signout|sign-out|billing|account|accounts|subscription|subscriptions|premium|upgrade|settings)(?:\/|$)/i.test(p) || /^\/api\/auth\/(?!token(?:\/|$))/.test(p));
  }
  function enforceNavigation(value) { return blocked(value) ? PROXY + "/paraphrasing-tool" : mapUrl(value); }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (blocked(input instanceof Request ? input.url : input)) return Promise.resolve(new Response("QuillBot account action disabled", { status: 403 }));
    if (input instanceof Request) {
      const mapped = mapUrl(input); if (mapped !== input.url) input = new Request(new URL(mapped, window.location.href), input);
    } else input = mapUrl(input);
    return nativeFetch(input, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeOpen.call(this, method, blocked(url) ? PROXY + "/account" : mapUrl(url), ...rest);
  };
  const nativeWindowOpen = window.open.bind(window);
  window.open = (url, ...rest) => nativeWindowOpen(url == null ? url : enforceNavigation(url), ...rest);
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);
  history.pushState = (state, title, url) => nativePush(state, title, url == null ? url : enforceNavigation(url));
  history.replaceState = (state, title, url) => nativeReplace(state, title, url == null ? url : enforceNavigation(url));
  const nativeBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (nativeBeacon) navigator.sendBeacon = (url, data) => blocked(url) ? false : nativeBeacon(mapUrl(url), data);
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (["src","href","action","poster"].includes(String(name).toLowerCase()) && /^(SCRIPT|IMG|LINK|A|FORM|SOURCE|VIDEO|AUDIO|IFRAME)$/.test(this.tagName)) value = mapUrl(value);
    return nativeSetAttribute.call(this, name, value);
  };
  for (const [Ctor, prop] of [[HTMLScriptElement,"src"],[HTMLImageElement,"src"],[HTMLLinkElement,"href"],[HTMLAnchorElement,"href"],[HTMLFormElement,"action"]]) {
    const descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!descriptor || !descriptor.set || !descriptor.configurable) continue;
    Object.defineProperty(Ctor.prototype, prop, { ...descriptor, set(value) { descriptor.set.call(this, mapUrl(value)); } });
  }
  document.addEventListener("click", event => {
    const a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!a) return;
    const raw = a.getAttribute("href");
    if (blocked(raw)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const mapped = mapUrl(raw); if (mapped && mapped !== raw) a.setAttribute("href", mapped);
  }, true);
  document.addEventListener("submit", event => {
    const form = event.target;
    if (!form || !form.getAttribute) return;
    const raw = form.getAttribute("action");
    if (blocked(raw)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (raw) form.setAttribute("action", mapUrl(raw));
  }, true);
  function markLinks() {
    for (const a of document.querySelectorAll("a[href]")) {
      const raw = a.getAttribute("href"); if (!raw || raw.startsWith("#")) continue;
      if (blocked(raw)) { a.setAttribute("aria-disabled", "true"); a.style.setProperty("pointer-events", "none"); a.style.setProperty("opacity", ".45"); }
      else { const mapped = mapUrl(raw); if (mapped !== raw) a.setAttribute("href", mapped); }
    }
  }
  new MutationObserver(markLinks).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markLinks, { once: true }); else markLinks();
})();`;
  return new Response(script, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow, noarchive" } });
}
