import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRunCost } from '../src/usageCosts.js';

const baseEntry = {
  provider: 'google',
  model: 'gemini-3.1-flash-lite',
  apiModelId: 'gemini-3.1-flash-lite',
  usage: { inputTokens: 1000, outputTokens: 2000 },
  response: {
    metadata: {
      provider: {
        ecoRouting: {
          requested: true,
          route: 'aiStudio',
          fallback: false
        }
      }
    }
  }
};

test('AI Studio eco cost is free and reports Vertex-equivalent savings', () => {
  const freeCost = estimateRunCost({ ...baseEntry, executionProvider: 'aiStudio' });
  const vertexCost = estimateRunCost({ ...baseEntry, executionProvider: 'vertex' });

  assert.equal(freeCost.totalUsd, 0);
  assert.equal(freeCost.source, 'Google AI Studio Free Tier');
  assert.equal(freeCost.avoidedUsd, vertexCost.totalUsd);
  assert.ok(freeCost.avoidedUsd > 0);
});
