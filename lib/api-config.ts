/**
 * api-config.ts — Configuration for all external API services
 * 
 * VRIKSHA.ai LangGraph Multi-Agent System
 * - AI4Bharat (IndicTrans2 & Saaras ASR) for vernacular speech
 * - Amazon Bedrock (Claude 3.5 Sonnet) for Socratic planning
 * - Groq (Llama-3.3-70b) for ultra-low latency planning
 * - Qwen3 Coder (free) for AST-aware code editing
 * - Local Gemma 3 (via @xenova/transformers) for code review and documentation
 * - Local Nomic Embed (via @xenova/transformers) for vector retrieval
 */

// ── Environment Variables ────────────────────────────────────────────────────

export const API_CONFIG = {
  // AI4Bharat - Vernacular Speech Recognition & Translation
  /*
  ai4bharat: {
    baseUrl: process.env.NEXT_PUBLIC_AI4BHARAT_BASE_URL || 'https://api.ai4bharat.org',
    apiKey: process.env.NEXT_PUBLIC_AI4BHARAT_API_KEY || '',
    asrModel: process.env.NEXT_PUBLIC_AI4BHARAT_ASR_MODEL || 'saaras-v3',
    translationModel: process.env.NEXT_PUBLIC_AI4BHARAT_TRANSLATION_MODEL || 'indictrans2',
  },
  */

  // Sarvam AI - Alternative vernacular speech
  /*
  sarvam: {
    baseUrl: process.env.NEXT_PUBLIC_SARVAM_BASE_URL || 'https://api.sarvam.ai',
    apiKey: process.env.NEXT_PUBLIC_SARVAM_API_KEY || '',
  },
  */

  // Amazon Bedrock - Claude 3.5 Sonnet for Socratic Planning
  bedrock: {
    baseUrl: process.env.NEXT_PUBLIC_BEDROCK_BASE_URL || 'https://bedrock.aws.com',
    apiKey: process.env.NEXT_PUBLIC_BEDROCK_API_KEY || '',
    model: process.env.NEXT_PUBLIC_BEDROCK_MODEL || 'claude-3-5-sonnet',
  },

  // Groq - Llama-3.3-70b for ultra-low latency
  groq: {
    baseUrl: process.env.NEXT_PUBLIC_GROQ_BASE_URL || 'https://api.groq.com',
    apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY || '',
    model: process.env.NEXT_PUBLIC_GROQ_MODEL || 'llama-3-70b',
  },

  // Groq ASR - Whisper for speech recognition
  groqAsr: {
    baseUrl: process.env.NEXT_PUBLIC_GROQ_BASE_URL || 'https://api.groq.com',
    apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY || '',
    model: process.env.NEXT_PUBLIC_GROQ_ASR_MODEL || 'whisper-large-v3',
    fallbackModel: process.env.NEXT_PUBLIC_GROQ_ASR_FALLBACK_MODEL || 'whisper-large-v3-turbo',
  },

  // Google TTS - Free tier text-to-speech
  googleTts: {
    baseUrl: process.env.NEXT_PUBLIC_GOOGLE_TTS_BASE_URL || 'https://texttospeech.googleapis.com',
    apiKey: process.env.NEXT_PUBLIC_GOOGLE_TTS_API_KEY || '',
  },

  // Microsoft TTS - Free tier text-to-speech
  microsoftTts: {
    baseUrl: process.env.NEXT_PUBLIC_MICROSOFT_TTS_BASE_URL || 'https://speech.microsoft.com',
    apiKey: process.env.NEXT_PUBLIC_MICROSOFT_TTS_API_KEY || '',
  },

  // Qwen3 Coder - AST-aware code editing (free via OpenRouter)
  qwen: {
    baseUrl: process.env.NEXT_PUBLIC_QWEN_BASE_URL || 'https://openrouter.ai',
    apiKey: process.env.NEXT_PUBLIC_QWEN_API_KEY || '',
    model: process.env.NEXT_PUBLIC_QWEN_MODEL || 'qwen/qwen3-coder:free',
  },

  // Google Gemini (Gemma) - Reflection & Verification
  gemini: {
    baseUrl: process.env.NEXT_PUBLIC_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    model: process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemma-2-9b-it',
  },

  // Local Nomic Embed - Vector retrieval for code (via @xenova/transformers)
  nomic: {
    baseUrl: process.env.NEXT_PUBLIC_NOMIC_BASE_URL || 'https://api.nomic.ai',
    apiKey: process.env.NEXT_PUBLIC_NOMIC_API_KEY || '',
    model: process.env.NEXT_PUBLIC_NOMIC_MODEL || 'embed-code-v1',
  },

  // AWS S3 - Audio & asset storage
  s3: {
    bucket: process.env.AWS_S3_BUCKET || 'vriksha-assets',
    region: process.env.AWS_REGION || 'ap-south-1',
  },

  // AWS DynamoDB - State management
  dynamodb: {
    baseUrl: process.env.NEXT_PUBLIC_DYNAMODB_BASE_URL || 'https://dynamodb.aws.com',
    apiKey: process.env.NEXT_PUBLIC_DYNAMODB_API_KEY || '',
  },

  // Upstash Redis - Rate limiting and queuing
  upstashRedis: {
    baseUrl: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  },
} as const;

// ── Supported Languages ──────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = {
  en: { name: 'English', nativeName: 'English', ai4bharatCode: 'en' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', ai4bharatCode: 'hi' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', ai4bharatCode: 'ta' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', ai4bharatCode: 'te' },
  bn: { name: 'Bengali', nativeName: 'বাংলা', ai4bharatCode: 'bn' },
  mr: { name: 'Marathi', nativeName: 'मराठी', ai4bharatCode: 'mr' },
  gu: { name: 'Gujarati', nativeName: 'ગુજરાતી', ai4bharatCode: 'gu' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', ai4bharatCode: 'kn' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', ai4bharatCode: 'ml' },
  pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', ai4bharatCode: 'pa' },
  or: { name: 'Odia', nativeName: 'ଓଡ଼ିଆ', ai4bharatCode: 'or' },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// ── Helper to check if APIs are configured ───────────────────────────────────

export function getConfiguredAPIs(): { name: string; configured: boolean }[] {
  return [
    // { name: 'AI4Bharat (ASR)', configured: !!API_CONFIG.ai4bharat.apiKey },
    // { name: 'Sarvam AI', configured: !!API_CONFIG.sarvam.apiKey },
    { name: 'AWS Bedrock', configured: !!API_CONFIG.bedrock.apiKey },
    { name: 'Groq (Llama)', configured: !!API_CONFIG.groq.apiKey },
    { name: 'Groq (ASR)', configured: !!API_CONFIG.groqAsr.apiKey },
    { name: 'Google TTS', configured: !!API_CONFIG.googleTts.apiKey },
    { name: 'Microsoft TTS', configured: !!API_CONFIG.microsoftTts.apiKey },
    { name: 'Qwen3 Coder', configured: !!API_CONFIG.qwen.apiKey },
    { name: 'Local Gemma 3', configured: true }, // Always available
    { name: 'Local Nomic Embed', configured: true }, // Always available
  ];
}

export function isAPIConfigured(api: keyof typeof API_CONFIG): boolean {
  switch (api) {
    // case 'ai4bharat':
    //   return !!API_CONFIG.ai4bharat.apiKey;
    // case 'sarvam':
    //   return !!API_CONFIG.sarvam.apiKey;
    case 'bedrock':
      return !!API_CONFIG.bedrock.apiKey;
    case 'groq':
      return !!API_CONFIG.groq.apiKey;
    case 'groqAsr':
      return !!API_CONFIG.groqAsr.apiKey;
    case 'googleTts':
      return !!API_CONFIG.googleTts.apiKey;
    case 'microsoftTts':
      return !!API_CONFIG.microsoftTts.apiKey;
    case 'qwen':
      return !!API_CONFIG.qwen.apiKey;
    case 'gemini':
      return true; // Local Gemma 3 always available
    case 'nomic':
      return true; // Local embeddings always available
    default:
      return false;
  }
}
