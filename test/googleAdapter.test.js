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

test('drops stale text thought signatures but preserves function-call signatures', async () => {
  const adapter = new GoogleAdapter({
    googleApiKey: 'test-key',
    googleUseVertex: false
  });

  const textHistory = await adapter.buildGeminiRequestContents({
    messages: [
      { role: 'user', content: 'First question' },
      {
        role: 'assistant',
        provider_state: {
          role: 'model',
          parts: [
            { text: 'Old thought summary', thought: true, thoughtSignature: 'stale' },
            { thoughtSignature: 'orphan' },
            { text: 'Old answer', thoughtSignature: 'stale-answer' }
          ]
        }
      },
      { role: 'user', content: 'Continue' }
    ]
  });

  assert.deepEqual(textHistory.contents[1].parts, [
    { text: 'Old thought summary', thought: true },
    { text: 'Old answer' }
  ]);

  const toolHistory = await adapter.buildGeminiRequestContents({
    messages: [
      { role: 'user', content: 'Call a tool.' },
      {
        role: 'assistant',
        provider_state: {
          role: 'model',
          parts: [{
            functionCall: { name: 'get_weather', args: { city: 'Paris' } },
            thoughtSignature: 'required-signature'
          }]
        }
      },
      {
        role: 'tool',
        name: 'get_weather',
        tool_call_id: 'call-1',
        content: '{"temperature":20}'
      }
    ]
  });

  assert.equal(toolHistory.contents[1].parts[0].thoughtSignature, 'required-signature');
});

test('sequential image requests preserve provider_state for the next edit', async () => {
  const adapter = new GoogleAdapter({
    googleApiKey: 'test-key',
    googleUseVertex: false
  });
  const requests = [];

  adapter.imageAI.models.generateContentStream = async (request) => {
    requests.push(request);
    const responseNumber = requests.length;
    return (async function* generateChunks() {
      yield {
        candidates: [{
          content: {
            role: 'model',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: responseNumber === 1 ? 'Zmlyc3Q=' : 'c2Vjb25k'
                },
                thoughtSignature: `image-signature-${responseNumber}`
              },
              { text: responseNumber === 1 ? 'First image' : 'Edited image' }
            ]
          }
        }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 2,
          totalTokenCount: 3
        }
      };
    }());
  };

  const first = await adapter.generate({
    model: 'gemini-3.1-flash-lite-image',
    type: 'image',
    prompt: 'Create the first frame',
    image: { size: '1K', aspectRatio: '9:16' }
  });
  const second = await adapter.generate({
    model: 'gemini-3.1-flash-lite-image',
    type: 'image',
    messages: [
      { role: 'user', content: 'Create the first frame' },
      {
        role: 'assistant',
        content: first.message.content,
        provider_state: first.providerState
      },
      { role: 'user', content: 'Keep the characters and change the lighting' }
    ],
    image: { size: '1K', aspectRatio: '9:16' }
  });

  assert.equal(first.providerState.parts[0].inlineData.data, 'Zmlyc3Q=');
  assert.equal(requests[1].contents[1].role, 'model');
  assert.equal(requests[1].contents[1].parts[0].inlineData.data, 'Zmlyc3Q=');
  assert.equal(requests[1].contents[1].parts[0].thoughtSignature, undefined);
  assert.equal(second.providerState.parts[0].inlineData.data, 'c2Vjb25k');
});
