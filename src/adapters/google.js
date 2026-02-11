import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI, PersonGeneration } from '@google/genai';
import OpenAI from 'openai';
import { BaseAdapter } from './base.js';

export class GoogleAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.apiKey = config.googleApiKey || process.env.GEMINI_API_KEY;
    
    if (!this.apiKey) {
      console.warn('Google Adapter initialized without API Key');
    }

    // Native SDK for standard models (like Gemma)
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.imageAI = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
    
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
    const { model, apiModelId, options, adapterMode, type } = params;

    // Use apiModelId from config if available, fallback to 'model' ID
    const targetModel = apiModelId || model;

    if (type === 'image') {
      return this.generateImage({ ...params, model: targetModel });
    }

    if (type === 'video') {
      return this.generateVideo({ ...params, model: targetModel });
    }

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

  async generateImage({ model, prompt, messages, image, imageMode }) {
    if (!this.imageAI) {
      throw new Error('Google image generation requires a valid API key');
    }

    const promptText = prompt || messages?.[messages.length - 1]?.content;
    if (!promptText) {
      throw new Error('No prompt provided for image generation');
    }

    const resolvedMode = imageMode || (model.includes('imagen') ? 'imagen' : 'nano-banana');

    if (resolvedMode === 'imagen') {
      return this.generateImagenImages({ model, prompt: promptText, imageOptions: image });
    }

    return this.generateGeminiImages({ model, prompt: promptText, imageOptions: image, imageMode: resolvedMode });
  }

  async generateImagenImages({ model, prompt, imageOptions }) {
    const numberOfImages = imageOptions?.count || 1;
    const outputMimeType = imageOptions?.format || 'image/png';
    const aspectRatio = imageOptions?.aspectRatio || '1:1';
    const imageSize = imageOptions?.size || '1K';
    const supportsImageSize = !model.includes('imagen-4.0-fast');

    const config = {
      numberOfImages,
      outputMimeType,
      personGeneration: PersonGeneration.ALLOW_ALL,
      aspectRatio
    };

    if (supportsImageSize) {
      config.imageSize = imageSize;
    }

    const response = await this.imageAI.models.generateImages({
      model,
      prompt,
      config
    });

    const images = (response?.generatedImages || [])
      .map((generated) => {
        const data = generated?.image?.imageBytes;
        if (!data) return null;
        return { data, mimeType: outputMimeType };
      })
      .filter(Boolean);

    if (!images.length) {
      throw new Error('No images generated.');
    }

    return {
      type: 'image',
      images,
      metadata: {
        mode: 'imagen',
        model,
        count: images.length
      }
    };
  }

  async generateGeminiImages({ model, prompt, imageOptions, imageMode }) {
    const imageSize = imageOptions?.size || '1K';
    const aspectRatio = imageOptions?.aspectRatio;
    const supportsImageSize = !model.includes('gemini-2.5-flash-image');
    const supportsText = !model.includes('gemini-2.5-flash-image');
    const responseModalities = supportsText ? ['IMAGE', 'TEXT'] : ['IMAGE'];
    const config = { responseModalities };

    if (supportsImageSize || aspectRatio) {
      config.imageConfig = {};
      if (supportsImageSize) {
        config.imageConfig.imageSize = imageSize;
      }
      if (aspectRatio) {
        config.imageConfig.aspectRatio = aspectRatio;
      }
    }
    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt }
        ]
      }
    ];

    const response = await this.imageAI.models.generateContentStream({
      model,
      config,
      contents
    });

    const images = [];
    let trailingText = '';

    for await (const chunk of response) {
      const parts = chunk?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part?.inlineData?.data) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png'
          });
        } else if (part?.text) {
          trailingText += part.text;
        }
      }
    }

    if (!images.length) {
      throw new Error('No images generated.');
    }

    return {
      type: 'image',
      images,
      metadata: {
        mode: imageMode || 'nano-banana',
        model,
        count: images.length,
        text: trailingText || undefined
      }
    };
  }

  async generateVideo({ model, prompt, messages, video, videoMode }) {
    if (!this.imageAI) {
      throw new Error('Google video generation requires a valid API key');
    }

    const promptText = prompt || messages?.[messages.length - 1]?.content;
    if (!promptText) {
      throw new Error('No prompt provided for video generation');
    }

    const config = {
      numberOfVideos: video?.count || 1,
      aspectRatio: video?.aspectRatio || '16:9',
      durationSeconds: video?.durationSeconds || 8,
      resolution: video?.resolution || '1080p',
      personGeneration: PersonGeneration.ALLOW_ALL
    };

    let operation = await this.imageAI.models.generateVideos({
      model,
      prompt: promptText,
      config
    });

    const pollIntervalMs = 10000;
    const maxPolls = 60;
    let polls = 0;

    while (!operation.done) {
      if (polls >= maxPolls) {
        throw new Error('Video generation timed out.');
      }
      polls += 1;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      operation = await this.imageAI.operations.getVideosOperation({
        operation
      });
    }

    const generatedVideos = operation.response?.generatedVideos || [];
    const videos = [];

    for (const generatedVideo of generatedVideos) {
      const uri = generatedVideo?.video?.uri;
      if (!uri) continue;

      const downloadUrl = this.appendApiKey(uri);
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download generated video: ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = generatedVideo?.video?.mimeType || 'video/mp4';
      videos.push({
        data: buffer.toString('base64'),
        mimeType
      });
    }

    if (!videos.length) {
      throw new Error('No videos generated.');
    }

    return {
      type: 'video',
      videos,
      metadata: {
        mode: videoMode || 'veo',
        model,
        count: videos.length,
        durationSeconds: config.durationSeconds,
        resolution: config.resolution,
        aspectRatio: config.aspectRatio
      }
    };
  }

  appendApiKey(url) {
    if (!this.apiKey || url.includes('key=')) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}key=${this.apiKey}`;
  }
}
