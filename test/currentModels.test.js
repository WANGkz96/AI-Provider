import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAdapter } from '../src/adapters/google.js';

const adapter = new GoogleAdapter({ googleApiKey: 'test' });

test('Hydrogen accepts XHIGH and Carbon falls back to HIGH', () => {
  assert.equal(adapter.buildGeminiThinkingConfig('gemini-4-hydrogen', { level: 'XHIGH' }).thinkingLevel, 'XHIGH');
  assert.equal(adapter.buildGeminiThinkingConfig('gemini-4-carbon', { level: 'XHIGH' }).thinkingLevel, 'HIGH');
  assert.equal(adapter.buildGeminiThinkingConfig('gemini-4-hydrogen', { level: 'MINIMAL' }).thinkingLevel, 'LOW');
});

test('Gemini 4 retains signed text in prior turns and older models retain existing sanitization', async () => {
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi', provider_state: { role: 'model', parts: [{ text: 'Hi', thoughtSignature: 'signed' }] } },
    { role: 'user', content: 'Continue' }
  ];
  const newer = await adapter.buildGeminiRequestContents({ messages, model: 'gemini-4-hydrogen' });
  const older = await adapter.buildGeminiRequestContents({ messages, model: 'gemini-3.8-flash' });
  assert.equal(newer.contents[1].parts[0].thoughtSignature, 'signed');
  assert.equal(older.contents[1].parts[0].thoughtSignature, undefined);
});

test('new models use compatible fallback groups', async () => {
  const { resolveAutoFallbackModelIds } = await import('../src/services/modelFallback.js');
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-4-hydrogen'), ['gemini-3.8-flash', 'gemini-3.7-flash']);
  assert.deepEqual(resolveAutoFallbackModelIds('gemini-nano-banana-2.1', { type: 'image' }), ['gemini-3.1-flash-image', 'gemini-3-pro-image']);
});

test('image output tokens are not billed twice in the estimate', async () => {
  const { estimateRunCost } = await import('../src/usageCosts.js');
  const cost = estimateRunCost({
    provider: 'google', model: 'gemini-nano-banana-2.1', type: 'image',
    usage: { inputTokens: 1000, outputTokens: 1220, raw: { candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 100 }] } },
    response: { images: [{}] }
  });
  assert.equal(cost.totalUsd, 0.03585);
});
