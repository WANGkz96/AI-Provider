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

  async generate({ model, apiModelId, messages, stream, options }) {
    // Use apiModelId from config if provided, else fall back to the internal ID
    const realModelId = apiModelId || model;
    
    console.log(`[GroqAdapter] Requesting model: ${realModelId}`);

    const params = {
      model: realModelId,
      messages: messages,
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
      return completion.choices[0]?.message?.content || '';
    }
  }
}
