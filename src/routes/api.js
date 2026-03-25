import express from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { getConfiguredModels, saveConfiguredModels, config } from '../config/models.js';
import { GoogleAdapter } from '../adapters/google.js';
import { GroqAdapter } from '../adapters/groq.js';
import { LocalAdapter } from '../adapters/local.js';
import { ChatterboxAdapter } from '../adapters/chatterbox.js';

const router = express.Router();

const GEMINI_TTS_VOICE_NAMES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda',
  'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima',
  'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];

const toolCallSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  arguments: z.any().optional()
});

const providerStateSchema = z.object({
  role: z.string().optional(),
  parts: z.array(z.any()).optional()
}).passthrough();

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).max(128).optional(),
  tool_call_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  parts: z.array(z.any()).optional(),
  provider_state: providerStateSchema.optional()
}).superRefine((message, ctx) => {
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return;
  }

  if (message.role === 'tool' && !message.tool_call_id && !message.name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tool messages must include tool_call_id or name'
    });
  }
});

const outputSchema = z.object({
  type: z.enum(['text', 'json_schema']),
  name: z.string().min(1).optional(),
  schema: z.any().optional()
}).superRefine((output, ctx) => {
  if (output.type === 'json_schema' && output.schema === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'output.schema is required when output.type is json_schema'
    });
  }
});

const toolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.any().optional()
  })
});

const toolChoiceSchema = z.union([
  z.enum(['auto', 'required', 'none', 'validated']),
  z.string().min(1),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1)
    })
  })
]);

// Initialize Providers
const providers = {
  google: new GoogleAdapter(config),
  groq: new GroqAdapter(config),
  local: new LocalAdapter(config),
  chatterbox: new ChatterboxAdapter(config)
};

// Log loaded providers
console.log('Loaded providers:', Object.keys(providers));

// --- Validation Schemas ---
const runSchema = z.object({
  model: z.string(),
  // Messages are required for Chat, but strictly speaking TTS might just need a prompt
  // We'll treat the last message content as the prompt for TTS if provided
  messages: z.array(messageSchema).optional(),
  prompt: z.string().optional(), // Direct prompt support
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'audio']).optional(),
    mimeType: z.string().min(1),
    data: z.string().min(1), // base64 payload (with or without data:*;base64, prefix)
    name: z.string().optional(),
    videoMetadata: z.object({
      startOffset: z.string().optional(),
      endOffset: z.string().optional(),
      fps: z.number().positive().optional()
    }).optional()
  })).max(10).optional(),
  
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  max_tokens: z.number().optional(),
  thinking: z.object({
    budget: z.number().int().min(-1).optional(),
    level: z.enum(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']).optional(),
    includeThoughts: z.boolean().default(false)
  }).optional(),
  responseMimeType: z.enum(['text/plain', 'application/json']).optional(),
  responseSchema: z.record(z.string(), z.any()).optional(),
  strictJson: z.boolean().optional(),
  output: outputSchema.optional(),
  tools: z.array(toolSchema).max(128).optional(),
  tool_choice: toolChoiceSchema.optional(),
  
  // Audio / TTS specific params
  tts: z.object({
    languageId: z.string().optional(),
    exaggeration: z.number().min(0).max(2).optional(),
    cfg: z.number().min(0).max(2).optional(),
    voiceSample: z.string().optional(),
    mode: z.enum(['single', 'multi']).optional(),
    voiceName: z.string().optional(),
    speakers: z.array(z.object({
      speaker: z.string().min(1),
      voiceName: z.string().min(1)
    })).max(2).optional()
  }).optional(),

  // Image generation params
  image: z.object({
    size: z.string().optional(),
    aspectRatio: z.string().optional(),
    count: z.number().int().min(1).max(4).optional(),
    format: z.enum(['image/png', 'image/jpeg']).optional()
  }).optional(),

  // Video generation params
  video: z.object({
    aspectRatio: z.string().optional(),
    durationSeconds: z.number().int().positive().optional(),
    resolution: z.string().optional(),
    count: z.number().int().min(1).max(4).optional()
  }).optional()
});

function normalizeTextResponse(response) {
  if (typeof response === 'string') {
    return {
      content: response,
      outputText: response,
      parsedOutput: null,
      toolCalls: [],
      parts: [],
      providerState: null,
      messageRole: 'assistant',
      finishReason: null,
      usage: null,
      blockedReason: null,
      providerMetadata: null
    };
  }

  if (response && typeof response === 'object') {
    const content = normalizeContentText(
      response.content ?? response.outputText ?? response.message?.content
    );
    const toolCalls = Array.isArray(response.toolCalls)
      ? response.toolCalls
      : (Array.isArray(response.message?.toolCalls) ? response.message.toolCalls : []);
    const parts = Array.isArray(response.parts)
      ? response.parts
      : (Array.isArray(response.message?.parts)
        ? response.message.parts
        : (Array.isArray(response.providerState?.parts)
          ? response.providerState.parts
          : (Array.isArray(response.message?.providerState?.parts)
            ? response.message.providerState.parts
            : (Array.isArray(response.message?.provider_state?.parts)
              ? response.message.provider_state.parts
              : []))));
    const providerState = response.providerState
      ?? response.message?.providerState
      ?? response.message?.provider_state
      ?? (parts.length > 0 ? { parts } : null);

    return {
      content,
      outputText: normalizeContentText(response.outputText ?? content),
      parsedOutput: response.parsedOutput ?? null,
      toolCalls,
      parts,
      providerState,
      messageRole: response.message?.role ?? 'assistant',
      finishReason: response.finishReason ?? null,
      usage: response.usage ?? null,
      blockedReason: response.blockedReason ?? null,
      providerMetadata: response.metadata ?? null
    };
  }

  return {
    content: '',
    outputText: '',
    parsedOutput: null,
    toolCalls: [],
    parts: [],
    providerState: null,
    messageRole: 'assistant',
    finishReason: null,
    usage: null,
    blockedReason: null,
    providerMetadata: null
  };
}

function normalizeContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  if (content === null || content === undefined) return '';
  return String(content);
}

function stripJsonCodeFence(content) {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function tryParseJson(value) {
  try {
    return { ok: true, parsed: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function isTruncatedFinishReason(finishReason) {
  if (!finishReason) return false;
  const normalized = String(finishReason).toLowerCase();
  return normalized === 'length' || normalized === 'max_tokens' || normalized === 'max_output_tokens';
}

function usesAdvancedTextContract(body) {
  if (body.output || body.tools || body.tool_choice !== undefined) {
    return true;
  }

  return Array.isArray(body.messages) && body.messages.some((message) => (
    message.role === 'tool' ||
    (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
  ));
}

// --- Routes ---

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/config', (req, res) => {
  const models = getConfiguredModels();
  res.json(models);
});

router.post('/config', (req, res) => {
  try {
    const models = req.body;
    if (!Array.isArray(models)) {
        return res.status(400).json({ error: 'Config must be an array of models' });
    }
    if (saveConfiguredModels(models)) {
        res.json({ success: true, message: 'Config saved' });
    } else {
        res.status(500).json({ error: 'Failed to save config' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/available-models', async (req, res) => {
  const models = getConfiguredModels();
  
  // Filter and enrich models
  const validModels = [];

  for (const m of models) {
    const provider = providers[m.provider];
    let available = false;
    let additions = {};

    if (provider) {
        // Health Check
        if (provider.health) {
            // For Chatterbox/Local, check specific URL
            if (m.provider === 'chatterbox' && m.baseUrl) {
                available = await provider.health().catch((e) => {
                    console.error(`Health check failed for ${m.id}:`, e.message);
                    return false;
                });
            } else {
                available = await provider.health().catch((e) => {
                    // Suppress excessive logs for cloud providers usually
                    return false;
                });
            }
        } else {
            // No health check = assume available? Or unavailable?
            available = true; 
        }

        // Additions (e.g. Voices / Image modes)
        if (m.type === 'audio' && available) {
            if (m.audioMode) {
                additions.audioMode = m.audioMode;
            } else if (m.provider === 'chatterbox') {
                additions.audioMode = 'chatterbox';
            } else if (m.provider === 'google') {
                additions.audioMode = 'gemini-tts';
            }

            if (m.provider === 'chatterbox') {
                console.log(`[API] Checking additions for ${m.id}. Provider has getVoices: ${!!provider.getVoices}`);
                if (provider.getVoices) {
                    console.log(`[API] Fetching voices for ${m.id} from ${m.baseUrl}`);
                    const voices = await provider.getVoices(m.baseUrl);
                    console.log(`[API] Got voices: ${voices ? voices.length : 'null'}`);
                    additions.voices = voices;
                }
            } else if (m.provider === 'google' && (additions.audioMode === 'gemini-tts')) {
                additions.voices = GEMINI_TTS_VOICE_NAMES.map((name) => ({ name }));
            }
        }

        if (m.type === 'image' && m.imageMode) {
            additions.imageMode = m.imageMode;
        }

        if (m.type === 'video' && m.videoMode) {
            additions.videoMode = m.videoMode;
        }
    } else {
        console.warn(`Provider '${m.provider}' not found for model '${m.id}'`);
    }

    // Include ONLY available models
    if (available) {
        // Explicitly construct the object to ensure additions is included
        const modelObj = {
            id: m.id,
            provider: m.provider,
            available: available,
            type: m.type || 'text'
        };
        
        // Only add additions if not empty
        if (Object.keys(additions).length > 0) {
            modelObj.additions = additions;
        }
        
        validModels.push(modelObj);
    }
  }

  res.json({ models: validModels });
});

// Helper route to serve local audio files generated by Chatterbox
// Simplified as we now prefer direct links, but kept for legacy/fallback
router.get('/audio-proxy', (req, res) => {
    const filePath = req.query.path;
    if (filePath && fs.existsSync(filePath)) {
        return res.sendFile(path.resolve(filePath));
    }
    res.status(404).send('File not found');
});

router.post('/run', async (req, res) => {
  try {
    const body = runSchema.parse(req.body);
    const resolvedMaxTokens = body.maxTokens ?? body.max_tokens;
    const resolvedResponseMimeType = body.output?.type === 'json_schema'
      ? 'application/json'
      : (body.output?.type === 'text' ? 'text/plain' : body.responseMimeType);
    const resolvedResponseSchema = body.output?.type === 'json_schema'
      ? undefined
      : body.responseSchema;
    const resolvedResponseJsonSchema = body.output?.type === 'json_schema'
      ? body.output.schema
      : undefined;
    const resolvedStrictJson = body.strictJson ?? (body.output?.type === 'json_schema' ? true : undefined);

    const models = getConfiguredModels();
    const targetModel = models.find(m => m.id === body.model);

    if (!targetModel) {
      return res.status(404).json({ error: `Model '${body.model}' not found in configuration.` });
    }

    const provider = providers[targetModel.provider];
    if (!provider) {
      return res.status(500).json({ error: `Provider '${targetModel.provider}' not initialized.` });
    }

    if (body.stream && usesAdvancedTextContract(body)) {
      return res.status(400).json({
        error: 'Streaming is currently not supported when using output schemas or tool calling'
      });
    }

    // Unified Generation Params
    const generateParams = {
        model: targetModel.id,
        apiModelId: targetModel.apiModelId,
        adapterMode: targetModel.adapterMode,
        type: targetModel.type || 'text',
        baseUrl: targetModel.baseUrl, // Important for local models
        imageMode: targetModel.imageMode,
        videoMode: targetModel.videoMode,
        
        // Input text can come from prompt or messages
        prompt: body.prompt, 
        messages: body.messages,
        media: body.media,
        image: body.image,
        video: body.video,
        
        stream: body.stream,
        options: {
            temperature: body.temperature,
            topP: body.topP,
            maxTokens: resolvedMaxTokens,
            thinking: body.thinking,
            responseMimeType: resolvedResponseMimeType,
            responseSchema: resolvedResponseSchema,
            responseJsonSchema: resolvedResponseJsonSchema,
            outputName: body.output?.name,
            strictJson: resolvedStrictJson,
            tools: body.tools,
            toolChoice: body.tool_choice,
            
            // Audio Params
            languageId: body.tts?.languageId,
            exaggeration: body.tts?.exaggeration,
            cfg: body.tts?.cfg,
            voiceSample: body.tts?.voiceSample,
            ttsMode: body.tts?.mode,
            voiceName: body.tts?.voiceName,
            speakers: body.tts?.speakers
        }
    };

    if (body.stream && targetModel.type === 'text') { // Only text models stream via SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const stream = await provider.generate({ ...generateParams, stream: true });
        const streamedParts = [];
        let streamedRole = 'model';

        for await (const chunk of stream) {
            const chunkText = typeof chunk?.text === 'function'
              ? chunk.text()
              : (typeof chunk === 'string'
                ? chunk
                : (chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : ''));

            const chunkThought = typeof chunk?.thought === 'string'
              ? chunk.thought
              : '';
            const chunkParts = Array.isArray(chunk?.parts) ? chunk.parts : [];

            if (typeof chunk?.role === 'string' && chunk.role.length > 0) {
              streamedRole = chunk.role;
            }

            if (chunkParts.length > 0) {
              streamedParts.push(...chunkParts);
            }

            const payload = {};
            if (chunkText) {
              payload.content = chunkText;
            }
            if (chunkThought) {
              payload.thought = chunkThought;
            }

            if (Object.keys(payload).length > 0) {
              res.write(`data: ${JSON.stringify(payload)}\n\n`);
            }
        }

        if (streamedParts.length > 0) {
          res.write(`data: ${JSON.stringify({
            provider_state: {
              role: streamedRole,
              parts: streamedParts
            }
          })}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        res.end();
      }
    } else {
      // Standard Response (Text or Audio)
      const response = await provider.generate({ ...generateParams, stream: false });
      
      if (targetModel.type === 'audio') {
          if (response.type === 'audio' && (response.audioUrl || response.data)) {
              res.json({
                  type: 'audio',
                  audioUrl: response.audioUrl || null,
                  audio: response.data ? {
                      data: response.data,
                      mimeType: response.mimeType || 'audio/wav'
                  } : null,
                  metadata: {
                      ...(response.metadata || {}),
                      mode: response.metadata?.mode || targetModel.audioMode || (targetModel.provider === 'google' ? 'gemini-tts' : (targetModel.provider === 'chatterbox' ? 'chatterbox' : null)),
                      duration: response.duration ?? response.metadata?.duration ?? null,
                      voice: response.usedVoice ?? response.metadata?.voice ?? null
                  }
              });
          } else {
              res.status(500).json({ error: 'Invalid audio response from adapter' });
          }
      } else if (targetModel.type === 'image') {
          if (response.type === 'image' && Array.isArray(response.images) && response.images.length > 0) {
              res.json({
                  type: 'image',
                  images: response.images,
                  metadata: response.metadata || {}
              });
          } else {
              res.status(500).json({ error: 'Invalid image response from adapter' });
          }
      } else if (targetModel.type === 'video') {
          if (response.type === 'video' && Array.isArray(response.videos) && response.videos.length > 0) {
              res.json({
                  type: 'video',
                  videos: response.videos,
                  metadata: response.metadata || {}
              });
          } else {
              res.status(500).json({ error: 'Invalid video response from adapter' });
          }
      } else {
          // Text response
          const normalized = normalizeTextResponse(response);
          const expectsJson = resolvedResponseMimeType === 'application/json';
          const strictJson = expectsJson ? (resolvedStrictJson ?? true) : (resolvedStrictJson ?? false);
          const finishReason = normalized.finishReason;
          const truncated = isTruncatedFinishReason(finishReason);
          const toolCalls = Array.isArray(normalized.toolCalls) ? normalized.toolCalls : [];
          const rawParts = Array.isArray(normalized.parts) ? normalized.parts : [];
          let content = normalized.content;
          let outputText = normalized.outputText || content;
          let parsedOutput = normalized.parsedOutput;

          if (expectsJson && toolCalls.length === 0) {
            content = stripJsonCodeFence(content);
            outputText = stripJsonCodeFence(outputText || content);
            const parsedResult = tryParseJson(content);

            if (!parsedResult.ok && strictJson) {
              return res.status(422).json({
                error: 'Model returned invalid JSON',
                details: parsedResult.error,
                content,
                finishReason,
                usage: normalized.usage,
                blockedReason: normalized.blockedReason,
                truncated,
                metadata: {
                  requestedMaxTokens: resolvedMaxTokens ?? null,
                  responseMimeType: resolvedResponseMimeType,
                  responseSchemaProvided: !!(resolvedResponseSchema || resolvedResponseJsonSchema),
                  strictJson
                }
              });
            }

            if (parsedResult.ok) {
              content = JSON.stringify(parsedResult.parsed);
              outputText = content;
              parsedOutput = parsedResult.parsed;
            }
          }

          res.json({
            type: 'text',
            content,
            message: {
              role: normalized.messageRole,
              content,
              tool_calls: toolCalls,
              parts: rawParts,
              provider_state: normalized.providerState ?? null
            },
            output_text: outputText,
            parsed_output: parsedOutput ?? null,
            provider_state: normalized.providerState ?? null,
            finishReason,
            usage: normalized.usage,
            blockedReason: normalized.blockedReason,
            truncated,
            metadata: {
              requestedMaxTokens: resolvedMaxTokens ?? null,
              responseMimeType: resolvedResponseMimeType || 'text/plain',
              responseSchemaProvided: !!(resolvedResponseSchema || resolvedResponseJsonSchema),
              strictJson,
              provider: normalized.providerMetadata
            }
          });
      }
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: error.errors });
    }
    if (error?.message === 'Media attachments are currently supported only for Gemini text models') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Generation Error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default router;
