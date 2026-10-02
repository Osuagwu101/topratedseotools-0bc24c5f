import test from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_ORIGIN, UPSTREAM_ORIGIN, MAX_REQUEST_BYTES,
  classifyGatewayRequest, sanitizeUpstreamHeaders,
  sanitizeUpstreamResponseHeaders, rewriteLocation,
  rewriteTextBody, bodyMode, assertRequestSize,
  Phase4PolicyError,
} from "./transport.mjs";

const req = (path="/", init={}) => new Request(GATEWAY_ORIGIN + path, init);

test("fixed host routes only to chatgpt.com and strips ticket", () => {
  const r = classifyGatewayRequest(req("/backend-api/models?ticket=secret&x=1"));
  assert.equal(r.target.origin, UPSTREAM_ORIGIN);
  assert.equal(r.target.pathname, "/backend-api/models");
  assert.equal(r.target.searchParams.has("ticket"), false);
  assert.equal(r.target.searchParams.get("x"), "1");
});

test("only explicit static asset hosts are routable", () => {
  const good = classifyGatewayRequest(req("/__host/cdn.oaistatic.com/assets/app.js"));
  assert.equal(good.target.origin, "https://cdn.oaistatic.com");
  assert.throws(
    () => classifyGatewayRequest(req("/__host/evil.example/app.js")),
    e => e instanceof Phase4PolicyError && e.code === "asset_host_blocked",
  );
});

test("account and login document routes are blocked", () => {
  assert.throws(
    () => classifyGatewayRequest(req("/settings", {headers:{accept:"text/html"}})),
    e => e.code === "restricted_document_route",
  );
  assert.doesNotThrow(
    () => classifyGatewayRequest(req("/settings", {headers:{accept:"application/json"}})),
  );
});

test("unsupported methods fail closed", () => {
  assert.throws(
    () => classifyGatewayRequest(req("/", {method:"PROPFIND"})),
    e => e.code === "method_not_allowed" && e.status === 405,
  );
});

test("request headers never forward dashboard auth, cookies or forwarding headers", () => {
  const r = req("/api", {headers:{
    authorization:"Bearer dashboard-secret",
    cookie:"secret=value",
    "x-forwarded-for":"1.2.3.4",
    accept:"application/json",
    "user-agent":"phase4-test",
  }});
  const h = sanitizeUpstreamHeaders(r, UPSTREAM_ORIGIN);
  assert.equal(h.get("authorization"), null);
  assert.equal(h.get("cookie"), null);
  assert.equal(h.get("x-forwarded-for"), null);
  assert.equal(h.get("accept"), "application/json");
  assert.equal(h.get("origin"), UPSTREAM_ORIGIN);
});

test("response headers suppress Set-Cookie and unsafe redirect metadata", () => {
  const input = new Headers({
    "content-type":"application/json",
    "set-cookie":"upstream=secret",
    location:"https://evil.example/",
    server:"internal",
  });
  const h = sanitizeUpstreamResponseHeaders(input);
  assert.equal(h.get("content-type"), "application/json");
  assert.equal(h.get("set-cookie"), null);
  assert.equal(h.get("location"), null);
  assert.equal(h.get("server"), null);
  assert.match(h.get("cache-control"), /no-store/);
});

test("redirects stay inside gateway or allowlisted asset routes", () => {
  assert.equal(rewriteLocation("/c/123"), "/c/123");
  assert.equal(
    rewriteLocation("https://cdn.oaistatic.com/assets/a.js"),
    "/__host/cdn.oaistatic.com/assets/a.js",
  );
  assert.throws(
    () => rewriteLocation("https://accounts.example.com/login"),
    e => e.code === "external_redirect_blocked",
  );
});

test("absolute upstream URLs are rewritten to gateway-relative URLs", () => {
  const html = '<script src="https://cdn.oaistatic.com/a.js"></script><a href="https://chatgpt.com/c/1">x</a>';
  const out = rewriteTextBody(html, "text/html");
  assert.equal(out.includes("https://chatgpt.com"), false);
  assert.equal(out.includes("/__host/cdn.oaistatic.com/a.js"), true);
  assert.equal(out.includes('href="/c/1"'), true);
});

test("event streams and binary payloads are never buffered for rewriting", () => {
  assert.equal(bodyMode("text/event-stream"), "stream");
  assert.equal(bodyMode("application/octet-stream"), "stream");
  assert.equal(bodyMode("application/json"), "rewrite");
});

test("large requests are rejected before body processing", () => {
  assert.throws(
    () => assertRequestSize(req("/", {method:"POST",headers:{"content-length":String(MAX_REQUEST_BYTES+1)}})),
    e => e.code === "request_too_large" && e.status === 413,
  );
});

test("websocket upgrades are classified but not opened by Phase 4", () => {
  const r = classifyGatewayRequest(req("/backend-api/conversation", {headers:{upgrade:"websocket"}}));
  assert.equal(r.kind, "websocket");
  assert.equal(r.target.origin, UPSTREAM_ORIGIN);
});
