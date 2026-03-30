import crypto from 'crypto';

const noopMiddleware = (req, res, next) => next();

const getRequestKey = (req) => (
  req.authSubject
  || req.ip
  || req.socket?.remoteAddress
  || 'anonymous'
);

const timingSafeStringCompare = (expected, actual) => {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

const parseBasicAuthCredentials = (authorizationHeader) => {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch (error) {
    return null;
  }
};

const extractBearerToken = (authorizationHeader) => {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

export const buildCorsOptions = (config) => {
  const allowedOrigins = new Set(config.corsAllowedOrigins);

  if (allowedOrigins.size === 0) {
    return { origin: false };
  }

  return {
    origin(origin, callback) {
      if (!origin) {
        if (config.corsAllowNoOrigin) {
          return callback(null, true);
        }

        return callback(new Error('CORS origin is required'));
      }

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin '${origin}' is not allowed`));
    }
  };
};

export const applySecurityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
};

export const createAccessControlMiddleware = (config) => {
  const hasBasicAuth = Boolean(config.basicAuthUsername && config.basicAuthPassword);
  const hasApiKey = Boolean(config.apiKey);

  if (!hasBasicAuth && !hasApiKey) {
    if (config.enforceAuthentication) {
      console.error('[security] Authentication is enforced, but no BASIC_AUTH_* or AI_PROVIDER_API_KEY is configured.');

      return (req, res, next) => {
        if (!config.protectHealthEndpoint && req.path === '/health') {
          return next();
        }

        return res.status(503).json({
          error: 'Authentication is required but not configured on the server'
        });
      };
    }

    console.warn('[security] No BASIC_AUTH_* or AI_PROVIDER_API_KEY configured. Service is running without authentication.');
    return (req, res, next) => {
      req.authSubject = getRequestKey(req);
      next();
    };
  }

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      return next();
    }

    if (!config.protectHealthEndpoint && req.path === '/health') {
      return next();
    }

    const authorizationHeader = req.headers.authorization;
    const headerApiKey = req.headers['x-api-key'];
    const providedApiKey = typeof headerApiKey === 'string'
      ? headerApiKey
      : extractBearerToken(authorizationHeader);

    if (hasApiKey && timingSafeStringCompare(config.apiKey, providedApiKey)) {
      req.authSubject = 'api-key';
      return next();
    }

    if (hasBasicAuth) {
      const credentials = parseBasicAuthCredentials(authorizationHeader);

      if (
        credentials
        && timingSafeStringCompare(config.basicAuthUsername, credentials.username)
        && timingSafeStringCompare(config.basicAuthPassword, credentials.password)
      ) {
        req.authSubject = `basic:${credentials.username}`;
        return next();
      }

      res.setHeader('WWW-Authenticate', 'Basic realm="AI Provider", charset="UTF-8"');
    }

    return res.status(401).json({ error: 'Authentication required' });
  };
};

export const createRateLimiter = ({
  maxRequests,
  windowMs,
  keyGenerator = getRequestKey,
  label = 'requests'
}) => {
  if (!maxRequests || maxRequests <= 0) {
    return noopMiddleware;
  }

  const hits = new Map();
  let lastSweepAt = 0;

  return (req, res, next) => {
    const now = Date.now();

    if ((now - lastSweepAt) >= windowMs) {
      for (const [key, entry] of hits.entries()) {
        if ((now - entry.windowStart) >= windowMs) {
          hits.delete(key);
        }
      }

      lastSweepAt = now;
    }

    const key = keyGenerator(req);
    const entry = hits.get(key);

    if (!entry || (now - entry.windowStart) >= windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - entry.windowStart)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: `Too many ${label} from this client`,
        retryAfterSeconds
      });
    }

    entry.count += 1;
    return next();
  };
};

export const createConcurrencyLimiter = ({
  maxConcurrent,
  keyGenerator = getRequestKey,
  label = 'generation requests'
}) => {
  if (!maxConcurrent || maxConcurrent <= 0) {
    return noopMiddleware;
  }

  const inflight = new Map();

  return (req, res, next) => {
    const key = keyGenerator(req);
    const activeCount = inflight.get(key) || 0;

    if (activeCount >= maxConcurrent) {
      return res.status(429).json({
        error: 'Too many concurrent requests',
        details: `Too many active ${label} from this client`
      });
    }

    inflight.set(key, activeCount + 1);

    let released = false;
    const release = () => {
      if (released) {
        return;
      }

      released = true;
      const currentCount = inflight.get(key) || 0;

      if (currentCount <= 1) {
        inflight.delete(key);
      } else {
        inflight.set(key, currentCount - 1);
      }
    };

    res.on('finish', release);
    res.on('close', release);

    next();
  };
};
