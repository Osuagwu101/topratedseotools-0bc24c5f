import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNavigationUrl } from '../src/browser-session.mjs';

test('accepts deterministic HTML data pages and normal web URLs', () => {
  assert.equal(validateNavigationUrl('https://example.com/'), 'https://example.com/');
  assert.equal(validateNavigationUrl('http://example.com/test'), 'http://example.com/test');
  assert.equal(validateNavigationUrl('data:text/html,%3Ctitle%3ETest%3C/title%3E'), 'data:text/html,%3Ctitle%3ETest%3C/title%3E');
});

test('rejects unsupported navigation schemes', () => {
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /http, https, or data/);
  assert.throws(() => validateNavigationUrl('javascript:alert(1)'), /http, https, or data/);
  assert.throws(() => validateNavigationUrl('data:text/plain,hello'), /data:text\/html/);
});
