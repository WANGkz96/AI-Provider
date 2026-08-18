const normalizeModelId = (value) => String(value || '').trim().replace(/^models\//, '');

// Each fallback ladder is restricted to models that can serve the same kind of request.
export const MODEL_FALLBACK_GROUPS = Object.freeze({
  // Text-capable Gemini models, including multimodal text requests.
  text: Object.freeze([
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ]),
  image: Object.freeze([
    'gemini-3-pro-image',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite-image'
  ]),
  video: Object.freeze([
    'veo-3.1-generate-preview',
    'veo-3.1-fast-generate-preview'
  ]),
  tts: Object.freeze([
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-tts',
    'gemini-2.5-flash-lite-preview-tts',
    'gemini-2.5-pro-tts'
  ]),
  music: Object.freeze([
    'lyria-3-pro-preview',
    'lyria-3-clip-preview'
  ])
});

const getFallbackGroupKey = ({ type = 'text', audioMode } = {}) => {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return audioMode === 'lyria' ? 'music' : 'tts';
  if (type === 'text') return 'text';
  return null;
};

// Kept as a compatibility export for consumers that used the old text-only list.
export const GEMINI_AUTO_FALLBACK_ORDER = MODEL_FALLBACK_GROUPS.text;

export const resolveAutoFallbackModelIds = (modelId, options = {}) => {
  const normalizedOptions = typeof options === 'number'
    ? { maxModels: options }
    : options;
  const groupKey = getFallbackGroupKey(normalizedOptions);
  const order = MODEL_FALLBACK_GROUPS[groupKey] || [];
  const maxModels = normalizedOptions.maxModels ?? 2;
  const canonical = normalizeModelId(modelId);
  const index = order.indexOf(canonical);
  if (index < 0) return [];

  return order.slice(index + 1, index + 1 + maxModels);
};

export const resolveFallbackModelIds = ({
  useFallback,
  modelId,
  type = 'text',
  audioMode,
  maxAutoModels = 2
} = {}) => {
  if (useFallback === 'auto') {
    return resolveAutoFallbackModelIds(modelId, {
      type,
      audioMode,
      maxModels: maxAutoModels
    });
  }

  if (!Array.isArray(useFallback)) return [];

  return [...new Set(useFallback.map(normalizeModelId).filter(Boolean))];
};

export { normalizeModelId };
