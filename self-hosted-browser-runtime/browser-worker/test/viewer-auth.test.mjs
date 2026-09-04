import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewerToken,
  readBearerToken,
  verifyViewerToken,
} from '../src/viewer-auth.mjs';

const secret = 'phase-3-unit-test-secret-32-bytes-minimum-value';
const sessionId = '11111111-2222-4333-8444-555555555555';

test('issues and verifies a session-bound short-lived viewer token', () => {
  const { token, payload } = createViewerToken({ sessionId, secret, ttlSeconds: 60, nowSeconds: 1000, nonce: 'fixed' });
  assert.equal(payload.sid, sessionId);
  assert.equal(payload.exp, 1060);
  assert.equal(verifyViewerToken(token, { sessionId, secret, nowSeconds: 1010 }).sid, sessionId);
});

test('rejects tampered, expired, and cross-session viewer tokens', () => {
  const { token } = createViewerToken({ sessionId, secret, ttlSeconds: 60, nowSeconds: 1000, nonce: 'fixed' });
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.throws(() => verifyViewerToken(tampered, { sessionId, secret, nowSeconds: 1010 }), /signature/);
  assert.throws(() => verifyViewerToken(token, { sessionId, secret, nowSeconds: 1060 }), /expired/);
  assert.throws(() => verifyViewerToken(token, { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', secret, nowSeconds: 1010 }), /not valid for this session/);
});

test('requires bearer transport and rejects malformed authorization', () => {
  assert.equal(readBearerToken('Bearer abc.def'), 'abc.def');
  assert.throws(() => readBearerToken('Basic abc'), /bearer token/);
  assert.throws(() => readBearerToken(''), /bearer token/);
});
