const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '../extensions/phrasly-oneclick');
const SITE = 'https://topratedseotools.com';

function worker({ enabled = true, fulfill = {}, quota = { ok: true, allowed: true, used: 1, limit: 20 },
  sharedStorage = {}, rejectedCookies = [], firstPartySession = 'synthetic-first-party-session', whoamiStatus = 200, cookieReadError = false } = {}) {
  const storage = sharedStorage; const calls = []; const tabs = []; const updates = []; const events = []; const cookieSets = []; const cookieRemoves = []; const cookieJar = [];
  let external, internal, removed, navigation;
  const chrome = {
    storage: { session: { async get() { return structuredClone(storage); }, async set(data) { Object.assign(storage, structuredClone(data)); events.push('tracked'); } } },
    cookies: {
      async getAll(filter) { return cookieJar.filter(c => !filter.name || c.name === filter.name); },
      async set(data) { events.push('cookie:' + data.name); cookieSets.push(data); if (rejectedCookies.includes(data.name)) throw new Error('synthetic cookie failure'); cookieJar.splice(0,cookieJar.length,...cookieJar.filter(c=>c.name!==data.name)); const saved={...data,domain:data.domain||'phrasly.ai',hostOnly:!data.domain};cookieJar.push(saved);return saved; },
      async remove(data) { cookieRemoves.push(data); },
      async get() { if (cookieReadError) throw new Error('synthetic read failure'); return firstPartySession ? { value: firstPartySession } : null; },
    },
    tabs: { async create(data) { events.push('tab'); tabs.push(data); return { id: tabs.length }; },
      async update(id, data) { updates.push({ id, ...data }); }, onRemoved: { addListener(fn) { removed = fn; } } },
    webNavigation: { onBeforeNavigate: { addListener(fn) { navigation = fn; } } },
    runtime: { getURL: p => 'chrome-extension://fixture/' + p, onMessageExternal: { addListener(fn) { external = fn; } }, onMessage: { addListener(fn) { internal = fn; } } },
  };
  const context = vm.createContext({ chrome, URL, URLSearchParams, Object, Promise, Date,
    importScripts() {}, TRST_EXTENSION: { origin: SITE, enabled },
    async fetch(url, init) {
      calls.push({ url, init }); const endpoint = new URL(url).pathname;
      const status = endpoint === '/ext-whoami.php' ? whoamiStatus : 200;
      return { status, ok: status === 200, async json() {
        if (endpoint === '/ext-fulfill.php') return { ok: true, url: 'https://phrasly.ai/dashboard', record_token: 'synthetic-record', used: 0, limit: 20,
          cookies: [{ name: 'session', value: 'synthetic-secret', domain: '.phrasly.ai', httpOnly: true }],
          block_paths: ['/billing', '/account'], ...fulfill };
        if (endpoint === '/ext-whoami.php') return { ok: true, full_name: 'Synthetic Writer', tools: [] };
        return quota;
      } };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const send = (listener, message, sender = {}) => new Promise(resolve => {
    let replied = false;
    const keep = listener(message, sender, data => { replied = true; resolve(data); });
    if (!keep && !replied) resolve({ ignored: true });
  });
  return {
    access: () => send(external, { type: 'trst_access', payload: 'synthetic', signature: 'a'.repeat(64) }, { url: SITE + '/dashboard' }),
    usage: (feature = 'humanizer', sender = { tab: { id: 1 } }) => send(internal, { type: 'trst_check_usage', feature }, sender),
    whoami: () => send(internal, { type: 'trst_whoami' }),
    ping: () => send(external, { type: 'trst_ping' }),
    dispatch: (m, s, reply) => internal(m, s, reply),
    external: (m, s, reply) => external(m, s, reply),
    calls, tabs, updates, events, cookieSets, cookieRemoves, storage, context, removed, navigation,
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('manifest retains AWS permissions, popup, host scope and public extension identity', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.deepEqual(m.permissions, ['cookies', 'tabs', 'webNavigation', 'storage']);
  assert.deepEqual(m.host_permissions, [SITE + '/*', '*://*/*']);
  assert.deepEqual(m.externally_connectable.matches, [SITE + '/*']);
  assert.equal(m.action.default_popup, 'popup.html');
  const digest = createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...digest].map(x => String.fromCharCode(97 + parseInt(x, 16))).join('');
  assert.equal(id, 'lpgnjkafilbopdojcfnagooojifkccek');
});
test('the deployment readiness switch performs no backend call', async () => {
  for (const enabled of [true, false]) {
    const w = worker({ enabled }); assert.deepEqual(plain(await w.ping()), { ok: true, protocol: 3, enabled }); assert.equal(w.calls.length, 0);
  }
});
test('disabled deployment refuses session installation', async () => {
  const w = worker({ enabled: false }); assert.equal((await w.access()).error, 'not_enabled'); assert.equal(w.calls.length, 0); assert.equal(w.cookieSets.length, 0);
});
test('AWS cookie conversion preserves attributes and default HTTPS/lax behavior', () => {
  const w = worker();
  assert.deepEqual(plain(w.context.cookieToSetDetails({ name: 'synthetic', value: 'synthetic-value' }, 'https://phrasly.ai/dashboard')),
    { url: 'https://phrasly.ai/', name: 'synthetic', value: 'synthetic-value', path: '/', secure: true, httpOnly: false, sameSite: 'lax' });
  const explicit = w.context.cookieToSetDetails({ name: 'synthetic', value: 'synthetic-value', domain: '.phrasly.ai', path: '/app', secure: false, httpOnly: true, expirationDate: 1234, sameSite: 'strict' }, 'https://phrasly.ai/');
  assert.equal(explicit.url, 'http://phrasly.ai/app'); assert.equal(explicit.expirationDate, 1234); assert.equal(explicit.httpOnly, true); assert.equal(explicit.sameSite, 'strict');
});
test('fulfillment uses the original GET query token contract', async () => {
  const w = worker(); assert.equal((await w.access()).ok, true);
  const url = new URL(w.calls[0].url);
  assert.equal(url.pathname, '/ext-fulfill.php'); assert.equal(url.searchParams.get('payload'), 'synthetic'); assert.equal(url.searchParams.get('signature'), 'a'.repeat(64));
  assert.equal(w.calls[0].init, undefined);
});
test('cookie installation precedes native tab creation and tracking matches AWS order', async () => {
  const w = worker(); const response = await w.access();
  assert.deepEqual(w.events, ['cookie:session', 'tab', 'tracked']);
  assert.equal(w.tabs[0].url, 'https://phrasly.ai/dashboard');
  assert.equal(w.cookieSets[0].httpOnly, true);
  assert.deepEqual(Object.keys(response).sort(), ['limit', 'ok', 'results', 'used']);
  assert.equal(JSON.stringify(response).includes('synthetic-secret'), false);
  assert.equal(JSON.stringify(w.storage).includes('synthetic-secret'), false);
  assert.equal(w.storage.trst_tracked_tabs[1].appliedCookies[0].name, 'session');
});
test('failed login-cookie installation refuses to open a guest tab', async () => {
  const w = worker({ rejectedCookies: ['session'] }); const response = await w.access();
  assert.equal(response.ok, false); assert.equal(response.error,'session_cookie_not_installed');assert.equal(response.results.success.length, 0);assert.ok(response.results.failed.length>=1);
  assert.equal(w.tabs.length, 0);
});
test('failed fulfillment opens no tab and forwards its countdown', async () => {
  const w = worker({ fulfill: { ok: false, error: 'limit_reached', resets_in: 30 } });
  const response = await w.access(); assert.equal(response.error, 'limit_reached'); assert.equal(response.resets_in, 30); assert.equal(w.tabs.length, 0);
});
test('popup identity reads PHPSESSID and sends X-Ext-Session exactly as AWS', async () => {
  const w = worker(); const response = await w.whoami();
  assert.equal(response.full_name, 'Synthetic Writer'); assert.equal(w.calls[0].url, SITE + '/ext-whoami.php');
  assert.deepEqual(plain(w.calls[0].init), { headers: { 'X-Ext-Session': 'synthetic-first-party-session' } });
});
test('missing first-party session gives the original popup error without a backend request', async () => {
  const w = worker({ firstPartySession: null }); assert.equal((await w.whoami()).error, 'no_PHPSESSID_cookie_found'); assert.equal(w.calls.length, 0);
});
test('popup cookie and HTTP errors retain the AWS error path', async () => {
  assert.match((await worker({ cookieReadError: true }).whoami()).error, /^cookies.get threw:/);
  assert.equal((await worker({ whoamiStatus: 403 }).whoami()).error, 'whoami http 403');
});
test('opening is free and each native action sends only record_token and feature', async () => {
  const w = worker(); await w.access(); assert.equal(w.calls.length, 1); assert.equal((await w.usage()).allowed, true);
  const fields = new URLSearchParams(w.calls[1].init.body);
  assert.deepEqual([...fields.keys()].sort(), ['feature', 'record_token']); assert.equal(fields.get('record_token'), 'synthetic-record'); assert.equal(fields.get('feature'), 'humanizer');
});
test('untracked tab and absent sender tab are denied without a usage request', async () => {
  const w = worker(); assert.equal((await w.usage()).allowed, false); assert.equal((await w.usage('humanizer', {})).allowed, false); assert.equal(w.calls.length, 0);
});
test('quota denial clears installed cookies, opens countdown and untracks', async () => {
  const w = worker({ quota: { ok: true, allowed: false, resets_in: 120 } }); await w.access();
  assert.equal((await w.usage()).allowed, false);
  assert.deepEqual(plain(w.cookieRemoves), [{ url: 'https://phrasly.ai/', name: 'session' }]);
  assert.match(w.updates[0].url, /limit-reached.html\?resets_in=120$/); assert.deepEqual(Object.keys(w.storage.trst_tracked_tabs), []);
});
test('an upstream access error also clears cookies and redirects, matching AWS', async () => {
  const w = worker({ quota: { ok: false, error: 'account_inactive' } }); await w.access();
  assert.equal((await w.usage()).allowed, false); assert.equal(w.cookieRemoves.length, 1); assert.match(w.updates[0].url, /resets_in=0$/);
});
test('record/cookie metadata survives a worker restart', async () => {
  const sharedStorage = {}; await worker({ sharedStorage }).access(); const w = worker({ sharedStorage });
  assert.equal((await w.usage('ai_detector')).allowed, true);
  assert.equal(sharedStorage.trst_tracked_tabs[1].blockPaths[0], '/billing');
});
test('closing a tab removes tracking without clearing the shared browser cookie jar', async () => {
  const w = worker(); await w.access(); w.removed(1); await new Promise(setImmediate);
  assert.deepEqual(Object.keys(w.storage.trst_tracked_tabs), []); assert.equal(w.cookieRemoves.length, 0);
});
test('top-level blocked path prefixes redirect to the saved landing URL', async () => {
  const w = worker(); await w.access();
  await w.navigation({ tabId: 1, frameId: 1, url: 'https://phrasly.ai/billing' }); assert.equal(w.updates.length, 0);
  await w.navigation({ tabId: 1, frameId: 0, url: 'https://phrasly.ai/billing/plan' });
  assert.equal(w.updates[0].url, 'https://phrasly.ai/dashboard');
  await w.navigation({ tabId: 1, frameId: 0, url: 'https://phrasly.ai/dashboard' }); assert.equal(w.updates.length, 1);
});

function pageContext(reply) {
  const listeners = new Set(); const requests = []; const timers = []; let nativeCalls = 0;
  const win = {
    location: { href: 'https://phrasly.ai/dashboard', origin: 'https://phrasly.ai' },
    async fetch() { nativeCalls++; return new Response('synthetic native reply'); },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    postMessage(message) {
      requests.push(message);
      if (reply !== undefined) queueMicrotask(() => {
        for (const fn of [...listeners]) fn({ source: win, data: { source: 'trst-interceptor-reply', requestId: message.requestId, allowed: reply } });
      });
    },
  };
  const context = vm.createContext({ window: win, URL, Response, setTimeout(fn, ms) { timers.push({ fn, ms }); } });
  vm.runInContext(fs.readFileSync(path.join(root, 'interceptor.js'), 'utf8'), context);
  return { win, requests, timers, nativeCalls: () => nativeCalls };
}
test('AWS path substring matching remains method-agnostic and accepts matching foreign URLs', async () => {
  const p = pageContext(true);
  await p.win.fetch('/api/ai/rewrite', { method: 'POST' });
  await p.win.fetch('/api/ai/detect/preview', { method: 'GET' });
  await p.win.fetch('https://foreign.invalid/api/ai/rewrite', { method: 'GET' });
  assert.deepEqual(p.requests.map(x => x.feature), ['humanizer', 'ai_detector', 'humanizer']); assert.equal(p.nativeCalls(), 3);
});
test('unwatched paths are passed through without any quota message', async () => {
  const p = pageContext(undefined); await p.win.fetch('/unwatched'); assert.equal(p.nativeCalls(), 1); assert.equal(p.requests.length, 0);
});
test('explicit denial suppresses the native request with AWS 429 response', async () => {
  const p = pageContext(false); const response = await p.win.fetch('/api/ai/rewrite', { method: 'POST' });
  assert.equal(response.status, 429); assert.equal(p.nativeCalls(), 0); assert.equal((await response.json()).error, 'Daily limit reached.');
});
test('the recovered four-second timeout fails open exactly as AWS', async () => {
  const p = pageContext(undefined); const pending = p.win.fetch('/api/ai/rewrite', { method: 'POST' });
  assert.equal(p.timers[0].ms, 4000); p.timers[0].fn();
  assert.equal((await pending).status, 200); assert.equal(p.nativeCalls(), 1);
});
for (const allowed of [true, false]) test('combined original MAIN / isolated / worker relay, allowed=' + allowed, async () => {
  const w = worker({ quota: { ok: true, allowed, resets_in: 60 } }); await w.access();
  const listeners = new Set(); let nativeCalls = 0;
  const win = { location: { href: 'https://phrasly.ai/dashboard', origin: 'https://phrasly.ai' },
    async fetch() { nativeCalls++; return new Response('synthetic native reply'); },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    postMessage(data) { queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: win, data }); }); },
  };
  const chrome = { runtime: { lastError: null, sendMessage(message, callback) { w.dispatch(message, { tab: { id: 1 } }, callback); } } };
  const context = vm.createContext({ window: win, chrome, URL, Response, Node: { ELEMENT_NODE: 1 }, document: { documentElement: {}, body: null },
    MutationObserver: class { observe() {} }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'interceptor.js'), 'utf8'), context);
  assert.equal((await win.fetch('/api/ai/rewrite', { method: 'POST' })).status, allowed ? 200 : 429); assert.equal(nativeCalls, allowed ? 1 : 0);
});
