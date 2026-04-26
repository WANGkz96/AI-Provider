import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/models.js';

const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_TOP_REQUESTS = 50;
const DEFAULT_LEDGER_MONTHS = 24;

let ledgerWriteQueue = Promise.resolve();

const GOOGLE_PRICING = {
  'gemini-3.1-pro-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 2,
    inputLongPer1M: 4,
    outputPer1M: 12,
    outputLongPer1M: 18,
    longContextThreshold: 200_000
  },
  'gemini-3-pro-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 2,
    inputLongPer1M: 4,
    outputPer1M: 12,
    outputLongPer1M: 18,
    longContextThreshold: 200_000
  },
  'gemini-3-flash-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.5,
    inputAudioPer1M: 1,
    outputPer1M: 3
  },
  'gemini-3.1-flash-lite-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.25,
    inputAudioPer1M: 0.5,
    outputPer1M: 1.5
  },
  'gemini-2.5-flash': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.3,
    inputAudioPer1M: 1,
    outputPer1M: 2.5
  },
  'gemini-2.5-flash-lite': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.1,
    inputAudioPer1M: 0.3,
    outputPer1M: 0.4
  },
  'gemini-2.5-flash-lite-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.1,
    inputAudioPer1M: 0.3,
    outputPer1M: 0.4
  },
  'gemini-2.5-flash-image': {
    source: 'Google Gemini API pricing, Standard tier',
    inputPer1M: 0.3,
    outputImageUsd: {
      default: 0.039,
      '1K': 0.039
    }
  },
  'gemini-3-pro-image-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 2,
    outputPer1M: 12,
    outputImageUsd: {
      default: 0.134,
      '1K': 0.134,
      '2K': 0.134,
      '4K': 0.24
    }
  },
  'gemini-3.1-flash-image-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.5,
    outputPer1M: 3,
    outputImageUsd: {
      default: 0.067,
      '0.5K': 0.045,
      '512': 0.045,
      '1K': 0.067,
      '2K': 0.101,
      '4K': 0.151
    }
  },
  'gemini-2.5-flash-preview-tts': {
    source: 'Google Gemini API pricing, Standard tier',
    inputPer1M: 0.5,
    outputAudioPer1M: 10,
    audioTokensPerSecond: 25
  },
  'gemini-2.5-flash-tts': {
    source: 'Google Gemini API pricing, Standard tier',
    inputPer1M: 0.5,
    outputAudioPer1M: 10,
    audioTokensPerSecond: 25
  },
  'gemini-3.1-flash-tts-preview': {
    source: 'Google Gemini API pricing, Standard tier',
    inputPer1M: 1,
    outputAudioPer1M: 20,
    audioTokensPerSecond: 25
  },
  'imagen-4.0-fast-generate-001': {
    source: 'Google Gemini API pricing, Standard tier',
    outputImageUsd: { default: 0.02 }
  },
  'imagen-4.0-generate-001': {
    source: 'Google Gemini API pricing, Standard tier',
    outputImageUsd: { default: 0.04 }
  },
  'imagen-4.0-ultra-generate-001': {
    source: 'Google Gemini API pricing, Standard tier',
    outputImageUsd: { default: 0.06 }
  },
  'veo-3.1-generate-preview': {
    source: 'Google Gemini API pricing, Standard tier',
    outputVideoSecondUsd: { default: 0.4, '720p': 0.4, '1080p': 0.4, '4k': 0.6, '4K': 0.6 }
  },
  'veo-3.1-generate-001': {
    source: 'Google Gemini API pricing, Standard tier',
    outputVideoSecondUsd: { default: 0.4, '720p': 0.4, '1080p': 0.4, '4k': 0.6, '4K': 0.6 }
  },
  'veo-3.1-fast-generate-preview': {
    source: 'Google Gemini API pricing, Standard tier',
    outputVideoSecondUsd: { default: 0.12, '720p': 0.1, '1080p': 0.12, '4k': 0.3, '4K': 0.3 }
  },
  'veo-3.1-fast-generate-001': {
    source: 'Google Gemini API pricing, Standard tier',
    outputVideoSecondUsd: { default: 0.12, '720p': 0.1, '1080p': 0.12, '4k': 0.3, '4K': 0.3 }
  },
  'veo-3.1-lite-generate-preview': {
    source: 'Google Gemini API pricing, Standard tier',
    outputVideoSecondUsd: { default: 0.08, '720p': 0.05, '1080p': 0.08 }
  }
};

const normalizeModelId = (value) => String(value || '')
  .trim()
  .replace(/^models\//, '')
  .toLowerCase();

const money = (value) => (
  Number.isFinite(value)
    ? Math.round(value * 1_000_000) / 1_000_000
    : 0
);

const rateForTokens = (pricing, inputTokens, kind = 'text') => {
  if (kind === 'audio' && Number.isFinite(pricing.inputAudioPer1M)) {
    return pricing.inputAudioPer1M;
  }

  if (
    pricing.longContextThreshold
    && Number.isFinite(pricing.inputLongPer1M)
    && inputTokens > pricing.longContextThreshold
  ) {
    return pricing.inputLongPer1M;
  }

  return pricing.inputPer1M;
};

const outputRateForTokens = (pricing, inputTokens, kind = 'text') => {
  if (kind === 'audio' && Number.isFinite(pricing.outputAudioPer1M)) {
    return pricing.outputAudioPer1M;
  }

  if (
    pricing.longContextThreshold
    && Number.isFinite(pricing.outputLongPer1M)
    && inputTokens > pricing.longContextThreshold
  ) {
    return pricing.outputLongPer1M;
  }

  return pricing.outputPer1M;
};

const countResponseItems = (response, field) => (
  Array.isArray(response?.[field])
    ? response[field].length
    : 0
);

const resolveImageSize = (entry) => (
  entry?.request?.body?.image?.size
  || entry?.response?.metadata?.imageSize
  || entry?.response?.metadata?.size
  || 'default'
);

const resolveUnitPrice = (priceMap, key) => {
  if (!priceMap) {
    return 0;
  }

  return priceMap[key] ?? priceMap[String(key).toUpperCase()] ?? priceMap.default ?? 0;
};

const estimateTokenCost = ({ pricing, usage, requestType }) => {
  if (!usage) {
    return {
      inputUsd: 0,
      outputUsd: 0,
      inputTokens: null,
      outputTokens: null,
      notes: ['No token usage was returned by provider']
    };
  }

  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const inputKind = requestType === 'audio' ? 'audio' : 'text';
  const outputKind = requestType === 'audio' ? 'audio' : 'text';
  const inputRate = rateForTokens(pricing, inputTokens, inputKind);
  const outputRate = outputRateForTokens(pricing, inputTokens, outputKind);
  const inputUsd = Number.isFinite(inputRate) ? (inputTokens * inputRate / TOKENS_PER_MILLION) : 0;
  const outputUsd = Number.isFinite(outputRate) ? (outputTokens * outputRate / TOKENS_PER_MILLION) : 0;

  return {
    inputUsd,
    outputUsd,
    inputTokens,
    outputTokens,
    inputRatePer1M: inputRate ?? null,
    outputRatePer1M: outputRate ?? null,
    notes: []
  };
};

export const estimateRunCost = (entry) => {
  const provider = String(entry?.provider || '').toLowerCase();
  if (provider !== 'google') {
    return null;
  }

  const modelId = normalizeModelId(entry.apiModelId || entry.model || entry.response?.metadata?.model);
  const pricing = GOOGLE_PRICING[modelId];
  if (!pricing) {
    return {
      currency: 'USD',
      totalUsd: 0,
      priced: false,
      modelPricingId: modelId,
      notes: [`No Google pricing rule configured for '${modelId}'`]
    };
  }

  const usage = entry.usage || entry.response?.usage || null;
  const requestType = entry.type || entry.request?.body?.type || 'text';
  const tokenCost = estimateTokenCost({ pricing, usage, requestType });
  const imageCount = countResponseItems(entry.response, 'images');
  const imageSize = resolveImageSize(entry);
  const imageUnitUsd = resolveUnitPrice(pricing.outputImageUsd, imageSize);
  const imageUsd = imageCount * imageUnitUsd;
  const videoCount = countResponseItems(entry.response, 'videos');
  const durationSeconds = Number(entry.response?.metadata?.durationSeconds || entry.request?.body?.video?.durationSeconds || 0);
  const resolution = entry.response?.metadata?.resolution || entry.request?.body?.video?.resolution || 'default';
  const videoSecondUsd = resolveUnitPrice(pricing.outputVideoSecondUsd, resolution);
  const videoUsd = videoCount * durationSeconds * videoSecondUsd;
  let audioFallbackUsd = 0;
  let audioFallbackTokens = null;
  const notes = [...tokenCost.notes];

  if (requestType === 'audio' && !usage?.outputTokens && Number.isFinite(pricing.outputAudioPer1M)) {
    const duration = Number(entry.response?.metadata?.duration || 0);
    if (duration > 0) {
      audioFallbackTokens = duration * (pricing.audioTokensPerSecond || 25);
      audioFallbackUsd = audioFallbackTokens * pricing.outputAudioPer1M / TOKENS_PER_MILLION;
      notes.push('Estimated TTS audio output tokens from duration');
    }
  }

  const totalUsd = money(tokenCost.inputUsd + tokenCost.outputUsd + imageUsd + videoUsd + audioFallbackUsd);

  return {
    currency: 'USD',
    totalUsd,
    inputUsd: money(tokenCost.inputUsd),
    outputUsd: money(tokenCost.outputUsd + audioFallbackUsd),
    imageUsd: money(imageUsd),
    videoUsd: money(videoUsd),
    priced: totalUsd > 0 || tokenCost.inputTokens === 0 || imageCount > 0 || videoCount > 0,
    modelPricingId: modelId,
    source: pricing.source,
    rates: {
      inputPer1M: tokenCost.inputRatePer1M ?? pricing.inputPer1M ?? null,
      outputPer1M: tokenCost.outputRatePer1M ?? pricing.outputPer1M ?? pricing.outputAudioPer1M ?? null,
      imageUnitUsd: imageUnitUsd || null,
      videoSecondUsd: videoSecondUsd || null
    },
    units: {
      inputTokens: tokenCost.inputTokens,
      outputTokens: tokenCost.outputTokens,
      audioFallbackTokens,
      images: imageCount,
      imageSize,
      videos: videoCount,
      videoDurationSeconds: durationSeconds || null,
      videoResolution: resolution
    },
    notes
  };
};

const getLedgerPath = () => config.usageCostLedgerPath;

const readLedger = async () => {
  try {
    const data = await fs.readFile(getLedgerPath(), 'utf8');
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed : { months: {} };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { months: {} };
    }

    console.error('[usage-costs] Failed to read usage cost ledger:', error.message);
    return { months: {} };
  }
};

const writeLedger = async (ledger) => {
  const ledgerPath = getLedgerPath();
  const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(ledger, null, 2), 'utf8');
  await fs.rename(tempPath, ledgerPath);
};

const formatDateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    monthKey: `${parts.year}-${parts.month}`
  };
};

const shouldIncludeEntry = (entry, timeZone) => {
  const startDate = config.usageCostReportStartDate;
  if (!startDate) {
    return true;
  }

  return formatDateParts(new Date(entry.timestamp), timeZone).dateKey >= startDate;
};

const emptyMonth = (monthKey) => ({
  month: monthKey,
  requestCount: 0,
  pricedRequestCount: 0,
  unpricedRequestCount: 0,
  totalUsd: 0,
  byProvider: {},
  byModel: {},
  byType: {},
  byDay: {},
  topRequests: []
});

const addToBucket = (bucket, key, costUsd) => {
  const safeKey = key || 'unknown';
  bucket[safeKey] = money((bucket[safeKey] || 0) + costUsd);
};

const trimLedgerMonths = (months) => {
  const limit = Number.isFinite(config.usageCostLedgerMonths) && config.usageCostLedgerMonths > 0
    ? config.usageCostLedgerMonths
    : DEFAULT_LEDGER_MONTHS;
  const keys = Object.keys(months).sort();
  const removeCount = Math.max(0, keys.length - limit);

  for (const key of keys.slice(0, removeCount)) {
    delete months[key];
  }
};

const trimTopRequests = (month) => {
  const limit = Number.isFinite(config.usageCostTopRequests) && config.usageCostTopRequests > 0
    ? config.usageCostTopRequests
    : DEFAULT_TOP_REQUESTS;

  month.topRequests = (month.topRequests || [])
    .sort((a, b) => (b.totalUsd || 0) - (a.totalUsd || 0))
    .slice(0, limit);
};

export const recordUsageCost = async (entry) => {
  if (!entry?.ok || !entry?.cost) {
    return;
  }

  const timeZone = config.usageCostTimezone || 'UTC';
  if (!shouldIncludeEntry(entry, timeZone)) {
    return;
  }

  ledgerWriteQueue = ledgerWriteQueue
    .catch(() => {})
    .then(async () => {
      const ledger = await readLedger();
      const { monthKey, dateKey } = formatDateParts(new Date(entry.timestamp), timeZone);
      ledger.startDate = config.usageCostReportStartDate || null;
      ledger.timezone = timeZone;
      ledger.updatedAt = new Date().toISOString();
      ledger.months ||= {};

      const month = ledger.months[monthKey] || emptyMonth(monthKey);
      const costUsd = entry.cost.totalUsd || 0;
      month.requestCount += 1;
      if (entry.cost.priced) {
        month.pricedRequestCount += 1;
      } else {
        month.unpricedRequestCount += 1;
      }
      month.totalUsd = money(month.totalUsd + costUsd);
      addToBucket(month.byProvider, entry.provider, costUsd);
      addToBucket(month.byModel, entry.model, costUsd);
      addToBucket(month.byType, entry.type, costUsd);
      addToBucket(month.byDay, dateKey, costUsd);
      month.topRequests.push({
        id: entry.id,
        timestamp: entry.timestamp,
        model: entry.model,
        provider: entry.provider,
        type: entry.type,
        totalUsd: costUsd,
        inputUsd: entry.cost.inputUsd,
        outputUsd: entry.cost.outputUsd,
        imageUsd: entry.cost.imageUsd,
        videoUsd: entry.cost.videoUsd,
        durationMs: entry.durationMs
      });
      trimTopRequests(month);
      ledger.months[monthKey] = month;
      trimLedgerMonths(ledger.months);
      await writeLedger(ledger);
    });

  return ledgerWriteQueue;
};

export const safeRecordUsageCost = async (entry) => {
  try {
    await recordUsageCost(entry);
  } catch (error) {
    console.error('[usage-costs] Failed to record usage cost:', error.message);
  }
};

export const getUsageCostSummary = async ({ month } = {}) => {
  const ledger = await readLedger();
  const timeZone = ledger.timezone || config.usageCostTimezone || 'UTC';
  const currentMonth = formatDateParts(new Date(), timeZone).monthKey;
  const selectedMonth = month || currentMonth;
  const selected = ledger.months?.[selectedMonth] || emptyMonth(selectedMonth);

  return {
    currency: 'USD',
    month: selectedMonth,
    currentMonth,
    startDate: ledger.startDate || config.usageCostReportStartDate || null,
    timezone: timeZone,
    updatedAt: ledger.updatedAt || null,
    months: Object.keys(ledger.months || {}).sort().reverse(),
    summary: selected,
    pricingVersion: 'google-public-pricing-2026-04-26',
    pricingModels: Object.keys(GOOGLE_PRICING).sort()
  };
};
