import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config/models.js';

const DEFAULT_LIMIT = 150;
const DEFAULT_VIEW_LIMIT = 100;
const DEFAULT_TEXT_LIMIT = 12000;
const MAX_VIEW_LIMIT = 500;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 80;
const MAX_OBJECT_KEYS = 80;

let writeQueue = Promise.resolve();

const getLogPath = () => config.requestLogPath;

const getLogLimit = () => (
  Number.isFinite(config.requestLogLimit) && config.requestLogLimit > 0
    ? config.requestLogLimit
    : DEFAULT_LIMIT
);

const getTextLimit = () => (
  Number.isFinite(config.requestLogTextLimit) && config.requestLogTextLimit > 0
    ? config.requestLogTextLimit
    : DEFAULT_TEXT_LIMIT
);

const truncateString = (value, limit = getTextLimit()) => {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}... [truncated ${value.length - limit} chars]`;
};

const looksLikeBase64Payload = (key, value) => {
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedKey = String(key || '').toLowerCase();
  if (['data', 'audio', 'image', 'video'].includes(normalizedKey) && value.length > 512) {
    return true;
  }

  return value.startsWith('data:') && value.includes(';base64,');
};

const summarizeBinaryString = (value) => ({
  omitted: true,
  chars: typeof value === 'string' ? value.length : 0
});

const sanitizeForLog = (value, depth = 0, parentKey = '') => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (looksLikeBase64Payload(parentKey, value)) {
      return summarizeBinaryString(value);
    }

    return truncateString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[max depth reached]';
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1, parentKey));
    if (value.length > MAX_ARRAY_ITEMS) {
      sliced.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return sliced;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const sanitized = {};

    for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      const normalizedKey = key.toLowerCase();

      if (normalizedKey === 'authorization' || normalizedKey === 'x-api-key') {
        sanitized[key] = '[redacted]';
        continue;
      }

      sanitized[key] = sanitizeForLog(entryValue, depth + 1, key);
    }

    if (entries.length > MAX_OBJECT_KEYS) {
      sanitized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
    }

    return sanitized;
  }

  return String(value);
};

const readAllLogs = async () => {
  const logPath = getLogPath();

  try {
    const data = await fs.readFile(logPath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    console.error('[request-log] Failed to read request log:', error.message);
    return [];
  }
};

const writeAllLogs = async (entries) => {
  const logPath = getLogPath();
  const tempPath = `${logPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf8');
  await fs.rename(tempPath, logPath);
};

export const appendRequestLog = async (entry) => {
  const normalizedEntry = {
    id: entry.id || randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    ...sanitizeForLog(entry)
  };

  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const currentEntries = await readAllLogs();
      currentEntries.push(normalizedEntry);
      await writeAllLogs(currentEntries.slice(-getLogLimit()));
    });

  return writeQueue;
};

export const safeAppendRequestLog = async (entry) => {
  try {
    await appendRequestLog(entry);
  } catch (error) {
    console.error('[request-log] Failed to append request log:', error.message);
  }
};

export const getRequestLogs = async ({ limit } = {}) => {
  const configuredViewLimit = Number.isFinite(config.requestLogViewLimit) && config.requestLogViewLimit > 0
    ? config.requestLogViewLimit
    : DEFAULT_VIEW_LIMIT;
  const requestedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_VIEW_LIMIT)
    : configuredViewLimit;
  const entries = await readAllLogs();

  return {
    entries: entries.slice(-safeLimit).reverse(),
    totalStored: entries.length,
    storageLimit: getLogLimit(),
    defaultViewLimit: configuredViewLimit
  };
};
