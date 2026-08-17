import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MINUTE_MS = 60 * 1000;
const RETENTION_MS = 48 * 60 * 60 * 1000;

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveLimit = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export const getPacificDate = (timestamp = Date.now()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const getNextPacificMidnight = (timestamp = Date.now()) => {
  const currentDate = getPacificDate(timestamp);
  let low = timestamp;
  let high = timestamp + 36 * 60 * 60 * 1000;

  while (getPacificDate(high) === currentDate) {
    high += 12 * 60 * 60 * 1000;
  }

  for (let index = 0; index < 48; index += 1) {
    const midpoint = Math.floor((low + high) / 2);
    if (getPacificDate(midpoint) === currentDate) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return high;
};

const normalizeProfile = (profile = {}) => ({
  enabled: profile.enabled !== false,
  quotaSource: profile.quotaSource || 'unknown',
  rpm: positiveLimit(profile.rpm),
  rpd: positiveLimit(profile.rpd),
  tpm: positiveLimit(profile.tpm)
});

const emptyState = () => ({
  version: 1,
  reservations: [],
  quotaProfiles: {},
  updatedAt: null
});

export class EcoQuotaLedger {
  constructor({ statePath, now = () => Date.now() } = {}) {
    this.statePath = statePath;
    this.now = now;
    this.state = emptyState();
    this.ready = this.load();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (!this.statePath) return;

    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...emptyState(),
        ...parsed,
        reservations: Array.isArray(parsed?.reservations) ? parsed.reservations : [],
        quotaProfiles: parsed?.quotaProfiles && typeof parsed.quotaProfiles === 'object'
          ? parsed.quotaProfiles
          : {}
      };
      this.prune(this.now());
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[EcoQuota] Could not load ${this.statePath}: ${error.message}`);
      }
    }
  }

  async persist() {
    if (!this.statePath) return;

    const snapshot = JSON.stringify({
      ...this.state,
      updatedAt: new Date(this.now()).toISOString()
    }, null, 2);

    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, `${snapshot}\n`, 'utf8');
        await fs.rename(temporaryPath, this.statePath);
      })
      .catch((error) => {
        console.warn(`[EcoQuota] Could not persist ${this.statePath}: ${error.message}`);
      });

    return this.writeQueue;
  }

  prune(now) {
    const cutoff = now - RETENTION_MS;
    this.state.reservations = this.state.reservations.filter((reservation) => (
      Number(reservation.timestamp) >= cutoff
    ));
  }

  getProfile(modelId, modelProfile) {
    const key = String(modelId || '').replace(/^models\//, '');
    const configured = normalizeProfile(modelProfile);
    const remote = this.state.quotaProfiles[key];
    if (!remote) return configured;

    return normalizeProfile({
      ...configured,
      ...remote,
      enabled: remote.enabled !== false,
      quotaSource: remote.quotaSource || 'monitoring'
    });
  }

  getRemoteUsage(modelId) {
    const key = String(modelId || '').replace(/^models\//, '');
    const remote = this.state.quotaProfiles[key];
    if (!remote || remote.usageDate !== getPacificDate(this.now())) {
      return { rpm: 0, rpd: 0, tpm: 0 };
    }

    return {
      rpm: toFiniteNumber(remote.usageRpm),
      rpd: toFiniteNumber(remote.usageRpd),
      tpm: toFiniteNumber(remote.usageTpm)
    };
  }

  snapshot(modelId, profile) {
    const now = this.now();
    this.prune(now);
    const key = String(modelId || '').replace(/^models\//, '');
    const effectiveProfile = this.getProfile(key, profile);
    const today = getPacificDate(now);
    const modelReservations = this.state.reservations.filter((item) => item.modelId === key);
    const recentReservations = modelReservations.filter((item) => now - Number(item.timestamp) < MINUTE_MS);
    const todayReservations = modelReservations.filter((item) => item.pacificDate === today);
    const remoteUsage = this.getRemoteUsage(key);

    return {
      modelId: key,
      limits: effectiveProfile,
      usage: {
        rpm: recentReservations.length + remoteUsage.rpm,
        rpd: todayReservations.length + remoteUsage.rpd,
        tpm: recentReservations.reduce((total, item) => total + toFiniteNumber(item.inputTokens), 0) + remoteUsage.tpm
      },
      pacificDate: today,
      observedAt: new Date(now).toISOString(),
      source: effectiveProfile.quotaSource
    };
  }

  async reserve({ modelId, profile, estimatedInputTokens = 1 } = {}) {
    await this.ready;
    const now = this.now();
    this.prune(now);
    const key = String(modelId || '').replace(/^models\//, '');
    const effectiveProfile = this.getProfile(key, profile);
    const current = this.snapshot(key, effectiveProfile);

    if (!effectiveProfile.enabled) {
      return { allowed: false, reason: 'disabled', snapshot: current };
    }

    if (!effectiveProfile.rpm || !effectiveProfile.rpd) {
      return { allowed: false, reason: 'unknown_quota', snapshot: current };
    }

    if (current.usage.rpd >= effectiveProfile.rpd) {
      return { allowed: false, reason: 'rpd', snapshot: current };
    }

    const inputTokens = Math.max(1, Math.ceil(toFiniteNumber(estimatedInputTokens, 1)));
    if (effectiveProfile.tpm && current.usage.tpm + inputTokens > effectiveProfile.tpm) {
      return { allowed: false, reason: 'tpm', snapshot: current };
    }

    if (current.usage.rpm >= effectiveProfile.rpm) {
      const oldest = this.state.reservations
        .filter((item) => item.modelId === key && now - Number(item.timestamp) < MINUTE_MS)
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))[0];
      const waitMs = oldest
        ? Math.max(1, MINUTE_MS - (now - Number(oldest.timestamp)) + 25)
        : MINUTE_MS;
      return { allowed: false, reason: 'rpm', waitMs, snapshot: current };
    }

    const reservation = {
      id: randomUUID(),
      timestamp: now,
      pacificDate: current.pacificDate,
      modelId: key,
      inputTokens,
      outputTokens: 0,
      status: 'reserved'
    };
    this.state.reservations.push(reservation);
    const next = this.snapshot(key, effectiveProfile);
    void this.persist();
    return { allowed: true, reservationId: reservation.id, snapshot: next };
  }

  async recordResult({ reservationId, usage, status = 'success' } = {}) {
    await this.ready;
    const reservation = this.state.reservations.find((item) => item.id === reservationId);
    if (!reservation) return;

    reservation.status = status;
    reservation.inputTokens = Math.max(
      reservation.inputTokens || 0,
      Math.ceil(toFiniteNumber(usage?.inputTokens, 0))
    );
    reservation.outputTokens = Math.max(0, Math.ceil(toFiniteNumber(usage?.outputTokens, 0)));
    void this.persist();
  }

  async applyMonitoringProfile(modelId, { rpm, rpd, tpm, usageRpm, usageRpd, usageTpm } = {}) {
    await this.ready;
    const key = String(modelId || '').replace(/^models\//, '');
    const existing = this.state.quotaProfiles[key] || {};
    this.state.quotaProfiles[key] = {
      ...existing,
      ...(positiveLimit(rpm) ? { rpm } : {}),
      ...(positiveLimit(rpd) ? { rpd } : {}),
      ...(positiveLimit(tpm) ? { tpm } : {}),
      quotaSource: 'monitoring',
      ...(usageRpm !== undefined ? { usageRpm } : {}),
      ...(usageRpd !== undefined ? { usageRpd } : {}),
      ...(usageTpm !== undefined ? { usageTpm } : {}),
      usageDate: getPacificDate(this.now()),
      observedAt: new Date(this.now()).toISOString()
    };
    void this.persist();
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getModelTiming(modelId) {
    const now = this.now();
    const key = String(modelId || '').replace(/^models\//, '');
    const oldestRecentReservation = this.state.reservations
      .filter((item) => item.modelId === key && now - Number(item.timestamp) < MINUTE_MS)
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))[0];

    return {
      nextRpmResetAt: oldestRecentReservation
        ? Number(oldestRecentReservation.timestamp) + MINUTE_MS + 25
        : null,
      windowMs: MINUTE_MS
    };
  }
}

export const estimateInputTokens = ({ prompt, messages, media } = {}) => {
  const text = [
    prompt,
    ...(Array.isArray(messages) ? messages.map((message) => message?.content) : [])
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
  const mediaCount = Array.isArray(media) ? media.length : 0;
  return Math.max(1, Math.ceil(text.length / 4) + (mediaCount * 256));
};
