import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAdapter } from '../src/adapters/google.js';

test('Gemma 4 sends thinking level, output limit, schema and tools to Gemini API', async () => {
  const adapter = new GoogleAdapter({
    googleApiKey: 'test-key',
    googleUseVertex: false,
    googleHttpTimeoutMs: 1000
  });
  let request;

  adapter.genAI.models.generateContent = async (value) => {
    request = value;
    return {
      candidates: [{
        content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
        finishReason: 'STOP'
      }],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 2,
        totalTokenCount: 3
      }
    };
  };

  await adapter.generate({
    model: 'gemma-4-31b-it',
    type: 'text',
    messages: [{ role: 'user', content: 'Return a JSON object.' }],
    stream: false,
    options: {
      maxTokens: 8192,
      thinking: { level: 'HIGH', includeThoughts: true },
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok']
      },
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city']
          }
        }
      }],
      toolChoice: 'auto'
    }
  });

  assert.equal(request.model, 'gemma-4-31b-it');
  assert.equal(request.config.maxOutputTokens, 8192);
  assert.deepEqual(request.config.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'HIGH'
  });
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.deepEqual(request.config.responseJsonSchema, {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok']
  });
  assert.equal(request.config.tools[0].functionDeclarations[0].name, 'get_weather');
  assert.equal(request.config.toolConfig.functionCallingConfig.mode, 'AUTO');
});

test('Gemma 4 maps legacy thinking budgets to its binary API levels', () => {
  const adapter = new GoogleAdapter({
    googleApiKey: 'test-key',
    googleUseVertex: false
  });

  assert.deepEqual(
    adapter.buildGeminiThinkingConfig('gemma-4-26b-a4b-it', { budget: 4096 }),
    { thinkingLevel: 'HIGH' }
  );
  assert.deepEqual(
    adapter.buildGeminiThinkingConfig('gemma-4-26b-a4b-it', { budget: 0 }),
    { thinkingLevel: 'MINIMAL' }
  );
});
