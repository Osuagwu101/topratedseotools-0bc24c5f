const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.join(__dirname, '../extensions/phrasly-oneclick');

function worker({ enabled = true, fulfill = {}, quota = { ok: true, allowed: true, used: 1, limit: 20 }, sharedStorage = {} } = {}) {
  const storage = sharedStorage; const calls = []; const tabs = []; const updates = [];
  let external, internal, removed;
  const chrome = {
    storage: { session: { async get() { return structuredClone(storage); }, async set(data) { Object.assign(storage, structuredClone(data)); } } },
    tabs: { async create(tab) { tabs.push(tab); return { id: tabs.length }; }, async update(id, data) { updates.push({ id, ...data }); }, async remove() {}, onRemoved: { addListener(fn) { removed = fn; } } },
    runtime: { getURL: p => 'chrome-extension://fixture/' + p, onMessageExternal: { addListener(fn) { external = fn; } }, onMessage: { addListener(fn) { internal = fn; } } },
  };
  const context = vm.createContext({ chrome, URL, URLSearchParams, AbortSignal, Object, Promise,
    importScripts() {}, TRST_EXTENSION: { origin: 'https://topratedseotools.com', enabled },
    async fetch(url, init) { calls.push({ url, init }); return { status: 200, async json() { return url.endsWith('/ext-fulfill.php') ? { ok: true, url: 'https://phrasly.ai/', record_token: 'fixture-record', used: 0, limit: 20, ...fulfill } : quota; } }; },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const access = (sender = { url: 'https://topratedseotools.com/dashboard' }) => new Promise(resolve => {
    const active = external({ type: 'trst_access', payload: 'fixture', signature: 'a'.repeat(64) }, sender, resolve);
    if (!active) resolve({ ignored: true });
  });
  const usage = (feature = 'humanizer', sender = { tab: { id: 1 }, frameId: 0, url: 'https://phrasly.ai/dashboard?tab=humanizer' }) => new Promise(resolve => {
    internal({ type: 'trst_check_usage', feature, action_id: randomUUID() }, sender, resolve);
  });
  return { access, usage, calls, tabs, updates, storage, context, removed, dispatch: (m, s, reply) => internal(m, s, reply) };
}

test('manifest has no cookie, all-host or webNavigation permission', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://topratedseotools.com/*']);
  assert.equal(manifest.key, undefined);
});
test('source distribution is disabled until backend/browser integration', () => {
  assert.match(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), /enabled: false/);
});
test('disabled extension does not contact the server', async () => {
  const w = worker({ enabled: false }); assert.equal((await w.access()).error, 'not_enabled'); assert.equal(w.calls.length, 0);
});
test('foreign websites cannot redeem a handoff', async () => {
  const w = worker(); assert.equal((await w.access({ url: 'https://untrusted.invalid' })).ignored, true); assert.equal(w.calls.length, 0);
});
test('redemption opens a native page without transferring or asserting provider login', async () => {
  const w = worker(); const result = await w.access();
  assert.equal(result.ok, true); assert.equal(result.provider_login, 'not_performed');
  assert.equal(w.calls.length, 1); assert.equal(w.calls[0].url, 'https://topratedseotools.com/ext-fulfill.php');
  assert.equal(w.calls[0].init.method, 'POST'); assert.equal(w.calls[0].init.credentials, 'omit');
  assert.equal(w.tabs[0].url, 'https://phrasly.ai/');
});
test('original shared-cookie fulfillment is explicitly rejected', async () => {
  const w = worker({ fulfill: { cookies: [{ name: 'fixture', value: 'not-live' }] } });
  assert.equal((await w.access()).error, 'provider_session_transfer_excluded'); assert.equal(w.tabs.length, 0);
});
for (const url of ['http://phrasly.ai/', 'https://untrusted.invalid/', 'https://phrasly.ai/?session=fixture']) test(`unapproved native target ${url}`, async () => {
  const w = worker({ fulfill: { url } }); assert.equal((await w.access()).error, 'bad_fulfill_response'); assert.equal(w.tabs.length, 0);
});
test('opening a native page does not increment usage; action dispatch uses the record token', async () => {
  const w = worker(); await w.access(); assert.equal(w.calls.length, 1);
  assert.equal((await w.usage()).allowed, true);
  assert.equal(w.calls[1].url, 'https://topratedseotools.com/ext-check-usage.php');
  const fields = new URLSearchParams(w.calls[1].init.body);
  assert.equal(fields.get('record_token'), 'fixture-record'); assert.equal(fields.get('feature'), 'humanizer'); assert.ok(fields.get('action_id'));
});
test('untracked tab, subframe and unsupported feature cannot consume usage', async () => {
  const w = worker();
  assert.equal((await w.usage()).allowed, false);
  await w.access();
  assert.equal((await w.usage('humanizer', { tab: { id: 1 }, frameId: 1, url: 'https://phrasly.ai/' })).allowed, false);
  assert.equal((await w.usage('unsupported')).allowed, false); assert.equal(w.calls.length, 1);
});
test('daily denial opens the countdown and removes tracked capability, without changing provider cookies', async () => {
  const w = worker({ quota: { ok: true, allowed: false, used: 20, limit: 20, resets_in: 120 } });
  await w.access(); assert.equal((await w.usage()).allowed, false);
  assert.match(w.updates[0].url, /limit-reached.html\?resets_in=120$/);
  assert.equal(Object.keys(w.storage.trst_tracked_tabs).length, 0);
});
test('tracked capability survives a service-worker restart', async () => {
  const sharedStorage = {};
  await worker({ sharedStorage }).access();
  assert.equal((await worker({ sharedStorage }).usage()).allowed, true);
});
test('concurrent launches retain both tab records', async () => {
  const w = worker(); await Promise.all([w.access(), w.access()]);
  assert.deepEqual(Object.keys(w.storage.trst_tracked_tabs).sort(), ['1', '2']);
});
for (const allowed of [true, false]) test(`combined MAIN-world/content/worker/quota relay, allowed=${allowed}`, async () => {
  const w = worker({ quota: { ok: true, allowed, used: allowed ? 1 : 20, limit: 20, resets_in: 60 } });
  await w.access();
  const listeners = new Set(); let nativeCalls = 0;
  const win = { location: { href: 'https://phrasly.ai/dashboard', origin: 'https://phrasly.ai' },
    async fetch() { nativeCalls++; return new Response('native fixture'); },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    postMessage(data) { queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: win, origin: win.location.origin, data }); }); },
  };
  const chrome = { runtime: { lastError: null, sendMessage(message, reply) {
    w.dispatch(message, { tab: { id: 1 }, frameId: 0, url: win.location.href }, reply);
  } } };
  const context = vm.createContext({ window: win, chrome, URL, Response, Map, crypto: { randomUUID }, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'interceptor.js'), 'utf8'), context);
  const response = await win.fetch('/api/ai/rewrite', { method: 'POST' });
  assert.equal(response.status, allowed ? 200 : 429); assert.equal(nativeCalls, allowed ? 1 : 0);
  assert.equal(w.calls.filter(x => x.url.endsWith('/ext-check-usage.php')).length, 1);
});

function interceptor(reply) {
  const listeners = new Set(); const calls = []; let timeout; let originalCalls = 0;
  const win = { location: { href: 'https://phrasly.ai/dashboard', origin: 'https://phrasly.ai' },
    async fetch() { originalCalls++; return new Response('native fixture'); },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    postMessage(message) { calls.push(message); if (reply !== undefined) for (const fn of [...listeners]) fn({ source: win, origin: win.location.origin, data: { source: 'trst-interceptor-reply', requestId: message.requestId, allowed: reply } }); },
  };
  const ctx = vm.createContext({ window: win, URL, Response, Map, crypto: { randomUUID },
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'interceptor.js'), 'utf8'), ctx);
  return { win, calls, expire: () => timeout(), originalCalls: () => originalCalls };
}
test('only the recovered exact native POST action paths ask for quota', async () => {
  const c = interceptor(true);
  await c.win.fetch('/other', { method: 'POST' }); await c.win.fetch('/api/ai/rewrite', { method: 'GET' });
  await c.win.fetch('https://untrusted.invalid/api/ai/rewrite', { method: 'POST' });
  assert.equal(c.calls.length, 0);
  await c.win.fetch('/api/ai/rewrite', { method: 'POST' }); await c.win.fetch('/api/ai/detect', { method: 'POST' });
  assert.equal(c.calls[0].feature, 'humanizer'); assert.equal(c.calls[1].feature, 'ai_detector'); assert.equal(c.originalCalls(), 5);
});
test('denial suppresses the native request', async () => {
  const c = interceptor(false); assert.equal((await c.win.fetch('/api/ai/rewrite', { method: 'POST' })).status, 429); assert.equal(c.originalCalls(), 0);
});
test('relay timeout fails closed instead of the AWS fail-open behavior', async () => {
  const c = interceptor(); const pending = c.win.fetch('/api/ai/rewrite', { method: 'POST' }); c.expire();
  assert.equal((await pending).status, 429); assert.equal(c.originalCalls(), 0);
});
