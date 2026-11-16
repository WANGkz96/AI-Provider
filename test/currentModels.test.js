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
