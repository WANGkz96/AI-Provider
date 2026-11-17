import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRunCost } from '../src/usageCosts.js';
import { GoogleAdapter } from '../src/adapters/google.js';
const entry = { provider: 'google', model: 'gemini-4-argon', type: 'text', timestamp: '2026-11-17T00:00:00Z' };
test('Argon prices input and thinking tokens and cached inputs', () => {
  const cost = estimateRunCost({ ...entry, usage: { inputTokens: 100000, outputTokens: 1000, raw: { candidatesTokenCount: 1000, thoughtsTokenCount: 2000, cachedContentTokenCount: 20000 } } });
  assert.equal(cost.totalUsd, 0.192);
  assert.equal(cost.units.outputTokens, 3000);
});
test('Argon introductory tariff ends in December', () => {
  const data = { ...entry, usage: { inputTokens: 1000000, outputTokens: 1000000 } };
  assert.equal(estimateRunCost(data).totalUsd, 12);
  assert.equal(estimateRunCost({ ...data, timestamp: '2026-12-02T00:00:00Z' }).totalUsd, 24);
});
test('Nano Banana charges reported image tokens, not duplicate image parts', () => {
  const cost = estimateRunCost({ ...entry, model: 'gemini-nano-banana-2.1', type: 'image',
    usage: { inputTokens: 9, outputTokens: 1523, raw: { candidatesTokenCount: 1142, thoughtsTokenCount: 381, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 22 }] } }, response: { images: [{}, {}] } });
  assert.equal(cost.imageUsd, 0.0336);
  assert.equal(cost.totalUsd, 0.036636);
});
test('TTS charges reported audio tokens and flags unknown text output tariff', () => {
  const cost = estimateRunCost({ ...entry, model: 'gemini-3.8-flash-lite-tts', type: 'audio', usage: { inputTokens: 11, outputTokens: 95, raw: { candidatesTokenCount: 95, candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: 72 }, { modality: 'TEXT', tokenCount: 23 }] } } });
  assert.equal(cost.totalUsd, 0.000438);
  assert.equal(cost.priced, false);
});
test('streamed usage counts thinking in output tokens', async () => {
  const adapter = new GoogleAdapter({ googleApiKey: 'test' });
  async function* chunks() { yield { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7, totalTokenCount: 22 } }; }
  const values = [];
  for await (const item of adapter.transformGeminiContentStream(chunks())) values.push(item);
  assert.equal(values[0].usage.outputTokens, 12);
});
