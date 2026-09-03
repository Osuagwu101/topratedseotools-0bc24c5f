import http from 'node:http';
import { buildHealthPayload } from './health.mjs';

const port = Number(process.env.PORT || 8081);

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(buildHealthPayload()));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'worker_started', port, phase: 1 }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'worker_stopping', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
