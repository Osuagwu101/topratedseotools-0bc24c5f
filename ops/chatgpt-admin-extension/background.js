const TARGETS = ["user", "me", "init"];

function parseCookieNames(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const i = part.indexOf("=");
      return i > 0 ? part.slice(0, i).trim() : "";
    })
    .filter(Boolean);
}

function targetFor(urlString) {
  try {
    const url = new URL(urlString);
    const path = url.pathname.toLowerCase();
    for (const name of TARGETS) {
      if (
        path === "/" + name ||
        path.endsWith("/" + name) ||
        path.includes("/" + name + "/") ||
        url.searchParams.get("action") === name
      ) return name;
    }
  } catch {}
  return null;
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  async details => {
    const target = targetFor(details.url);
    if (!target) return;

    const cookieHeader = (details.requestHeaders || []).find(
      h => String(h.name || "").toLowerCase() === "cookie"
    );
    const names = [...new Set(parseCookieNames(cookieHeader?.value))].sort();

    const current = (await chrome.storage.session.get("observed")).observed || {};
    current[target] = {
      names,
      urlPath: (() => {
        try { return new URL(details.url).pathname; } catch { return ""; }
      })(),
      at: Date.now(),
    };
    await chrome.storage.session.set({ observed: current });
  },
  { urls: ["https://chatgpt.com/*"] },
  ["requestHeaders", "extraHeaders"]
);
