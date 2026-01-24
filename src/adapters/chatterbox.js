import { BaseAdapter } from './base.js';

export class ChatterboxAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    // Base URL is usually passed per model config, but we can have a default
    this.defaultBaseUrl = 'http://localhost:8000';
  }

  async health() {
    // We check the specific model's URL if provided, or default
    const url = this.config.baseUrl || this.defaultBaseUrl;
    try {
      const res = await fetch(`${url}/health`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  /**
   * Helper to fetch available voice samples from the server.
   * This is specific to Chatterbox and might be called via a custom route later.
   */
  async getVoices(baseUrl) {
    const url = baseUrl || this.defaultBaseUrl;
    try {
      const res = await fetch(`${url}/voices`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.voices || [];
    } catch (e) {
      console.error('Failed to fetch voices:', e);
      return [];
    }
  }

  async generate(params) {
    const { model, options, baseUrl } = params;
    const url = baseUrl || this.defaultBaseUrl;

    // Map universal params to Chatterbox specific params
    // 'messages' is not really relevant for TTS unless we treat the last user message as the text to speak.
    // Let's assume the text comes from the 'prompt' or the last message content.
    const textToSpeak = params.prompt || params.messages?.[params.messages.length - 1]?.content;

    if (!textToSpeak) {
        throw new Error('No text provided for TTS generation');
    }

    const payload = {
      text: textToSpeak,
      language_id: options?.languageId || 'en', // Default to English
      exaggeration: options?.exaggeration !== undefined ? options.exaggeration : 0.5,
      cfg: options?.cfg !== undefined ? options.cfg : 0.5,
      voice_sample: options?.voiceSample, // e.g., 'test.wav'
      // output_filename: optional, server generates one if omitted
    };

    console.log(`[ChatterboxAdapter] Generating audio at ${url}/tts`, payload);

    const response = await fetch(`${url}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Chatterbox API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // The server returns 'download_url' (e.g. "/outputs/file.wav")
    // We construct the full URL so the frontend can access it directly.
    // Note: This assumes the frontend can access the Chatterbox server (localhost:8000).
    // If running in Docker/Network, the 'url' variable here (e.g. http://chatterbox:8000) 
    // might not be accessible to the user's browser (localhost:8000).
    // Ideally, we should return the relative URL and let the frontend/API decide the host,
    // OR we assume the provider config 'baseUrl' is the external facing URL.
    
    // Let's return the full URL using the configured base URL.
    // Ensure no double slashes if baseUrl ends with /
    const baseUrlClean = url.replace(/\/$/, '');
    const downloadPath = data.download_url.startsWith('/') ? data.download_url : `/${data.download_url}`;
    const fullAudioUrl = `${baseUrlClean}${downloadPath}`;

    return {
        type: 'audio',
        // We use the direct URL now, no need for internal path
        audioUrl: fullAudioUrl,
        duration: data.duration_seconds ? parseFloat(data.duration_seconds.toFixed(2)) : 0,
        usedVoice: data.used_voice
    };
  }
}

