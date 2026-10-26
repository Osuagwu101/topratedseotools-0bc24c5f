/* Actual AWS extension in Chromium. All account/session values are synthetic.
 * The loopback proxy has no upstream forwarding path. No provider is contacted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const SITE = 'https://toprated-staging.example.test';
const NATIVE = 'https://phrasly.ai';
const AWS_ID = 'lpgnjkafilbopdojcfnagooojifkccek';
const PROVIDER_COOKIE = 'trst_synthetic_provider';

async function fixture(enabled, { signedIn = true } = {}) {
  const protocol = await import(pathToFileURL(path.join(root, 'src/lib/phrasly-extension/protocol.server.ts')).href);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trst-aws-mv3-'));
  let context, server, proxy;
  const connections = new Set();
  const closeServers = async () => {
    for (const socket of connections) socket.destroy();
    for (const service of [proxy, server]) if (service?.listening) {
      service.closeAllConnections?.();
      await new Promise(resolve => service.close(resolve));
    }
  };
  try {
    const extension = path.join(temporary, 'extension');
    execFileSync('python3', [path.join(root, 'scripts/phrasly/build-native-extension.py'), '--origin', SITE, '--out', extension, ...(enabled ? ['--enabled'] : [])]);
    const fixtureKey = path.join(temporary, 'fixture.key'), fixtureCert = path.join(temporary, 'fixture.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=toprated-staging.example.test', '-addext', 'subjectAltName=DNS:toprated-staging.example.test,DNS:phrasly.ai', '-keyout', fixtureKey, '-out', fixtureCert], { stdio: 'ignore' });
    let handler;
    server = https.createServer({ key: fs.readFileSync(fixtureKey), cert: fs.readFileSync(fixtureCert) }, async (request, response) => {
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error('oversized synthetic request'); }
        const route = {
          request: () => ({ url: () => 'https://' + request.headers.host + request.url, method: () => request.method, headers: () => request.headers, postData: () => body }),
          fulfill: ({ status = 200, contentType = 'text/plain', body = '' }) => { response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(body); },
          abort: () => { response.writeHead(404); response.end(); },
        };
        if (!handler) throw new Error('fixture not ready');
        await handler(route);
      } catch (error) { response.writeHead(500); response.end('fixture failure'); console.error(error); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
    proxy.on('connect', (request, client, head) => {
      // Chromium may reset a rejected background CONNECT during profile teardown.
      // Cover rejected sockets too; they never reach the upstream listener below.
      client.on('error', () => client.destroy());
      if (!['toprated-staging.example.test:443', 'phrasly.ai:443'].includes(request.url)) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      const upstream = net.connect(server.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      for (const socket of [client, upstream]) {
        connections.add(socket);
        socket.on('close', () => connections.delete(socket));
        socket.on('error', () => { client.destroy(); upstream.destroy(); });
      }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
      proxy: { server: 'http://127.0.0.1:' + proxy.address().port },
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1', '--ignore-certificate-errors'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = new URL(worker.url()).host;
    assert.equal(id, AWS_ID, 'the original public manifest key must retain the AWS extension ID');
    const state = { handoffs: 0, fulfillments: 0, whoami: 0, identityHeaderAccepted: false, usage: [], native: [], otherRequests: [],
      used: { humanizer: 0, ai_detector: 0 }, revoked: false, providerStatus: 200, token: null };
    const secret = randomBytes(48).toString('hex');
    const firstPartySession = randomBytes(24).toString('hex'), providerSession = randomBytes(24).toString('hex');
    const records = new Set();
    const launcher = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/lib/phrasly-extension/launcher.ts'), 'utf8'));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const handoff = feature => protocol.issueAwsHandoff(42, 7, feature, Math.floor(Date.now() / 1000), secret);
    const hasCookie = (request, name, value) => (request.headers().cookie || '').split(';').some(part => part.trim() === name + '=' + value);
    const nativePage = authenticated => [
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic AWS native fixture</title>',
      '<h1 id="fixture-auth">' + (authenticated ? 'authenticated' : 'not_authenticated') + '</h1>',
      '<p>Local session fixture. No real provider login or processing.</p>',
      '<button id="humanizer">Humanizer</button><button id="ai_detector">Detector</button><output id="status"></output>',
      '<div id="accountMenu"><button>Settings</button><button>Billing</button><button>Log out</button></div>',
      '<script>for(const [feature,path] of [["humanizer","rewrite"],["ai_detector","detect"]]){',
      'document.getElementById(feature).onclick=async()=>{const r=await fetch("/api/ai/"+path,{method:"POST",body:JSON.stringify({text:"synthetic fixture text"})});document.getElementById("status").textContent=feature+":"+r.status;};',
      '}</script></html>',
    ].join('');
    handler = async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === SITE) {
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
        if (url.pathname === '/launcher.js') return route.fulfill({ contentType: 'application/javascript', body: launcher });
        if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: [
          '<!doctype html><title>TopRated staging fixture</title><script type="module">',
          'import {createPhraslyLauncher} from "/launcher.js";',
          'globalThis.launcher=createPhraslyLauncher({extensionId:' + JSON.stringify(id) + ',runtime:globalThis.chrome?.runtime,',
          'requestHandoff:async feature=>{const r=await fetch("/ext-handoff.php?tool_id=7&feature="+encodeURIComponent(feature));if(!r.ok)throw new Error("fixture denied");return r.json();}});',
          '</script>',
        ].join('') });
        if (url.pathname === '/ext-handoff.php') {
          assert.equal(request.method(), 'GET');
          if (!hasCookie(request, 'PHPSESSID', firstPartySession)) return json(route, { ok: false, error: 'not_signed_in' }, 401);
          const feature = url.searchParams.get('feature');
          state.handoffs++; state.token = handoff(feature);
          return json(route, state.token);
        }
        if (url.pathname === '/ext-whoami.php') {
          assert.equal(request.method(), 'GET'); state.whoami++;
          state.identityHeaderAccepted = request.headers()['x-ext-session'] === firstPartySession;
          if (!state.identityHeaderAccepted) return json(route, { ok: false, error: 'not_signed_in' });
          return json(route, { ok: true, full_name: 'Synthetic Writer', email: 'writer@example.test', subscription_end: '2099-12-31 23:59:59',
            tools: [{ id: 7, name: 'Phrasly', type: 'cookie_extension', active: true, resets_in: 120,
              features: ['humanizer', 'ai_detector'].map(feature => ({
                key: feature, label: feature === 'humanizer' ? 'Humanizer' : 'AI Detector', used: state.used[feature], limit: 1,
                maxed: state.used[feature] >= 1, ...(state.used[feature] < 1 ? handoff(feature) : {}),
              })) }] });
        }
        if (url.pathname === '/ext-fulfill.php') {
          assert.equal(request.method(), 'GET'); state.fulfillments++;
          assert.deepEqual([...url.searchParams.keys()].sort(), ['payload', 'signature']);
          let claims;
          try { claims = protocol.verifyAwsToken(url.searchParams.get('payload'), url.searchParams.get('signature'), 'handoff', Math.floor(Date.now() / 1000), secret); }
          catch { return json(route, { ok: false, error: 'bad_token' }, 403); }
          if (state.revoked) return json(route, { ok: false, error: 'account_inactive' }, 403);
          if (state.used[claims.feature] >= 1) return json(route, { ok: false, error: 'limit_reached', limit: 1, resets_in: 120 }, 429);
          // AWS does not persist one-use redemption: a valid handoff can be redeemed again within its TTL.
          const record = protocol.issueAwsRecordToken(42, 7, Math.floor(Date.now() / 1000), secret);
          records.add(record);
          return json(route, { ok: true, url: NATIVE + '/dashboard',
            cookies: [{ name: PROVIDER_COOKIE, value: providerSession, path: '/', secure: true, httpOnly: true, sameSite: 'lax' }],
            block_paths: ['/billing', '/account'], record_token: record, used: state.used[claims.feature], limit: 1 });
        }
        if (url.pathname === '/ext-check-usage.php') {
          assert.equal(request.method(), 'POST');
          const fields = Object.fromEntries(new URLSearchParams(request.postData()));
          assert.deepEqual(Object.keys(fields).sort(), ['feature', 'record_token']);
          state.usage.push({ feature: fields.feature });
          if (state.revoked || !records.has(fields.record_token)) return json(route, { ok: false, error: 'account_inactive' }, 403);
          const [payload, signature] = fields.record_token.split('.');
          protocol.verifyAwsToken(payload, signature, 'record', Math.floor(Date.now() / 1000), secret);
          if (!Object.hasOwn(state.used, fields.feature)) return json(route, { ok: false, error: 'no_access' }, 403);
          const allowed = state.used[fields.feature] < 1;
          if (allowed) state.used[fields.feature]++;
          return json(route, { ok: true, allowed, used: state.used[fields.feature], limit: 1, resets_in: 120 });
        }
        state.otherRequests.push(url.pathname); return route.abort();
      }
      if (url.origin === NATIVE) {
        const authenticated = hasCookie(request, PROVIDER_COOKIE, providerSession);
        if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: nativePage(authenticated) });
        if (url.pathname === '/billing' || url.pathname === '/account') return route.fulfill({ contentType: 'text/html', body: '<title>Synthetic account page</title>' });
        if (request.method() === 'POST' && ['/api/ai/rewrite', '/api/ai/detect'].includes(url.pathname)) {
          state.native.push({ path: url.pathname, authenticated });
          return json(route, { fixture: true }, authenticated ? state.providerStatus : 401);
        }
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      }
      state.otherRequests.push(url.origin + url.pathname); return route.abort();
    };
    const cookie = (name, value, url) => ({ name, value, url, httpOnly: true, secure: true, sameSite: 'Lax' });
    if (signedIn) await context.addCookies([cookie('PHPSESSID', firstPartySession, SITE + '/')]);
    const page = await context.newPage(); await page.goto(SITE + '/dashboard');
    await page.waitForFunction(() => !!globalThis.launcher);
    return {
      context, page, state, id,
      async seedProvider() { await context.addCookies([cookie(PROVIDER_COOKIE, providerSession, NATIVE + '/')]); },
      async providerCookiePresent() { return (await context.cookies(NATIVE)).some(c => c.name === PROVIDER_COOKIE); },
      async openPopup() { const popup = await context.newPage(); await popup.goto('chrome-extension://' + id + '/popup.html'); return popup; },
      async launch(feature = 'humanizer') {
        const opened = context.waitForEvent('page');
        assert.deepEqual(await page.evaluate(feature => globalThis.launcher.launch(feature), feature), { ok: true });
        const native = await opened; await native.waitForURL(NATIVE + '/dashboard'); await native.locator('#humanizer').waitFor();
        return native;
      },
      async close() { await context.close(); await closeServers(); fs.rmSync(temporary, { recursive: true, force: true }); },
    };
  } catch (error) {
    if (context) await context.close();
    await closeServers(); fs.rmSync(temporary, { recursive: true, force: true }); throw error;
  }
}

test('real AWS MV3: cookie login, native actions, menu/nav controls and quota cookie cleanup', { timeout: 90_000 }, async () => {
  const f = await fixture(true);
  try {
    assert.deepEqual(await f.page.evaluate(() => globalThis.launcher.probe()), { ok: true });
    const native = await f.launch();
    assert.equal(await native.locator('#fixture-auth').textContent(), 'authenticated');
    assert.equal(await f.providerCookiePresent(), true);
    assert.equal(await native.evaluate(() => document.cookie.includes('trst_synthetic_provider')), false, 'HttpOnly session must stay outside page JavaScript');
    assert.equal(f.state.usage.length, 0, 'opening does not increment the daily count');
    await native.waitForFunction(() => document.querySelector('#accountMenu').getAttribute('data-trst-hidden') === '1');
    assert.equal(await native.locator('#accountMenu').isVisible(), false);
    const navigate = native.goto(NATIVE + '/billing').catch(error => { if (!/ERR_ABORTED|interrupted/.test(error.message)) throw error; });
    await navigate; await native.waitForURL(NATIVE + '/dashboard');
    await native.click('#humanizer'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:200');
    await native.click('#ai_detector'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'ai_detector:200');
    assert.deepEqual(f.state.used, { humanizer: 1, ai_detector: 1 });
    assert.equal(f.state.native.length, 2); assert.equal(f.state.native.every(r => r.authenticated), true);
    await native.click('#humanizer'); await native.waitForURL(/chrome-extension:\/\/.*\/limit-reached.html\?resets_in=120/);
    assert.equal(await native.locator('#resetsIn').textContent(), '2m');
    assert.equal(f.state.native.length, 2); assert.equal(await f.providerCookiePresent(), false);
    assert.deepEqual(f.state.otherRequests, []);
    console.log(JSON.stringify({ mode: 'original-AWS-MV3-with-synthetic-sessions', native_provider_contacts: 0,
      checks: ['stable-AWS-id', 'cookie-installation', 'HttpOnly-cookie', 'no-count-on-open', 'account-menu', 'navigation-redirect', 'humanizer', 'detector', 'quota-denial', 'cookie-removal', 'countdown'] }));
  } finally { await f.close(); }
});

test('real AWS popup: PHP session bridge, identity/features and internal launch', { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  try {
    const popup = await f.openPopup();
    await popup.locator('#signedIn:not(.hidden)').waitFor();
    assert.equal(await popup.locator('#fullName').textContent(), 'Synthetic Writer');
    assert.equal(await popup.locator('.tool').count(), 2);
    assert.equal(f.state.identityHeaderAccepted, true); assert.equal(f.state.whoami, 1);
    const opened = f.context.waitForEvent('page'); await popup.locator('.tool-btn').first().click();
    const native = await opened; await native.waitForURL(NATIVE + '/dashboard'); await native.locator('#fixture-auth').waitFor();
    assert.equal(await native.locator('#fixture-auth').textContent(), 'authenticated'); assert.equal(f.state.usage.length, 0);
    assert.deepEqual(f.state.otherRequests, []);
  } finally { await f.close(); }
});

test('real AWS popup: signed-out state and configured first-party login link', { timeout: 60_000 }, async () => {
  const f = await fixture(true, { signedIn: false });
  try {
    const popup = await f.openPopup(); await popup.locator('#signedOut:not(.hidden)').waitFor();
    assert.equal(await popup.locator('#signedOut a').getAttribute('href'), SITE + '/login');
    assert.equal(f.state.whoami, 0); assert.equal(f.state.fulfillments, 0);
  } finally { await f.close(); }
});

test('real AWS behavior: upstream denial clears the shared cookie session', { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  try {
    const native = await f.launch(); assert.equal(await f.providerCookiePresent(), true);
    f.state.revoked = true;
    await native.click('#humanizer'); await native.waitForURL(/limit-reached.html\?resets_in=0/);
    assert.equal(await f.providerCookiePresent(), false); assert.equal(f.state.native.length, 0); assert.equal(f.state.used.humanizer, 0);
  } finally { await f.close(); }
});

test('real AWS behavior: untracked native tabs are denied without backend quota calls', { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  try {
    await f.seedProvider(); const native = await f.context.newPage(); await native.goto(NATIVE + '/dashboard');
    await native.click('#humanizer'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:429');
    assert.equal(f.state.usage.length, 0); assert.equal(f.state.native.length, 0); assert.equal(await f.providerCookiePresent(), true);
  } finally { await f.close(); }
});

test('real AWS behavior: a handoff can be redeemed again within its valid TTL', { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  try {
    await f.launch(); const opened = f.context.waitForEvent('page');
    const replay = await f.page.evaluate(({ id, token }) => new Promise(resolve => chrome.runtime.sendMessage(id, { type: 'trst_access', ...token }, resolve)),
      { id: f.id, token: f.state.token });
    assert.equal(replay.ok, true); const native = await opened; await native.waitForURL(NATIVE + '/dashboard');
    assert.equal(f.state.fulfillments, 2); assert.equal(f.state.usage.length, 0);
  } finally { await f.close(); }
});

test('real AWS behavior: processing failure still consumes a first-party attempt', { timeout: 60_000 }, async () => {
  const f = await fixture(true);
  try {
    const native = await f.launch(); f.state.providerStatus = 500;
    await native.click('#humanizer'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:500');
    assert.equal(f.state.used.humanizer, 1); assert.equal(f.state.native.length, 1);
  } finally { await f.close(); }
});

test('disabled package: no handoff, content interception or menu hiding', { timeout: 60_000 }, async () => {
  const f = await fixture(false);
  try {
    assert.deepEqual(await f.page.evaluate(() => globalThis.launcher.launch('ai_detector')), { ok: false, error: 'extension_disabled' });
    assert.equal(f.state.handoffs, 0); assert.equal(f.state.fulfillments, 0);
    await f.seedProvider(); const native = await f.context.newPage(); await native.goto(NATIVE + '/dashboard');
    await native.click('#ai_detector'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'ai_detector:200');
    assert.equal(f.state.usage.length, 0); assert.equal(f.state.native.length, 1);
    assert.equal(await native.locator('#accountMenu').isVisible(), true); assert.deepEqual(f.state.otherRequests, []);
  } finally { await f.close(); }
});
