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
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })).optional(),
  prompt: z.string().optional(), // Direct prompt support
  
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z.object({
    budget: z.number().min(1024),
    includeThoughts: z.boolean().default(false)
  }).optional(),
  
  // Audio / TTS specific params
  tts: z.object({
    languageId: z.string().optional(),
    exaggeration: z.number().min(0).max(2).optional(),
    cfg: z.number().min(0).max(2).optional(),
    voiceSample: z.string().optional()
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
        if (m.type === 'audio' && m.provider === 'chatterbox' && available) {
            console.log(`[API] Checking additions for ${m.id}. Provider has getVoices: ${!!provider.getVoices}`);
            if (provider.getVoices) {
                console.log(`[API] Fetching voices for ${m.id} from ${m.baseUrl}`);
                const voices = await provider.getVoices(m.baseUrl);
                console.log(`[API] Got voices: ${voices ? voices.length : 'null'}`);
                additions.voices = voices;
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
    
    const models = getConfiguredModels();
    const targetModel = models.find(m => m.id === body.model);

    if (!targetModel) {
      return res.status(404).json({ error: `Model '${body.model}' not found in configuration.` });
    }

    const provider = providers[targetModel.provider];
    if (!provider) {
      return res.status(500).json({ error: `Provider '${targetModel.provider}' not initialized.` });
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
        image: body.image,
        video: body.video,
        
        stream: body.stream,
        options: {
            temperature: body.temperature,
            topP: body.topP,
            maxTokens: body.maxTokens,
            thinking: body.thinking,
            
            // Audio Params
            languageId: body.tts?.languageId,
            exaggeration: body.tts?.exaggeration,
            cfg: body.tts?.cfg,
            voiceSample: body.tts?.voiceSample
        }
    };

    if (body.stream && targetModel.type === 'text') { // Only text models stream via SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const stream = await provider.generate({ ...generateParams, stream: true });
        for await (const chunk of stream) {
            const chunkText = chunk.text();
            res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
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
          // If audio, response should be { type: 'audio', audioUrl: '...' }
          if (response.type === 'audio' && response.audioUrl) {
              res.json({ 
                  type: 'audio', 
                  audioUrl: response.audioUrl,
                  metadata: {
                      duration: response.duration,
                      voice: response.usedVoice
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
          res.json({ content: response });
      }
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: error.errors });
    }
    console.error('Generation Error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default router;
