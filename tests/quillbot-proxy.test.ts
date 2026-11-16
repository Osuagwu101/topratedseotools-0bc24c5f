import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildQuillBotUpstreamHeaders, proxyQuillBotRequest, redactQuillBotAuth, rewriteQuillBotBody, extractQuillBotAuthRotation, quillBotApplicationCookieHeader } from "../src/lib/quillbot-proxy.server.ts";
import { resolveQuillBotUpstreamPath, rewriteQuillBotUpstreamLocation } from "../src/lib/quillbot-provider.server.ts";
import { normaliseQuillBotSession } from "../src/lib/quillbot-session.server.ts";
import { quillBotProxyBootstrapResponse } from "../src/lib/quillbot-proxy-bootstrap.server.ts";
const state = { cookie: "qbDeviceId=opaque-device-value; app_session=exact%2Fvalue==; cf_clearance=edge-proof; __cf_bm=edge-state", useridtoken: "opaque-upstream-user-token" };
const req = (path: string, init: RequestInit = {}) => new Request("https://chatgpt.topratedseotools.com/__qbtest" + path, init);
test("media API receives provider token and canonical Origin/Referer", () => {
  const h = buildQuillBotUpstreamHeaders(req("/__host/media.quillbot.com/api/auth/token", { headers: { cookie: "trst_qb_proxy=customer-token", authorization: "Bearer customer", useridtoken: "customer", referer: "https://chatgpt.topratedseotools.com/__qbtest/paraphrasing-tool?x=1" } }), state, new URL("https://media.quillbot.com/api/auth/token"));
  assert.equal(h.get("useridtoken"), state.useridtoken); assert.equal(h.get("origin"), "https://quillbot.com"); assert.equal(h.get("referer"), "https://quillbot.com/paraphrasing-tool?x=1");
  assert.equal(h.get("authorization"), null); assert.ok(!h.get("cookie")!.includes("customer")); assert.ok(!h.get("cookie")!.includes("cf_clearance"));
});
test("secondary static assets do not receive provider credentials", () => { const h = buildQuillBotUpstreamHeaders(req("/__host/media.quillbot.com/font.woff"), state, new URL("https://media.quillbot.com/font.woff")); assert.equal(h.get("cookie"), null); assert.equal(h.get("useridtoken"), null); });
test("application cookie bytes remain exact while edge verification cookies are excluded", () => { assert.equal(quillBotApplicationCookieHeader(state.cookie), "qbDeviceId=opaque-device-value; app_session=exact%2Fvalue=="); });
test("main origin headers preserve browser characteristics", () => { const h = buildQuillBotUpstreamHeaders(req("/ssrprops", { headers: { accept: "application/json", "user-agent": "test-browser", "sec-ch-ua": "test" } }), state, new URL("https://quillbot.com/ssrprops")); assert.equal(h.get("accept"), "application/json"); assert.equal(h.get("user-agent"), "test-browser"); assert.equal(h.get("accept-encoding"), "identity"); assert.equal(h.get("useridtoken"), null); });
test("POST method and bytes are preserved", async () => { let seen: any; const body = '{"text":"sample sentence","strength":2}'; const response = await proxyQuillBotRequest(req("/__host/media.quillbot.com/api/paraphrase", { method: "POST", headers: { origin: "https://chatgpt.topratedseotools.com", "content-type": "application/json" }, body }), state, async (url: any, init: any) => { seen = { url: String(url), ...init }; return Response.json({ result: "rephrased" }); }); assert.equal(seen.method, "POST"); assert.equal(Buffer.from(seen.body).toString(), body); assert.equal(seen.redirect, "manual"); assert.equal(response.status, 200); });
test("unknown hosts are blocked before fetch", async () => { let called = false; const r = await proxyQuillBotRequest(req("/__host/evil.example/file"), state, async () => { called = true; return new Response(); }); assert.equal(r.status, 403); assert.equal(called, false); });
test("account paths on both origins are blocked before fetch", async () => { for (const path of ["/account", "/%61ccount", "/api/auth/logout", "/__host/media.quillbot.com/billing", "/__host/media.quillbot.com/api/account", "/premium"]) { const r = await proxyQuillBotRequest(req(path), state, async () => { throw new Error("must not fetch"); }); assert.equal(r.status, 403); } });
test("unsafe encoded and protocol-relative paths are rejected", () => { assert.equal(resolveQuillBotUpstreamPath("//evil.example/path"), null); assert.equal(resolveQuillBotUpstreamPath("/%2561ccount"), null); assert.equal(resolveQuillBotUpstreamPath("/__host/media.quillbot.com//evil.example"), null); });
test("cross-site mutations are blocked", async () => { const r = await proxyQuillBotRequest(req("/api/action", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), state, async () => { throw new Error("must not fetch"); }); assert.equal(r.status, 403); });
test("oversized body is blocked", async () => { const r = await proxyQuillBotRequest(req("/api/action", { method: "POST", headers: { "content-length": String(6 * 1024 * 1024) }, body: "{}" }), state, async () => { throw new Error("must not fetch"); }); assert.equal(r.status, 413); });
test("redirects keep main and secondary requests inside the proxy", async () => { const r = await proxyQuillBotRequest(req("/old"), state, async () => new Response(null, { status: 307, headers: { location: "https://media.quillbot.com/asset.js" } })); assert.equal(r.status, 307); assert.equal(r.headers.get("location"), "/__qbtest/__host/media.quillbot.com/asset.js"); });
test("external and account redirects fail closed", async () => { for (const location of ["https://evil.example/", "https://quillbot.com/account"]) { const r = await proxyQuillBotRequest(req("/old"), state, async () => new Response(null, { status: 302, headers: { location } })); assert.equal(r.status, 502); } });
test("redirect URLs with credentials or noncanonical ports are blocked", () => { assert.equal(rewriteQuillBotUpstreamLocation("https://user:pass@quillbot.com/file"), null); assert.equal(rewriteQuillBotUpstreamLocation("https://media.quillbot.com:444/file"), null); });
test("HTML rewriting injects bootstrap and avoids duplicate base prefixes", () => { const text = rewriteQuillBotBody('<html><head></head><script src="/app.js"></script><img src="https://media.quillbot.com/a.png"><a href="https://quillbot.com/paraphrasing-tool">go</a></html>', "text/html"); assert.ok(text.includes('/__qbtest/__trst/bootstrap.js')); assert.ok(text.includes('src="/__qbtest/app.js"')); assert.ok(text.includes('/__qbtest/__host/media.quillbot.com/a.png')); assert.ok(!text.includes('/__qbtest/__qbtest')); });
test("CSS and escaped JSON URLs are rewritten", () => { assert.equal(rewriteQuillBotBody('url(/fonts/a.woff)', "text/css"), 'url(/__qbtest/fonts/a.woff)'); assert.ok(rewriteQuillBotBody('{"url":"https:\\/\\/media.quillbot.com\\/file"}', "application/json").includes('__host\\/media.quillbot.com')); });
test("raw auth and encoded auth cannot leak into text responses", () => { const output = redactQuillBotAuth(state.useridtoken + " " + encodeURIComponent(state.useridtoken) + " " + state.cookie + " " + "exact%2Fvalue==", state); assert.ok(!output.includes(state.useridtoken)); assert.ok(!output.includes(state.cookie)); assert.ok(!output.includes("exact%2Fvalue==")); });
test("upstream Set-Cookie is never sent to customer", async () => { const r = await proxyQuillBotRequest(req("/ssrprops"), state, async () => new Response(state.useridtoken, { headers: { "content-type": "text/plain", "set-cookie": "provider=secret; HttpOnly" } })); assert.equal(r.headers.get("set-cookie"), null); assert.equal(await r.text(), "trst-server-auth"); assert.equal(r.headers.get("cache-control"), "no-store"); });
test("unknown reflected JSON credentials are replaced without altering Premium flags", async () => { const r = await proxyQuillBotRequest(req("/__host/media.quillbot.com/api/auth/token", { method: "POST", body: "{}" }), state, async () => Response.json({ userToken: "fresh-user-secret", user_token: "fresh-snake-secret", accessToken: "new-provider-secret", refresh_token: "another-secret", user: { useridtoken: "different-secret", premium: true } })); const body = await r.json(); assert.equal(body.userToken, "trst-server-auth"); assert.equal(body.user_token, "trst-server-auth"); assert.equal(body.accessToken, "trst-server-auth"); assert.equal(body.refresh_token, "trst-server-auth"); assert.equal(body.user.useridtoken, "trst-server-auth"); assert.equal(body.user.premium, true); });
test("binary assets, content range and upstream status are preserved", async () => { const r = await proxyQuillBotRequest(req("/font.woff"), state, async () => new Response(new Uint8Array([0, 255, 1, 2]), { status: 206, headers: { "content-type": "font/woff", "content-range": "bytes 0-3/4" } })); assert.equal(r.status, 206); assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0, 255, 1, 2]); assert.equal(r.headers.get("content-range"), "bytes 0-3/4"); });
test("no-body and conditional statuses preserve protocol semantics", async () => { for (const status of [204, 205, 304]) { const r = await proxyQuillBotRequest(req("/asset"), state, async () => new Response(null, { status })); assert.equal(r.status, status); assert.equal(await r.text(), ""); } });
test("upstream auth rejection remains visible without credential exposure", async () => { const r = await proxyQuillBotRequest(req("/ssrprops"), state, async () => new Response("Forbidden", { status: 403 })); assert.equal(r.status, 403); assert.equal(r.headers.get("x-trst-upstream-status"), "403"); });
test("rotation accepts only the existing explicit field from token endpoint", () => { assert.equal(extractQuillBotAuthRotation("/api/auth/token", JSON.stringify({ useridtoken: "next-user-token", tracking: "ignored" }), state).changed, true); assert.equal(extractQuillBotAuthRotation("/api/other", JSON.stringify({ useridtoken: "next-user-token" }), state).changed, false); assert.equal(extractQuillBotAuthRotation("/api/auth/token", JSON.stringify({ accessToken: "unknown", cookie: "replace" }), state).changed, false); assert.equal(extractQuillBotAuthRotation("/api/auth/token", JSON.stringify({ useridtoken: "bad\r\nvalue" }), state).changed, false); });
test("auth values reject header control characters", () => { assert.throws(() => normaliseQuillBotSession(JSON.stringify({ ...state, useridtoken: "bad\r\nvalue" }))); });
test("bootstrap remaps fetch/XHR/history and dynamically assigned assets", async () => {
  const calls: any[] = []; const histories: any[] = [];
  class Element { tagName = "SCRIPT"; setAttribute(_n: any, _v: any) {} }
  class Asset extends Element { _src = ""; get src() { return this._src; } set src(v: any) { this._src = v; } }
  class XHR { open(...args: any[]) { calls.push(args); } }
  const document = { documentElement: {}, readyState: "complete", querySelectorAll: () => [], addEventListener: () => {} };
  const window: any = { location: { href: "https://chatgpt.topratedseotools.com/__qbtest/paraphrasing-tool", origin: "https://chatgpt.topratedseotools.com" }, fetch: async (...args: any[]) => { calls.push(args); return new Response("ok"); }, open: (...args: any[]) => calls.push(args) };
  const history = { pushState: (...args: any[]) => histories.push(args), replaceState: (...args: any[]) => histories.push(args) };
  const sandbox = { window, document, history, navigator: {}, Request, Response, URL, XMLHttpRequest: XHR, Element, HTMLScriptElement: Asset, HTMLImageElement: Asset, HTMLLinkElement: Asset, HTMLAnchorElement: Asset, HTMLFormElement: Asset, MutationObserver: class { observe() {} } };
  vm.runInNewContext(await quillBotProxyBootstrapResponse().text(), sandbox);
  await window.fetch("https://media.quillbot.com/api/auth/token", { method: "POST" }); assert.equal(calls[0][0], "/__qbtest/__host/media.quillbot.com/api/auth/token");
  await window.fetch("/ssrprops"); assert.equal(calls[1][0], "/__qbtest/ssrprops");
  await window.fetch("/__qbtest/ssrprops"); assert.equal(calls[2][0], "/__qbtest/ssrprops");
  const request = new Request("https://quillbot.com/api/action", { method: "POST", body: "unchanged" }); await window.fetch(request); assert.equal(calls[3][0].url, "https://chatgpt.topratedseotools.com/__qbtest/api/action"); assert.equal(await calls[3][0].text(), "unchanged");
  new XHR().open("POST", "https://media.quillbot.com/api/action"); assert.equal(calls[4][1], "/__qbtest/__host/media.quillbot.com/api/action");
  history.pushState({}, "", "/paraphrasing-tool"); assert.equal(histories[0][2], "/__qbtest/paraphrasing-tool");
  const script = new Asset(); script.src = "/app.js"; assert.equal(script.src, "/__qbtest/app.js");
  const blocked = await window.fetch("https://quillbot.com/account"); assert.equal(blocked.status, 403);
});

test("protocol-relative application and media URLs stay inside proxy", () => {
 const output = rewriteQuillBotBody('<script src="//quillbot.com/a.js"></script><img src="//media.quillbot.com/b.png">', "text/html");
 assert.ok(output.includes('src="/__qbtest/a.js"'));
 assert.ok(output.includes('src="/__qbtest/__host/media.quillbot.com/b.png"'));
});
test("known application cookie rotation is persisted before redirects without exposing cookies", async () => {
 let saved = "";
 const h = new Headers({ location: "/paraphrasing-tool" });
 h.append("set-cookie", "app_session=fresh%2Fvalue==; Path=/; HttpOnly");
 h.append("set-cookie", "unknown_cookie=ignored; Path=/");
 h.append("set-cookie", "cf_clearance=ignored; Path=/");
 const r = await proxyQuillBotRequest(req("/old"), state, async () => new Response(null, {status:302,headers:h}), async v => {saved=v;});
 assert.equal(JSON.parse(saved).cookie, state.cookie.replace("exact%2Fvalue==","fresh%2Fvalue=="));
 assert.equal(r.headers.get("set-cookie"),null);
 assert.equal(r.status,302);
});
test("media host cannot rotate main-host application cookies", async () => {
 let saved = "";
 await proxyQuillBotRequest(req("/__host/media.quillbot.com/api/action"), state, async () => Response.json({}, {headers:{"set-cookie":"app_session=wrong-host; Path=/"}}), async v => {saved=v;});
 assert.equal(saved,"");
});

test("edge challenge retains diagnostics without bootstrap or application rotation", async () => {
  let rotated = false;
  const headers = new Headers({ "content-type": "text/html", "cf-mitigated": "challenge", "cf-ray": "a46dc08e2fcedf96-YUL", "set-cookie": "app_session=untrusted; Path=/" });
  const r = await proxyQuillBotRequest(req("/paraphrasing-tool"), state, async () => new Response("<html><head></head>challenge</html>", { status: 403, headers }), async () => { rotated = true; });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("cf-mitigated"), "challenge");
  assert.equal(r.headers.get("cf-ray"), "a46dc08e2fcedf96-YUL");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(rotated, false);
  const body = await r.text();
  assert.ok(!body.includes("bootstrap.js"));
  assert.ok(body.includes("dashboard has not loaded"));
});
test("HEAD edge challenge has no response body", async () => {
  const r = await proxyQuillBotRequest(req("/paraphrasing-tool", { method: "HEAD" }), state, async () => new Response(null, { status: 403, headers: { "cf-mitigated": "challenge" } }));
  assert.equal(r.status, 403);
  assert.equal(await r.text(), "");
});
