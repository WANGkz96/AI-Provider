const normalizeModelId = (value) => String(value || '').trim().replace(/^models\//, '');

export const resolveResponseModelId = ({ response, fallbackModelId } = {}) => {
  const selectedModel = response?.metadata?.useFallback?.selectedModel
    || response?.metadata?.provider?.useFallback?.selectedModel
    || fallbackModelId;

  return selectedModel ? normalizeModelId(selectedModel) : null;
};
