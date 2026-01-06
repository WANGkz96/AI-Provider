import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { BaseAdapter } from './base.js';

export class GoogleAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.apiKey = config.googleApiKey;
    
    if (!this.apiKey) {
      console.warn('Google Adapter initialized without API Key');
    }

    // Native SDK for standard models (like Gemma)
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    
    // OpenAI Client for newer models or models requiring the OpenAI-compatible endpoint
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      defaultHeaders: {
        'x-goog-api-key': this.apiKey 
      }
    });
  }

  async health() {
    // We strictly test if we can list models or check a basic availability
    // Relying on a specific model existence (like gemini-1.5) is brittle.
    // Native SDK doesn't have a simple "ping". 
    // We will assume true if API key is present, as actual 404s/Auth errors happen at generation time.
    return !!this.apiKey;
  }

  async generate(params) {
    const { model, apiModelId, messages, stream, options, adapterMode } = params;
    
    // Use apiModelId from config if available, fallback to 'model' ID
    const targetModel = apiModelId || model;

    // Use mode from config ('native' vs 'openai'). Default to native if not specified.
    // But if 'thinking' is used, we force OpenAI as per previous requirement.
    const useOpenAI = adapterMode === 'openai' || options?.thinking;

    if (useOpenAI) {
        return this.generateViaOpenAI({ ...params, model: targetModel });
    } else {
        return this.generateViaNativeSDK({ ...params, model: targetModel });
    }
  }

  // --- Implementation 1: Native Google SDK ---
  async generateViaNativeSDK({ model, messages, stream, options }) {
    console.log(`[GoogleAdapter:Native] Requesting model: ${model}`);

    const modelParams = {
      model: model,
      generationConfig: {
        topP: options?.topP,
        maxOutputTokens: options?.maxTokens,
        temperature: options?.temperature
      }
    };

    const genModel = this.genAI.getGenerativeModel(modelParams);

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const lastMessage = messages[messages.length - 1].content;

    const chat = genModel.startChat({ history });

    if (stream) {
      const result = await chat.sendMessageStream(lastMessage);
      return result.stream; 
    } else {
      const result = await chat.sendMessage(lastMessage);
      return result.response.text();
    }
  }

  // --- Implementation 2: OpenAI-Compatible Endpoint ---
  async generateViaOpenAI({ model, messages, stream, options }) {
    console.log(`[GoogleAdapter:OpenAI] Requesting model: ${model}`);

    const requestOptions = {
      model: model,
      messages: messages,
      stream: stream,
      top_p: options?.topP,
      max_tokens: options?.maxTokens,
    };

    // Handle Thinking Logic
    if (options?.thinking) {
        console.log('[GoogleAdapter:OpenAI] Thinking enabled:', options.thinking);
        delete requestOptions.temperature;
        requestOptions.extra_body = {
            google: {
                thinking_config: {
                    include_thoughts: options.thinking.includeThoughts,
                    thinking_budget: options.thinking.budget
                }
            }
        };
    } else {
        requestOptions.temperature = options?.temperature;
    }

    if (stream) {
        const streamResponse = await this.openai.chat.completions.create(requestOptions);
        
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
        const response = await this.openai.chat.completions.create(requestOptions);
        return response.choices[0].message.content;
    }
  }
}
