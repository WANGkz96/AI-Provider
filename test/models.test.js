import test from 'node:test';
import assert from 'node:assert/strict';
import models from '../models.json' with { type: 'json' };

test('Gemma 4 models have the AI Studio Free Tier eco profile', () => {
  for (const modelId of ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']) {
    const model = models.find((entry) => entry.id === modelId);

    assert.ok(model, `${modelId} must stay configured`);
    assert.deepEqual(model.eco, {
      enabled: true,
      quotaSource: 'aiStudio',
      rpm: 30,
      tpm: 16000,
      rpd: 14400
    });
  }
});
