const normalizeModelId = (value) => String(value || '').trim().replace(/^models\//, '');

// Ordered from the strongest general-purpose Gemini Flash model toward cheaper fallbacks.
export const GEMINI_FALLBACK_GROUPS = Object.freeze({
  frontierFlash: Object.freeze([
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash'
  ]),
  efficientFlash: Object.freeze([
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite'
  ]),
  legacyFlash: Object.freeze([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ])
});

export const GEMINI_AUTO_FALLBACK_ORDER = Object.freeze(
  Object.values(GEMINI_FALLBACK_GROUPS).flat()
);

export const resolveAutoFallbackModelIds = (modelId, maxModels = 2) => {
  const canonical = normalizeModelId(modelId);
  const index = GEMINI_AUTO_FALLBACK_ORDER.indexOf(canonical);
  if (index < 0) return [];

  return GEMINI_AUTO_FALLBACK_ORDER.slice(index + 1, index + 1 + maxModels);
};

export const resolveFallbackModelIds = ({ useFallback, modelId, maxAutoModels = 2 } = {}) => {
  if (useFallback === 'auto') {
    return resolveAutoFallbackModelIds(modelId, maxAutoModels);
  }

  if (!Array.isArray(useFallback)) return [];

  return [...new Set(useFallback.map(normalizeModelId).filter(Boolean))];
};

export { normalizeModelId };
