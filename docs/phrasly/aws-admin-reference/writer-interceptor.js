// Runs in the MAIN world (Phrasly's own JS realm — see manifest.json's
// content_scripts "world": "MAIN"), injected by the browser extension
// system directly, not as a <script> tag — so Phrasly's CSP (which would
// block a plain injected <script src> due to its nonce-based script-src)
// never applies to this. This file only WATCHES; it never talks to our
// server itself (page-context fetch/XHR would be subject to Phrasly's CSP
// connect-src, which doesn't list our domain) — it hands off to content.js
// (the isolated-world script, extension-privileged and exempt from page
// CSP) via window.postMessage, which relays to the background script,
// which is the one that actually talks to our server.
//
// Only these two exact endpoints are watched — every other request on the
// page (navigation, analytics, anything else) passes through completely
// untouched, with zero added latency.
const WATCHED = [
  { match: '/api/ai/rewrite', feature: 'humanizer' },
  { match: '/api/ai/detect', feature: 'ai_detector' },
];

function matchFeature(url) {
  const path = (() => {
    try { return new URL(url, window.location.href).pathname; } catch (e) { return url; }
  })();
  const hit = WATCHED.find((w) => path.includes(w.match));
  return hit ? hit.feature : null;
}

let nextRequestId = 1;
function askPermission(feature) {
  return new Promise((resolve) => {
    const requestId = nextRequestId++;
    const onReply = (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== 'trst-interceptor-reply' || d.requestId !== requestId) return;
      window.removeEventListener('message', onReply);
      resolve(!!d.allowed);
    };
    window.addEventListener('message', onReply);
    window.postMessage({ source: 'trst-interceptor', type: 'check', requestId, feature }, window.location.origin);
    // If the isolated world / background never answers (extension not
    // installed, disabled mid-session, etc.), fail open after a short
    // timeout rather than freeze the page's own feature forever.
    setTimeout(() => {
      window.removeEventListener('message', onReply);
      resolve(true);
    }, 4000);
  });
}

const originalFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const feature = matchFeature(url);
  if (!feature) {
    return originalFetch(input, init);
  }
  const allowed = await askPermission(feature);
  if (!allowed) {
    // Suppress the real request entirely — Phrasly never receives it, so
    // nothing is consumed from the shared account's real quota. The
    // background script (notified via the same check) handles closing out
    // the tab with a clear "limit reached" message.
    return new Response(JSON.stringify({ error: 'Daily limit reached.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};
