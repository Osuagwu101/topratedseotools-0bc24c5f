#!/usr/bin/env node
/*
 * Claude OneClick dictation + Read Aloud bridge (systemd: trst-claude-voice, 127.0.0.1:3296).
 *
 * Claude's dictation streams audio over a WebSocket to /api/ws/speech_to_text/...
 * Writers are never signed in to claude.ai; only the private server browsers are.
 * nginx sends /api/ws/ on the Claude proxy host here. For each socket we:
 *   1. require a live TopRated Claude proxy session (asks the app, cookie forwarded),
 *   2. ask that writer's account relay to open the real socket inside its
 *      signed-in browser (POST /voice/open, streamed NDJSON events back),
 *   3. pipe frames both ways (POST /voice/send batches, ordered).
 * Env (/etc/trst-claude-voice.env): CLAUDE_VOICE_PORT, CLAUDE_PUBLIC_ORIGIN,
 * CLAUDE_RELAY_KEY_ACCOUNT_1, CLAUDE_RELAY_KEY_ACCOUNT_2 (optional).
 */
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CLAUDE_VOICE_PORT || 3296);
const PUBLIC_ORIGIN = String(process.env.CLAUDE_PUBLIC_ORIGIN || "https://claude.topratedseotools.com").replace(/\/$/, "");
const RELAYS = {
  account_1: { url: "http://127.0.0.1:6101", key: process.env.CLAUDE_RELAY_KEY_ACCOUNT_1 || "" },
  account_2: { url: "http://127.0.0.1:6112", key: process.env.CLAUDE_RELAY_KEY_ACCOUNT_2 || "" },
};
const MAX_FRAME = 1024 * 1024;

export function isDictationPath(rawUrl) {
  try {
    const u = new URL(rawUrl, PUBLIC_ORIGIN);
    return /^\/api\/ws\/(?:speech_to_text|text_to_speech)\/[a-z0-9_]{1,64}$/.test(u.pathname) && rawUrl.length <= 2048;
  } catch {
    return false;
  }
}

/** Split a streamed NDJSON body into parsed events. */
export function lineReader(onEvent) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); } catch { /* ignore malformed line */ }
    }
    if (buffer.length > 8 * 1024 * 1024) buffer = "";
  };
}

async function writerAccount(req) {
  const cookie = String(req.headers.cookie || "");
  if (!cookie.includes("trst_claude_proxy=")) return null;
  const r = await fetch(PUBLIC_ORIGIN + "/__trst/voice-auth", {
    headers: { cookie, accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const data = await r.json().catch(() => null);
  return data?.account === "account_2" ? "account_2" : data?.account === "account_1" ? "account_1" : null;
}

function reject(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {}
  socket.destroy();
}

export function startBridge({ port = PORT } = {}) {
  const require = createRequire(path.join(here, "package.json"));
  const { WebSocketServer } = require("ws");
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
    res.writeHead(426); res.end();
  });

  server.on("upgrade", async (req, socket, head) => {
    socket.on("error", () => {});
    if (!isDictationPath(req.url || "")) return reject(socket, 404, "Not Found");
    if (req.headers.origin !== PUBLIC_ORIGIN) return reject(socket, 403, "Forbidden");
    const account = await writerAccount(req);
    if (!account) return reject(socket, 401, "Unauthorized");
    const relay = RELAYS[account];
    if (!relay.key) return reject(socket, 503, "Service Unavailable");

    const abort = new AbortController();
    let upstream;
    try {
      upstream = await fetch(relay.url + "/voice/open", {
        method: "POST",
        headers: { Authorization: "Bearer " + relay.key, "Content-Type": "application/json" },
        body: JSON.stringify({ path: req.url }),
        signal: abort.signal,
      });
    } catch { return reject(socket, 503, "Service Unavailable"); }
    if (!upstream.ok || !upstream.body) { abort.abort(); return reject(socket, upstream.status === 429 ? 503 : 502, "Bad Gateway"); }

    // Wait for Claude's socket to open before accepting the writer's socket.
    let voiceId = null, client = null, opened = false, closed = false;
    const early = [];
    const finish = (code = 1000, reason = "") => {
      if (closed) return; closed = true;
      abort.abort();
      if (voiceId) fetch(relay.url + "/voice/close", { method: "POST", headers: { Authorization: "Bearer " + relay.key, "Content-Type": "application/json" }, body: JSON.stringify({ id: voiceId }) }).catch(() => {});
      if (client && client.readyState <= 1) { try { client.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011, reason.slice(0, 120)); } catch {} }
      else if (!client) reject(socket, 502, "Bad Gateway");
    };
    const deliver = (e) => {
      if (!client) { early.push(e); return; }
      if (e.t === "text") client.send(String(e.d));
      else if (e.t === "bin") client.send(Buffer.from(String(e.d), "base64"));
      else if (e.t === "close") finish(Number(e.c) || 1000, String(e.r || ""));
    };
    const openTimer = setTimeout(() => { if (!opened) finish(1011, "timeout"); }, 15000);
    const onEvent = (e) => {
      if (e.t === "id") { voiceId = String(e.id); return; }
      if (e.t === "open" && !opened) {
        opened = true; clearTimeout(openTimer);
        wss.handleUpgrade(req, socket, head, (ws) => {
          client = ws;
          for (const x of early.splice(0)) deliver(x);
          // Ordered, batched sends to the browser.
          let queue = [], sending = false;
          const flush = async () => {
            if (sending || !queue.length || closed) return;
            sending = true;
            const frames = queue.splice(0, 64);
            try {
              const r = await fetch(relay.url + "/voice/send", { method: "POST", headers: { Authorization: "Bearer " + relay.key, "Content-Type": "application/json" }, body: JSON.stringify({ id: voiceId, frames }) });
              if (!r.ok) finish(1011, "upstream");
            } catch { finish(1011, "upstream"); }
            sending = false;
            flush();
          };
          ws.on("message", (data, isBinary) => {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            queue.push(isBinary ? { t: "bin", d: buf.toString("base64") } : { t: "text", d: buf.toString("utf8") });
            if (queue.length > 2000) return finish(1011, "overflow");
            flush();
          });
          ws.on("close", (code, reason) => finish(code, String(reason || "")));
          ws.on("error", () => finish(1011, ""));
        });
        return;
      }
      if (e.t === "close" && !opened) { clearTimeout(openTimer); return finish(Number(e.c) || 1011, String(e.r || "")); }
      deliver(e);
    };
    (async () => {
      const read = lineReader(onEvent);
      const decoder = new TextDecoder();
      try {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          read(decoder.decode(value, { stream: true }));
        }
      } catch {}
      clearTimeout(openTimer);
      finish(1011, "ended");
    })();
  });
  return server.listen(port, "127.0.0.1");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startBridge();
