import {ADMIN_ORIGIN, ADMIN_PATH, IMPORT_TTL_MS, isPhraslyDomain, isPhraslyPage, validateCookies, checkClaim} from "./core.mjs";

const PENDING = "phraslyPendingImport", EXPIRY = "phraslyImportExpiry";
let serial = Promise.resolve();
const mutate = fn => { const operation = serial.then(fn); serial = operation.catch(() => {}); return operation; };
const safeErrors = new Set(["phrasly_page_required", "phrasly_sign_in_required", "cookie_store_unavailable", "invalid_cookie_bundle", "invalid_import", "import_expired", "untrusted_import"]);
const failure = e => ({ok: false, error: safeErrors.has(e?.message) ? e.message : "extension_request_failed"});

async function collect(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("phrasly_page_required");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !isPhraslyPage(tab.url)) throw new Error("phrasly_page_required");
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find(s => s.tabIds.includes(tabId));
  if (!store) throw new Error("cookie_store_unavailable");
  // Match the supplied AWS EXR: export all cookies for the active native URL.
  const cookies=await chrome.cookies.getAll({url:tab.url,storeId:store.id});
  return validateCookies(cookies,false);
}

async function createImport(tabId) {
  const cookies = validateCookies(await collect(tabId));
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const capturedAt = Date.now(), expiresAt = capturedAt + IMPORT_TTL_MS;
  const tab = await chrome.tabs.create({url: "about:blank", active: true});
  if (!Number.isInteger(tab.id)) throw new Error("extension_request_failed");
  try {
    await chrome.storage.session.set({[PENDING]: {nonce, cookies, capturedAt, expiresAt, tabId: tab.id}});
    await chrome.alarms.create(EXPIRY, {when: expiresAt});
    await chrome.tabs.update(tab.id, {url: ADMIN_ORIGIN + ADMIN_PATH + "#cookie-import=" + nonce});
    return {ok: true, count: cookies.length};
  } catch (e) {
    await chrome.storage.session.remove(PENDING);
    await chrome.alarms.clear(EXPIRY);
    throw e;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  if (message?.type !== "GET_PHRASLY_COOKIES" && message?.type !== "SEND_PHRASLY_COOKIES") return false;
  const operation = message.type === "GET_PHRASLY_COOKIES"
    ? collect(message.tabId).then(cookies => ({ok: true, cookies}))
    : mutate(() => createImport(message.tabId));
  operation.then(respond, e => respond(failure(e)));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (message?.type !== "TOPRATED_PHRASLY_COOKIE_IMPORT" || message.version !== 1) return false;
  mutate(async () => {
    const pending = (await chrome.storage.session.get(PENDING))[PENDING];
    let result;
    try { result = checkClaim(pending, message.nonce, sender); }
    catch (e) {
      if (e.message === "import_expired" && pending?.expiresAt <= Date.now()) await chrome.storage.session.remove(PENDING);
      throw e;
    }
    // Consume before replying: a second tab or concurrent retry cannot obtain the cookies.
    await chrome.storage.session.remove(PENDING);
    await chrome.alarms.clear(EXPIRY);
    return result;
  }).then(respond, e => respond(failure(e)));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== EXPIRY) return;
  void mutate(async () => {
    const pending = (await chrome.storage.session.get(PENDING))[PENDING];
    if (!pending || pending.expiresAt <= Date.now()) await chrome.storage.session.remove(PENDING);
  });
});
