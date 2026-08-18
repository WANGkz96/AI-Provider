import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_AUTO_FALLBACK_ORDER,
  resolveAutoFallbackModelIds,
  resolveFallbackModelIds
} from '../src/services/modelFallback.js';

test('auto fallback follows the Gemini priority ladder and stops after two models', () => {
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-3.6-flash'), [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite'
  ]);
  assert.deepEqual(resolveAutoFallbackModelIds('models/gemini-3.7-flash'), [
    'gemini-3.6-flash',
    'gemini-3.5-flash'
  ]);
  assert.ok(GEMINI_AUTO_FALLBACK_ORDER.includes('gemini-2.5-flash-lite'));
});

test('explicit fallback arrays preserve order and remove duplicates/prefixes', () => {
  assert.deepEqual(resolveFallbackModelIds({
    useFallback: [
      'models/gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash'
    ],
    modelId: 'gemini-3.7-flash'
  }), [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite'
  ]);
});
