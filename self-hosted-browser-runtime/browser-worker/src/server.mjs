import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildHealthPayload } from './health.mjs';
import { BrowserSessionController } from './browser-session.mjs';
import {
  createViewerToken,
  DEFAULT_VIEWER_TTL_SECONDS,
  MAX_VIEWER_TTL_SECONDS,
  readBearerToken,
  resolveViewerSecret,
  verifyViewerToken,
} from './viewer-auth.mjs';
import { buildViewerHtml } from './viewer-page.mjs';

const port = Number(process.env.PORT || 8081);
const controller = new BrowserSessionController();
const viewerSecret = resolveViewerSecret();
const configuredViewerTtl = Number(process.env.VIEWER_TOKEN_TTL_SECONDS || DEFAULT_VIEWER_TTL_SECONDS);
if (!Number.isInteger(configuredViewerTtl) || configuredViewerTtl < 1 || configuredViewerTtl > MAX_VIEWER_TTL_SECONDS) {
  throw new Error(`VIEWER_TOKEN_TTL_SECONDS must be between 1 and ${MAX_VIEWER_TTL_SECONDS}.`);
}

function commonHeaders(extra = {}) {
  return {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, commonHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  response.end(JSON.stringify(payload));
}

function writeViewerHtml(response, html, nonce) {
  response.writeHead(200, commonHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; img-src 'self' blob: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`,
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
  }));
  response.end(html);
}

async function readJson(request, maxBytes = 16 * 1024) {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
  }
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

function issueViewerGrant(sessionId) {
  const { token, payload } = createViewerToken({
    sessionId,
    secret: viewerSecret,
    ttlSeconds: configuredViewerTtl,
  });
  return {
    url: `/viewer/${encodeURIComponent(sessionId)}#${encodeURIComponent(token)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    tokenTransport: 'url-fragment-to-bearer',
    rawCdpExposed: false,
  };
}

function matchViewerRoute(pathname) {
  const match = pathname.match(/^\/viewer\/([0-9a-f-]{36})(?:\/(frame|status|input))?$/i);
  if (!match) return null;
  return { sessionId: match[1], action: match[2] || 'shell' };
}

function authorizeViewer(request, sessionId) {
  controller.assertSession(sessionId);
  const token = readBearerToken(request.headers.authorization);
  verifyViewerToken(token, { sessionId, secret: viewerSecret });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://browser-worker.local');

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, buildHealthPayload());
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/browser/status') {
      writeJson(response, 200, controller.status);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/browser/start') {
      const body = await readJson(request);
      const status = await controller.start(body.url);
      writeJson(response, 201, {
        ...status,
        viewerGrant: issueViewerGrant(status.sessionId),
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/browser/navigate') {
      const body = await readJson(request);
      if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 });
      writeJson(response, 200, await controller.navigate(body.url));
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/browser/stop') {
      writeJson(response, 200, await controller.stop());
      return;
    }

    const viewerRoute = matchViewerRoute(requestUrl.pathname);
    if (viewerRoute) {
      const { sessionId, action } = viewerRoute;

      if (request.method === 'GET' && action === 'shell') {
        controller.assertSession(sessionId);
        const nonce = randomBytes(18).toString('base64');
        writeViewerHtml(response, buildViewerHtml({ sessionId, nonce }), nonce);
        return;
      }

      authorizeViewer(request, sessionId);

      if (request.method === 'GET' && action === 'status') {
        writeJson(response, 200, await controller.refreshMetadata());
        return;
      }

      if (request.method === 'GET' && action === 'frame') {
        const frame = await controller.captureFrame(sessionId);
        response.writeHead(200, commonHeaders({
          'content-type': 'image/jpeg',
          'content-length': String(frame.length),
          'cross-origin-resource-policy': 'same-origin',
        }));
        response.end(frame);
        return;
      }

      if (request.method === 'POST' && action === 'input') {
        const body = await readJson(request, 8 * 1024);
        writeJson(response, 200, await controller.sendViewerInput(sessionId, body));
        return;
      }
    }

    writeJson(response, 404, { status: 'not_found' });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    writeJson(response, statusCode, {
      status: 'error',
      message: statusCode >= 500 ? 'Browser worker operation failed.' : String(error.message || 'Request failed.'),
      ...(process.env.NODE_ENV === 'production' || statusCode < 500 ? {} : { detail: String(error.message || error) }),
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'worker_started', port, phase: 3, control: 'cdp', viewer: 'restricted' }));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'worker_stopping', signal }));
  const forceTimer = setTimeout(() => process.exit(1), 8000);
  forceTimer.unref();

  try {
    await controller.stop();
  } catch (error) {
    console.error(JSON.stringify({ event: 'browser_cleanup_failed', message: String(error.message || error) }));
  }

  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
