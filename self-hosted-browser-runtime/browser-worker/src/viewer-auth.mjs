import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_VIEWER_TTL_SECONDS = 300;
export const MAX_VIEWER_TTL_SECONDS = 900;

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

export function resolveViewerSecret(env = process.env) {
  const secret = String(env.VIEWER_SIGNING_SECRET || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('VIEWER_SIGNING_SECRET must contain at least 32 bytes.');
  }
  return secret;
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function signPayload(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createViewerToken({
  sessionId,
  secret,
  ttlSeconds = DEFAULT_VIEWER_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
  nonce = randomBytes(12).toString('base64url'),
} = {}) {
  const sid = String(sessionId || '');
  if (!sid) throw new Error('sessionId is required for a viewer token.');
  if (!secret) throw new Error('viewer token secret is required.');

  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_VIEWER_TTL_SECONDS) {
    throw new Error(`viewer token TTL must be between 1 and ${MAX_VIEWER_TTL_SECONDS} seconds.`);
  }

  const payload = {
    v: 1,
    sid,
    iat: Number(nowSeconds),
    exp: Number(nowSeconds) + ttl,
    jti: String(nonce),
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    payload,
  };
}

export function verifyViewerToken(token, {
  sessionId,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const raw = String(token || '');
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw httpError('Viewer token is invalid.', 401);
  }

  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    throw httpError('Viewer token signature is invalid.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw httpError('Viewer token payload is invalid.', 401);
  }

  if (payload?.v !== 1 || typeof payload.sid !== 'string' || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    throw httpError('Viewer token payload is invalid.', 401);
  }

  if (payload.exp <= Number(nowSeconds)) {
    throw httpError('Viewer token has expired.', 401);
  }
  if (payload.iat > Number(nowSeconds) + 30) {
    throw httpError('Viewer token is not yet valid.', 401);
  }
  if (payload.exp - payload.iat > MAX_VIEWER_TTL_SECONDS) {
    throw httpError('Viewer token lifetime is invalid.', 401);
  }
  if (String(sessionId || '') !== payload.sid) {
    throw httpError('Viewer token is not valid for this session.', 403);
  }

  return payload;
}

export function readBearerToken(authorizationHeader) {
  const value = String(authorizationHeader || '');
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw httpError('A viewer bearer token is required.', 401);
  return match[1];
}
