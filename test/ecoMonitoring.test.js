import test from 'node:test';
import assert from 'node:assert/strict';
import { EcoQuotaMonitor } from '../src/services/ecoMonitoring.js';

test('eco monitoring sends the ADC quota project to Google APIs', async () => {
  const requests = [];
  const monitor = new EcoQuotaMonitor({
    config: { googleAiStudioApiKey: 'test-key' },
    authFactory: () => ({
      getClient: async () => ({
        quotaProjectId: 'billing-project',
        getAccessToken: async () => ({ token: 'test-token' })
      })
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), headers: options.headers });
      if (String(url).includes('keys:lookupKey')) {
        return { ok: true, json: async () => ({ parent: 'projects/studio-project' }) };
      }
      return { ok: true, json: async () => ({ timeSeries: [] }) };
    },
    modelsProvider: () => [{ provider: 'google', id: 'gemini-example' }],
    quotaLedger: { applyMonitoringProfile: async () => {} }
  });

  assert.equal((await monitor.sync()).ok, true);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.headers.Authorization, 'Bearer test-token');
    assert.equal(request.headers['x-goog-user-project'], 'billing-project');
  }
});
