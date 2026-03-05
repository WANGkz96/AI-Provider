import { BaseAdapter } from './base.js';

export class LocalAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    // You can define a base local URL or pass it per model config
    this.baseUrl = config.dockerHost || 'http://localhost';
  }

  async health() {
    try {
      // Simple fetch to the root or a known health endpoint of the local model server
      // Adjust this path based on your local inference server (e.g. Ollama, TGI, vLLM)
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async generate({ model, prompt, messages, media, stream, options }) {
    if (Array.isArray(media) && media.length > 0) {
      throw new Error('Media attachments are currently supported only for Gemini text models');
    }

    // This is a generic implementation assuming an OpenAI-compatible local server (like vLLM or Ollama)
    // You can customize this payload structure if your local container uses a different API.
    const inputMessages = (Array.isArray(messages) && messages.length > 0)
      ? messages
      : (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!inputMessages) {
      throw new Error('No prompt/messages provided for text generation');
    }
    
    const payload = {
      model: model, // Some local servers ignore this, others need it
      messages: inputMessages,
      stream: stream,
      temperature: options?.temperature,
      top_p: options?.topP,
      max_tokens: options?.maxTokens
    };

    const endpoint = `${this.baseUrl}/v1/chat/completions`; // Standard OpenAI-compatible path

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Local model error: ${response.statusText}`);
      }

      if (stream) {
        // Return the raw stream from the fetch response
        // Note: You might need to transform this stream if the local format differs from standard SSE
        return response.body; 
      } else {
        const data = await response.json();
        const choice = data?.choices?.[0];
        return {
          content: choice?.message?.content || '',
          finishReason: choice?.finish_reason ?? null,
          usage: data?.usage ? {
            inputTokens: data.usage.prompt_tokens ?? null,
            outputTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
            raw: data.usage
          } : null,
          blockedReason: choice?.finish_reason === 'content_filter' ? 'content_filter' : null
        };
      }
    } catch (error) {
      console.error('Local Adapter Generation Error:', error);
      throw error;
    }
  }
}

