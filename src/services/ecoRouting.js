const AI_STUDIO_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorStatus = (error) => Number(
  error?.status
  ?? error?.statusCode
  ?? error?.response?.status
  ?? error?.cause?.status
  ?? 0
);

export const classifyEcoError = (error) => {
  const status = getErrorStatus(error);
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (
    status === 429
    || ['resource_exhausted', 'rate_limit_exceeded', 'quota_exceeded'].some((value) => code.includes(value) || message.includes(value))
    || message.includes('quota')
    || message.includes('rate limit')
  ) {
    return 'quota';
  }

  if (
    status === 503
    || message.includes('503')
    || message.includes('high demand')
    || message.includes('high-demand')
    || message.includes('overloaded')
    || message.includes('temporarily unavailable')
  ) {
    return 'high_demand';
  }

  if (status === 403 || message.includes('permission denied') || message.includes('forbidden')) {
    return 'forbidden';
  }

  if (status === 404 || message.includes('not found')) {
    return 'not_found';
  }

  if (
    message.includes('fetch failed')
    || message.includes('network')
    || message.includes('econnreset')
    || message.includes('enotfound')
    || message.includes('timeout')
  ) {
    return 'network';
  }

  if (message.includes('region') || message.includes('location')) {
    return 'region';
  }

  return 'other';
};

const normalizeModelId = (value) => String(value || '').trim().replace(/^models\//, '');

const withRoutingMetadata = (response, routing) => {
  if (!response || typeof response !== 'object') {
    return {
      content: typeof response === 'string' ? response : '',
      metadata: { ecoRouting: routing }
    };
  }

  return {
    ...response,
    metadata: {
      ...(response.metadata || {}),
      ecoRouting: routing
    }
  };
};

export class EcoAvailabilityCache {
  constructor({ apiKey, ttlMs = 60 * 60 * 1000, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.apiKey = apiKey;
    this.ttlMs = ttlMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = null;
  }

  async listModels() {
    if (!this.apiKey || typeof this.fetchImpl !== 'function') {
      return { ok: false, reason: 'missing_key' };
    }

    if (this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.value;
    }

    try {
      const response = await this.fetchImpl(`${AI_STUDIO_MODELS_URL}?pageSize=1000`, {
        headers: { 'x-goog-api-key': this.apiKey }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `AI Studio models.list failed with HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const models = Array.isArray(payload.models) ? payload.models : [];
      const value = { ok: true, models };
      this.cache = { expiresAt: this.now() + this.ttlMs, value };
      return value;
    } catch (error) {
      const value = { ok: false, reason: classifyEcoError(error), error: error.message };
      this.cache = { expiresAt: this.now() + Math.min(this.ttlMs, 60 * 1000), value };
      return value;
    }
  }

  async checkModel(modelId) {
    const canonical = normalizeModelId(modelId);
    const result = await this.listModels();
    if (!result.ok) return result;

    const model = result.models.find((item) => normalizeModelId(item.name || item.baseModelId) === canonical);
    if (!model) return { ok: false, reason: 'not_found' };

    const methods = Array.isArray(model.supportedGenerationMethods)
      ? model.supportedGenerationMethods.map((method) => String(method).toLowerCase())
      : [];
    if (methods.length > 0 && !methods.includes('generatecontent')) {
      return { ok: false, reason: 'generate_content_unsupported', model };
    }

    return { ok: true, model };
  }

  getStatus() {
    return {
      configured: Boolean(this.apiKey),
      cached: Boolean(this.cache),
      expiresAt: this.cache?.expiresAt || null,
      ok: this.cache?.value?.ok ?? null,
      reason: this.cache?.value?.reason || null,
      modelCount: this.cache?.value?.models?.length || 0
    };
  }
}

const getModelProfile = (targetModel) => targetModel?.eco || null;

export class EcoRouter {
  constructor({ config, quotaLedger, availabilityCache, aiStudioProvider, sleepImpl = sleep } = {}) {
    this.config = config;
    this.quotaLedger = quotaLedger;
    this.availabilityCache = availabilityCache;
    this.aiStudioProvider = aiStudioProvider;
    this.sleep = sleepImpl;
  }

  shouldHandle({ targetModel, params } = {}) {
    return Boolean(
      this.config?.ecoEnabled
      && params?.eco === true
      && targetModel?.provider === 'google'
      && this.config?.googleUseVertex
      && this.aiStudioProvider
    );
  }

  async fallback({ targetModel, params, primaryProvider, reason, attempts = 0, quota = null }) {
    const response = await primaryProvider.generate({ ...params, stream: false });
    return withRoutingMetadata(response, {
      requested: true,
      route: 'vertex',
      fallback: true,
      fallbackReason: reason,
      attempts,
      model: normalizeModelId(params.apiModelId || targetModel?.vertexApiModelId || targetModel?.id),
      quota
    });
  }

  async generate({ targetModel, params, primaryProvider } = {}) {
    if (!this.shouldHandle({ targetModel, params })) {
      return primaryProvider.generate(params);
    }

    const aiStudioModel = normalizeModelId(
      targetModel.aiStudioApiModelId || targetModel.apiModelId || targetModel.id
    );
    const profile = getModelProfile(targetModel);
    if (!profile || profile.enabled === false) {
      return this.fallback({ targetModel, params, primaryProvider, reason: 'no_eco_profile' });
    }

    const availability = await this.availabilityCache.checkModel(aiStudioModel);
    if (!availability.ok) {
      return this.fallback({
        targetModel,
        params,
        primaryProvider,
        reason: `ai_studio_unavailable:${availability.reason || 'unknown'}`
      });
    }

    const estimatedInputTokens = Math.max(
      1,
      Number(params?.estimatedInputTokens || 1)
    );
    let reservation = await this.quotaLedger.reserve({
      modelId: aiStudioModel,
      profile,
      estimatedInputTokens
    });

    if (!reservation.allowed && reservation.reason === 'rpm') {
      const requiredWaitMs = Number(reservation.waitMs || 0);
      const maxWaitMs = Number(this.config.ecoMaxRpmWaitMs || 60 * 1000);
      if (requiredWaitMs > 0 && requiredWaitMs <= maxWaitMs) {
        await this.sleep(requiredWaitMs);
        reservation = await this.quotaLedger.reserve({
          modelId: aiStudioModel,
          profile,
          estimatedInputTokens
        });
      }
    }

    if (!reservation.allowed) {
      return this.fallback({
        targetModel,
        params,
        primaryProvider,
        reason: `local_quota:${reservation.reason}`,
        quota: reservation.snapshot
      });
    }

    const aiStudioParams = {
      ...params,
      apiModelId: aiStudioModel,
      stream: false
    };
    let attempts = 1;

    try {
      let response;
      try {
        response = await this.aiStudioProvider.generate(aiStudioParams);
      } catch (error) {
        const category = classifyEcoError(error);
        if (category !== 'high_demand') {
          await this.quotaLedger.recordResult({
            reservationId: reservation.reservationId,
            status: 'fallback',
            usage: null
          });
          return this.fallback({
            targetModel,
            params,
            primaryProvider,
            reason: `ai_studio_${category}`,
            attempts,
            quota: reservation.snapshot
          });
        }

        attempts = 2;
        await this.sleep(1000);
        response = await this.aiStudioProvider.generate(aiStudioParams);
      }

      await this.quotaLedger.recordResult({
        reservationId: reservation.reservationId,
        status: 'success',
        usage: response?.usage
      });
      return withRoutingMetadata(response, {
        requested: true,
        route: 'aiStudio',
        fallback: false,
        fallbackReason: null,
        attempts,
        model: aiStudioModel,
        quota: this.quotaLedger.snapshot(aiStudioModel, profile)
      });
    } catch (error) {
      await this.quotaLedger.recordResult({
        reservationId: reservation.reservationId,
        status: 'fallback',
        usage: null
      });
      return this.fallback({
        targetModel,
        params,
        primaryProvider,
        reason: `ai_studio_${classifyEcoError(error)}`,
        attempts,
        quota: reservation.snapshot
      });
    }
  }
}

export { normalizeModelId };
