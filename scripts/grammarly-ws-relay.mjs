#!/usr/bin/env node
/*
 * Grammarly WebSocket relay (pm2: trst-grammarly-ws, 127.0.0.1:3290).
 *
 * The Grammarly editor checks text over a WebSocket (wss://capi.grammarly.com/freews).
 * On the proxy host the editor connects to wss://<proxy>/__ws/<grammarly-host>/<path>;
 * nginx sends /__ws/ here. For each connection we:
 *   1. require a live Topratedseotools Grammarly proxy session (HttpOnly cookie),
 *   2. open the upstream socket with the shared login from the encrypted vault,
 *   3. refuse to check documents that belong to another writer,
 *   4. pipe frames both ways.
 * Env (from the live release .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * optional GRAMMARLY_SESSION_ENCRYPTION_KEY, GRAMMARLY_WS_RELAY_PORT.
 */
import http from "node:http";
import { createDecipheriv, createHash, hkdfSync } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

// `ws` ships with the app's node_modules; resolve it from the live release
// (loaded lazily so the pure helpers below can be unit-tested without it).
let WebSocketServer;
let WebSocket;
function loadWs() {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  ({ WebSocketServer, WebSocket } = require("ws"));
}

const PORT = Number(process.env.GRAMMARLY_WS_RELAY_PORT || 3290);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const COOKIE = "trst_gr_proxy";
const APP_ORIGIN = "https://app.grammarly.com";
const BLOCKED_HOSTS = new Set(["account.grammarly.com", "api.payments.grammarly.com", "sso.grammarly.com"]);

export function isGrammarlyHost(host) {
  const h = String(host || "").toLowerCase();
  return /^[a-z0-9.-]+$/.test(h) && (h === "grammarly.com" || h.endsWith(".grammarly.com") || h.endsWith(".grammarly.io"));
}

export function parseRelayPath(rawUrl) {
  const u = new URL(rawUrl, "http://relay.local");
  const m = u.pathname.match(/^\/__ws\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (!isGrammarlyHost(host) || BLOCKED_HOSTS.has(host)) return null;
  return { host, target: `wss://${host}${m[2] || "/"}${u.search}` };
}

export function documentIdFromFrame(text) {
  const m = String(text).match(/"doc_?id"\s*:\s*"?(\d{3,})"?/i);
  return m ? m[1] : null;
}

function rest(pathAndQuery) {
  const headers = { apikey: SERVICE_KEY };
  if (!SERVICE_KEY.startsWith("sb_secret_")) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers, signal: AbortSignal.timeout(10_000) }).then(
    async (r) => (r.ok ? r.json() : Promise.reject(new Error(`supabase ${r.status}`))),
  );
}

export async function proxySession(token) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) return null;
 const hash=createHash("sha256").update(token,"utf8").digest("hex");
 const rows=await rest(`grammarly_proxy_sessions?select=id,user_id,status,expires_at,source_kind,source_id,provider_account_key&token_hash=eq.${hash}&status=eq.active&limit=1`);
 const row=rows[0];
 if(!row||Date.parse(row.expires_at)<=Date.now()||!["account_1","account_2"].includes(row.provider_account_key))return null;
 const uid=encodeURIComponent(row.user_id),key=row.provider_account_key;
 const [controls,settings,accounts,source]=await Promise.all([
 rest(`grammarly_user_controls?select=provider_account_key&user_id=eq.${uid}&limit=1`),
 rest('tool_settings?select=enabled,one_click_auth_enabled&tool_slug=eq.grammarly&limit=1'),
 rest(`grammarly_provider_accounts?select=status,verified_at&account_key=eq.${key}&limit=1`),
 row.source_kind==='grant'
 ?rest(`tool_access_grants?select=status,expires_at&id=eq.${encodeURIComponent(row.source_id)}&user_id=eq.${uid}&tool_slug=eq.grammarly&limit=1`)
 :row.source_kind==='order'?rest(`tool_orders?select=status,payment_status,access_type,fulfilment_status,expires_at&id=eq.${encodeURIComponent(row.source_id)}&user_id=eq.${uid}&tool_slug=eq.grammarly&limit=1`):Promise.resolve([])
 ]);
 if((controls[0]?.provider_account_key??"account_1")!==key||!settings[0]?.one_click_auth_enabled||settings[0]?.enabled===false||accounts[0]?.status!=="stored"||(key==="account_2"&&!accounts[0]?.verified_at))return null;
 const grant=source[0];if(!grant||(grant.expires_at&&Date.parse(grant.expires_at)<=Date.now()))return null;
 if(row.source_kind==='grant'&&grant.status!=='active')return null;
 if(row.source_kind==='order'&&(grant.status!=='approved'||grant.payment_status!=='successful'||(grant.access_type==='private'&&grant.fulfilment_status!=='active')))return null;
 return row;
}

function vaultKey() {
  const raw = String(process.env.GRAMMARLY_SESSION_ENCRYPTION_KEY || "").trim();
  if (raw) return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return Buffer.from(hkdfSync("sha256", Buffer.from(SERVICE_KEY), Buffer.from("topratedseotools"), Buffer.from("grammarly-session-encryption:v1"), 32));
}
export async function vaultCookies(account) {
  if(!["account_1","account_2"].includes(account))throw Error("Invalid provider account");
  const rows = await rest(`grammarly_provider_accounts?select=encrypted_payload,status,verified_at&account_key=eq.${account}&limit=1`);
  if (!rows[0] || rows[0].status !== "stored" || (account==="account_2"&&!rows[0].verified_at)) throw new Error("vault not configured");
  const env = JSON.parse(rows[0].encrypted_payload);
  const d = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(env.iv, "base64"));
  d.setAAD(Buffer.from("topratedseotools:grammarly:session_state_json:v1"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  const state = JSON.parse(d.update(Buffer.from(env.ct, "base64")).toString("utf8") + d.final("utf8"));
  return state;
}

export function cookieHeaderFor(state, host) {
  const h = host.toLowerCase();
  return state.cookies
    .filter((c) => {
      const d = String(c.domain || "").toLowerCase().replace(/^\./, "");
      return (h === d || h.endsWith("." + d)) && !(c.expires && c.expires>0 && c.expires*1000<=Date.now());
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function documentOwner(id,account) {
 if(!["account_1","account_2"].includes(account))throw Error("Invalid provider account");
 const rows=await rest(`grammarly_document_owners?select=user_id&provider_account_key=eq.${account}&document_id=eq.${encodeURIComponent(id)}&limit=1`);
 return rows[0]?.user_id??null;
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function log(event) {
  console.log(JSON.stringify({ component: "grammarly_ws_relay", at: new Date().toISOString(), ...event }));
}

export function startRelay({port=PORT,UpstreamWebSocket}={}) {
  loadWs();
  const ProviderSocket=UpstreamWebSocket??WebSocket;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/__health" ? 200 : 426, { "Content-Type": "text/plain" });
    res.end(req.url === "/__health" ? "ok" : "WebSocket upgrade required");
  });

  server.on("upgrade", async (req, socket, head) => {
    const route = parseRelayPath(req.url || "");
    if (!route) return reject(socket, 403, "Forbidden");
    const expectedOrigin=process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN ? new URL(process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN).origin : "https://"+req.headers.host;
    if(req.headers.origin!==expectedOrigin)return reject(socket,403,"Forbidden");
    const token=cookieValue(req.headers.cookie, COOKIE);
    let session;
    try {
      session = await proxySession(token);
    } catch {
      return reject(socket, 503, "Service Unavailable");
    }
    if (!session) return reject(socket, 401, "Unauthorized");
    // Dox names the document in the connection URL, before any frames arrive.
    const routeDoc = route.host === "dox.grammarly.com"
      ? new URL(route.target).pathname.match(/^\/documents\/(\d+)\/ws$/)?.[1]
      : null;
    if (routeDoc && await documentOwner(routeDoc,session.provider_account_key).catch(() => null) !== String(session.user_id)) {
      return reject(socket, 403, "Forbidden");
    }
    let state;
    try {
      state = await vaultCookies(session.provider_account_key);
    } catch {
      return reject(socket, 503, "Service Unavailable");
    }

    const upstream = new ProviderSocket(route.target, req.headers["sec-websocket-protocol"]?.split(",").map((s) => s.trim()) || [], {
      headers: {
        Cookie: cookieHeaderFor(state, route.host),
        Origin: APP_ORIGIN,
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
      perMessageDeflate: true,
      handshakeTimeout: 15_000,
    });

    upstream.once("error", (err) => {
      log({ event: "upstream_error", host: route.host, message: "Provider connection failed" });
      if (!socket.destroyed) reject(socket, 502, "Bad Gateway");
    });

    upstream.once("open", () => {
      wss.handleUpgrade(req, socket, head, (client) => {
        log({ event: "open", host: route.host });
        let refused = false;
        let queue = Promise.resolve();
        const forward = async (data, isBinary) => {
          if (refused) return;
          const current=await proxySession(token).catch(()=>null);
          if(!current||current.id!==session.id||current.provider_account_key!==session.provider_account_key){refused=true;client.close(4401,"Launch Grammarly again from your dashboard");upstream.close();return;}
          if(isBinary&&!routeDoc){refused=true;client.close(4403,"Unsupported checking frame");upstream.close();return;}
          if (!isBinary) {
            const docId = documentIdFromFrame(data.toString());
            if (docId) {
              const owner = await documentOwner(docId,session.provider_account_key).catch(() => null);
              if (owner !== String(session.user_id)) {
                refused = true;
                log({ event: "foreign_document_refused" });
                client.close(4403, "Document not available");
                upstream.close();
                return;
              }
            }
          }
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        };
        // Keep frame order while ownership lookups are in flight.
        client.on("message", (data, isBinary) => {
          queue = queue.then(() => forward(data, isBinary)).catch(() => undefined);
        });
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        const closeBoth = (code, reason) => {
          const c = Number.isInteger(code) && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
          try { if (client.readyState === WebSocket.OPEN) client.close(c, String(reason || "").slice(0, 120)); } catch {}
          try { if (upstream.readyState === WebSocket.OPEN) upstream.close(c, String(reason || "").slice(0, 120)); } catch {}
        };
        let validating=false;
        const timer=setInterval(async()=>{
          if(validating)return;validating=true;
          try{
            const current=await proxySession(token);
            if(!current||current.id!==session.id||current.provider_account_key!==session.provider_account_key)closeBoth(4401,"Launch Grammarly again from your dashboard");
          }catch{closeBoth(1011,"Could not verify Grammarly access");}finally{validating=false;}
        },2000);
        timer.unref?.();
        client.on("close", (code, reason) => {clearInterval(timer);closeBoth(code, reason);});
        upstream.on("close", (code, reason) => {clearInterval(timer);closeBoth(code, reason);});
        client.on("error", () => closeBoth(1011));
        upstream.on("error", () => closeBoth(1011));
      });
    });
  });

  server.listen(port, "127.0.0.1", () => log({ event: "listening", port: server.address().port }));
  return server;
}

// Start when run directly or under pm2 (pm2 wraps the script, so argv[1] is
// its own container; it sets pm_id). Importing the module (tests) never starts it.
const runDirectly = !!process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (runDirectly || process.env.pm_id !== undefined) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  startRelay();
}
