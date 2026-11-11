/**
 * Grammarly one-click proxy: URL mapping, blocks, per-writer documents, relay helpers.
 * Run: bun tests/grammarly-proxy.test.ts
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  filterGrammarlyDocuments,
  grammarlyBootstrapScript,
  grammarlyCookieHeader,
  grammarlyDocumentIdFromPath,
  isBlockedGrammarlyRequest,
  isGrammarlyHost,
  rewriteGrammarlyBody,
  toProxyUrl,
  upstreamTarget,
} from "../src/lib/grammarly-proxy.server";
import { cookieHeaderFor, documentIdFromFrame, parseRelayPath } from "../scripts/grammarly-ws-relay.mjs";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  x", message);
  }
}
const O = "https://grammarly.topratedseotools.com";

// ---- URL mapping
assert(toProxyUrl("https://app.grammarly.com/ddocs", O) === `${O}/ddocs`, "app host maps to the proxy root");
assert(toProxyUrl("https://dox.grammarly.com/documents?x=1", O) === `${O}/__host/dox.grammarly.com/documents?x=1`, "other hosts map under /__host/");
assert(toProxyUrl("wss://capi.grammarly.com/freews", O) === "wss://grammarly.topratedseotools.com/__ws/capi.grammarly.com/freews", "websockets map under /__ws/");
assert(toProxyUrl("https://evil.example.com/", O) === null, "non-Grammarly URLs are not mapped");
assert(upstreamTarget(`${O}/ddocs/123?a=1`)!.url.toString() === "https://app.grammarly.com/ddocs/123?a=1", "root paths go to app.grammarly.com");
assert(upstreamTarget(`${O}/__host/dox.grammarly.com/documents`)!.url.toString() === "https://dox.grammarly.com/documents", "/__host/ paths go to that host");
assert(upstreamTarget(`${O}/__host/evil.com/x`) === null, "/__host/ refuses non-Grammarly hosts");
assert(isGrammarlyHost("f-log-editor.grammarly.io") && !isGrammarlyHost("grammarly.com.evil.net"), "host allow-list is strict");

const body = 'a="https://app.grammarly.com/x";b="https://dox.grammarly.com";c="wss://capi.grammarly.com/freews";d="https:\\/\\/auth.grammarly.com\\/v3";e=\'//denali-static.grammarly.com/js/a.js\';f="https://example.com"';
const rw = rewriteGrammarlyBody(body, O);
assert(rw.includes(`a="${O}/x"`), "rewrites app URLs");
assert(rw.includes(`b="${O}/__host/dox.grammarly.com"`), "rewrites API hosts");
assert(rw.includes('c="wss://grammarly.topratedseotools.com/__ws/capi.grammarly.com/freews"'), "rewrites the checking websocket");
assert(rw.includes('d="https:\\/\\/grammarly.topratedseotools.com\\/__host\\/auth.grammarly.com\\/v3"'), "rewrites JSON-escaped URLs");
assert(rw.includes(`e='${O}/__host/denali-static.grammarly.com/js/a.js'`), "rewrites protocol-relative URLs");
assert(rw.includes('f="https://example.com"'), "leaves other sites alone");

{
  const cfg = rewriteGrammarlyBody('{"domains":{"cookie":".grammarly.com"},"copyLogsToConsole":false}', O);
  assert(cfg.includes('"cookie":"grammarly.topratedseotools.com"'), "editor cookies are written for the proxy host");
  assert(cfg.includes('"copyLogsToConsole":false') && rewriteGrammarlyBody('"copyLogsToConsole":false', O, true).includes('"copyLogsToConsole":true'), "debug switch only when asked");
}

// ---- bootstrap script is valid JS
{
  const html = grammarlyBootstrapScript();
  const js = html.replace(/^<script>/, "").replace(/<\/script>$/, "");
  let ok = true;
  try {
    new vm.Script(js);
  } catch {
    ok = false;
  }
  assert(ok, "bootstrap script compiles");
  assert(js.includes("__ws/") && js.includes("__host/") && js.includes("csrf-token="), "bootstrap maps sockets/hosts and sets a readable CSRF cookie");
  assert(js.includes('domain=[^;]*'), "bootstrap drops foreign cookie domains");
}

// ---- shared-account blocks
assert(isBlockedGrammarlyRequest("GET", "account.grammarly.com", "/subscription"), "account site blocked");
assert(isBlockedGrammarlyRequest("POST", "api.payments.grammarly.com", "/x"), "payments blocked");
assert(isBlockedGrammarlyRequest("POST", "auth.grammarly.com", "/v3/user/logout"), "logout blocked");
assert(isBlockedGrammarlyRequest("POST", "auth.grammarly.com", "/v3/user/password"), "password change blocked");
assert(!isBlockedGrammarlyRequest("POST", "auth.grammarly.com", "/v3/user/oranonymous"), "session check allowed");
assert(isBlockedGrammarlyRequest("POST", "subscription.grammarly.com", "/api/v1/cancel"), "subscription changes blocked");
assert(isBlockedGrammarlyRequest("PUT", "gateway.grammarly.com", "/institution/api/groups"), "team admin changes blocked");
assert(!isBlockedGrammarlyRequest("GET", "subscription.grammarly.com", "/api/v1/subscription"), "reading subscription status allowed");
assert(!isBlockedGrammarlyRequest("POST", "dox.grammarly.com", "/documents"), "creating documents allowed");

// ---- per-writer documents
assert(grammarlyDocumentIdFromPath("dox.grammarly.com", "/documents/3004033476/metadata") === "3004033476", "reads document ids from dox paths");
assert(grammarlyDocumentIdFromPath("app.grammarly.com", "/ddocs/3004033476") === "3004033476", "reads document ids from editor URLs");
assert(grammarlyDocumentIdFromPath("dox.grammarly.com", "/documents") === null, "list path has no id");
const docs = [
  { id: 1, user_id: 9, title: "mine", first_content: "x" },
  { id: 2, user_id: 9, title: "theirs", first_content: "y" },
];
const kept = filterGrammarlyDocuments(docs, new Set(["1"]));
assert(kept.length === 1 && kept[0].title === "mine", "document list keeps only the writer's documents");
assert(filterGrammarlyDocuments({ documents: docs }, new Set()).documents.length === 0, "nested lists are filtered too");

// ---- cookies
const state = { version: 2 as const, cookies: [{ name: "grauth", value: "A", domain: ".grammarly.com", path: "/" }, { name: "csrf-token", value: "C", domain: ".grammarly.com", path: "/" }], session_tokens: { storage: { localStorage: {}, sessionStorage: {} } } };
assert(grammarlyCookieHeader(state, "dox.grammarly.com") === "grauth=A; csrf-token=C", "sends the shared login to Grammarly hosts");
assert(grammarlyCookieHeader(state, "f-log-editor.grammarly.io") === "", "never sends the login to other domains");

// ---- relay helpers
assert(parseRelayPath("/__ws/capi.grammarly.com/freews?x=1")!.target === "wss://capi.grammarly.com/freews?x=1", "relay maps to the upstream socket");
assert(parseRelayPath("/__ws/evil.com/freews") === null, "relay refuses non-Grammarly hosts");
assert(parseRelayPath("/__ws/account.grammarly.com/x") === null, "relay refuses blocked hosts");
assert(documentIdFromFrame('{"action":"start","docid":"3004033476"}') === "3004033476", "relay reads document ids from frames");
assert(documentIdFromFrame('{"action":"submit_ot"}') === null, "frames without documents pass");
assert(cookieHeaderFor(state, "capi.grammarly.com") === "grauth=A; csrf-token=C", "relay sends the shared login upstream");

// ---- wiring
const server = readFileSync("src/server.ts", "utf8");
assert(server.includes("isDedicatedGrammarlyProxyRequest(request)") && server.includes("handleGrammarlyProxyRequest"), "server routes the Grammarly host to the proxy");
const launcher = readFileSync("src/lib/tool-launcher.ts", "utf8");
assert(launcher.includes("startGrammarlyProxyLaunch") && launcher.includes('toolSlug === "grammarly"'), "dashboard launches Grammarly through the proxy");
const migration = readFileSync("supabase/migrations/20261112000000_grammarly_proxy.sql", "utf8");
assert(migration.includes("grammarly_proxy_sessions") && migration.includes("grammarly_document_owners") && migration.includes("one_click_auth_enabled, launch_mode)"), "migration creates sessions, document owners and settings");
const relaySrc = readFileSync("scripts/grammarly-ws-relay.mjs", "utf8");
assert(relaySrc.includes("process.env.pm_id !== undefined"), "relay starts under pm2");
const deploy = readFileSync("scripts/deploy/ovh_deploy_main.py", "utf8");
assert(deploy.includes("/etc/nginx/sites-enabled/grammarly-proxy") && deploy.includes("trst-grammarly-ws"), "deploys keep the Grammarly host and relay on the live build");

console.log(`grammarly-proxy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
