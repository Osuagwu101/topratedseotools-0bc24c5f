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
const CACHE_MS = 30_000;
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

const sessions = new Map();
async function proxySession(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) return null;
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const hit = sessions.get(hash);
  if (hit && hit.until > Date.now()) return hit.row;
  const rows = await rest(
    `grammarly_proxy_sessions?select=id,user_id,status,expires_at&token_hash=eq.${hash}&status=eq.active&limit=1`,
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (sessions.size > 5000) sessions.clear();
  sessions.set(hash, { row, until: Date.now() + CACHE_MS });
  return row;
}

let vault = null;
function vaultKey() {
  const raw = String(process.env.GRAMMARLY_SESSION_ENCRYPTION_KEY || "").trim();
  if (raw) return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return Buffer.from(hkdfSync("sha256", Buffer.from(SERVICE_KEY), Buffer.from("topratedseotools"), Buffer.from("grammarly-session-encryption:v1"), 32));
}
async function vaultCookies() {
  if (vault && vault.until > Date.now()) return vault.state;
  const rows = await rest("tool_authorized_sessions?select=encrypted_payload,status&tool_slug=eq.grammarly&limit=1");
  if (!rows[0] || rows[0].status !== "stored") throw new Error("vault not configured");
  const env = JSON.parse(rows[0].encrypted_payload);
  const d = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(env.iv, "base64"));
  d.setAAD(Buffer.from("topratedseotools:grammarly:session_state_json:v1"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  const state = JSON.parse(d.update(Buffer.from(env.ct, "base64")).toString("utf8") + d.final("utf8"));
  vault = { state, until: Date.now() + CACHE_MS };
  return state;
}

export function cookieHeaderFor(state, host) {
  const h = host.toLowerCase();
  return state.cookies
    .filter((c) => {
      const d = String(c.domain || "").toLowerCase().replace(/^\./, "");
      return h === d || h.endsWith("." + d);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

const owners = new Map();
async function documentOwner(id) {
  if (owners.has(id)) return owners.get(id);
  const rows = await rest(`grammarly_document_owners?select=user_id&document_id=eq.${encodeURIComponent(id)}&limit=1`);
  const owner = rows[0]?.user_id ?? null;
  if (owner) owners.set(id, owner);
  return owner;
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

export function startRelay() {
  loadWs();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/__health" ? 200 : 426, { "Content-Type": "text/plain" });
    res.end(req.url === "/__health" ? "ok" : "WebSocket upgrade required");
  });

  server.on("upgrade", async (req, socket, head) => {
    const route = parseRelayPath(req.url || "");
    if (!route) return reject(socket, 403, "Forbidden");
    let session;
    try {
      session = await proxySession(cookieValue(req.headers.cookie, COOKIE));
    } catch {
      return reject(socket, 503, "Service Unavailable");
    }
    if (!session) return reject(socket, 401, "Unauthorized");
    let state;
    try {
      state = await vaultCookies();
    } catch {
      return reject(socket, 503, "Service Unavailable");
    }

    const upstream = new WebSocket(route.target, req.headers["sec-websocket-protocol"]?.split(",").map((s) => s.trim()) || [], {
      headers: {
        Cookie: cookieHeaderFor(state, route.host),
        Origin: APP_ORIGIN,
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
      perMessageDeflate: true,
      handshakeTimeout: 15_000,
    });

    upstream.once("error", (err) => {
      log({ event: "upstream_error", host: route.host, message: String(err?.message || err).slice(0, 120) });
      if (!socket.destroyed) reject(socket, 502, "Bad Gateway");
    });

    upstream.once("open", () => {
      wss.handleUpgrade(req, socket, head, (client) => {
        log({ event: "open", host: route.host });
        const checked = new Set();
        let refused = false;
        let queue = Promise.resolve();
        const forward = async (data, isBinary) => {
          if (refused) return;
          if (!isBinary) {
            const docId = documentIdFromFrame(data.toString());
            if (docId && !checked.has(docId)) {
              const owner = await documentOwner(docId).catch(() => null);
              if (owner !== String(session.user_id)) {
                refused = true;
                log({ event: "foreign_document_refused" });
                client.close(4403, "Document not available");
                upstream.close();
                return;
              }
              checked.add(docId);
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
        client.on("close", (code, reason) => closeBoth(code, reason));
        upstream.on("close", (code, reason) => closeBoth(code, reason));
        client.on("error", () => closeBoth(1011));
        upstream.on("error", () => closeBoth(1011));
      });
    });
  });

  server.listen(PORT, "127.0.0.1", () => log({ event: "listening", port: PORT }));
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
