const DEFAULT_QUOTA_RETRY_AFTER_SECONDS = 60;

const getErrorStatus = (error) => Number(
  error?.status
  ?? error?.statusCode
  ?? error?.response?.status
  ?? error?.cause?.status
  ?? 0
);

const getHeaderValue = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);

  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName);
  return entry?.[1] ?? null;
};

const getRetryAfterSeconds = (error) => {
  const headerValue = getHeaderValue(error?.response?.headers || error?.headers, 'retry-after');
  const numericHeader = Number(headerValue);
  if (Number.isFinite(numericHeader) && numericHeader > 0) {
    return Math.ceil(numericHeader);
  }

  const message = String(error?.message || error || '');
  const retryDelayMatch = message.match(/(?:retryDelay|retry after)[^0-9]*(\d+)(?:\.\d+)?\s*s?/i);
  if (retryDelayMatch) {
    return Math.max(1, Number.parseInt(retryDelayMatch[1], 10));
  }

  return DEFAULT_QUOTA_RETRY_AFTER_SECONDS;
};

export const normalizeUpstreamError = (error) => {
  const status = getErrorStatus(error);
  const message = String(error?.message || error || '');
  const code = String(error?.code || '');
  const isQuotaError = (
    status === 429
    || /RESOURCE_EXHAUSTED|rate_limit_exceeded|quota_exceeded/i.test(`${code} ${message}`)
  );

  if (!isQuotaError) return null;

  const retryAfterSeconds = getRetryAfterSeconds(error);
  return {
    statusCode: 429,
    retryAfterSeconds,
    body: {
      error: 'Upstream quota exhausted',
      code: 'RESOURCE_EXHAUSTED',
      status: 'RESOURCE_EXHAUSTED',
      retryAfter: retryAfterSeconds,
      retryAfterSeconds
    }
  };
};

export { getRetryAfterSeconds };
