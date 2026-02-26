/**
 * translation-service.ts — Multilingual translation using AI4Bharat IndicTrans2
 * 
 * Supports translation between English and Indian languages:
 * Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia
 */

import { API_CONFIG, type SupportedLanguage, SUPPORTED_LANGUAGES } from './api-config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TranslationRequest {
  text: string;
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
}

export interface TranslationResponse {
  translatedText: string;
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
  confidence?: number;
}

export interface BatchTranslationRequest {
  texts: string[];
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
}

// ── AI4Bharat IndicTrans2 Translation ────────────────────────────────────────

/**
 * Translate text using AI4Bharat IndicTrans2 API
 */
export async function translateWithAI4Bharat(
  request: TranslationRequest
): Promise<TranslationResponse> {
  const { text, sourceLang, targetLang } = request;

  // If same language, return as-is
  if (sourceLang === targetLang) {
    return { translatedText: text, sourceLang, targetLang, confidence: 1.0 };
  }

  const apiKey = API_CONFIG.ai4bharat.apiKey;
  if (!apiKey) {
    console.warn('AI4Bharat API key not configured, using fallback translation');
    return fallbackTranslation(request);
  }

  try {
    const response = await fetch(`${API_CONFIG.ai4bharat.baseUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text,
        source_language: SUPPORTED_LANGUAGES[sourceLang].ai4bharatCode,
        target_language: SUPPORTED_LANGUAGES[targetLang].ai4bharatCode,
        model: API_CONFIG.ai4bharat.translationModel,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI4Bharat API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      translatedText: data.translated_text || data.translation || text,
      sourceLang,
      targetLang,
      confidence: data.confidence,
    };
  } catch (error) {
    console.error('AI4Bharat translation error:', error);
    return fallbackTranslation(request);
  }
}

/**
 * Translate using Sarvam AI as alternative
 */
export async function translateWithSarvam(
  request: TranslationRequest
): Promise<TranslationResponse> {
  const { text, sourceLang, targetLang } = request;

  if (sourceLang === targetLang) {
    return { translatedText: text, sourceLang, targetLang, confidence: 1.0 };
  }

  const apiKey = API_CONFIG.sarvam.apiKey;
  if (!apiKey) {
    return translateWithAI4Bharat(request);
  }

  try {
    const response = await fetch(`${API_CONFIG.sarvam.baseUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Subscription-Key': apiKey,
      },
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        speaker_gender: 'neutral',
        mode: 'formal',
        enable_preprocessing: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Sarvam API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      translatedText: data.translated_text || text,
      sourceLang,
      targetLang,
    };
  } catch (error) {
    console.error('Sarvam translation error:', error);
    return translateWithAI4Bharat(request);
  }
}

/**
 * Translate using Groq Llama as fallback (fast, capable of Indian languages)
 */
export async function translateWithGroq(
  request: TranslationRequest
): Promise<TranslationResponse> {
  const { text, sourceLang, targetLang } = request;

  if (sourceLang === targetLang) {
    return { translatedText: text, sourceLang, targetLang, confidence: 1.0 };
  }

  const apiKey = API_CONFIG.groq.apiKey;
  if (!apiKey) {
    return fallbackTranslation(request);
  }

  const sourceLanguageName = SUPPORTED_LANGUAGES[sourceLang].name;
  const targetLanguageName = SUPPORTED_LANGUAGES[targetLang].name;

  try {
    const response = await fetch(`${API_CONFIG.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: API_CONFIG.groq.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in Indian languages. Translate the following text from ${sourceLanguageName} to ${targetLanguageName}. Maintain technical terms in English when appropriate. Output ONLY the translated text, no explanations.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content?.trim() || text;

    return {
      translatedText,
      sourceLang,
      targetLang,
    };
  } catch (error) {
    console.error('Groq translation error:', error);
    return fallbackTranslation(request);
  }
}

// ── Main Translation Function ────────────────────────────────────────────────

/**
 * Main translation function - tries AI4Bharat first, then Sarvam, then Groq
 */
export async function translate(
  request: TranslationRequest
): Promise<TranslationResponse> {
  // Try AI4Bharat first (best for Indic languages)
  if (API_CONFIG.ai4bharat.apiKey) {
    return translateWithAI4Bharat(request);
  }

  // Try Sarvam as second option
  if (API_CONFIG.sarvam.apiKey) {
    return translateWithSarvam(request);
  }

  // Try Groq Llama as fallback
  if (API_CONFIG.groq.apiKey) {
    return translateWithGroq(request);
  }

  // Last resort fallback
  return fallbackTranslation(request);
}

/**
 * Batch translate multiple texts
 */
export async function batchTranslate(
  request: BatchTranslationRequest
): Promise<TranslationResponse[]> {
  const { texts, sourceLang, targetLang } = request;
  
  // Translate in parallel
  const results = await Promise.all(
    texts.map(text => translate({ text, sourceLang, targetLang }))
  );
  
  return results;
}

/**
 * Detect language of text (using Groq)
 */
export async function detectLanguage(text: string): Promise<SupportedLanguage> {
  const apiKey = API_CONFIG.groq.apiKey;
  if (!apiKey) {
    return 'en'; // Default to English
  }

  try {
    const response = await fetch(`${API_CONFIG.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: API_CONFIG.groq.model,
        messages: [
          {
            role: 'system',
            content: `Detect the language of the following text. Respond with ONLY the ISO 639-1 language code (en, hi, ta, te, bn, mr, gu, kn, ml, pa, or). If unsure, respond with "en".`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      return 'en';
    }

    const data = await response.json();
    const detectedCode = data.choices?.[0]?.message?.content?.trim().toLowerCase() as SupportedLanguage;

    if (detectedCode in SUPPORTED_LANGUAGES) {
      return detectedCode;
    }
    return 'en';
  } catch {
    return 'en';
  }
}

// ── Fallback Translation ─────────────────────────────────────────────────────

/**
 * Fallback translation when no API is available
 * Returns original text with a note
 */
function fallbackTranslation(request: TranslationRequest): TranslationResponse {
  const { text, sourceLang, targetLang } = request;
  
  // For Hindi<->English, provide basic static translations for common phrases
  if (sourceLang === 'hi' && targetLang === 'en') {
    const hiToEn: Record<string, string> = {
      'नमस्ते': 'Hello',
      'धन्यवाद': 'Thank you',
      'हाँ': 'Yes',
      'नहीं': 'No',
      'कृपया': 'Please',
    };
    const translated = hiToEn[text.trim()];
    if (translated) {
      return { translatedText: translated, sourceLang, targetLang };
    }
  }

  if (sourceLang === 'en' && targetLang === 'hi') {
    const enToHi: Record<string, string> = {
      'Hello': 'नमस्ते',
      'Thank you': 'धन्यवाद',
      'Yes': 'हाँ',
      'No': 'नहीं',
      'Please': 'कृपया',
    };
    const translated = enToHi[text.trim()];
    if (translated) {
      return { translatedText: translated, sourceLang, targetLang };
    }
  }

  // Return original with note if no translation available
  return {
    translatedText: text,
    sourceLang,
    targetLang,
    confidence: 0,
  };
}

// ── Utility Functions ────────────────────────────────────────────────────────

/**
 * Create a "Samjhao" (explanation) in the target language
 * Used for explaining technical concepts in vernacular
 */
export async function createSamjhao(
  technicalConcept: string,
  explanation: string,
  targetLang: SupportedLanguage
): Promise<string> {
  if (targetLang === 'en') {
    return explanation;
  }

  const translated = await translate({
    text: explanation,
    sourceLang: 'en',
    targetLang,
  });

  return translated.translatedText;
}

/**
 * Translate a chat message while preserving code blocks and technical terms
 */
export async function translateChatMessage(
  message: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage
): Promise<string> {
  if (sourceLang === targetLang) {
    return message;
  }

  // Extract code blocks to preserve them
  const codeBlockRegex = /```[\s\S]*?```|`[^`]+`/g;
  const codeBlocks: string[] = [];
  const placeholder = '___CODE_BLOCK___';
  
  const textWithPlaceholders = message.replace(codeBlockRegex, (match) => {
    codeBlocks.push(match);
    return placeholder + (codeBlocks.length - 1) + '___';
  });

  // Translate the text
  const translated = await translate({
    text: textWithPlaceholders,
    sourceLang,
    targetLang,
  });

  // Restore code blocks
  let result = translated.translatedText;
  codeBlocks.forEach((block, i) => {
    result = result.replace(`${placeholder}${i}___`, block);
  });

  return result;
}
