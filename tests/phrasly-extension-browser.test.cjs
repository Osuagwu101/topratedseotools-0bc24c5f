/* Real Chromium/MV3 test. HTTPS uses a local TLS fixture through a restricted proxy.
 * The first-party handlers and native page are synthetic contract fixtures.
 * This does not authenticate to Phrasly or validate provider processing.
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

async function fixture(enabled) {
  const protocol = await import(pathToFileURL(path.join(root, 'src/lib/phrasly-extension/protocol.server.ts')).href);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trst-mv3-'));
  let context; let server; let proxy;
  const connections = new Set();
  const closeServers = async () => {
    for (const socket of connections) socket.destroy();
    for (const service of [proxy, server]) if (service?.listening) {
      service.closeAllConnections?.(); await new Promise(resolve => service.close(resolve));
    }
  };
  try {
    const extension = path.join(temporary, 'extension');
    execFileSync('python3', [path.join(root, 'scripts/phrasly/build-native-extension.py'), '--origin', SITE, '--out', extension, ...(enabled ? ['--enabled'] : [])]);
    const fixtureKey = path.join(temporary, 'fixture.key'); const fixtureCert = path.join(temporary, 'fixture.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=toprated-staging.example.test', '-addext', 'subjectAltName=DNS:toprated-staging.example.test,DNS:phrasly.ai', '-keyout', fixtureKey, '-out', fixtureCert], { stdio: 'ignore' });
    let handler;
    server = https.createServer({ key: fs.readFileSync(fixtureKey), cert: fs.readFileSync(fixtureCert) }, async (request, response) => {
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error('oversized fixture request'); }
        const route = {
          request: () => ({ url: () => 'https://' + request.headers.host + request.url, method: () => request.method,
            headers: () => request.headers, postData: () => body, postDataJSON: () => JSON.parse(body) }),
          fulfill: ({ status = 200, contentType = 'text/plain', body = '' }) => { response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(body); },
          abort: () => { response.writeHead(404); response.end(); },
        };
        if (!handler) throw new Error('fixture handler not ready');
        await handler(route);
      } catch (error) { response.writeHead(500); response.end('fixture failure'); console.error(error); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
    proxy.on('connect', (request, client, head) => {
      // Every permitted target goes to this fixture. No upstream DNS/network call exists.
      if (!['toprated-staging.example.test:443', 'phrasly.ai:443'].includes(request.url)) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      const upstream = net.connect(server.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      for (const socket of [client, upstream]) {
        connections.add(socket); socket.on('close', () => connections.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); });
      }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
      proxy: { server: 'http://127.0.0.1:' + proxy.address().port },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1', '--ignore-certificate-errors'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = new URL(worker.url()).host;
    const state = { handoffs: 0, fulfillments: 0, usage: [], native: [], otherRequests: [], used: { humanizer: 0, ai_detector: 0 }, revoked: false, token: null };
    const secret = randomBytes(48).toString('hex');
    const issued = new Set(); const records = new Set(); const actions = new Map();
    const key = token => token.payload + '.' + token.signature;
    const launcher = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/lib/phrasly-extension/launcher.ts'), 'utf8'));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const nativePage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic native action fixture</title>
      <p>This page is a local contract fixture. No Phrasly login or processing occurs.</p>
      <button id="humanizer">Humanizer</button><button id="ai_detector">Detector</button><output id="status"></output>
      <script>for(const [feature,path] of [['humanizer','rewrite'],['ai_detector','detect']]){
        document.getElementById(feature).onclick=async()=>{const r=await fetch('/api/ai/'+path,{method:'POST',body:JSON.stringify({text:'synthetic fixture text'})});document.getElementById('status').textContent=feature+':'+r.status;};
      }</script></html>`;
    handler = async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin === SITE) {
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
        if (url.pathname === '/launcher.js') return route.fulfill({ contentType: 'application/javascript', body: launcher });
        if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>TopRated staging fixture</title><script type="module">
          import {createPhraslyLauncher} from '/launcher.js';
          globalThis.launcher=createPhraslyLauncher({extensionId:${JSON.stringify(id)},runtime:globalThis.chrome?.runtime,
            requestHandoff:async feature=>{const r=await fetch('/ext-handoff.php',{method:'POST',headers:{Authorization:'Bearer fixture-account','Content-Type':'application/json'},body:JSON.stringify({feature})});if(!r.ok)throw new Error('fixture access denied');return r.json();}});
          </script>` });
        if (request.method() !== 'POST') return json(route, { ok: false, error: 'method_not_allowed' }, 405);
        if (url.pathname === '/ext-handoff.php') {
          if (request.headers().authorization !== 'Bearer fixture-account') return json(route, { ok: false }, 401);
          state.handoffs++;
          const feature = request.postDataJSON().feature;
          const token = protocol.issueAwsHandoff('fixture-user', 'phrasly', feature, Math.floor(Date.now() / 1000), secret);
          state.token = token; issued.add(key(token));
          return json(route, token);
        }
        const fields = Object.fromEntries(new URLSearchParams(request.postData()));
        if (url.pathname === '/ext-fulfill.php') {
          state.fulfillments++;
          assert.deepEqual(Object.keys(fields).sort(), ['payload', 'signature']);
          try { protocol.verifyAwsToken(fields.payload, fields.signature, 'handoff', Math.floor(Date.now() / 1000), secret); }
          catch { return json(route, { ok: false, error: 'bad_token' }, 403); }
          if (!issued.delete(key(fields))) return json(route, { ok: false, error: 'already_redeemed' }, 403);
          const token = protocol.issueAwsRecordToken('fixture-user', 'phrasly', Math.floor(Date.now() / 1000), secret);
          records.add(token);
          return json(route, { ok: true, url: NATIVE + '/dashboard', record_token: token, used: 0, limit: 1 });
        }
        if (url.pathname === '/ext-check-usage.php') {
          assert.deepEqual(Object.keys(fields).sort(), ['action_id', 'feature', 'record_token']);
          state.usage.push({ feature: fields.feature });
          if (state.revoked || !records.has(fields.record_token)) return json(route, { ok: false, error: 'access_revoked' }, 403);
          const [payload, signature] = fields.record_token.split('.');
          protocol.verifyAwsToken(payload, signature, 'record', Math.floor(Date.now() / 1000), secret);
          if (!Object.hasOwn(state.used, fields.feature)) return json(route, { ok: false }, 403);
          if (actions.has(fields.action_id)) return json(route, actions.get(fields.action_id));
          const allowed = state.used[fields.feature] < 1;
          if (allowed) state.used[fields.feature]++;
          const reply = { ok: true, allowed, used: state.used[fields.feature], limit: 1, resets_in: 120 };
          actions.set(fields.action_id, reply);
          return json(route, reply);
        }
        state.otherRequests.push(url.pathname); return route.abort();
      }
      if (url.origin === NATIVE) {
        if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: nativePage });
        if (request.method() === 'POST' && ['/api/ai/rewrite', '/api/ai/detect'].includes(url.pathname)) {
          state.native.push(url.pathname); return json(route, { fixture: true });
        }
        if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      }
      state.otherRequests.push(url.origin + url.pathname); return route.abort();
    };
    const page = await context.newPage();
    await page.goto(SITE + '/dashboard');
    await page.waitForFunction(() => !!globalThis.launcher);
    return { context, page, state, id, temporary, async close() { await context.close(); await closeServers(); fs.rmSync(temporary, { recursive: true, force: true }); } };
  } catch (error) {
    if (context) await context.close();
    await closeServers();
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

test('real MV3: first-party launch, both native actions, revocation, quota countdown and unmanaged use', { timeout: 90_000 }, async () => {
  const f = await fixture(true);
  try {
    assert.deepEqual(await f.page.evaluate(() => globalThis.launcher.probe()), { ok: true });
    const opened = f.context.waitForEvent('page');
    assert.deepEqual(await f.page.evaluate(() => globalThis.launcher.launch('humanizer')), { ok: true, provider_login: 'not_performed' });
    const native = await opened;
    await native.waitForURL(NATIVE + '/dashboard');
    const injection = await native.evaluate(() => ({ configuration: globalThis.TRST_EXTENSION || null, wrappedFetch: window.fetch.toString().includes('permission') }));
    console.log(JSON.stringify({ nativeInjection: injection, grantedPermissions: await f.context.serviceWorkers()[0].evaluate(() => chrome.permissions.getAll()) }));
    assert.equal(injection.configuration?.enabled, true, 'manifest content scripts must execute in the native page');
    assert.equal(injection.wrappedFetch, true, 'MAIN world must wrap fetch before actions');
    assert.equal(f.state.handoffs, 1); assert.equal(f.state.fulfillments, 1); assert.equal(f.state.usage.length, 0);
    const replay = await f.page.evaluate(({ id, token }) => new Promise(resolve => chrome.runtime.sendMessage(id, { type: 'trst_access', ...token }, resolve)), { id: f.id, token: f.state.token });
    assert.equal(replay.error, 'already_redeemed');
    await native.click('#humanizer'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:200');
    await native.click('#ai_detector'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'ai_detector:200');
    assert.deepEqual(f.state.used, { humanizer: 1, ai_detector: 1 });
    assert.deepEqual(f.state.native, ['/api/ai/rewrite', '/api/ai/detect']);
    f.state.revoked = true;
    await native.click('#humanizer'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:429');
    assert.equal(f.state.native.length, 2); assert.equal(f.state.used.humanizer, 1);
    f.state.revoked = false;
    await native.click('#humanizer'); await native.waitForURL(/chrome-extension:\/\/.*\/limit-reached.html\?resets_in=120/);
    assert.equal(f.state.native.length, 2);
    assert.equal(await native.locator('#resetsIn').textContent(), '0h 2m');
    const usageBefore = f.state.usage.length;
    const unmanaged = await f.context.newPage(); await unmanaged.goto(NATIVE + '/dashboard');
    await unmanaged.click('#humanizer'); await unmanaged.waitForFunction(() => document.querySelector('#status').textContent === 'humanizer:200');
    assert.equal(f.state.usage.length, usageBefore); assert.equal(f.state.native.length, 3);
    assert.deepEqual(f.state.otherRequests, []);
    console.log(JSON.stringify({ mode: 'real-chromium-mv3-with-local-contract-fixtures', native_provider_contacts: 0, checks: ['installed-extension-id', 'website-readiness', 'single-launch', 'no-count-on-open', 'replay-denied', 'humanizer', 'detector', 'revocation', 'quota-denial', 'countdown', 'unmanaged-use'] }));
  } finally { await f.close(); }
});

test('real MV3: disabled package issues no handoff and leaves native fetch untouched', { timeout: 60_000 }, async () => {
  const f = await fixture(false);
  try {
    assert.deepEqual(await f.page.evaluate(() => globalThis.launcher.launch('ai_detector')), { ok: false, error: 'extension_disabled' });
    assert.equal(f.state.handoffs, 0); assert.equal(f.state.fulfillments, 0);
    const native = await f.context.newPage(); await native.goto(NATIVE + '/dashboard');
    await native.click('#ai_detector'); await native.waitForFunction(() => document.querySelector('#status').textContent === 'ai_detector:200');
    assert.equal(f.state.usage.length, 0); assert.equal(f.state.native.length, 1);
    assert.deepEqual(f.state.otherRequests, []);
  } finally { await f.close(); }
});
