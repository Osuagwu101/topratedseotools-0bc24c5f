function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildViewerHtml({ sessionId, nonce }) {
  const safeSessionId = escapeHtml(sessionId);
  const sessionLiteral = JSON.stringify(String(sessionId));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Secure Browser Session</title>
  <style nonce="${escapeHtml(nonce)}">
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: #0b0d10; color: #f5f7fa; overflow: hidden; }
    body { display: grid; grid-template-rows: auto 1fr; }
    header { display: grid; gap: 3px; padding: 8px 12px; border-bottom: 1px solid #2a2f37; background: #14181e; min-height: 48px; }
    #state { font-size: 13px; font-weight: 700; }
    #meta { font-size: 11px; color: #aab2bf; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #surface { min-height: 0; display: grid; place-items: center; outline: none; background: #080a0d; cursor: default; }
    #surface:focus-visible { box-shadow: inset 0 0 0 2px #8ab4f8; }
    #frame { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; user-select: none; -webkit-user-drag: none; touch-action: none; }
    #message { position: fixed; inset: 50% auto auto 50%; transform: translate(-50%, -50%); padding: 12px 16px; max-width: min(520px, 90vw); border: 1px solid #343b46; border-radius: 8px; background: #14181e; color: #d8dee9; text-align: center; display: none; }
  </style>
</head>
<body>
  <header>
    <div id="state">Connecting secure viewer…</div>
    <div id="meta">Session ${safeSessionId}</div>
  </header>
  <main id="surface" tabindex="0" aria-label="Interactive remote browser">
    <img id="frame" alt="Remote browser frame" draggable="false">
  </main>
  <div id="message" role="alert"></div>
  <script nonce="${escapeHtml(nonce)}">
  (() => {
    'use strict';
    const sessionId = ${sessionLiteral};
    const base = '/viewer/' + encodeURIComponent(sessionId);
    const storageKey = 'toprated.viewer.' + sessionId;
    const stateEl = document.getElementById('state');
    const metaEl = document.getElementById('meta');
    const surface = document.getElementById('surface');
    const frame = document.getElementById('frame');
    const message = document.getElementById('message');

    const fragmentToken = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '';
    if (fragmentToken) {
      sessionStorage.setItem(storageKey, fragmentToken);
      history.replaceState(null, '', location.pathname);
    }
    const token = fragmentToken || sessionStorage.getItem(storageKey) || '';
    let stopped = false;
    let objectUrl = null;
    let movePending = false;
    let latestMove = null;

    function showFatal(text) {
      stopped = true;
      stateEl.textContent = 'Viewer unavailable';
      message.textContent = text;
      message.style.display = 'block';
    }

    if (!token) {
      showFatal('This secure viewer link is missing its authorization token. Open a fresh viewer link from Top Rated SEO Tools.');
      return;
    }

    async function request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set('authorization', 'Bearer ' + token);
      const response = await fetch(base + path, {
        ...options,
        headers,
        cache: 'no-store',
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 401 || response.status === 403 || response.status === 410) {
        sessionStorage.removeItem(storageKey);
        throw new Error('AUTH');
      }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response;
    }

    async function refreshStatus() {
      if (stopped) return;
      try {
        const response = await request('/status');
        const status = await response.json();
        stateEl.textContent = 'Secure viewer connected';
        metaEl.textContent = (status.title ? status.title + ' — ' : '') + status.url;
      } catch (error) {
        if (String(error.message) === 'AUTH') {
          showFatal('This viewer link expired or is no longer valid. Open a fresh viewer link to reconnect.');
          return;
        }
        stateEl.textContent = 'Viewer reconnecting…';
      }
      if (!stopped) setTimeout(refreshStatus, 1500);
    }

    async function refreshFrame() {
      if (stopped) return;
      try {
        const response = await request('/frame');
        const blob = await response.blob();
        const nextUrl = URL.createObjectURL(blob);
        const previous = objectUrl;
        objectUrl = nextUrl;
        frame.onload = () => { if (previous) URL.revokeObjectURL(previous); };
        frame.src = nextUrl;
      } catch (error) {
        if (String(error.message) === 'AUTH') {
          showFatal('This viewer link expired or is no longer valid. Open a fresh viewer link to reconnect.');
          return;
        }
        stateEl.textContent = 'Viewer reconnecting…';
      }
      if (!stopped) setTimeout(refreshFrame, 250);
    }

    function pointFromEvent(event) {
      const rect = frame.getBoundingClientRect();
      const width = frame.naturalWidth || 1440;
      const height = frame.naturalHeight || 900;
      const x = Math.max(0, Math.min(width - 1, (event.clientX - rect.left) * width / Math.max(rect.width, 1)));
      const y = Math.max(0, Math.min(height - 1, (event.clientY - rect.top) * height / Math.max(rect.height, 1)));
      return { x, y };
    }

    async function sendInput(payload) {
      if (stopped) return;
      try {
        await request('/input', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (String(error.message) === 'AUTH') {
          showFatal('This viewer link expired or is no longer valid. Open a fresh viewer link to reconnect.');
        }
      }
    }

    frame.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      surface.focus({ preventScroll: true });
      frame.setPointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      void sendInput({ type: 'mouse', event: 'pressed', button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', ...point });
    });

    frame.addEventListener('pointerup', (event) => {
      event.preventDefault();
      const point = pointFromEvent(event);
      void sendInput({ type: 'mouse', event: 'released', button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', ...point });
    });

    frame.addEventListener('pointermove', (event) => {
      latestMove = pointFromEvent(event);
      if (movePending) return;
      movePending = true;
      setTimeout(() => {
        movePending = false;
        if (latestMove) void sendInput({ type: 'mouse', event: 'moved', button: 'none', ...latestMove });
      }, 40);
    });

    frame.addEventListener('contextmenu', (event) => event.preventDefault());
    frame.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = pointFromEvent(event);
      void sendInput({ type: 'scroll', deltaX: event.deltaX, deltaY: event.deltaY, ...point });
    }, { passive: false });

    surface.addEventListener('keydown', (event) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
        void sendInput({ type: 'text', text: event.key });
        return;
      }
      const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
      void sendInput({ type: 'key', key: event.key, code: event.code, modifiers });
    });

    window.addEventListener('online', () => { stateEl.textContent = 'Viewer reconnecting…'; });
    refreshStatus();
    refreshFrame();
  })();
  </script>
</body>
</html>`;
}
