import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/models.js';

const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_TOP_REQUESTS = 50;
const DEFAULT_LEDGER_MONTHS = 24;
const LEDGER_LOCK_STALE_MS = 30_000;
const LEDGER_LOCK_WAIT_MS = 75;

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
  'gemini-3.1-flash-lite': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.25,
    inputAudioPer1M: 0.5,
    outputPer1M: 1.5
  },
  'gemini-3.1-flash-lite-preview': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.25,
    inputAudioPer1M: 0.5,
    outputPer1M: 1.5
  },
  'gemma-4-26b-a4b-it': {
    source: 'Google Agent Platform MaaS / Gemini API pricing, Standard tier',
    inputPer1M: 0.15,
    outputPer1M: 0.6
  },
  'gemma-4-26b-a4b-it-maas': {
    source: 'Google Agent Platform MaaS / Gemini API pricing, Standard tier',
    inputPer1M: 0.15,
    outputPer1M: 0.6
  },
  'gemini-3.5-flash': {
    source: 'Google Agent Platform pricing, Standard tier',
    inputPer1M: 1.5,
    inputLongPer1M: 1.5,
    outputPer1M: 9,
    outputLongPer1M: 9,
    longContextThreshold: 200_000
  },
  'gemini-3.7-flash': {
    source: 'Google Gemini 3.7 Flash introductory pricing through 2026-12-31',
    inputPer1M: 0.75,
    inputLongPer1M: 0.75,
    outputPer1M: 3.75,
    outputLongPer1M: 3.75,
    longContextThreshold: 200_000
  },
  'gemini-3.6-flash': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 1.5,
    inputLongPer1M: 1.5,
    outputPer1M: 7.5,
    outputLongPer1M: 7.5,
    longContextThreshold: 200_000
  },
  'gemini-3.5-flash-lite': {
    source: 'Google Vertex AI / Gemini API pricing, Standard tier',
    inputPer1M: 0.3,
    inputLongPer1M: 0.3,
    outputPer1M: 2.5,
    outputLongPer1M: 2.5,
    longContextThreshold: 200_000
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
  'gemini-3.1-flash-lite-image': {
    source: 'Google Agent Platform pricing, Standard tier',
    inputPer1M: 0.25,
    outputPer1M: 1.5,
    outputImageUsd: {
      default: 0.034,
      '1K': 0.034
    }
  },
  'gemini-3.1-flash-image': {
    source: 'Google Agent Platform pricing, Standard tier',
    inputPer1M: 0.5,
    outputPer1M: 3,
    outputImageUsd: {
      default: 0.067,
      '0.5K': 0.045,
      '512': 0.045,
      '1K': 0.067,
      '2K': 0.101,
      '4K': 0.15
    }
  },
  'gemini-3-pro-image': {
    source: 'Google Agent Platform pricing, Standard tier',
    inputPer1M: 2,
    outputPer1M: 12,
    outputImageUsd: {
      default: 0.134,
      '1K': 0.134,
      '2K': 0.134,
      '4K': 0.24
    }
  },
  'gemini-2.5-flash-tts': {
    source: 'Google Cloud TTS / Vertex AI pricing, Standard tier',
    inputPer1M: 0.5,
    outputAudioPer1M: 10,
    audioTokensPerSecond: 25
  },
  'gemini-2.5-flash-lite-preview-tts': {
    source: 'Google Cloud TTS / Vertex AI pricing, Standard tier',
    inputPer1M: 0.5,
    outputAudioPer1M: 10,
    audioTokensPerSecond: 25
  },
  'gemini-2.5-pro-tts': {
    source: 'Google Cloud TTS / Vertex AI pricing, Standard tier',
    inputPer1M: 1,
    outputAudioPer1M: 20,
    audioTokensPerSecond: 25
  },
  'gemini-3.1-flash-tts-preview': {
    source: 'Google Cloud TTS / Vertex AI pricing, Standard tier',
    inputPer1M: 1,
    outputAudioPer1M: 20,
    audioTokensPerSecond: 25
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
  },
  'grok-4.1-fast-non-reasoning': {
    source: 'Google Agent Platform pricing, xAI Grok models',
    inputPer1M: 0.2,
    outputPer1M: 0.5
  },
  'grok-4.1-fast-reasoning': {
    source: 'Google Agent Platform pricing, xAI Grok models',
    inputPer1M: 0.2,
    outputPer1M: 0.5
  },
  'grok-4.20-non-reasoning': {
    source: 'Google Agent Platform pricing, xAI Grok models',
    inputPer1M: 1.25,
    outputPer1M: 2.5
  },
  'grok-4.20-reasoning': {
    source: 'Google Agent Platform pricing, xAI Grok models',
    inputPer1M: 1.25,
    outputPer1M: 2.5
  }
};

const normalizeModelId = (value) => String(value || '')
  .trim()
  .replace(/^models\//, '')
  .replace(/^xai\//, '')
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
  if (!['google', 'vertexopenai'].includes(provider)) {
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
const getJournalPath = () => config.usageCostJournalPath;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const acquireLedgerLock = async () => {
  const lockPath = `${getLedgerPath()}.lock`;

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(path.join(lockPath, 'owner'), `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = await fs.stat(lockPath);
        if ((Date.now() - stat.mtimeMs) > LEDGER_LOCK_STALE_MS) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') {
          throw statError;
        }
      }

      await sleep(LEDGER_LOCK_WAIT_MS);
    }
  }
};

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

const appendJournalEntry = async (event) => {
  const journalPath = getJournalPath();
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.appendFile(journalPath, `${JSON.stringify(event)}\n`, 'utf8');
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

const parseDateKey = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const toDateKey = ({ year, month, day }) => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const addMonths = ({ year, month }, offset) => {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
};

const previousDateKey = (dateKey) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) - 24 * 60 * 60 * 1000);
  return toDateKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
};

const cycleStartForMonth = ({ year, month }, startDay) => (
  toDateKey({
    year,
    month,
    day: Math.min(startDay, daysInMonth(year, month))
  })
);

const calendarPeriodForMonth = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) {
    return {
      key: monthKey,
      type: 'calendar-month',
      startDate: null,
      endDate: null,
      label: monthKey
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const startDate = toDateKey({ year, month, day: 1 });
  const endDate = toDateKey({ year, month, day: daysInMonth(year, month) });

  return {
    key: monthKey,
    type: 'calendar-month',
    startDate,
    endDate,
    label: `${startDate} - ${endDate}`
  };
};

const resolveReportCycle = (dateKey) => {
  const dateParts = parseDateKey(dateKey);
  const reportStart = parseDateKey(config.usageCostReportStartDate);
  if (!dateParts || !reportStart) {
    const monthKey = String(dateKey || '').slice(0, 7);
    return {
      key: monthKey,
      startDate: `${monthKey}-01`,
      endDate: null,
      label: monthKey,
      type: 'calendar-month'
    };
  }

  const startDay = reportStart.day;
  const startMonth = dateParts.day >= startDay
    ? { year: dateParts.year, month: dateParts.month }
    : addMonths({ year: dateParts.year, month: dateParts.month }, -1);
  const nextStartMonth = addMonths(startMonth, 1);
  const startDate = cycleStartForMonth(startMonth, startDay);
  const nextStartDate = cycleStartForMonth(nextStartMonth, startDay);
  const endDate = previousDateKey(nextStartDate);

  return {
    key: startDate,
    startDate,
    endDate,
    label: `${startDate} - ${endDate}`,
    type: 'report-cycle'
  };
};

const shouldIncludeEntry = (entry, timeZone) => {
  const startDate = config.usageCostReportStartDate;
  if (!startDate) {
    return true;
  }

  return formatDateParts(new Date(entry.timestamp), timeZone).dateKey >= startDate;
};

const emptySummary = (periodKey, period = {}) => ({
  month: periodKey,
  periodKey,
  periodType: period.type || 'calendar-month',
  periodStart: period.startDate || null,
  periodEnd: period.endDate || null,
  periodLabel: period.label || periodKey,
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

const emptyMonth = (monthKey) => emptySummary(monthKey, calendarPeriodForMonth(monthKey));

const emptyCycle = (cycle) => emptySummary(cycle.key, cycle);

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

const applyUsageEntryToSummary = (summary, entry, dateKey) => {
  const costUsd = entry.cost.totalUsd || 0;
  summary.requestCount += 1;
  if (entry.cost.priced) {
    summary.pricedRequestCount += 1;
  } else {
    summary.unpricedRequestCount += 1;
  }
  summary.totalUsd = money(summary.totalUsd + costUsd);
  addToBucket(summary.byProvider, entry.provider, costUsd);
  addToBucket(summary.byModel, entry.model, costUsd);
  addToBucket(summary.byType, entry.type, costUsd);
  addToBucket(summary.byDay, dateKey, costUsd);
  summary.topRequests ||= [];
  summary.topRequests.push({
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
  trimTopRequests(summary);
};

const mergeBucket = (target, source) => {
  for (const [key, value] of Object.entries(source || {})) {
    addToBucket(target, key, Number(value) || 0);
  }
};

const mergeFullSummary = (target, source) => {
  target.requestCount += source.requestCount || 0;
  target.pricedRequestCount += source.pricedRequestCount || 0;
  target.unpricedRequestCount += source.unpricedRequestCount || 0;
  target.totalUsd = money(target.totalUsd + (source.totalUsd || 0));
  mergeBucket(target.byProvider, source.byProvider);
  mergeBucket(target.byModel, source.byModel);
  mergeBucket(target.byType, source.byType);
  mergeBucket(target.byDay, source.byDay);
  target.topRequests = [...(target.topRequests || []), ...(source.topRequests || [])];
  trimTopRequests(target);
};

const isDateInRange = (dateKey, startDate, endDate) => (
  (!startDate || dateKey >= startDate)
  && (!endDate || dateKey <= endDate)
);

const buildCycleFromMonths = (ledger, cycle) => {
  const summary = emptyCycle(cycle);

  for (const month of Object.values(ledger.months || {})) {
    const dayKeys = Object.keys(month.byDay || {});
    if (!dayKeys.length) {
      continue;
    }

    const hasAnyDayInRange = dayKeys.some((dateKey) => isDateInRange(dateKey, cycle.startDate, cycle.endDate));
    if (!hasAnyDayInRange) {
      continue;
    }

    const allKnownDaysInRange = dayKeys.every((dateKey) => isDateInRange(dateKey, cycle.startDate, cycle.endDate));
    if (allKnownDaysInRange) {
      mergeFullSummary(summary, month);
      continue;
    }

    for (const dateKey of dayKeys) {
      if (isDateInRange(dateKey, cycle.startDate, cycle.endDate)) {
        const costUsd = Number(month.byDay?.[dateKey]) || 0;
        summary.totalUsd = money(summary.totalUsd + costUsd);
        addToBucket(summary.byDay, dateKey, costUsd);
      }
    }
  }

  return summary;
};

const buildCostJournalEvent = ({ entry, monthKey, dateKey, cycle }) => ({
  schemaVersion: 1,
  kind: 'run-cost',
  id: entry.id,
  timestamp: entry.timestamp,
  recordedAt: new Date().toISOString(),
  dateKey,
  monthKey,
  cycleKey: cycle.key,
  cycleStart: cycle.startDate,
  cycleEnd: cycle.endDate,
  ok: Boolean(entry.ok),
  statusCode: entry.statusCode ?? null,
  provider: entry.provider || 'unknown',
  model: entry.model || 'unknown',
  apiModelId: entry.apiModelId || null,
  type: entry.type || 'unknown',
  durationMs: entry.durationMs ?? null,
  usage: entry.usage || entry.response?.usage || null,
  cost: entry.cost,
  costSchemaVersion: 'google-public-pricing-2026-06-10'
});

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
      const releaseLock = await acquireLedgerLock();
      try {
        const ledger = await readLedger();
        const { monthKey, dateKey } = formatDateParts(new Date(entry.timestamp), timeZone);
        const cycle = resolveReportCycle(dateKey);
        const journalEvent = buildCostJournalEvent({ entry, monthKey, dateKey, cycle });
        await appendJournalEntry(journalEvent);

        ledger.startDate = config.usageCostReportStartDate || null;
        ledger.timezone = timeZone;
        ledger.updatedAt = new Date().toISOString();
        ledger.months ||= {};
        ledger.cycles ||= {};
        ledger.journal ||= {};
        ledger.journal.path = getJournalPath();
        ledger.journal.schemaVersion = 1;
        ledger.journal.recordCount = (ledger.journal.recordCount || 0) + 1;
        ledger.journal.lastEventId = entry.id;
        ledger.journal.updatedAt = ledger.updatedAt;

        const month = ledger.months[monthKey] || emptyMonth(monthKey);
        applyUsageEntryToSummary(month, entry, dateKey);
        ledger.months[monthKey] = month;

        const cycleSummary = ledger.cycles[cycle.key] || emptyCycle(cycle);
        applyUsageEntryToSummary(cycleSummary, entry, dateKey);
        ledger.cycles[cycle.key] = cycleSummary;

        trimLedgerMonths(ledger.months);
        trimLedgerMonths(ledger.cycles);
        await writeLedger(ledger);
      } finally {
        await releaseLock();
      }
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

export const getUsageCostSummary = async ({ month, period } = {}) => {
  const ledger = await readLedger();
  const timeZone = ledger.timezone || config.usageCostTimezone || 'UTC';
  const currentParts = formatDateParts(new Date(), timeZone);
  const currentMonth = currentParts.monthKey;
  const currentCycle = resolveReportCycle(currentParts.dateKey);
  const useReportCycle = period === 'cycle';
  const selectedMonth = month || currentMonth;
  const selectedPeriod = useReportCycle
    ? currentCycle
    : calendarPeriodForMonth(selectedMonth);
  const selected = useReportCycle
    ? (ledger.cycles?.[currentCycle.key] || buildCycleFromMonths(ledger, currentCycle))
    : (ledger.months?.[selectedMonth] || emptyMonth(selectedMonth));

  return {
    currency: 'USD',
    month: selectedPeriod.key,
    currentMonth,
    currentCycle: currentCycle.key,
    periodType: selectedPeriod.type,
    periodStart: selectedPeriod.startDate,
    periodEnd: selectedPeriod.endDate,
    periodLabel: selectedPeriod.label,
    startDate: ledger.startDate || config.usageCostReportStartDate || null,
    timezone: timeZone,
    updatedAt: ledger.updatedAt || null,
    months: Object.keys(ledger.months || {}).sort().reverse(),
    cycles: Object.keys(ledger.cycles || {}).sort().reverse(),
    journal: ledger.journal || null,
    summary: selected,
    pricingVersion: 'google-public-pricing-2026-07-25',
    pricingModels: Object.keys(GOOGLE_PRICING).sort()
  };
};
