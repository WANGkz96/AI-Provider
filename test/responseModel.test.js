import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponseModelId } from '../src/services/responseModel.js';

test('response model prefers the selected fallback model', () => {
  assert.equal(resolveResponseModelId({
    response: {
      metadata: {
        useFallback: {
          selectedModel: 'models/gemini-3.5-flash-lite'
        }
      }
    },
    fallbackModelId: 'gemini-3.7-flash'
  }), 'gemini-3.5-flash-lite');
});

test('response model falls back to the requested canonical model', () => {
  assert.equal(resolveResponseModelId({
    response: { metadata: {} },
    fallbackModelId: 'models/gemini-3.7-flash'
  }), 'gemini-3.7-flash');
});
