export const ADMIN_ORIGIN = "https://topratedseotools.com";
export const ADMIN_PATH = "/admin/phrasly";
export const IMPORT_TTL_MS = 5 * 60 * 1000;
export const MAX_COOKIES = 100;
export const MAX_BYTES = 200000;
export const NONCE = /^[a-f0-9]{64}$/;

export function isPhraslyDomain(domain) {
  if (typeof domain !== "string") return false;
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "phrasly.ai" || host.endsWith(".phrasly.ai");
}

export function isPhraslyPage(raw) {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.port && isPhraslyDomain(u.hostname); }
  catch { return false; }
}

export function validateCookies(cookies, requireSession = true) {
  if (!Array.isArray(cookies) || !cookies.length || cookies.length > MAX_COOKIES ||
      !cookies.every(c => c && typeof c.name === "string" && typeof c.value === "string" && isPhraslyDomain(c.domain)) ||
      new TextEncoder().encode(JSON.stringify(cookies)).length > MAX_BYTES) throw new Error("invalid_cookie_bundle");
  if (requireSession && !cookies.some(c => c.name === "session" && c.value.length > 0)) throw new Error("phrasly_sign_in_required");
  return cookies;
}

export function trustedAdminSender(sender, nonce, tabId) {
  try {
    const u = new URL(sender?.url);
    return typeof tabId === "number" && sender?.tab?.id === tabId &&
      (!sender.origin || sender.origin === ADMIN_ORIGIN) && u.origin === ADMIN_ORIGIN &&
      u.pathname === ADMIN_PATH && u.search === "" && u.hash === "#cookie-import=" + nonce;
  } catch { return false; }
}

export function checkClaim(pending, nonce, sender, now = Date.now()) {
  if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new Error("invalid_import");
  if (!pending || pending.expiresAt <= now) throw new Error("import_expired");
  if (pending.nonce !== nonce || !trustedAdminSender(sender, nonce, pending.tabId)) throw new Error("untrusted_import");
  validateCookies(pending.cookies);
  return {ok: true, cookies: pending.cookies, capturedAt: pending.capturedAt, source: "phrasly.ai"};
}
