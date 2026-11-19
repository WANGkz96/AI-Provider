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

test('nested Google billing eligibility error preserves HTTP 403 and readable message', () => {
  const message = 'Access requires an eligible paid billing account in a supported region, subject to our terms and policies.';
  const error = new Error(JSON.stringify({ error: { code: 403, status: 'Forbidden', message: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message } }) } }));
  const result = normalizeUpstreamError(error);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, message);
  assert.equal(result.body.reason, 'BILLING_ACCOUNT_ELIGIBILITY');
  assert.equal(result.retryAfterSeconds, undefined);
});

test('ordinary IAM permission error is not classified as billing eligibility', () => {
  const error = new Error('Permission denied to access the project');
  error.status = 403;
  const result = normalizeUpstreamError(error);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.reason, undefined);
});

test('nested quota error without an outer numeric status is recognized', () => {
  const error = new Error(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }));
  assert.equal(normalizeUpstreamError(error).statusCode, 429);
});
