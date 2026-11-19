const DEFAULT_QUOTA_RETRY_AFTER_SECONDS = 60;

const getErrorStatus = (error) => Number(
  error?.status
  ?? error?.statusCode
  ?? error?.response?.status
  ?? error?.cause?.status
  ?? 0
);

// The Google SDK can wrap an API error in one or more JSON message strings.
const unwrapApiError = (error) => {
  let payload = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (payload?.error && typeof payload.error === 'object') {
      payload = payload.error;
      continue;
    }
    const message = typeof payload === 'string' ? payload : payload?.message;
    if (typeof message !== 'string' || !message.trim().startsWith('{')) break;
    try {
      payload = JSON.parse(message);
    } catch {
      break;
    }
  }
  return payload;
};

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
  const payload = unwrapApiError(error);
  const status = getErrorStatus(error) || getErrorStatus(payload) || Number(payload?.code) || 0;
  const message = String(payload?.message || error?.message || error || '');
  const code = String(payload?.status || payload?.code || error?.code || '');
  if (status === 403 || code === 'PERMISSION_DENIED') {
    return {
      statusCode: 403,
      body: {
        error: message,
        code: 'PERMISSION_DENIED',
        status: 'PERMISSION_DENIED',
        upstreamStatus: 403,
        ...(/eligible paid billing account/i.test(message)
          ? { reason: 'BILLING_ACCOUNT_ELIGIBILITY' }
          : {})
      }
    };
  }
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
