import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
// Go up two levels from src/config to project root
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '../../');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'models.json');

const parsePositiveIntEnv = (name, fallback) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    console.warn(`Invalid ${name}='${rawValue}', using ${fallback}`);
    return fallback;
  }

  return parsedValue;
};

const parseNonNegativeIntEnv = (name, fallback) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    console.warn(`Invalid ${name}='${rawValue}', using ${fallback}`);
    return fallback;
  }

  return parsedValue;
};

const parseOptionalPositiveIntEnv = (name, fallback) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue)) {
    console.warn(`Invalid ${name}='${rawValue}', using ${fallback}`);
    return fallback;
  }

  return parsedValue > 0 ? parsedValue : 0;
};

const parseBooleanEnv = (name, fallback = false) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(rawValue);
};

const parseCsvEnv = (name) => {
  const rawValue = process.env[name];
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const parseTrustProxyEnv = (name) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return false;
  }

  if (/^(1|true|yes|on)$/i.test(rawValue)) {
    return true;
  }

  if (/^(0|false|no|off)$/i.test(rawValue)) {
    return false;
  }

  const numericValue = Number.parseInt(rawValue, 10);
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  return rawValue;
};

const resolveProjectPath = (value) => {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(PROJECT_ROOT, value);
};

/**
 * Reads configured models from models.json
 */
export const getConfiguredModels = () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('models.json not found, returning empty list');
      return [];
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading models.json:', error);
    return [];
  }
};

/**
 * Updates models.json
 */
export const saveConfiguredModels = (models) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(models, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving models.json:', error);
    return false;
  }
};

export const config = {
  port: process.env.PORT || 3000,
  googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  googleUseVertex: /^(1|true|yes)$/i.test(
    process.env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_USE_VERTEX || ''
  ),
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT,
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION || 'global',
  googleCloudStorageBucket: process.env.GOOGLE_CLOUD_STORAGE_BUCKET,
  googleHttpTimeoutMs: parsePositiveIntEnv('GOOGLE_HTTP_TIMEOUT_MS', 20 * 60 * 1000),
  googleFileActiveTimeoutMs: parsePositiveIntEnv('GOOGLE_FILE_ACTIVE_TIMEOUT_MS', 20 * 60 * 1000),
  googleFilePollIntervalMs: parsePositiveIntEnv('GOOGLE_FILE_POLL_INTERVAL_MS', 5000),
  googleMaxRetries: parseNonNegativeIntEnv('GOOGLE_MAX_RETRIES', 0),
  groqApiKey: process.env.GROQ_API_KEY,
  dockerHost: process.env.DOCKER_HOST_URL || 'http://localhost',
  serverRequestTimeoutMs: parsePositiveIntEnv('SERVER_REQUEST_TIMEOUT_MS', 20 * 60 * 1000),
  serverHeadersTimeoutMs: parsePositiveIntEnv('SERVER_HEADERS_TIMEOUT_MS', 21 * 60 * 1000),
  trustProxy: parseTrustProxyEnv('TRUST_PROXY'),
  corsAllowedOrigins: parseCsvEnv('CORS_ALLOWED_ORIGINS'),
  corsAllowNoOrigin: parseBooleanEnv('CORS_ALLOW_NO_ORIGIN', true),
  enforceAuthentication: parseBooleanEnv('ENFORCE_AUTHENTICATION', process.env.NODE_ENV === 'production'),
  protectHealthEndpoint: parseBooleanEnv('PROTECT_HEALTH_ENDPOINT', false),
  basicAuthUsername: process.env.BASIC_AUTH_USERNAME || '',
  basicAuthPassword: process.env.BASIC_AUTH_PASSWORD || '',
  apiKey: process.env.AI_PROVIDER_API_KEY || '',
  enableConfigRoutes: parseBooleanEnv('ENABLE_CONFIG_ROUTES', false),
  enableAudioProxy: parseBooleanEnv('ENABLE_AUDIO_PROXY', false),
  audioProxyRoot: resolveProjectPath(process.env.AUDIO_PROXY_ROOT),
  runRateLimitWindowMs: parsePositiveIntEnv('RUN_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  runRateLimitMax: parseOptionalPositiveIntEnv('RUN_RATE_LIMIT_MAX', 30),
  runConcurrencyLimit: parseOptionalPositiveIntEnv('RUN_CONCURRENCY_LIMIT', 2),
  maxGenerationTokens: parseOptionalPositiveIntEnv('MAX_GENERATION_TOKENS', 4096)
};
