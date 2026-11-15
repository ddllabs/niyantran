// The three model ids, in one place (plan, "Edge Function factcheck"; spec G2a and G2b).

/** Chunked speech to text through OpenRouter's /audio/transcriptions (spec L8). */
export const TRANSCRIPTION_MODEL = 'elevenlabs/scribe-v2';
/** Claim extraction through chat completions with JSON-schema output (spec G2b). */
export const EXTRACTION_MODEL = 'google/gemini-3.8-flash';
/** Fact check through chat completions with JSON-schema output (spec L9, G2b). */
export const CHECK_MODEL = 'perplexity/sonar';

export const OPENROUTER_TRANSCRIPTIONS_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
