/**
 * Base Adapter Interface
 * All model providers must extend this class.
 */
export class BaseAdapter {
  constructor(config) {
    this.config = config;
  }

  /**
   * Check if the provider is healthy/reachable.
   * @returns {Promise<boolean>}
   */
  async health() {
    throw new Error('health() must be implemented');
  }

  /**
   * Main generation method.
   * @param {object} params
   * @param {string} params.model - The model identifier
   * @param {Array} params.messages - [{role: 'user', content: ''}, ...]
   * @param {boolean} params.stream - Whether to return a stream
   * @param {object} params.options - { temperature, topP, maxTokens }
   * @returns {Promise<any>} - Returns a stream or a JSON object
   */
  async generate(params) {
    throw new Error('generate() must be implemented');
  }
}

