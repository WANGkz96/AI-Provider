import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_AUTO_FALLBACK_ORDER,
  MODEL_FALLBACK_GROUPS,
  resolveAutoFallbackModelIds,
  resolveFallbackModelIds
} from '../src/services/modelFallback.js';

test('auto fallback follows the text priority ladder and stops after two models', () => {
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

test('auto fallback keeps image generation inside the image ladder', () => {
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-3-pro-image', { type: 'image' }), [
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite-image'
  ]);
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-3.1-flash-image', { type: 'image' }), [
    'gemini-3.1-flash-lite-image'
  ]);
});

test('auto fallback keeps video generation inside the Veo ladder', () => {
  assert.deepEqual(resolveAutoFallbackModelIds('veo-3.1-generate-preview', { type: 'video' }), [
    'veo-3.1-fast-generate-preview'
  ]);
});

test('auto fallback keeps TTS and Lyria in separate audio ladders', () => {
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-3.1-flash-tts-preview', {
    type: 'audio',
    audioMode: 'gemini-tts'
  }), [
    'gemini-2.5-flash-tts',
    'gemini-2.5-flash-lite-preview-tts'
  ]);
  assert.deepEqual(resolveAutoFallbackModelIds('lyria-3-pro-preview', {
    type: 'audio',
    audioMode: 'lyria'
  }), [
    'lyria-3-clip-preview'
  ]);
  assert.deepEqual(resolveAutoFallbackModelIds('lyria-3-pro-preview', { type: 'audio' }), []);
  assert.equal(MODEL_FALLBACK_GROUPS.video.includes('gemini-3.5-flash'), false);
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
