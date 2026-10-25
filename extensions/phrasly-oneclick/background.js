/* Recovered AWS message names and first-party endpoints, adapted for .com.
 * Provider authentication is NOT implemented here. Cookie-bearing fulfill
 * responses are rejected rather than transferred into a customer's browser.
 */
importScripts("config.js");
const SITE = globalThis.TRST_EXTENSION.origin;
const KEY = "trst_tracked_tabs";
const FEATURES = ["humanizer", "ai_detector"];
let storageQueue = Promise.resolve();
function updateTabs(change) {
  const next = storageQueue.catch(() => undefined).then(async () => {
    const data = await chrome.storage.session.get(KEY);
    const tabs = data[KEY] || {};
    change(tabs);
    await chrome.storage.session.set({ [KEY]: tabs });
  });
  storageQueue = next;
  return next;
}
function nativePage(url) {
  try { const u = new URL(url); return u.origin === "https://phrasly.ai" && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}
function nativeOrigin(url) {
  try { const u = new URL(url); return u.origin === "https://phrasly.ai" && !u.username && !u.password; }
  catch { return false; }
}
function siteSender(sender) {
  try { return new URL(sender.url).origin === SITE; } catch { return false; }
}
async function post(path, fields) {
  const response = await fetch(SITE + path, {
    method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(3_000),
  });
  return { status: response.status, data: await response.json() };
}
async function redeem(payload, signature) {
  if (!globalThis.TRST_EXTENSION.enabled) return { ok: false, error: "not_enabled" };
  if (typeof payload !== "string" || payload.length > 2048 || !/^[a-f0-9]{64}$/.test(signature || "")) return { ok: false, error: "bad_token" };
  const { status, data } = await post("/ext-fulfill.php", { payload, signature });
  if (status !== 200 || data.ok !== true) return { ok: false, error: data.error || "fulfill_failed" };
  if (Object.hasOwn(data, "cookies") || Object.hasOwn(data, "session") || Object.hasOwn(data, "password")) {
    return { ok: false, error: "provider_session_transfer_excluded" };
  }
  if (!nativePage(data.url) || typeof data.record_token !== "string" || data.record_token.length > 4096) return { ok: false, error: "bad_fulfill_response" };
  const tab = await chrome.tabs.create({ url: data.url });
  try { await updateTabs(tabs => { tabs[tab.id] = { recordToken: data.record_token }; }); }
  catch (error) { await chrome.tabs.remove(tab.id); throw error; }
  return { ok: true, used: data.used, limit: data.limit, provider_login: "not_performed" };
}
async function usage(sender, message) {
  if (!globalThis.TRST_EXTENSION.enabled || !sender.tab || sender.frameId !== 0 || !nativeOrigin(sender.url) || !FEATURES.includes(message.feature)) return { allowed: false };
  const all = await chrome.storage.session.get(KEY);
  const tracked = (all[KEY] || {})[sender.tab.id];
  if (!tracked || typeof message.action_id !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(message.action_id)) return { allowed: false };
  const { status, data } = await post("/ext-check-usage.php", { record_token: tracked.recordToken, feature: message.feature, action_id: message.action_id });
  if (status !== 200 || data.ok !== true || data.allowed !== true) {
    if (data.error === "limit_reached" || (data.ok === true && data.allowed === false)) {
      const seconds = Number.isSafeInteger(data.resets_in) && data.resets_in >= 0 && data.resets_in <= 86400 ? data.resets_in : 0;
      await chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("limit-reached.html") + "?resets_in=" + seconds });
      await updateTabs(tabs => { delete tabs[sender.tab.id]; });
    }
    return { allowed: false, error: data.error || "usage_unavailable" };
  }
  return { allowed: true, used: data.used, limit: data.limit };
}
chrome.tabs.onRemoved.addListener(id => { void updateTabs(tabs => { delete tabs[id]; }); });
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (!siteSender(sender) || message?.type !== "trst_access") return false;
  redeem(message.payload, message.signature).then(reply, () => reply({ ok: false, error: "access_unavailable" }));
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "trst_check_usage") return false;
  usage(sender, message).then(reply, () => reply({ allowed: false, error: "usage_unavailable" }));
  return true;
});
