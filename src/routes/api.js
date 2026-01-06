import express from 'express';
import { z } from 'zod';
import { getConfiguredModels, saveConfiguredModels, config } from '../config/models.js';
import { GoogleAdapter } from '../adapters/google.js';
import { GroqAdapter } from '../adapters/groq.js';
import { LocalAdapter } from '../adapters/local.js';

const router = express.Router();

// Initialize Providers
const providers = {
  google: new GoogleAdapter(config),
  groq: new GroqAdapter(config),
  local: new LocalAdapter(config)
};

// --- Validation Schemas ---
const runSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z.object({
    budget: z.number().min(1024),
    includeThoughts: z.boolean().default(false)
  }).optional()
});

// --- Routes ---

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config Management Routes
router.get('/config', (req, res) => {
  const models = getConfiguredModels();
  res.json(models);
});

router.post('/config', (req, res) => {
  try {
    const models = req.body;
    // Basic validation: ensure it's an array and has required fields
    if (!Array.isArray(models)) {
        return res.status(400).json({ error: 'Config must be an array of models' });
    }
    
    // You might want to add deeper validation here using Zod schema for the config model
    
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
  
  // Enrich models with status check
  const results = await Promise.all(models.map(async (m) => {
    const provider = providers[m.provider];
    let available = false;
    
    if (provider) {
       // Ideally we check specific model availability, 
       // but here we check provider health as proxy
       available = await provider.health().catch(() => false);
    }

    return {
      id: m.id,
      provider: m.provider,
      available: available,
      type: m.provider === 'local' ? 'local' : 'cloud'
    };
  }));

  res.json({ models: results });
});

router.post('/run', async (req, res) => {
  try {
    // 1. Validate Input
    const body = runSchema.parse(req.body);
    
    // 2. Find Model Configuration
    const models = getConfiguredModels();
    const targetModel = models.find(m => m.id === body.model);

    if (!targetModel) {
      return res.status(404).json({ error: `Model '${body.model}' not found in configuration.` });
    }

    // 3. Select Provider
    const provider = providers[targetModel.provider];
    if (!provider) {
      return res.status(500).json({ error: `Provider '${targetModel.provider}' not initialized.` });
    }

    // 4. Generate
    const generateParams = {
        model: targetModel.id, // Internal ID
        apiModelId: targetModel.apiModelId, // Actual API ID from config
        adapterMode: targetModel.adapterMode, // 'native' vs 'openai' for Google
        messages: body.messages,
        stream: body.stream,
        options: {
            temperature: body.temperature,
            topP: body.topP,
            maxTokens: body.maxTokens,
            thinking: body.thinking
        }
    };

    if (body.stream) {
      // Handle Streaming (SSE)
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
        // Send error as a normal data event so the frontend sees it easily without event parsing
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        res.end();
      }

    } else {
      // Handle Standard Response
      const response = await provider.generate({ ...generateParams, stream: false });
      
      res.json({ content: response });
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
