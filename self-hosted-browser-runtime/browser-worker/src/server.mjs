import http from 'node:http';
import { buildHealthPayload } from './health.mjs';
import { BrowserSessionController } from './browser-session.mjs';

const port = Number(process.env.PORT || 8081);
const controller = new BrowserSessionController();

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, buildHealthPayload());
      return;
    }

    if (request.method === 'GET' && request.url === '/browser/status') {
      writeJson(response, 200, controller.status);
      return;
    }

    if (request.method === 'POST' && request.url === '/browser/start') {
      const body = await readJson(request);
      writeJson(response, 201, await controller.start(body.url));
      return;
    }

    if (request.method === 'POST' && request.url === '/browser/navigate') {
      const body = await readJson(request);
      if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 });
      writeJson(response, 200, await controller.navigate(body.url));
      return;
    }

    if (request.method === 'POST' && request.url === '/browser/stop') {
      writeJson(response, 200, await controller.stop());
      return;
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
  console.log(JSON.stringify({ event: 'worker_started', port, phase: 2, control: 'cdp' }));
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
