import { FunctionCallingConfigMode, GoogleGenAI, PersonGeneration } from '@google/genai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BaseAdapter } from './base.js';
import { Storage } from '@google-cloud/storage';

export class GoogleAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.apiKey = config.googleApiKey || process.env.GEMINI_API_KEY;
    this.useVertex = !!config.googleUseVertex;
    this.project = config.googleCloudProject;
    this.location = config.googleCloudLocation || 'global';
    this.storageBucket = config.googleCloudStorageBucket;
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

    if (this.useVertex && this.storageBucket) {
      this.gcs = new Storage({ projectId: this.project });
    }

    // Provide alias for compatibility in other methods
    this.imageAI = this.genAI;
  }

  async health() {
    // We strictly test only local configuration. Real auth/model errors happen at request time.
    if (this.useVertex) {
      return !!this.project;
    }
    return !!this.apiKey;
  }

  async generate(params) {
    const { model, apiModelId, options, adapterMode, type, media } = params;

    // Use apiModelId from config if available, fallback to 'model' ID
    let targetModel = apiModelId || model;

    // Vertex AI endpoints fail if the model ID keeps the AI Studio's 'models/' prefix
    if (this.useVertex && targetModel.startsWith('models/')) {
      targetModel = targetModel.replace('models/', '');
    }

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

    const { contents, systemInstruction } = await this.buildGeminiRequestContents({ prompt, messages, media });
    const config = {
      temperature: options?.temperature,
      topP: options?.topP,
      maxOutputTokens: options?.maxTokens,
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseJsonSchema ? undefined : options?.responseSchema,
      responseJsonSchema: options?.responseJsonSchema,
      tools: this.mapOpenAIToolsToGemini(options?.tools),
      toolConfig: this.mapToolChoiceToGemini(options?.toolChoice),
      systemInstruction
    };

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
    return this.formatGeminiContentResponse(response, {
      responseMimeType: options?.responseMimeType
    });
  }

  async buildGeminiRequestContents({ prompt, messages, media }) {
    const normalizedMessages = this.normalizeMessages({ prompt, messages });
    const mediaMessageIndex = this.resolveMediaMessageIndex(normalizedMessages, media);
    const contents = [];
    const systemInstructions = [];
    const toolNameById = new Map();
    let encounteredNonSystem = false;

    for (let index = 0; index < normalizedMessages.length; index += 1) {
      const message = normalizedMessages[index];

      if (message?.role === 'tool') {
        encounteredNonSystem = true;
        const { content, nextIndex } = this.buildAggregatedToolResponseContent({
          messages: normalizedMessages,
          startIndex: index,
          toolNameById
        });

        if (content) {
          contents.push(content);
        }

        index = nextIndex;
        continue;
      }

      if (message?.role === 'system') {
        const systemText = this.normalizeText(message?.content);
        if (this.useVertex && !encounteredNonSystem) {
          if (systemText) {
            systemInstructions.push(systemText);
          }
          continue;
        }

        const fallbackSystemMessage = this.buildTextContent('user', `[SYSTEM]\n${systemText}`);
        if (fallbackSystemMessage) {
          contents.push(fallbackSystemMessage);
        }
        continue;
      }

      encounteredNonSystem = true;
      const content = await this.mapMessageToGeminiContent({
        message,
        index,
        mediaMessageIndex,
        media,
        toolNameById
      });

      if (content) {
        contents.push(content);
      }
    }

    if (!contents.length) {
      throw new Error('No prompt/messages provided for text generation');
    }

    return {
      contents,
      systemInstruction: systemInstructions.length > 0
        ? systemInstructions.join('\n\n')
        : undefined
    };
  }

  buildAggregatedToolResponseContent({ messages, startIndex, toolNameById }) {
    const parts = [];
    let nextIndex = startIndex;

    while (nextIndex < messages.length && messages[nextIndex]?.role === 'tool') {
      const toolMessage = messages[nextIndex];
      const preservedParts = this.extractIncomingParts(toolMessage);

      if (preservedParts.length > 0) {
        parts.push(...preservedParts);
        nextIndex += 1;
        continue;
      }

      const toolName = toolMessage.name || (
        toolMessage.tool_call_id
          ? toolNameById.get(toolMessage.tool_call_id)
          : undefined
      );

      if (!toolName) {
        throw new Error('Unable to map tool message to function name. Provide message.name or include the prior assistant tool call with the same tool_call_id.');
      }

      parts.push({
        functionResponse: this.removeUndefined({
          id: toolMessage.tool_call_id,
          name: toolName,
          response: this.normalizeToolMessageResponse(toolMessage.content)
        })
      });

      nextIndex += 1;
    }

    return {
      content: parts.length > 0 ? { role: 'user', parts } : null,
      nextIndex: nextIndex - 1
    };
  }

  resolveMediaMessageIndex(messages, media) {
    if (!Array.isArray(media) || media.length === 0) {
      return -1;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        return index;
      }
    }

    throw new Error('Media attachments require at least one user message');
  }

  async mapMessageToGeminiContent({ message, index, mediaMessageIndex, media, toolNameById }) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const preservedParts = this.extractIncomingParts(message);

    if (message.role === 'user') {
      if (preservedParts.length > 0 && index !== mediaMessageIndex) {
        return { role: 'user', parts: preservedParts };
      }

      const parts = [];

      if (index === mediaMessageIndex) {
        const mediaParts = await this.buildGeminiMediaParts(media);
        parts.push(...mediaParts);
      }

      const userText = this.normalizeText(message.content);
      if (userText) {
        parts.push({ text: userText });
      }

      return parts.length > 0
        ? { role: 'user', parts }
        : null;
    }

    if (message.role === 'assistant') {
      const reconstructedToolCallParts = this.buildFunctionCallPartsFromToolCalls(message.tool_calls, toolNameById);

      if (preservedParts.length > 0) {
        const assistantParts = this.hasFunctionCallPart(preservedParts)
          ? preservedParts
          : [...preservedParts, ...reconstructedToolCallParts];

        this.registerToolNamesFromParts(toolNameById, assistantParts);
        return {
          role: this.normalizeContentRole(message.provider_state?.role, 'model'),
          parts: assistantParts
        };
      }

      const parts = [];
      if (reconstructedToolCallParts.length > 0) {
        parts.push(...reconstructedToolCallParts);
      } else {
        const assistantText = this.normalizeText(message.content);
        if (assistantText) {
          parts.push({ text: assistantText });
        }
      }

      return parts.length > 0
        ? { role: 'model', parts }
        : null;
    }

    return this.buildTextContent('user', this.normalizeText(message.content));
  }

  buildTextContent(role, text) {
    if (!text) {
      return null;
    }

    return {
      role,
      parts: [
        {
          text
        }
      ]
    };
  }

  extractIncomingParts(message) {
    const parts = Array.isArray(message?.provider_state?.parts)
      ? message.provider_state.parts
      : (Array.isArray(message?.parts) ? message.parts : []);

    return this.cloneParts(parts);
  }

  cloneParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
      return [];
    }

    return JSON.parse(JSON.stringify(parts));
  }

  registerToolNamesFromParts(toolNameById, parts) {
    for (const part of parts || []) {
      const id = this.normalizeText(part?.functionCall?.id).trim();
      const name = this.normalizeText(part?.functionCall?.name).trim();

      if (id && name) {
        toolNameById.set(id, name);
      }
    }
  }

  buildFunctionCallPartsFromToolCalls(toolCalls, toolNameById) {
    return this.normalizeAssistantToolCalls(toolCalls).map((toolCall) => {
      if (toolCall.id) {
        toolNameById.set(toolCall.id, toolCall.name);
      }

      return {
        functionCall: this.removeUndefined({
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.arguments
        })
      };
    });
  }

  hasFunctionCallPart(parts) {
    return Array.isArray(parts) && parts.some((part) => part?.functionCall);
  }

  normalizeContentRole(role, fallback = 'user') {
    const normalized = this.normalizeText(role).trim().toLowerCase();
    if (normalized === 'model' || normalized === 'assistant') {
      return 'model';
    }
    if (normalized === 'user' || normalized === 'tool') {
      return 'user';
    }
    return fallback;
  }

  isGemini3ThinkingModel(model) {
    const normalizedModel = this.normalizeText(model).trim().toLowerCase();
    return /^gemini-3([.-]|$)/.test(normalizedModel);
  }

  isGeminiModel(model) {
    const normalizedModel = this.normalizeText(model).trim().toLowerCase();
    return normalizedModel.startsWith('gemini-');
  }

  normalizeThinkingLevel(level) {
    const normalizedLevel = this.normalizeText(level).trim().toUpperCase();
    if (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(normalizedLevel)) {
      return normalizedLevel;
    }
    return undefined;
  }

  normalizeThinkingBudget(budget) {
    if (budget === null || budget === undefined || budget === '') {
      return undefined;
    }

    const numericBudget = Number(budget);
    if (!Number.isFinite(numericBudget)) {
      return undefined;
    }

    return Math.trunc(numericBudget);
  }

  mapGemini3ThinkingLevelFromBudget(budget) {
    const normalizedBudget = this.normalizeThinkingBudget(budget);

    if (normalizedBudget === undefined || normalizedBudget === -1) {
      return undefined;
    }

    if (normalizedBudget <= 1024) {
      return 'MINIMAL';
    }

    if (normalizedBudget <= 4096) {
      return 'LOW';
    }

    if (normalizedBudget <= 8192) {
      return 'MEDIUM';
    }

    return 'HIGH';
  }

  buildGeminiThinkingConfig(model, thinking) {
    if (!thinking || typeof thinking !== 'object') {
      return undefined;
    }

    if (!this.isGeminiModel(model)) {
      return undefined;
    }

    const includeThoughts = thinking.includeThoughts === true ? true : undefined;
    const explicitLevel = this.normalizeThinkingLevel(thinking.level);

    if (this.isGemini3ThinkingModel(model)) {
      const thinkingLevel = explicitLevel ?? this.mapGemini3ThinkingLevelFromBudget(thinking.budget);
      const config = this.removeUndefined({
        includeThoughts,
        thinkingLevel
      });

      return Object.keys(config).length > 0 ? config : undefined;
    }

    const thinkingBudget = this.normalizeThinkingBudget(thinking.budget);
    const config = this.removeUndefined({
      includeThoughts,
      thinkingBudget
    });

    return Object.keys(config).length > 0 ? config : undefined;
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
      if (this.useVertex) {
        if (!this.storageBucket || !this.gcs) {
          throw new Error('Vertex AI requires a GCS bucket for media uploads. Set GOOGLE_CLOUD_STORAGE_BUCKET in .env');
        }

        const bucket = this.gcs.bucket(this.storageBucket);
        const gcsFileName = `ai-provider-uploads/${randomUUID()}.${extension}`;
        
        await bucket.upload(tempPath, {
          destination: gcsFileName,
          metadata: { contentType: mimeType }
        });

        // Vertex AI expects the GCS URI directly. It does not need state polling.
        return {
          uri: `gs://${this.storageBucket}/${gcsFileName}`,
          mimeType
        };
      }

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
    const extractThoughtText = this.extractGeminiThoughtText.bind(this);
    const cloneParts = this.cloneParts.bind(this);

    const transformStream = async function* () {
      for await (const chunk of streamResponse) {
        const candidateContent = chunk?.candidates?.[0]?.content;
        const parts = cloneParts(candidateContent?.parts);
        const content = extractChunkText(chunk);
        const thought = extractThoughtText(chunk);

        if (content || thought || parts.length > 0) {
          yield {
            text: () => content,
            content,
            thought,
            parts,
            role: candidateContent?.role ?? 'model'
          };
        }
      }
    };

    return transformStream();
  }

  formatGeminiContentResponse(response, { responseMimeType } = {}) {
    const content = this.extractGeminiText(response);
    const toolCalls = this.mapGeminiFunctionCalls(response?.functionCalls);
    const candidateContent = response?.candidates?.[0]?.content;
    const parts = this.cloneParts(candidateContent?.parts);
    const providerState = parts.length > 0
      ? {
          role: candidateContent?.role ?? 'model',
          parts
        }
      : null;
    const parsedOutput = responseMimeType === 'application/json' && toolCalls.length === 0
      ? this.tryParseJsonContent(content)
      : null;

    return {
      content,
      outputText: content,
      parsedOutput,
      toolCalls,
      parts,
      providerState,
      message: {
        role: 'assistant',
        content,
        toolCalls,
        parts,
        providerState
      },
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

    const parts = responseLike?.candidates?.[0]?.content?.parts || [];
    if (parts.length > 0) {
      return parts
        .map((part) => (
          typeof part?.text === 'string' && !part?.thought
            ? part.text
            : ''
        ))
        .join('');
    }

    if (typeof responseLike.text === 'function') {
      return responseLike.text() || '';
    }

    if (typeof responseLike.text === 'string') {
      return responseLike.text;
    }

    return '';
  }

  extractGeminiThoughtText(responseLike) {
    if (!responseLike) return '';

    const parts = responseLike?.candidates?.[0]?.content?.parts || [];
    if (parts.length > 0) {
      return parts
        .map((part) => (
          typeof part?.text === 'string' && part?.thought
            ? part.text
            : ''
        ))
        .join('');
    }

    return '';
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

  normalizeAssistantToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls
      .map((toolCall, index) => {
        const name = this.normalizeText(toolCall?.name).trim();
        if (!name) {
          return null;
        }

        const id = this.normalizeText(toolCall?.id).trim() || `call_${index + 1}`;
        return {
          id,
          name,
          arguments: this.normalizeToolArguments(toolCall?.arguments)
        };
      })
      .filter(Boolean);
  }

  normalizeToolArguments(argumentsValue) {
    if (argumentsValue === null || argumentsValue === undefined || argumentsValue === '') {
      return {};
    }

    if (typeof argumentsValue === 'string') {
      const parsed = this.tryParseJsonContent(argumentsValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    }

    if (typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
      return argumentsValue;
    }

    return {};
  }

  normalizeToolMessageResponse(content) {
    const normalizedContent = this.normalizeText(content).trim();
    if (!normalizedContent) {
      return { output: null };
    }

    const parsed = this.tryParseJsonContent(normalizedContent);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed !== null) {
      return { output: parsed };
    }

    return { output: normalizedContent };
  }

  tryParseJsonContent(value) {
    if (typeof value !== 'string') {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  mapOpenAIToolsToGemini(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return undefined;
    }

    const functionDeclarations = tools
      .filter((tool) => tool?.type === 'function' && tool?.function?.name)
      .map((tool) => this.removeUndefined({
        name: tool.function.name,
        description: tool.function.description,
        parametersJsonSchema: tool.function.parameters
      }));

    if (functionDeclarations.length === 0) {
      return undefined;
    }

    return [{ functionDeclarations }];
  }

  mapToolChoiceToGemini(toolChoice) {
    if (toolChoice === undefined || toolChoice === null) {
      return undefined;
    }

    let mode;
    let allowedFunctionNames;

    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      mode = FunctionCallingConfigMode.ANY;
      allowedFunctionNames = [toolChoice.function?.name].filter(Boolean);
    } else if (typeof toolChoice === 'string') {
      const normalized = toolChoice.trim();

      if (!normalized) {
        return undefined;
      }

      if (normalized === 'auto') {
        mode = FunctionCallingConfigMode.AUTO;
      } else if (normalized === 'required') {
        mode = FunctionCallingConfigMode.ANY;
      } else if (normalized === 'none') {
        mode = FunctionCallingConfigMode.NONE;
      } else if (normalized === 'validated') {
        mode = FunctionCallingConfigMode.VALIDATED;
      } else {
        mode = FunctionCallingConfigMode.ANY;
        allowedFunctionNames = [normalized];
      }
    }

    if (!mode) {
      return undefined;
    }

    return {
      functionCallingConfig: this.removeUndefined({
        mode,
        allowedFunctionNames: Array.isArray(allowedFunctionNames) && allowedFunctionNames.length > 0
          ? allowedFunctionNames
          : undefined
      })
    };
  }

  mapGeminiFunctionCalls(functionCalls) {
    if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
      return [];
    }

    return functionCalls
      .map((call, index) => {
        const name = this.normalizeText(call?.name).trim();
        if (!name) {
          return null;
        }

        return {
          id: this.normalizeText(call?.id).trim() || `call_${index + 1}`,
          name,
          arguments: this.normalizeToolArguments(call?.args)
        };
      })
      .filter(Boolean);
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

  summarizeGeminiContents(contents) {
    return (contents || []).map((content, index) => ({
      index,
      role: content?.role || null,
      partTypes: (content?.parts || []).map((part) => {
        if (part?.functionCall) {
          return `functionCall:${part.functionCall.name || 'unknown'}:${part.functionCall.id || 'no-id'}`;
        }
        if (part?.functionResponse) {
          return `functionResponse:${part.functionResponse.name || 'unknown'}:${part.functionResponse.id || 'no-id'}`;
        }
        if (part?.text && part?.thought) {
          return 'thought:text';
        }
        if (part?.thoughtSignature) {
          return 'thoughtSignature';
        }
        if (part?.text) {
          return 'text';
        }
        if (part?.inlineData) {
          return 'inlineData';
        }
        if (part?.fileData) {
          return 'fileData';
        }
        return 'other';
      })
    }));
  }

  validateFunctionResponseAdjacency(contents) {
    for (let index = 0; index < (contents || []).length; index += 1) {
      const content = contents[index];
      const hasFunctionResponses = Array.isArray(content?.parts) && content.parts.some((part) => part?.functionResponse);

      if (!hasFunctionResponses) {
        continue;
      }

      const previous = index > 0 ? contents[index - 1] : null;
      const previousRole = this.normalizeContentRole(previous?.role, 'user');
      const previousHasFunctionCalls = Array.isArray(previous?.parts) && previous.parts.some((part) => part?.functionCall);

      if (previousRole !== 'model' || !previousHasFunctionCalls) {
        return {
          valid: false,
          reason: `functionResponse turn at index ${index} is not immediately preceded by a model functionCall turn`,
          summary: this.summarizeGeminiContents(contents)
        };
      }
    }

    return { valid: true };
  }

  async generateViaGenAI({ model, prompt, messages, stream, options }) {
    console.log(`[GoogleAdapter:GenAI] Requesting model: ${model}`);

    const { contents, systemInstruction } = await this.buildGeminiRequestContents({ prompt, messages });
    const historyValidation = this.validateFunctionResponseAdjacency(contents);

    if (!historyValidation.valid) {
      throw new Error(`Invalid function calling history before Vertex request: ${historyValidation.reason}. Summary: ${JSON.stringify(historyValidation.summary)}`);
    }

    const thinkingConfig = this.buildGeminiThinkingConfig(model, options?.thinking);
    const config = {
      temperature: options?.temperature,
      topP: options?.topP,
      maxOutputTokens: options?.maxTokens,
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseJsonSchema ? undefined : options?.responseSchema,
      responseJsonSchema: options?.responseJsonSchema,
      tools: this.mapOpenAIToolsToGemini(options?.tools),
      toolConfig: this.mapToolChoiceToGemini(options?.toolChoice),
      systemInstruction,
      thinkingConfig
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

    let response;
    try {
      response = await this.genAI.models.generateContent(request);
    } catch (error) {
      if (error?.status === 400) {
        console.error('[GoogleAdapter:GenAI] Rejected contents summary:', JSON.stringify(this.summarizeGeminiContents(contents)));
      }
      throw error;
    }
    
    const formatted = this.formatGeminiContentResponse(response, {
      responseMimeType: options?.responseMimeType
    });
    formatted.metadata = {
      ...formatted.metadata,
      mode: 'genai',
      model,
      effectiveConfig: this.removeUndefined({
        temperature: config.temperature,
        topP: config.topP,
        maxOutputTokens: config.maxOutputTokens,
        thinkingConfig: config.thinkingConfig
      })
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
      throw new Error('Gemini TTS requires a valid API key or Vertex AI config');
    }

    let targetModel = model;
    if (this.useVertex && targetModel.includes('-preview-tts')) {
      targetModel = targetModel.replace('-preview-tts', '-tts');
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
      model: targetModel,
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

  async generateImage({ model, prompt, messages, media, image, imageMode }) {
    if (!this.imageAI) {
      throw new Error('Google image generation requires a valid API key');
    }

    const resolvedMode = imageMode || (model.includes('imagen') ? 'imagen' : 'nano-banana');

    if (resolvedMode === 'imagen') {
      const promptText = prompt || messages?.[messages.length - 1]?.content;
      if (!promptText) {
        throw new Error('No prompt provided for image generation');
      }
      return this.generateImagenImages({ model, prompt: promptText, imageOptions: image });
    }

    if (!prompt && (!Array.isArray(messages) || messages.length === 0)) {
      throw new Error('Nano Banana image generation requires a prompt or conversation history');
    }

    return this.generateGeminiImages({
      model,
      prompt,
      messages,
      media,
      imageOptions: image,
      imageMode: resolvedMode
    });
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

  async generateGeminiImages({ model, prompt, messages, media, imageOptions, imageMode }) {
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
    const { contents, systemInstruction } = await this.buildGeminiRequestContents({
      prompt,
      messages,
      media
    });

    const response = await this.imageAI.models.generateContentStream({
      model,
      config: this.removeUndefined({
        ...config,
        systemInstruction
      }),
      contents
    });

    const images = [];
    let trailingText = '';
    const responseParts = [];
    let responseRole = 'model';

    for await (const chunk of response) {
      const candidateContent = chunk?.candidates?.[0]?.content;
      const parts = this.cloneParts(candidateContent?.parts);
      responseRole = candidateContent?.role || responseRole;

      if (parts.length > 0) {
        responseParts.push(...parts);
      }

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

    const providerState = responseParts.length > 0
      ? {
          role: responseRole,
          parts: responseParts
        }
      : null;

    return {
      type: 'image',
      images,
      parts: responseParts,
      providerState,
      message: {
        role: 'assistant',
        content: trailingText || '',
        parts: responseParts,
        providerState
      },
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

    let targetModel = model;
    if (this.useVertex && targetModel.includes('-preview')) {
      targetModel = targetModel.replace('-preview', '-001');
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
      model: targetModel,
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

    if (operation.error) {
      throw new Error(`Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    const generatedVideos = operation.response?.generatedVideos || [];
    const videos = [];

    for (const generatedVideo of generatedVideos) {
      if (generatedVideo?.video?.videoBytes) {
        videos.push({
          data: generatedVideo.video.videoBytes,
          mimeType: generatedVideo?.video?.mimeType || 'video/mp4'
        });
        continue;
      }

      const uri = generatedVideo?.video?.uri;
      if (!uri) continue;

      const downloadUrl = this.useVertex ? uri : this.appendApiKey(uri);
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
        model: targetModel,
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
