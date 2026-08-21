import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUpstreamError } from '../src/services/upstreamError.js';

test('nested Vertex RESOURCE_EXHAUSTED is normalized as HTTP 429', () => {
  const error = new Error(JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          code: 429,
          message: 'Resource exhausted. Please try again later.',
          status: 'RESOURCE_EXHAUSTED'
        }
      }),
      code: 429,
      status: 'Too Many Requests'
    }
  }));
  error.status = 429;

  const normalized = normalizeUpstreamError(error);
  assert.equal(normalized.statusCode, 429);
  assert.equal(normalized.body.code, 'RESOURCE_EXHAUSTED');
  assert.equal(normalized.body.retryAfter, 60);
});

test('Retry-After from upstream is preserved', () => {
  const error = new Error('quota exceeded');
  error.status = 429;
  error.response = { headers: { 'retry-after': '17' } };

  const normalized = normalizeUpstreamError(error);
  assert.equal(normalized.retryAfterSeconds, 17);
});
