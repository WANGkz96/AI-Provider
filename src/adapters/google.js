import { GoogleGenAI, PersonGeneration } from '@google/genai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BaseAdapter } from './base.js';

export class GoogleAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.apiKey = config.googleApiKey || process.env.GEMINI_API_KEY;
    this.useVertex = !!config.googleUseVertex;
    this.project = config.googleCloudProject;
    this.location = config.googleCloudLocation || 'global';
    this.httpTimeoutMs = config.googleHttpTimeoutMs || (20 * 60 * 1000);
    this.fileActiveTimeoutMs = config.googleFileActiveTimeoutMs || this.httpTimeoutMs;
    this.filePollIntervalMs = config.googleFilePollIntervalMs || 5000;
    this.maxRetries = config.googleMaxRetries ?? 0;
    
    if (!this.apiKey && !this.useVertex) {
      console.warn('Google Adapter initialized without API Key and without Vertex AI enabled');
    }

    this.genAI = new GoogleGenAI({
      ...(this.useVertex
        ? {
            vertexai: true,
            project: this.project,
            location: this.location
          }
        : {
            apiKey: this.apiKey
          }),
      maxRetries: this.maxRetries,
      httpOptions: {
        timeout: this.httpTimeoutMs
      }
    });

    // Provide alias for compatibility in other methods
    this.imageAI = this.genAI;
  }

  async health() {
    // We strictly test if we can list models or check a basic availability
    // Relying on a specific model existence (like gemini-1.5) is brittle.
    // Native SDK doesn't have a simple "ping". 
    // We will assume true if API key is present, as actual 404s/Auth errors happen at generation time.
    return !!this.apiKey;
  }

  async generate(params) {
    const { model, apiModelId, options, adapterMode, type, media } = params;

    // Use apiModelId from config if available, fallback to 'model' ID
    const targetModel = apiModelId || model;

    if (type === 'image') {
      return this.generateImage({ ...params, model: targetModel });
    }

    if (type === 'video') {
      return this.generateVideo({ ...params, model: targetModel });
    }

    if (type === 'audio') {
      return this.generateGeminiTtsAudio({ ...params, model: targetModel });
    }

    if (type === 'text' && Array.isArray(media) && media.length > 0) {
      return this.generateMultimodalViaGemini({ ...params, model: targetModel });
    }

    return this.generateViaGenAI({ ...params, model: targetModel });
  }

  async generateMultimodalViaGemini({ model, prompt, messages, media, stream, options }) {
    if (!this.imageAI) {
      throw new Error('Gemini multimodal input requires a valid API key');
    }

    console.log(`[GoogleAdapter:GeminiMultimodal] Requesting model: ${model}`);

    const { contents } = await this.buildGeminiMultimodalContents({ prompt, messages, media });
    const config = {
      topP: options?.topP,
      maxOutputTokens: options?.maxTokens,
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseSchema
    };

    // Thinking config does not combine reliably with file parts across models.
    if (!options?.thinking) {
      config.temperature = options?.temperature;
    }

    const request = {
      model,
      contents,
      config: this.removeUndefined(config)
    };

    if (stream) {
      const responseStream = await this.imageAI.models.generateContentStream(request);
      return this.transformGeminiContentStream(responseStream);
    }

    const response = await this.imageAI.models.generateContent(request);
    return this.formatGeminiContentResponse(response);
  }

  async buildGeminiMultimodalContents({ prompt, messages, media }) {
    const normalizedMessages = this.normalizeMessages({ prompt, messages });
    const historyMessages = normalizedMessages.slice(0, -1);
    const lastMessage = normalizedMessages[normalizedMessages.length - 1];

    const contents = historyMessages.map((message) => this.mapTextMessageToGeminiContent(message));

    const userText = this.normalizeText(lastMessage?.content);
    const userParts = await this.buildGeminiMediaParts(media);

    if (userText) {
      userParts.push({ text: userText });
    }

    if (!userParts.length) {
      throw new Error('No prompt/messages provided for multimodal generation');
    }

    contents.push({
      role: 'user',
      parts: userParts
    });

    return { contents };
  }

  mapTextMessageToGeminiContent(message) {
    const role = message?.role === 'assistant' ? 'model' : 'user';
    const text = this.normalizeText(message?.content);
    const finalText = message?.role === 'system' ? `[SYSTEM]\n${text}` : text;

    return {
      role,
      parts: [
        {
          text: finalText
        }
      ]
    };
  }

  async buildGeminiMediaParts(media) {
    const parts = [];

    for (const item of media || []) {
      const mediaType = this.resolveMediaType(item);
      const mimeType = item?.mimeType;
      const base64Data = this.stripDataUrlPrefix(item?.data);

      if (!mimeType || !base64Data) {
        throw new Error('Each media item must include mimeType and base64 data');
      }

      if (mediaType === 'image') {
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data
          }
        });
        continue;
      }

      if (mediaType === 'video') {
        const file = await this.uploadFileAndWaitActive({
          mimeType,
          data: base64Data,
          mediaType
        });

        const videoPart = {
          fileData: {
            fileUri: file.uri,
            mimeType: file.mimeType || mimeType
          }
        };

        const safeVideoMetadata = this.normalizeVideoMetadata(item?.videoMetadata);
        if (safeVideoMetadata) {
          videoPart.videoMetadata = safeVideoMetadata;
        }

        parts.push(videoPart);
        continue;
      }

      if (mediaType === 'audio') {
        const file = await this.uploadFileAndWaitActive({
          mimeType,
          data: base64Data,
          mediaType
        });

        parts.push({
          fileData: {
            fileUri: file.uri,
            mimeType: file.mimeType || mimeType
          }
        });
        continue;
      }

      throw new Error(`Unsupported media type '${mediaType}'. Supported: image, video, audio`);
    }

    return parts;
  }

  async uploadFileAndWaitActive({ mimeType, data, mediaType }) {
    const extension = this.mimeTypeToExtension(mimeType);
    const tempPath = path.join(os.tmpdir(), `gemini-upload-${randomUUID()}.${extension}`);
    const pollIntervalMs = this.filePollIntervalMs;
    const maxWaitMs = Math.max(this.fileActiveTimeoutMs, pollIntervalMs);
    const maxPolls = Math.max(1, Math.ceil(maxWaitMs / pollIntervalMs));

    await fs.writeFile(tempPath, Buffer.from(data, 'base64'));

    try {
      let file = await this.imageAI.files.upload({
        file: tempPath,
        config: { mimeType }
      });

      let polls = 0;
      while (this.getFileState(file?.state) !== 'ACTIVE') {
        const state = this.getFileState(file?.state);

        if (state === 'FAILED') {
          throw new Error(`${mediaType || 'Media'} processing failed for uploaded file '${file?.name || 'unknown'}'`);
        }

        if (polls >= maxPolls) {
          throw new Error(`${mediaType || 'Media'} processing timed out while waiting for ACTIVE state after ${Math.ceil(maxWaitMs / 1000)}s`);
        }

        polls += 1;
        await this.sleep(pollIntervalMs);
        file = await this.imageAI.files.get({ name: file.name });
      }

      return file;
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  transformGeminiContentStream(streamResponse) {
    const extractChunkText = this.extractGeminiText.bind(this);

    const transformStream = async function* () {
      for await (const chunk of streamResponse) {
        const content = extractChunkText(chunk);
        if (content) {
          yield { text: () => content };
        }
      }
    };

    return transformStream();
  }

  formatGeminiContentResponse(response) {
    return {
      content: this.extractGeminiText(response),
      finishReason: response?.candidates?.[0]?.finishReason ?? null,
      usage: this.mapNativeUsage(response?.usageMetadata),
      blockedReason: response?.promptFeedback?.blockReason ?? null,
      metadata: {
        multimodal: true
      }
    };
  }

  extractGeminiText(responseLike) {
    if (!responseLike) return '';

    if (typeof responseLike.text === 'function') {
      return responseLike.text() || '';
    }

    if (typeof responseLike.text === 'string') {
      return responseLike.text;
    }

    const parts = responseLike?.candidates?.[0]?.content?.parts || [];
    return parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  normalizeVideoMetadata(videoMetadata) {
    if (!videoMetadata || typeof videoMetadata !== 'object') {
      return null;
    }

    const metadata = {
      startOffset: videoMetadata.startOffset,
      endOffset: videoMetadata.endOffset,
      fps: videoMetadata.fps
    };

    const cleaned = this.removeUndefined(metadata);
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  }

  normalizeText(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  stripDataUrlPrefix(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const commaIdx = trimmed.indexOf(',');
    if (trimmed.startsWith('data:') && commaIdx !== -1) {
      return trimmed.slice(commaIdx + 1);
    }
    return trimmed;
  }

  resolveMediaType(item) {
    const explicitType = typeof item?.type === 'string' ? item.type.toLowerCase() : '';
    if (explicitType === 'image' || explicitType === 'video' || explicitType === 'audio') {
      return explicitType;
    }

    const mimeType = typeof item?.mimeType === 'string' ? item.mimeType.toLowerCase() : '';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';

    throw new Error(`Unable to infer media type for mimeType '${item?.mimeType || 'unknown'}'`);
  }

  mimeTypeToExtension(mimeType) {
    const safeMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
    if (safeMime === 'video/mp4') return 'mp4';
    if (safeMime === 'video/quicktime') return 'mov';
    if (safeMime === 'video/webm') return 'webm';
    if (safeMime === 'video/x-msvideo') return 'avi';
    if (safeMime === 'audio/mpeg' || safeMime === 'audio/mp3') return 'mp3';
    if (safeMime === 'audio/wav' || safeMime === 'audio/x-wav') return 'wav';
    if (safeMime === 'audio/aac') return 'aac';
    if (safeMime === 'audio/flac') return 'flac';
    if (safeMime === 'audio/ogg') return 'ogg';
    if (safeMime === 'audio/webm') return 'webm';
    if (safeMime === 'audio/mp4' || safeMime === 'audio/x-m4a') return 'm4a';
    return 'bin';
  }

  getFileState(state) {
    if (!state) return '';
    const asString = typeof state?.toString === 'function' ? state.toString() : String(state);
    const normalized = asString
      .replace(/^FILE_STATE_/, '')
      .replace(/^FileState\./, '')
      .trim()
      .toUpperCase();
    return normalized;
  }

  removeUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateViaGenAI({ model, prompt, messages, stream, options }) {
    console.log(`[GoogleAdapter:GenAI] Requesting model: ${model}`);

    const inputMessages = this.normalizeMessages({ prompt, messages });

    const contents = inputMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: m.role === 'system' ? `[SYSTEM]\n${m.content}` : m.content
        }
      ]
    }));

    const config = {
      temperature: options?.thinking ? undefined : options?.temperature,
      topP: options?.topP,
      maxOutputTokens: options?.maxTokens,
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseSchema,
      ...(options?.thinking ? {
        thinkingConfig: {
          includeThoughts: options.thinking.includeThoughts,
          thinkingBudget: options.thinking.budget
        }
      } : {})
    };

    const request = {
      model,
      contents,
      config: this.removeUndefined(config)
    };

    if (stream) {
      const responseStream = await this.genAI.models.generateContentStream(request);
      return this.transformGeminiContentStream(responseStream);
    }

    const response = await this.genAI.models.generateContent(request);
    
    const formatted = this.formatGeminiContentResponse(response);
    formatted.metadata = {
      ...formatted.metadata,
      mode: 'genai',
      model
    };
    return formatted;
  }

  // --- Implementation 2: OpenAI-Compatible Endpoint ---
  async generateViaOpenAI({ model, prompt, messages, stream, options }) {
    console.log(`[GoogleAdapter:OpenAI] Requesting model: ${model}`);

    const inputMessages = this.normalizeMessages({ prompt, messages });

    const requestOptions = {
      model: model,
      messages: inputMessages,
      stream: stream,
      top_p: options?.topP,
      max_tokens: options?.maxTokens,
    };

    const googleExtraBody = {};

    // Handle Thinking Logic
    if (options?.thinking) {
        console.log('[GoogleAdapter:OpenAI] Thinking enabled:', options.thinking);
        delete requestOptions.temperature;
        googleExtraBody.thinking_config = {
            include_thoughts: options.thinking.includeThoughts,
            thinking_budget: options.thinking.budget
        };
    } else {
        requestOptions.temperature = options?.temperature;
    }

    if (options?.responseMimeType === 'application/json') {
      // Gemini OpenAI-compatible endpoint is stable with json_object mode.
      // json_schema / response_schema can return 400 for some preview models.
      requestOptions.response_format = { type: 'json_object' };
    }

    if (Object.keys(googleExtraBody).length > 0) {
      requestOptions.extra_body = { google: googleExtraBody };
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
        const choice = response?.choices?.[0];
        return {
          content: this.extractOpenAIContent(choice?.message),
          finishReason: choice?.finish_reason ?? null,
          usage: this.mapOpenAIUsage(response?.usage),
          blockedReason: choice?.finish_reason === 'content_filter' ? 'content_filter' : null
        };
    }
  }

  normalizeMessages({ prompt, messages }) {
    if (Array.isArray(messages) && messages.length > 0) {
      return messages;
    }
    if (prompt) {
      return [{ role: 'user', content: prompt }];
    }
    throw new Error('No prompt/messages provided for text generation');
  }

  // Unused methods removed

  mapNativeUsage(usageMetadata) {
    if (!usageMetadata) return null;

    return {
      inputTokens: usageMetadata.promptTokenCount ?? null,
      outputTokens: usageMetadata.candidatesTokenCount ?? null,
      totalTokens: usageMetadata.totalTokenCount ?? null,
      raw: usageMetadata
    };
  }

  async generateGeminiTtsAudio({ model, prompt, messages, options }) {
    if (!this.imageAI) {
      throw new Error('Gemini TTS requires a valid API key');
    }

    const promptText = prompt || messages?.[messages.length - 1]?.content;
    if (!promptText) {
      throw new Error('No prompt provided for TTS generation');
    }

    const ttsMode = options?.ttsMode === 'multi' ? 'multi' : 'single';
    const sampleRateHz = 24000;
    let speechConfig;
    let usedVoice = null;
    let usedSpeakers = null;

    if (ttsMode === 'multi') {
      const normalizedSpeakers = this.normalizeGeminiTtsSpeakers(options?.speakers);
      speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: normalizedSpeakers.map((speakerConfig) => ({
            speaker: speakerConfig.speaker,
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: speakerConfig.voiceName
              }
            }
          }))
        }
      };
      usedSpeakers = normalizedSpeakers;
    } else {
      const voiceName = options?.voiceName || 'Kore';
      speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName
          }
        }
      };
      usedVoice = voiceName;
    }

    const response = await this.imageAI.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: String(promptText) }]
        }
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig
      }
    });

    const inlineAudio = this.extractGeminiInlineAudio(response);
    if (!inlineAudio?.data) {
      throw new Error('Gemini TTS returned no audio payload');
    }

    const pcmBuffer = Buffer.from(inlineAudio.data, 'base64');
    const wavBuffer = this.wrapPcmAsWav(pcmBuffer, {
      sampleRateHz,
      channels: 1,
      bitsPerSample: 16
    });
    const duration = this.estimatePcmDurationSeconds(pcmBuffer, sampleRateHz, 1, 16);

    return {
      type: 'audio',
      data: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
      duration,
      usedVoice,
      metadata: {
        mode: 'gemini-tts',
        model,
        sourceMimeType: inlineAudio.mimeType || 'audio/pcm',
        sampleRateHz,
        voice: usedVoice,
        speakers: usedSpeakers
      }
    };
  }

  normalizeGeminiTtsSpeakers(speakers) {
    const defaultSpeakers = [
      { speaker: 'Speaker1', voiceName: 'Kore' },
      { speaker: 'Speaker2', voiceName: 'Puck' }
    ];

    if (!Array.isArray(speakers) || speakers.length === 0) {
      return defaultSpeakers;
    }

    return speakers
      .slice(0, 2)
      .map((entry, index) => ({
        speaker: this.normalizeText(entry?.speaker).trim() || defaultSpeakers[index]?.speaker || `Speaker${index + 1}`,
        voiceName: this.normalizeText(entry?.voiceName).trim() || defaultSpeakers[index]?.voiceName || 'Kore'
      }));
  }

  extractGeminiInlineAudio(response) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts.find((part) => part?.inlineData?.data)?.inlineData || null;
  }

  wrapPcmAsWav(pcmBuffer, { sampleRateHz, channels, bitsPerSample }) {
    const bytesPerSample = bitsPerSample / 8;
    const byteRate = sampleRateHz * channels * bytesPerSample;
    const blockAlign = channels * bytesPerSample;
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRateHz, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  estimatePcmDurationSeconds(pcmBuffer, sampleRateHz, channels, bitsPerSample) {
    const bytesPerSecond = sampleRateHz * channels * (bitsPerSample / 8);
    if (bytesPerSecond <= 0) return null;
    return Number((pcmBuffer.length / bytesPerSecond).toFixed(2));
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
