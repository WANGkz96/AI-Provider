import test from 'node:test';
import assert from 'node:assert/strict';
import { executeModelFallback } from '../src/services/fallbackExecution.js';
import { resolveResponseModelId } from '../src/services/responseModel.js';

const imageModel = (id) => ({
  id,
  provider: 'google',
  type: 'image',
  apiModelId: id,
  vertexApiModelId: id
});

const ecoSkip = (reason = 'no_eco_profile') => {
  const error = new Error(`AI Studio eco request failed: ${reason}`);
  error.code = 'eco_routing_failed';
  error.ecoRouting = { fallbackReason: reason };
  return error;
};

test('image fallback continues after the original paid backend returns 429', async () => {
  const targetModel = imageModel('gemini-3.1-flash-lite-image');
  const nextModel = imageModel('gemini-3.1-flash-image');
  const paidCalls = [];

  const response = await executeModelFallback({
    targetModel,
    fallbackCandidates: [nextModel],
    useFallback: 'auto',
    generateParams: { apiModelId: targetModel.id },
    ecoPaidFallbackEligible: true,
    quotaAwareAutoFallback: true,
    invokeModel: async () => {
      throw ecoSkip();
    },
    invokePaidModel: async (model) => {
      paidCalls.push(model.id);
      if (model.id === targetModel.id) {
        const error = new Error('RESOURCE_EXHAUSTED');
        error.status = 429;
        throw error;
      }
      return {
        type: 'image',
        images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
        metadata: { model: model.id }
      };
    },
    buildModelParams: (model) => ({
      model: model.id,
      apiModelId: model.id,
      type: 'image',
      eco: true
    }),
    resolveApiModelId: (model) => model.id,
    decoratePaidResponse: (result, { model, reason }) => ({
      ...result,
      metadata: {
        ...(result.metadata || {}),
        ecoRouting: { route: 'vertex', model: model.id, fallbackReason: reason }
      }
    })
  });

  assert.deepEqual(paidCalls, [
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-image'
  ]);
  assert.equal(response.metadata.useFallback.selectedModel, 'gemini-3.1-flash-image');
  assert.equal(response.metadata.useFallback.fallbackUsed, true);
  assert.equal(response.metadata.useFallback.paidFallbackAttempts, 1);
  assert.equal(response.metadata.ecoRouting.fallbackReason, 'paid_original_failed');
  assert.equal(resolveResponseModelId({
    response,
    fallbackModelId: targetModel.id
  }), 'gemini-3.1-flash-image');
});
