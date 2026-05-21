import { GoogleAuth } from 'google-auth-library';
import { BaseAdapter } from './base.js';

export class VertexOpenAIAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.project = config.googleCloudProject || process.env.GOOGLE_CLOUD_PROJECT;
    this.location = config.googleCloudLocation || process.env.GOOGLE_CLOUD_LOCATION || 'global';
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    this.authClientPromise = null;
  }

  async health() {
    return !!this.project;
  }

  async generate({ model, apiModelId, prompt, messages, media, stream, options }) {
    if (Array.isArray(media) && media.length > 0) {
      throw new Error('Media attachments are currently supported only for Gemini text models');
    }

    const realModelId = apiModelId || model;
    const inputMessages = this.normalizeMessages({ prompt, messages });

    console.log(`[VertexOpenAIAdapter] Requesting model: ${realModelId}`);

    const request = this.removeUndefined({
      model: realModelId,
      messages: inputMessages,
      stream,
      temperature: options?.temperature,
      top_p: options?.topP,
      max_tokens: options?.maxTokens,
      response_format: this.buildResponseFormat(options),
      tools: options?.tools,
      tool_choice: options?.toolChoice
    });

    const response = await this.fetchChatCompletions(request);

    if (stream) {
      return this.transformOpenAIStream(response);
    }

    const completion = await response.json();
    const choice = completion?.choices?.[0];
    const message = choice?.message || {};

    return {
      content: this.extractContent(message),
      outputText: this.extractContent(message),
      toolCalls: this.mapToolCalls(message.tool_calls),
      finishReason: choice?.finish_reason ?? null,
      usage: this.mapUsage(completion?.usage),
      blockedReason: choice?.finish_reason === 'content_filter' ? 'content_filter' : null,
      metadata: {
        mode: 'vertex-openai',
        model: completion?.model || realModelId
      }
    };
  }

  async fetchChatCompletions(request) {
    const token = await this.getAccessToken();
    const url = `https://aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/endpoints/openapi/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    return response;
  }

  async getAccessToken() {
    if (!this.authClientPromise) {
      this.authClientPromise = this.auth.getClient();
    }

    const client = await this.authClientPromise;
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

    if (!token) {
      throw new Error('Unable to obtain Google Cloud access token for Vertex OpenAI endpoint');
    }

    return token;
  }

  async buildApiError(response) {
    const text = await response.text();
    let message = text;

    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message || parsed?.message || text;
    } catch {
      // Keep the original text.
    }

    const error = new Error(message || `Vertex OpenAI request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.statusText = response.statusText;
    return error;
  }

  normalizeMessages({ prompt, messages }) {
    const inputMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!inputMessages) {
      throw new Error('No prompt/messages provided for text generation');
    }

    return inputMessages.map((message) => this.removeUndefined({
      role: message.role,
      content: message.content ?? '',
      tool_call_id: message.tool_call_id,
      name: message.name,
      tool_calls: this.mapOutgoingToolCalls(message.tool_calls)
    }));
  }

  mapOutgoingToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined;
    }

    return toolCalls.map((toolCall) => this.removeUndefined({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: typeof toolCall.arguments === 'string'
          ? toolCall.arguments
          : JSON.stringify(toolCall.arguments ?? {})
      }
    }));
  }

  buildResponseFormat(options) {
    if (options?.responseMimeType !== 'application/json') {
      return undefined;
    }

    if (options?.responseJsonSchema) {
      return {
        type: 'json_schema',
        json_schema: {
          name: options.outputName || 'response',
          strict: options.strictJson !== false,
          schema: options.responseJsonSchema
        }
      };
    }

    return { type: 'json_object' };
  }

  transformOpenAIStream(response) {
    const extractContent = this.extractContent.bind(this);

    const stream = async function* () {
      const decoder = new TextDecoder();
      let buffer = '';

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') {
            continue;
          }

          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta || {};
          const content = extractContent(delta);

          if (content) {
            yield {
              text: () => content,
              content,
              role: delta.role
            };
          }
        }
      }
    };

    return stream();
  }

  extractContent(message) {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
        .join('');
    }
    return '';
  }

  mapToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: toolCall.type || 'function',
      name: toolCall.function?.name,
      arguments: this.parseToolArguments(toolCall.function?.arguments)
    }));
  }

  parseToolArguments(value) {
    if (typeof value !== 'string') {
      return value ?? {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  mapUsage(usage) {
    if (!usage) return null;

    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
    const outputTokens = (usage.completion_tokens ?? 0) + reasoningTokens;

    return {
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens,
      totalTokens: usage.total_tokens ?? null,
      raw: usage
    };
  }

  removeUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
  }
}
