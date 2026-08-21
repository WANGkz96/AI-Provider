const getFallbackFailureReason = (error) => (
  error?.ecoRouting?.fallbackReason
  || error?.code
  || null
);

const wasSkippedWithoutProviderAttempt = (error) => {
  const reason = String(getFallbackFailureReason(error) || '');
  return (
    reason.startsWith('no_eco_profile')
    || reason.startsWith('ai_studio_unavailable')
    || reason.startsWith('local_quota:')
  );
};

const withFallbackMetadata = (response, metadata) => {
  if (!response || typeof response !== 'object' || typeof response.then === 'function') {
    return response;
  }

  return {
    ...response,
    metadata: {
      ...(response.metadata || {}),
      useFallback: metadata
    }
  };
};

export const executeModelFallback = async ({
  targetModel,
  fallbackCandidates = [],
  fallbackSkipped = [],
  useFallback,
  generateParams,
  ecoPaidFallbackEligible = false,
  quotaAwareAutoFallback = false,
  invokeModel,
  invokePaidModel,
  buildModelParams,
  resolveApiModelId,
  decoratePaidResponse = (response) => response,
  maxAutoFallbackModels = 2
} = {}) => {
  const attempts = [];
  let lastError = null;
  let autoFallbackAttempts = 0;
  let paidFallbackAttempts = 0;
  const allCandidates = [targetModel, ...fallbackCandidates];

  const decorateSuccess = ({ response, model, fallbackUsed, paidControlAttempt }) => (
    withFallbackMetadata(response, {
      requested: true,
      mode: useFallback,
      originalModel: targetModel.id,
      originalApiModelId: generateParams.apiModelId,
      selectedModel: model.id,
      selectedApiModelId: resolveApiModelId(model),
      fallbackUsed,
      paidControlAttempt,
      autoFallbackAttempts: quotaAwareAutoFallback ? autoFallbackAttempts : null,
      paidFallbackAttempts: ecoPaidFallbackEligible ? paidFallbackAttempts : null,
      attempts,
      skipped: fallbackSkipped
    })
  );

  // Eco requests try free routes in this phase. Other modes retain the
  // provider-managed original -> fallback sequence.
  for (let index = 0; index < allCandidates.length; index += 1) {
    const model = allCandidates[index];
    const isOriginal = index === 0;
    if (quotaAwareAutoFallback && !isOriginal && autoFallbackAttempts >= maxAutoFallbackModels) {
      break;
    }

    try {
      const response = await invokeModel(
        model,
        buildModelParams(model),
        { allowPaidFallback: !ecoPaidFallbackEligible }
      );
      const consumedAutoAttempt = quotaAwareAutoFallback && !isOriginal;
      if (consumedAutoAttempt) autoFallbackAttempts += 1;
      attempts.push({
        model: model.id,
        success: true,
        route: response?.metadata?.ecoRouting?.route || null,
        phase: ecoPaidFallbackEligible ? 'eco' : 'provider',
        consumedAutoAttempt
      });
      return decorateSuccess({
        response,
        model,
        fallbackUsed: !isOriginal,
        paidControlAttempt: false
      });
    } catch (error) {
      lastError = error;
      const skippedWithoutProviderAttempt = Boolean(
        quotaAwareAutoFallback
        && !isOriginal
        && wasSkippedWithoutProviderAttempt(error)
      );
      if (quotaAwareAutoFallback && !isOriginal && !skippedWithoutProviderAttempt) {
        autoFallbackAttempts += 1;
      }
      attempts.push({
        model: model.id,
        success: false,
        phase: ecoPaidFallbackEligible ? 'eco' : 'provider',
        error: error?.message || String(error),
        reason: getFallbackFailureReason(error),
        consumedAutoAttempt: quotaAwareAutoFallback && !isOriginal && !skippedWithoutProviderAttempt
      });
    }
  }

  if (ecoPaidFallbackEligible) {
    try {
      const response = await invokePaidModel(targetModel, buildModelParams(targetModel));
      attempts.push({
        model: targetModel.id,
        success: true,
        route: 'vertex',
        phase: 'paid_original',
        paidControlAttempt: true
      });
      return decorateSuccess({
        response: decoratePaidResponse(response, {
          model: targetModel,
          reason: 'free_routes_exhausted',
          attempts: 1
        }),
        model: targetModel,
        fallbackUsed: false,
        paidControlAttempt: true
      });
    } catch (error) {
      lastError = error;
      attempts.push({
        model: targetModel.id,
        success: false,
        route: 'vertex',
        phase: 'paid_original',
        paidControlAttempt: true,
        error: error?.message || String(error)
      });
    }

    // If the paid route for the requested model also fails, try compatible
    // provider-managed fallbacks. Auto remains capped at two fallback models.
    for (const model of fallbackCandidates) {
      if (quotaAwareAutoFallback && paidFallbackAttempts >= maxAutoFallbackModels) {
        break;
      }

      paidFallbackAttempts += 1;
      try {
        const response = await invokePaidModel(model, buildModelParams(model));
        attempts.push({
          model: model.id,
          success: true,
          route: 'vertex',
          phase: 'paid_fallback',
          paidFallbackAttempt: paidFallbackAttempts
        });
        return decorateSuccess({
          response: decoratePaidResponse(response, {
            model,
            reason: 'paid_original_failed',
            attempts: paidFallbackAttempts
          }),
          model,
          fallbackUsed: true,
          paidControlAttempt: true
        });
      } catch (error) {
        lastError = error;
        attempts.push({
          model: model.id,
          success: false,
          route: 'vertex',
          phase: 'paid_fallback',
          paidFallbackAttempt: paidFallbackAttempts,
          error: error?.message || String(error)
        });
      }
    }
  }

  if (lastError) {
    lastError.fallbackAttempts = attempts;
    throw lastError;
  }
  throw new Error('No fallback model was available for this request.');
};

export { wasSkippedWithoutProviderAttempt };
