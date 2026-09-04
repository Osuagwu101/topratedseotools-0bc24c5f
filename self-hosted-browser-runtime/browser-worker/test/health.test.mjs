import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthPayload } from '../src/health.mjs';

test('health payload remains generic and phase-scoped', () => {
  const payload = buildHealthPayload({ CHROMIUM_EXECUTABLE: '/does/not/exist' });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'browser-worker');
  assert.equal(payload.phase, 2);
  assert.equal(payload.browserCore, 'generic');
  assert.equal(payload.control, 'cdp');
  assert.equal(payload.chromium.installed, false);
  assert.equal(JSON.stringify(payload).toLowerCase().includes('phrasly'), false);
});
