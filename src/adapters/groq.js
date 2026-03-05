import Groq from 'groq-sdk';
import { BaseAdapter } from './base.js';

export class GroqAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    if (!config.groqApiKey && process.env.GROQ_API_KEY) {
        config.groqApiKey = process.env.GROQ_API_KEY;
    }
    
    if (!config.groqApiKey) {
      console.warn('Groq Adapter initialized without API Key');
    }

    this.groq = new Groq({ apiKey: config.groqApiKey });
  }

  async health() {
    try {
      // Just check if we have a key, real check happens on request
      return !!this.groq.apiKey;
    } catch (e) {
      return false;
    }
  }

  async generate({ model, apiModelId, prompt, messages, media, stream, options }) {
    if (Array.isArray(media) && media.length > 0) {
      throw new Error('Media attachments are currently supported only for Gemini text models');
    }

    // Use apiModelId from config if provided, else fall back to the internal ID
    const realModelId = apiModelId || model;
    const inputMessages = (Array.isArray(messages) && messages.length > 0)
      ? messages
      : (prompt ? [{ role: 'user', content: prompt }] : null);

    if (!inputMessages) {
      throw new Error('No prompt/messages provided for text generation');
    }
    
    console.log(`[GroqAdapter] Requesting model: ${realModelId}`);

    const params = {
      model: realModelId,
      messages: inputMessages,
      stream: stream,
      temperature: options?.temperature,
      top_p: options?.topP,
      max_completion_tokens: options?.maxTokens, // Groq uses max_completion_tokens
    };

    if (stream) {
      const streamResponse = await this.groq.chat.completions.create(params);
      
      const transformStream = async function* () {
        for await (const chunk of streamResponse) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            yield { text: () => content };
          }
        }
      };
      
      return transformStream();
    } else {
      const completion = await this.groq.chat.completions.create(params);
      const choice = completion?.choices?.[0];
      return {
        content: choice?.message?.content || '',
        finishReason: choice?.finish_reason ?? null,
        usage: completion?.usage ? {
          inputTokens: completion.usage.prompt_tokens ?? null,
          outputTokens: completion.usage.completion_tokens ?? null,
          totalTokens: completion.usage.total_tokens ?? null,
          raw: completion.usage
        } : null,
        blockedReason: choice?.finish_reason === 'content_filter' ? 'content_filter' : null
      };
    }
  }
}
