const SESSION = "__Secure-next-auth.session-token";
const SUPPORTING = new Set([
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "__Secure-oai-is",
  "_account",
  "_puid",
  "_uasid",
  "_umsid",
  "oai-did",
  "oai-sc",
  "oai_client_auth_info",
  "oai-client-auth-info",
  "oai-client-session-epoch",
  "oai-hlib",
  "__oailb",
]);
const TARGETS = ["user","me","init"];

function isApproved(name) {
  return name === SESSION ||
    /^__Secure-next-auth\.session-token\.\d+$/.test(name) ||
    SUPPORTING.has(name);
}

function parseCookieNames(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const i=part.indexOf("=");
      return i > 0 ? part.slice(0,i).trim() : "";
    })
    .filter(name => name && isApproved(name));
}

function targetFor(urlString) {
  try {
    const url=new URL(urlString);
    const path=url.pathname.toLowerCase();
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
    const target=targetFor(details.url);
    if (!target) return;

    const cookieHeader=(details.requestHeaders || []).find(
      h => String(h.name || "").toLowerCase() === "cookie"
    );
    const names=[...new Set(parseCookieNames(cookieHeader?.value))].sort();

    const current=(await chrome.storage.session.get("observed")).observed || {};
    current[target]={
      names,
      urlPath:(() => {
        try { return new URL(details.url).pathname; } catch { return ""; }
      })(),
      at:Date.now(),
    };
    await chrome.storage.session.set({observed:current});
  },
  {urls:["https://chatgpt.com/*"]},
  ["requestHeaders","extraHeaders"]
);
