import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EcoQuotaLedger, getPacificDate } from '../src/services/ecoQuota.js';

const profile = { enabled: true, quotaSource: 'provisional', rpm: 2, rpd: 3 };

test('EcoQuotaLedger enforces RPM before RPD and reports wait time', async () => {
  let now = Date.UTC(2026, 0, 2, 12, 0, 0);
  const ledger = new EcoQuotaLedger({ now: () => now });

  assert.equal((await ledger.reserve({ modelId: 'gemini-test', profile })).allowed, true);
  assert.equal((await ledger.reserve({ modelId: 'gemini-test', profile })).allowed, true);

  const rpmLimit = await ledger.reserve({ modelId: 'gemini-test', profile });
  assert.equal(rpmLimit.allowed, false);
  assert.equal(rpmLimit.reason, 'rpm');
  assert.ok(rpmLimit.waitMs > 0);

  now += 60 * 1000 + 30;
  assert.equal((await ledger.reserve({ modelId: 'gemini-test', profile })).allowed, true);
  assert.equal((await ledger.reserve({ modelId: 'gemini-test', profile })).reason, 'rpd');
});

test('EcoQuotaLedger persists reservations without request content', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-provider-eco-'));
  const statePath = path.join(directory, 'eco-quota.json');
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);
  const first = new EcoQuotaLedger({ statePath, now: () => now });
  await first.reserve({ modelId: 'gemini-test', profile });
  await first.writeQueue;

  const second = new EcoQuotaLedger({ statePath, now: () => now });
  await second.ready;
  const state = second.getState();
  assert.equal(state.reservations.length, 1);
  assert.equal('prompt' in state.reservations[0], false);
  assert.equal('response' in state.reservations[0], false);
  assert.equal(getPacificDate(Date.UTC(2026, 0, 2, 7, 59, 59)), '2026-01-01');
  assert.equal(getPacificDate(Date.UTC(2026, 0, 2, 8, 0, 0)), '2026-01-02');
});
