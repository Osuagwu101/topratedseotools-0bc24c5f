// AWS extension body with the .com origin and an explicit staging switch.
importScripts('config.js');
// Top Rated SEO Tools — Access extension
//
// Flow: a signed, 60-second token (issued by our backend to a logged-in
// user, one per feature — e.g. Humanizer vs AI Detector on the same real
// account) gets handed to us — either by the dashboard page itself (a web
// page, via onMessageExternal, restricted to our own origin in
// manifest.json) or by this extension's own popup (via onMessage, after it
// reads the user's real login session straight from the browser's cookie
// jar using the privileged cookies API — see whoami() below). Either way we
// redeem the token against /ext-fulfill.php ourselves — the page/popup never
// sees the real cookie values, only this background script does. We get
// back the real site's cookies + URL, a block_paths list (billing/account/
// logout, kept away from entirely via webNavigation), and a longer-lived
// record_token — injected via chrome.cookies.set, tab opened, and that tab
// tracked for the rest of its life.
//
// The REAL per-action limit enforcement happens continuously after that:
// interceptor.js (injected into Phrasly's own page, MAIN world) watches for
// the actual Humanize/Detect API calls and, via content.js's relay, asks
// this script — on every single real click — whether the user is still
// under their daily cap, using that tab's record_token. If not, the real
// request is suppressed entirely (interceptor.js) AND this script closes
// out the tab with a clear "limit reached" page. No reverse proxy involved
// at any point — Phrasly is only ever contacted by the user's own browser.

const BASE_URL = globalThis.TRST_EXTENSION.origin;
const FULFILL_URL = `${BASE_URL}/ext-fulfill.php`;
const WHOAMI_URL = `${BASE_URL}/ext-whoami.php`;
const CHECK_USAGE_URL = `${BASE_URL}/ext-check-usage.php`;
const TRACKED_TABS_KEY = 'trst_tracked_tabs';

function cookieToSetDetails(cookie, pageUrl) {
  const domain = cookie.domain || new URL(pageUrl).hostname;
  const secure = cookie.secure !== false; // default true unless explicitly false
  const url = (secure ? 'https://' : 'http://') + domain.replace(/^\./, '') + (cookie.path || '/');
  return {
    url,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.hostOnly === true ? undefined : (cookie.domain || undefined),
    path: cookie.path || '/',
    secure,
    httpOnly: !!cookie.httpOnly,
    expirationDate: cookie.expirationDate ?? (cookie.expires > 0 ? cookie.expires : undefined),
    sameSite: cookie.sameSite || 'lax',
  };
}

async function applyCookies(url, cookies) {
  const results = { success: [], failed: [] };
  const sessions = Array.isArray(cookies) ? cookies.filter(c => c.name === 'session') : [];
  const login = sessions[0];
  const root = c => String(c.domain || new URL(url).hostname).replace(/^\./, '').toLowerCase() === 'phrasly.ai';
  if (sessions.length !== 1 || !root(login) || (login.path || '/') !== '/' || !login.value) {
    results.failed.push({ name: 'session', error: 'missing_login_cookie' });
    return results;
  }
  const loginDetails = cookieToSetDetails(login, url);
  if (loginDetails.expirationDate !== undefined && loginDetails.expirationDate <= Date.now() / 1000) {
    results.failed.push({ name: 'session', error: 'expired_login_cookie' });
    return results;
  }
  try {
    // Chrome can retain separate host-only/domain cookies with the same name.
    // Remove old root-site login variants before installing the Admin session.
    const existing = (await chrome.cookies.getAll({ domain: 'phrasly.ai', name: 'session' })).filter(root);
    const matches = existing.length === 1 && existing[0].path === '/' && existing[0].value === login.value && existing[0].hostOnly === (loginDetails.domain === undefined);
    if (!matches) {
      for (const old of existing) {
        const details = { url: 'https://phrasly.ai' + (old.path || '/'), name: 'session' };
        if (old.storeId) details.storeId = old.storeId;
        if (old.partitionKey) details.partitionKey = old.partitionKey;
        await chrome.cookies.remove(details);
      }
    }
  } catch {
    results.failed.push({ name: 'session', error: 'login_cookie_replacement_failed' });
    return results;
  }
  for (const cookie of cookies) {
    const details = cookieToSetDetails(cookie, url);
    try {
      const saved = await chrome.cookies.set(details);
      if (!saved || saved.value !== cookie.value) throw new Error('cookie_not_saved');
      results.success.push({ name: cookie.name, domain: details.domain || new URL(url).hostname, url: details.url });
    } catch {
      results.failed.push({ name: cookie.name, error: 'cookie_not_saved' });
    }
  }
  try {
    const installed = (await chrome.cookies.getAll({ domain: 'phrasly.ai', name: 'session' })).filter(root);
    if (installed.length !== 1 || installed[0].path !== '/' || installed[0].value !== login.value) {
      results.failed.push({ name: 'session', error: 'login_cookie_not_verified' });
    }
  } catch {
    results.failed.push({ name: 'session', error: 'login_cookie_not_verified' });
  }
  return results;
}

async function clearCookies(appliedCookies) {
  for (const c of appliedCookies || []) {
    try {
      await chrome.cookies.remove({ url: c.url, name: c.name });
    } catch (err) {
      // best effort — not fatal if one fails
    }
  }
}

// --- Per-tab tracking (survives service worker restarts via
// chrome.storage.session — a plain in-memory Map would silently stop
// working after the worker goes idle, which MV3 does aggressively). ---

async function getTrackedTabs() {
  const data = await chrome.storage.session.get(TRACKED_TABS_KEY);
  return data[TRACKED_TABS_KEY] || {};
}

async function trackTab(tabId, info) {
  const tabs = await getTrackedTabs();
  tabs[tabId] = info;
  await chrome.storage.session.set({ [TRACKED_TABS_KEY]: tabs });
}

async function untrackTab(tabId) {
  const tabs = await getTrackedTabs();
  if (tabs[tabId]) {
    delete tabs[tabId];
    await chrome.storage.session.set({ [TRACKED_TABS_KEY]: tabs });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => { untrackTab(tabId); });

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // only top-level navigations
  const tabs = await getTrackedTabs();
  const tracked = tabs[details.tabId];
  if (!tracked) return;

  let path;
  try {
    path = new URL(details.url).pathname;
  } catch (err) {
    return;
  }

  const blocked = (tracked.blockPaths || []).some((p) => p && path.startsWith(p));
  if (blocked) {
    chrome.tabs.update(details.tabId, { url: tracked.landingUrl });
  }
});

async function redeemAccessToken(payload, signature) {
  if (!globalThis.TRST_EXTENSION.enabled) return { ok: false, error: 'not_enabled' };
  const res = await fetch(
    `${FULFILL_URL}?payload=${encodeURIComponent(payload)}&signature=${encodeURIComponent(signature)}`
  );
  const data = await res.json();
  if (!data.ok) {
    return { ok: false, error: data.error || 'fulfill_failed', resets_in: data.resets_in };
  }
  const results = await applyCookies(data.url, data.cookies);
  if (!results.success.some(c => c.name === 'session') || results.failed.some(c => c.name === 'session')) {
    return { ok: false, error: 'session_cookie_not_installed', results };
  }
  const tab = await chrome.tabs.create({ url: data.url });
  await trackTab(tab.id, {
    blockPaths: data.block_paths,
    landingUrl: data.url,
    recordToken: data.record_token,
    appliedCookies: results.success,
  });
  return { ok: true, results, used: data.used, limit: data.limit };
}

// Real per-action check, called by content.js's relay every time
// interceptor.js catches an actual Humanize/Detect call on Phrasly's page.
async function checkUsage(tabId, feature) {
  if (!globalThis.TRST_EXTENSION.enabled) return { allowed: true };
  const tabs = await getTrackedTabs();
  const tracked = tabs[tabId];
  if (!tracked || !tracked.recordToken) {
    return { allowed: false };
  }

  const res = await fetch(CHECK_USAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `record_token=${encodeURIComponent(tracked.recordToken)}&feature=${encodeURIComponent(feature)}`,
  });
  const data = await res.json();

  if (!data.ok || !data.allowed) {
    await clearCookies(tracked.appliedCookies);
    const resetsIn = data.resets_in || 0;
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(`limit-reached.html?resets_in=${encodeURIComponent(resetsIn)}`),
    });
    await untrackTab(tabId);
    return { allowed: false };
  }

  return { allowed: true, used: data.used, limit: data.limit };
}

// Reads the user's real login session cookie straight from the browser's
// cookie jar (not via a fetch — a popup-origin fetch can't carry a
// SameSite=Lax cookie cross-site) and asks the backend who that is and what
// they have access to.
async function whoami() {
  if (!globalThis.TRST_EXTENSION.enabled) return { ok: false, error: 'not_enabled' };
  let cookie;
  try {
    cookie = await chrome.cookies.get({ url: BASE_URL + '/', name: 'PHPSESSID' });
  } catch (err) {
    return { ok: false, error: 'cookies.get threw: ' + String(err) };
  }
  if (!cookie) {
    return { ok: false, error: 'no_PHPSESSID_cookie_found' };
  }
  try {
    const res = await fetch(WHOAMI_URL, { headers: { 'X-Ext-Session': cookie.value } });
    if (!res.ok) {
      return { ok: false, error: 'whoami http ' + res.status };
    }
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'fetch threw: ' + String(err) };
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'trst_ping') {
    sendResponse({ ok: true, protocol: 3, enabled: globalThis.TRST_EXTENSION.enabled === true });
    return false;
  }
  if (!message || message.type !== 'trst_access') {
    return false;
  }
  redeemAccessToken(message.payload, message.signature).then(sendResponse);
  return true; // keep the message channel open for the async sendResponse above
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }
  if (message.type === 'trst_whoami') {
    whoami().then(sendResponse);
    return true;
  }
  if (message.type === 'trst_access') {
    redeemAccessToken(message.payload, message.signature).then(sendResponse);
    return true;
  }
  if (message.type === 'trst_check_usage') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId === undefined) {
      sendResponse({ allowed: false });
      return false;
    }
    checkUsage(tabId, message.feature).then(sendResponse);
    return true;
  }
  return false;
});
