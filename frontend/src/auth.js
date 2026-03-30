import axios from 'axios';

const ACCESS_KEY_STORAGE_KEY = 'ai-provider-access-key';

let promptInFlight = null;

const normalizeAccessKey = (value) => (
  typeof value === 'string'
    ? value.trim()
    : ''
);

const readStoredAccessKey = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return normalizeAccessKey(window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY));
};

const persistAccessKey = (value) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, value);
};

const clearStoredAccessKey = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
};

export const buildAccessKeyHeaders = (accessKey) => {
  const normalizedAccessKey = normalizeAccessKey(accessKey);
  if (!normalizedAccessKey) {
    return {};
  }

  return {
    Authorization: `Bearer ${normalizedAccessKey}`
  };
};

const verifyAccessKey = async (candidateAccessKey) => {
  const response = await fetch('/auth/check', {
    method: 'GET',
    headers: buildAccessKeyHeaders(candidateAccessKey)
  });

  return response.ok;
};

export const ensureAccessKey = async (forcePrompt = false) => {
  if (promptInFlight) {
    return promptInFlight;
  }

  promptInFlight = (async () => {
    let candidateAccessKey = forcePrompt ? '' : readStoredAccessKey();
    let promptMessage = 'Вставь access key для AI Provider';

    while (true) {
      if (!candidateAccessKey) {
        candidateAccessKey = normalizeAccessKey(window.prompt(promptMessage));
      }

      if (!candidateAccessKey) {
        promptMessage = 'Нужен access key. Вставь access key для AI Provider';
        continue;
      }

      const isValid = await verifyAccessKey(candidateAccessKey).catch(() => false);
      if (isValid) {
        persistAccessKey(candidateAccessKey);
        return candidateAccessKey;
      }

      clearStoredAccessKey();
      candidateAccessKey = '';
      promptMessage = 'Ключ не подошёл. Вставь access key для AI Provider ещё раз';
    }
  })();

  try {
    return await promptInFlight;
  } finally {
    promptInFlight = null;
  }
};

export const installAxiosAccessKey = (axiosInstance = axios) => {
  axiosInstance.interceptors.request.use(async (requestConfig) => {
    const accessKey = await ensureAccessKey();

    requestConfig.headers = {
      ...(requestConfig.headers || {}),
      ...buildAccessKeyHeaders(accessKey)
    };

    return requestConfig;
  });

  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error?.config;
      const statusCode = error?.response?.status;

      if (!originalRequest || statusCode !== 401 || originalRequest.__accessKeyRetry) {
        return Promise.reject(error);
      }

      clearStoredAccessKey();
      originalRequest.__accessKeyRetry = true;

      const accessKey = await ensureAccessKey(true);
      originalRequest.headers = {
        ...(originalRequest.headers || {}),
        ...buildAccessKeyHeaders(accessKey)
      };

      return axiosInstance.request(originalRequest);
    }
  );
};

export const fetchWithAccessKey = async (input, init = {}) => {
  const attemptRequest = async (forcePrompt = false) => {
    const accessKey = await ensureAccessKey(forcePrompt);

    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...buildAccessKeyHeaders(accessKey)
      }
    });
  };

  let response = await attemptRequest(false);
  if (response.status !== 401) {
    return response;
  }

  clearStoredAccessKey();
  response = await attemptRequest(true);
  return response;
};
