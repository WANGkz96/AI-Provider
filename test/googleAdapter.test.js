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

test('Gemini 3.8 strips unsupported sampling parameters and maps MINIMAL to LOW', async () => {
  const adapter = new GoogleAdapter({
    googleApiKey: 'test-key',
    googleUseVertex: false
  });
  let request;

  adapter.genAI.models.generateContent = async (value) => {
    request = value;
    return {
      candidates: [{
        content: { role: 'model', parts: [{ text: 'ok' }] },
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
    model: 'gemini-3.8-flash',
    type: 'text',
    messages: [{ role: 'user', content: 'Say ok.' }],
    stream: false,
    options: {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
      maxTokens: 8192,
      thinking: { level: 'MINIMAL', includeThoughts: true }
    }
  });

  assert.equal(request.model, 'gemini-3.8-flash');
  assert.equal(request.config.temperature, undefined);
  assert.equal(request.config.topP, undefined);
  assert.equal(request.config.topK, undefined);
  assert.equal(request.config.maxOutputTokens, 8192);
  assert.deepEqual(request.config.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'LOW'
  });
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

const samplePcmWav = (adapter) => adapter.wrapPcmAsWav(Buffer.alloc(24000 * 2), {
  sampleRateHz: 24000,
  channels: 1,
  bitsPerSample: 16
});

const sampleTtsResponse = (data, mimeType) => ({
  candidates: [{ content: { role: 'model', parts: [{ inlineData: { data: data.toString('base64'), mimeType } }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 }
});

const dialoguePrompt = [
  'Do not speak anything except the transcript after the heading.',
  '### TRANSCRIPT',
  'Milo: [gasp] Look at this, Noxie.',
  'Noxie: [chuckles] You are impossible, Milo.',
  'Milo: [whispering] Listen closely.',
  '### END NOTES',
  'Do not read these notes.'
].join('\n');
const dialogueTranscript = [
  'Milo: [gasp] Look at this, Noxie.',
  'Noxie: [chuckles] You are impossible, Milo.',
  'Milo: [whispering] Listen closely.'
].join('\n');

const dialogueSpeakers = [
  { speaker: 'Milo', voiceName: 'Puck' },
  { speaker: 'Noxie', voiceName: 'Aoede' }
];

test('Gemini 3.8 Flash and Flash-Lite use structured multi-speaker transcript parts', async (t) => {
  for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
    await t.test(model, async () => {
      const adapter = new GoogleAdapter({
        googleApiKey: 'test-key',
        googleUseVertex: false
      });
      let request;
      adapter.genAI.models.generateContent = async (value) => {
        request = value;
        return sampleTtsResponse(samplePcmWav(adapter), 'audio/wav');
      };

      const result = await adapter.generate({
        model,
        type: 'audio',
        audioMode: 'gemini-tts',
        prompt: dialoguePrompt,
        options: { ttsMode: 'multi', speakers: dialogueSpeakers }
      });

      assert.deepEqual(request.contents[0].parts, [
        { text: '<gasp> Look at this, Noxie.', speechMetadata: { speaker: 'Milo' } },
        { text: '<laugh> You are impossible, Milo.', speechMetadata: { speaker: 'Noxie' } },
        { text: 'Listen closely.', speechMetadata: { speaker: 'Milo', style: 'whispering' } }
      ]);
      assert.deepEqual(request.config.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs, [
        { speaker: 'Milo', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        { speaker: 'Noxie', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
      ]);
      assert.equal(JSON.stringify(request.contents).includes('Do not speak anything'), false);
      assert.equal(result.mimeType, 'audio/wav');
      assert.equal(result.duration, 1);
      assert.equal(Buffer.from(result.data, 'base64').toString('ascii', 0, 4), 'RIFF');
    });
  }
});

test('Gemini 3.8 single-speaker TTS uses the selected Puck voice and transcript-only input', async () => {
  const adapter = new GoogleAdapter({ googleApiKey: 'test-key', googleUseVertex: false });
  let request;
  adapter.genAI.models.generateContent = async (value) => {
    request = value;
    return sampleTtsResponse(samplePcmWav(adapter), 'audio/wav');
  };

  const result = await adapter.generate({
    model: 'gemini-3.8-flash-tts',
    type: 'audio',
    prompt: dialoguePrompt,
    options: { ttsMode: 'single', voiceName: 'Puck' }
  });

  assert.deepEqual(request.contents[0].parts, [
    { text: '<gasp> Look at this, Noxie.' },
    { text: '<laugh> You are impossible, Milo.' },
    { text: 'Listen closely.', speechMetadata: { style: 'whispering' } }
  ]);
  assert.deepEqual(request.config.speechConfig.voiceConfig, { voice: 'Puck' });
  assert.equal(result.usedVoice, 'Puck');
  assert.equal(result.duration, 1);
});

test('Gemini 3.8 Vertex TTS sends requests through the global Gemini Enterprise client', async () => {
  const adapter = new GoogleAdapter({
    googleUseVertex: true,
    googleCloudProject: 'test-project',
    googleCloudLocation: 'us-central1'
  });
  let request;
  adapter.enterpriseAI.models.generateContent = async (value) => {
    request = value;
    return sampleTtsResponse(samplePcmWav(adapter), 'audio/wav');
  };

  await adapter.generate({
    model: 'gemini-3.8-flash-tts',
    type: 'audio',
    prompt: dialoguePrompt,
    options: { ttsMode: 'multi', speakers: dialogueSpeakers }
  });

  assert.equal(request.model, 'gemini-3.8-flash-tts');
  assert.equal(request.contents[0].parts.length, 3);
});

test('legacy Gemini 2.5 TTS extracts marked transcript and wraps raw PCM exactly once', async () => {
  const adapter = new GoogleAdapter({ googleApiKey: 'test-key', googleUseVertex: false });
  let request;
  adapter.genAI.models.generateContent = async (value) => {
    request = value;
    return sampleTtsResponse(Buffer.alloc(24000 * 2), 'audio/L16;codec=pcm;rate=24000');
  };

  const result = await adapter.generate({
    model: 'gemini-2.5-flash-preview-tts',
    type: 'audio',
    prompt: dialoguePrompt,
    options: { ttsMode: 'multi', speakers: dialogueSpeakers }
  });

  assert.deepEqual(request.contents[0].parts, [{ text: dialogueTranscript }]);
  assert.deepEqual(request.config.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs, [
    { speaker: 'Milo', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
    { speaker: 'Noxie', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
  ]);
  assert.equal(result.duration, 1);
  assert.equal(Buffer.from(result.data, 'base64').toString('ascii', 0, 4), 'RIFF');
  assert.equal(Buffer.from(result.data, 'base64').readUInt32LE(4), Buffer.from(result.data, 'base64').length - 8);
});

test('legacy Gemini TTS preserves unmarked plain prompt text', async () => {
  const adapter = new GoogleAdapter({ googleApiKey: 'test-key', googleUseVertex: false });
  let request;
  adapter.genAI.models.generateContent = async (value) => {
    request = value;
    return sampleTtsResponse(samplePcmWav(adapter), 'audio/wav');
  };

  const prompt = 'Speak warmly: The station doors open at nine.';
  await adapter.generate({
    model: 'gemini-2.5-flash-preview-tts',
    type: 'audio',
    prompt,
    options: { ttsMode: 'single', voiceName: 'Puck' }
  });

  assert.deepEqual(request.contents[0].parts, [{ text: prompt }]);
});
