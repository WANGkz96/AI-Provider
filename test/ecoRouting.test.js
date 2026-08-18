import test from 'node:test';
import assert from 'node:assert/strict';
import { EcoAvailabilityCache, EcoRouter } from '../src/services/ecoRouting.js';
import { EcoQuotaLedger } from '../src/services/ecoQuota.js';

const targetModel = {
  id: 'gemini-test',
  provider: 'google',
  apiModelId: 'gemini-test',
  aiStudioApiModelId: 'gemini-test',
  vertexApiModelId: 'gemini-test-vertex',
  eco: { enabled: true, quotaSource: 'provisional', rpm: 15, rpd: 500 }
};

const makeRouter = ({ aiGenerate, config = {}, fetchImpl } = {}) => {
  const quotaLedger = new EcoQuotaLedger();
  const availabilityCache = new EcoAvailabilityCache({
    apiKey: config.googleAiStudioApiKey ?? 'test-key',
    fetchImpl: fetchImpl || (async () => ({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }]
      })
    }))
  });
  const aiStudioProvider = { generate: aiGenerate || (async () => ({ content: 'free', usage: { inputTokens: 1, outputTokens: 1 } })) };
  const primaryProvider = {
    calls: 0,
    async generate() {
      this.calls += 1;
      return { content: 'vertex', metadata: { mode: 'vertex' } };
    }
  };
  const router = new EcoRouter({
    config: {
      ecoEnabled: true,
      googleUseVertex: true,
      googleAiStudioApiKey: config.googleAiStudioApiKey ?? 'test-key',
      ecoMaxRpmWaitMs: 60000,
      ...config
    },
    quotaLedger,
    availabilityCache,
    aiStudioProvider,
    sleepImpl: async () => {}
  });
  return { router, primaryProvider };
};

test('eco routes a supported Google request through AI Studio', async () => {
  const { router, primaryProvider } = makeRouter({});
  const response = await router.generate({
    targetModel,
    params: { eco: true, apiModelId: 'gemini-test-vertex', stream: false },
    primaryProvider
  });
  assert.equal(response.content, 'free');
  assert.equal(response.metadata.ecoRouting.route, 'aiStudio');
  assert.equal(primaryProvider.calls, 0);
});

test('eco retries high demand once and then succeeds', async () => {
  let calls = 0;
  const { router, primaryProvider } = makeRouter({
    aiGenerate: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('high demand');
        error.status = 503;
        throw error;
      }
      return { content: 'retried', usage: { inputTokens: 1, outputTokens: 1 } };
    }
  });
  const response = await router.generate({
    targetModel,
    params: { eco: true, apiModelId: 'gemini-test-vertex' },
    primaryProvider
  });
  assert.equal(response.content, 'retried');
  assert.equal(response.metadata.ecoRouting.attempts, 2);
  assert.equal(primaryProvider.calls, 0);
});

test('eco falls back immediately on quota errors', async () => {
  const { router, primaryProvider } = makeRouter({
    aiGenerate: async () => {
      const error = new Error('RESOURCE_EXHAUSTED');
      error.status = 429;
      throw error;
    }
  });
  const response = await router.generate({
    targetModel,
    params: { eco: true, apiModelId: 'gemini-test-vertex' },
    primaryProvider
  });
  assert.equal(response.content, 'vertex');
  assert.equal(response.metadata.ecoRouting.route, 'vertex');
  assert.equal(response.metadata.ecoRouting.fallbackReason, 'ai_studio_quota');
  assert.equal(primaryProvider.calls, 1);
});

test('missing AI Studio key is a metadata-bearing Vertex fallback', async () => {
  const { router, primaryProvider } = makeRouter({ config: { googleAiStudioApiKey: '' } });
  const response = await router.generate({
    targetModel,
    params: { eco: true, apiModelId: 'gemini-test-vertex' },
    primaryProvider
  });
  assert.equal(response.metadata.ecoRouting.route, 'vertex');
  assert.equal(response.metadata.ecoRouting.fallbackReason, 'ai_studio_unavailable:missing_key');
});

test('eco is a no-op when the global Google mode is already AI Studio', async () => {
  let calls = 0;
  const { router, primaryProvider } = makeRouter({ config: { googleUseVertex: false } });
  primaryProvider.generate = async (params) => {
    calls += 1;
    assert.equal(params.stream, true);
    return { content: 'existing-ai-studio-path' };
  };
  const response = await router.generate({
    targetModel,
    params: { eco: true, stream: true },
    primaryProvider
  });
  assert.equal(response.content, 'existing-ai-studio-path');
  assert.equal(calls, 1);
});

test('eco can fail without spending on the original Vertex model when fallback orchestration is active', async () => {
  const { router, primaryProvider } = makeRouter({
    aiGenerate: async () => {
      const error = new Error('high demand');
      error.status = 503;
      throw error;
    }
  });

  await assert.rejects(
    () => router.generate({
      targetModel,
      params: { eco: true, apiModelId: 'gemini-test-vertex' },
      primaryProvider,
      allowPaidFallback: false
    }),
    (error) => {
      assert.equal(error.code, 'eco_routing_failed');
      assert.equal(error.ecoRouting.fallbackReason, 'ai_studio_high_demand');
      assert.equal(error.ecoRouting.attempts, 2);
      return true;
    }
  );
  assert.equal(primaryProvider.calls, 0);
});
