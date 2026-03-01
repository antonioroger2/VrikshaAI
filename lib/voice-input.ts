/**
 * voice-input.ts — Voice Ingestion Service (Node 1: Vernacular Q/A Pipeline)
 *
 * Implements:
 *  1. Browser MediaRecorder API for capturing audio blobs.
 *  2. Groq Whisper ASR (primary) for transcription.
 *  3. Fallback to turbo model if rate limited.
 *  4. Spoken language auto-detection.
 *
 * The audio is recorded as WebM/Opus (Chrome/Edge) or audio/mp4 (Safari),
 * then POSTed as multipart/form-data to the ASR endpoint.
 */

import { API_CONFIG, type SupportedLanguage, SUPPORTED_LANGUAGES } from './api-config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceRecordingState {
  isRecording: boolean;
  audioBlob: Blob | null;
  error: string | null;
  transcribedText: string | null;
  detectedLanguage: SupportedLanguage | null;
}

export interface TranscriptionResult {
  text: string;
  language: SupportedLanguage;
  confidence: number;
  duration_ms: number;
}

export interface RecordingHandle {
  /** Stop recording and return the captured audio blob */
  stop: () => Promise<Blob>;
  /** Abort recording without producing a blob */
  cancel: () => void;
  /** Live duration in ms (updated every ~250ms) */
  elapsed: () => number;
}

export interface TTSRequest {
  text: string;
  language: SupportedLanguage;
  voice?: string;
}

export interface TTSResult {
  audioBlob: Blob;
  duration_ms: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum recording duration before auto-stop (ms) */
const MAX_RECORDING_MS = 60_000;

/** Maximum audio file size (25MB) */
const MAX_AUDIO_SIZE_MB = 25;

/** Preferred MIME types in order of priority */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/wav',
];

// ── Browser Capability Detection ─────────────────────────────────────────────

/** Returns true when the browser supports voice recording */
export function isVoiceInputSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/** Pick the best supported audio MIME type for this browser */
function pickMimeType(): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return ''; // let the browser pick its default
}

// ── Audio Recording (Browser MediaRecorder API) ──────────────────────────────

/**
 * Start recording from the user's microphone.
 *
 * Returns a `RecordingHandle` whose `.stop()` resolves with the captured
 * audio Blob, or `.cancel()` to discard.
 *
 * The recording will auto-stop after `maxDuration` ms.
 */
export async function startRecording(
  maxDuration: number = MAX_RECORDING_MS,
): Promise<RecordingHandle> {
  if (!isVoiceInputSupported()) {
    throw new Error(VOICE_INPUT_STATUS.BROWSER_NOT_SUPPORTED);
  }

  // Request microphone permission
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,     // ASR models prefer 16 kHz
        channelCount: 1,       // mono
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error(VOICE_INPUT_STATUS.PERMISSION_DENIED);
    }
    throw new Error(`Microphone access failed: ${(err as Error).message}`);
  }

  const mimeType = pickMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 64_000,
  });

  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let stopped = false;

  // Collect audio data
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Request data every 250ms for smoother streaming
  mediaRecorder.start(250);

  // Auto-stop timer
  const autoStopTimer = setTimeout(() => {
    if (!stopped && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, maxDuration);

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    mediaRecorder.onstop = () => {
      stopped = true;
      clearTimeout(autoStopTimer);
      // Release mic
      stream.getTracks().forEach((track) => track.stop());

      if (chunks.length === 0) {
        reject(new Error('No audio data captured'));
        return;
      }

      const blob = new Blob(chunks, {
        type: mimeType || 'audio/webm',
      });
      resolve(blob);
    };

    mediaRecorder.onerror = (event) => {
      stopped = true;
      clearTimeout(autoStopTimer);
      stream.getTracks().forEach((track) => track.stop());
      reject(new Error(`Recording error: ${(event as ErrorEvent).message ?? 'unknown'}`));
    };
  });

  return {
    stop: () => {
      if (!stopped && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      return stopPromise;
    },
    cancel: () => {
      stopped = true;
      clearTimeout(autoStopTimer);
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      stream.getTracks().forEach((track) => track.stop());
    },
    elapsed: () => Date.now() - startedAt,
  };
}

/**
 * Stop an existing MediaRecorder and return the audio blob.
 * (Legacy compat — prefer using the RecordingHandle from startRecording.)
 */
export async function stopRecording(recorder: MediaRecorder): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      if (chunks.length === 0) {
        reject(new Error('No audio data captured'));
        return;
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };

    recorder.onerror = () => reject(new Error('Recording error'));

    if (recorder.state === 'recording') {
      recorder.stop();
    } else {
      reject(new Error('MediaRecorder is not recording'));
    }
  });
}

// ── Transcription (AI4Bharat Saaras ASR) ─────────────────────────────────────

/**
 * Transcribe an audio blob using Groq Whisper ASR API.
 *
 * Falls back to turbo model if rate limit is low.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  preferredLanguage?: SupportedLanguage,
): Promise<TranscriptionResult> {
  // Check file size limit
  const sizeMB = audioBlob.size / (1024 * 1024);
  if (sizeMB > MAX_AUDIO_SIZE_MB) {
    throw new Error(`Audio file too large: ${sizeMB.toFixed(2)}MB (max ${MAX_AUDIO_SIZE_MB}MB)`);
  }

  const groqKey = API_CONFIG.groqAsr.apiKey;
  if (!groqKey) {
    throw new Error(VOICE_INPUT_STATUS.API_NOT_CONFIGURED);
  }

  try {
    return await transcribeWithGroq(audioBlob, preferredLanguage, API_CONFIG.groqAsr.model);
  } catch (err) {
    console.warn('[voice-input] Groq ASR failed, trying turbo fallback:', err);
    // Check if it's rate limit, but since we check headers, perhaps fallback always or check error
    try {
      return await transcribeWithGroq(audioBlob, preferredLanguage, API_CONFIG.groqAsr.fallbackModel);
    } catch (fallbackErr) {
      console.warn('[voice-input] Turbo ASR also failed:', fallbackErr);
      throw new Error('ASR providers failed. Please try again.');
    }
  }
}

// ── Groq Whisper ASR ─────────────────────────────────────────────────────

/**
 * POST audio to Groq Whisper ASR endpoint.
 *
 * API contract:
 *   POST {baseUrl}/openai/v1/audio/transcriptions
 *   Content-Type: multipart/form-data
 *   Authorization: Bearer {apiKey}
 *
 *   Form fields:
 *     file        — binary audio file
 *     model       — e.g. 'whisper-large-v3'
 *     language    — ISO 639-1 code (optional)
 *
 *   Response JSON:
 *     { text, language, duration }
 */
async function transcribeWithGroq(
  audioBlob: Blob,
  preferredLanguage?: SupportedLanguage,
  model: string,
): Promise<TranscriptionResult> {
  const apiKey = API_CONFIG.groqAsr.apiKey;
  const baseUrl = API_CONFIG.groqAsr.baseUrl;

  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${extensionForBlob(audioBlob)}`);
  formData.append('model', model);

  if (preferredLanguage) {
    formData.append('language', preferredLanguage);
  }

  const response = await fetch(`${baseUrl}/openai/v1/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  // Check rate limit headers
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (remaining && parseInt(remaining) < 10) {
    console.warn(`[voice-input] Low rate limit remaining: ${remaining}, consider fallback`);
    // But since we call this function with model, we can throw to trigger fallback
    if (model !== API_CONFIG.groqAsr.fallbackModel) {
      throw new Error('Rate limit low, switching to fallback model');
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Groq ASR error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  return {
    text: (data.text ?? '').trim(),
    language: normalizeLanguageCode(data.language ?? preferredLanguage ?? 'en'),
    confidence: 0.9, // Groq doesn't return confidence
    duration_ms: data.duration ? data.duration * 1000 : 0,
  };
}

// ── Language Detection from Audio ────────────────────────────────────────────

/**
 * Detect the spoken language from an audio blob.
 *
 * Uses AI4Bharat ASR with language='auto' to identify the language.
 * If that fails, falls back to a heuristic.
 */
export async function detectSpokenLanguage(audioBlob: Blob): Promise<SupportedLanguage> {
  try {
    // Transcribe with auto-detection
    const result = await transcribeAudio(audioBlob);
    return result.language;
  } catch {
    return 'en'; // Default to English on failure
  }
}

// ── React-compatible Voice Input Hook ────────────────────────────────────────

/**
 * State machine for voice input in React components.
 *
 * Usage (call from a React component with useState/useRef):
 * ```ts
 * const voice = createVoiceInputController();
 * // Start recording
 * await voice.start('hi');
 * // Stop and get transcription
 * const result = await voice.stopAndTranscribe();
 * ```
 */
export interface VoiceInputController {
  start: (preferredLanguage?: SupportedLanguage) => Promise<void>;
  stopAndTranscribe: () => Promise<TranscriptionResult>;
  cancel: () => void;
  getState: () => VoiceRecordingState;
}

export function createVoiceInputController(): VoiceInputController {
  let state: VoiceRecordingState = {
    isRecording: false,
    audioBlob: null,
    error: null,
    transcribedText: null,
    detectedLanguage: null,
  };
  let currentHandle: RecordingHandle | null = null;
  let preferredLang: SupportedLanguage | undefined;

  return {
    async start(preferred?: SupportedLanguage) {
      if (state.isRecording) return;
      state = {
        isRecording: true,
        audioBlob: null,
        error: null,
        transcribedText: null,
        detectedLanguage: null,
      };
      preferredLang = preferred;

      try {
        currentHandle = await startRecording();
      } catch (err) {
        state.isRecording = false;
        state.error = (err as Error).message;
        throw err;
      }
    },

    async stopAndTranscribe(): Promise<TranscriptionResult> {
      if (!currentHandle) {
        throw new Error('Not recording');
      }

      try {
        const blob = await currentHandle.stop();
        state.isRecording = false;
        state.audioBlob = blob;

        const result = await transcribeAudio(blob, preferredLang);
        state.transcribedText = result.text;
        state.detectedLanguage = result.language;
        currentHandle = null;
        return result;
      } catch (err) {
        state.isRecording = false;
        state.error = (err as Error).message;
        currentHandle = null;
        throw err;
      }
    },

    cancel() {
      if (currentHandle) {
        currentHandle.cancel();
        currentHandle = null;
      }
      state.isRecording = false;
    },

    getState() {
      return { ...state };
    },
  };
}

/**
 * React hook for voice input.
 *
 * Must be called inside a React component — uses `useState` and `useEffect`
 * which are imported lazily to avoid issues in non-React contexts.
 *
 * Returns a controller object with start/stop/cancel and reactive state.
 */
export function useVoiceInput() {
  // Lazy require React hooks to avoid breaking non-React contexts
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const React = require('react') as typeof import('react');
  const { useState, useRef, useCallback, useEffect } = React;

  const [isRecording, setIsRecording] = useState(false);
  const [transcribedText, setTranscribedText] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<SupportedLanguage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleRef = useRef<RecordingHandle | null>(null);
  const preferredLangRef = useRef<SupportedLanguage | undefined>(undefined);

  const start = useCallback(async (preferredLanguage?: SupportedLanguage) => {
    setError(null);
    setTranscribedText(null);
    setDetectedLanguage(null);
    preferredLangRef.current = preferredLanguage;

    try {
      const handle = await startRecording();
      handleRef.current = handle;
      setIsRecording(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const stopAndTranscribe = useCallback(async (): Promise<TranscriptionResult | null> => {
    const handle = handleRef.current;
    if (!handle) return null;

    try {
      const blob = await handle.stop();
      setIsRecording(false);
      handleRef.current = null;

      setIsTranscribing(true);
      const result = await transcribeAudio(blob, preferredLangRef.current);
      setTranscribedText(result.text);
      setDetectedLanguage(result.language);
      setIsTranscribing(false);
      return result;
    } catch (err) {
      setIsRecording(false);
      setIsTranscribing(false);
      setError((err as Error).message);
      handleRef.current = null;
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel();
      handleRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.cancel();
      }
    };
  }, []);

  return {
    isRecording,
    isTranscribing,
    transcribedText,
    detectedLanguage,
    error,
    start,
    stopAndTranscribe,
    cancel,
    isSupported: isVoiceInputSupported(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get file extension for an audio blob based on its MIME type */
function extensionForBlob(blob: Blob): string {
  const mime = blob.type;
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm'; // default
}

/** Normalize language code from various formats to our SupportedLanguage key */
function normalizeLanguageCode(code: string): SupportedLanguage {
  // Strip region (e.g. 'hi-IN' → 'hi')
  const base = code.toLowerCase().split(/[-_]/)[0];

  if (base in SUPPORTED_LANGUAGES) {
    return base as SupportedLanguage;
  }

  // Common aliases
  const aliases: Record<string, SupportedLanguage> = {
    hindi: 'hi',
    tamil: 'ta',
    telugu: 'te',
    bengali: 'bn',
    marathi: 'mr',
    gujarati: 'gu',
    kannada: 'kn',
    malayalam: 'ml',
    punjabi: 'pa',
    odia: 'or',
    oriya: 'or',
    english: 'en',
  };

  return aliases[base] ?? 'en';
}

// ── Text-to-Speech (Free Alternatives) ──────────────────────────────────────

/**
 * Synthesize speech from text using free TTS APIs.
 *
 * Tries Google TTS first, then Microsoft TTS.
 */
export async function synthesizeSpeech(request: TTSRequest): Promise<TTSResult> {
  // Try Google TTS first
  if (API_CONFIG.googleTts.apiKey) {
    try {
      return await synthesizeWithGoogle(request);
    } catch (err) {
      console.warn('[voice-input] Google TTS failed, trying Microsoft:', err);
    }
  }

  // Try Microsoft TTS
  if (API_CONFIG.microsoftTts.apiKey) {
    try {
      return await synthesizeWithMicrosoft(request);
    } catch (err) {
      console.warn('[voice-input] Microsoft TTS failed:', err);
    }
  }

  throw new Error('No TTS API configured or both failed.');
}

/**
 * Synthesize with Google Text-to-Speech API.
 */
async function synthesizeWithGoogle(request: TTSRequest): Promise<TTSResult> {
  const apiKey = API_CONFIG.googleTts.apiKey;
  const baseUrl = API_CONFIG.googleTts.baseUrl;

  const payload = {
    input: { text: request.text },
    voice: {
      languageCode: request.language === 'en' ? 'en-US' : `${request.language}-IN`,
      name: request.voice || 'en-US-Neural2-D',
    },
    audioConfig: {
      audioEncoding: 'MP3',
    },
  };

  const response = await fetch(`${baseUrl}/v1/text:synthesize?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Google TTS error (${response.status})`);
  }

  const data = await response.json();
  const audioContent = data.audioContent;
  const audioBlob = new Blob([Uint8Array.from(atob(audioContent), c => c.charCodeAt(0))], { type: 'audio/mp3' });

  return {
    audioBlob,
    duration_ms: 0, // Estimate or leave as 0
  };
}

/**
 * Synthesize with Microsoft Azure Text-to-Speech API.
 */
async function synthesizeWithMicrosoft(request: TTSRequest): Promise<TTSResult> {
  const apiKey = API_CONFIG.microsoftTts.apiKey;
  const baseUrl = API_CONFIG.microsoftTts.baseUrl;

  const ssml = `<speak version='1.0' xml:lang='${request.language === 'en' ? 'en-US' : `${request.language}-IN`}'><voice name='${request.voice || 'en-US-AriaNeural'}'>${request.text}</voice></speak>`;

  const response = await fetch(`${baseUrl}/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Microsoft TTS error (${response.status})`);
  }

  const audioBlob = await response.blob();

  return {
    audioBlob,
    duration_ms: 0,
  };
}

// ── Tamil Voice Workflow ────────────────────────────────────────────────────

/**
 * Process voice input in Tamil: ASR -> Translate to English -> Socratic Interview -> Translate to Tamil -> TTS
 */
export async function processTamilVoiceWorkflow(audioBlob: Blob): Promise<{ text: string; audioBlob: Blob }> {
  // 1. ASR to Tamil
  const transcription = await transcribeAudio(audioBlob, 'ta');
  const tamilText = transcription.text;

  // 2. Translate Tamil to English
  const { translate } = await import('./translation-service');
  const englishTranslation = await translate({
    text: tamilText,
    sourceLang: 'ta' as SupportedLanguage,
    targetLang: 'en' as SupportedLanguage,
  });

  // 3. Prompt Socratic interview (using Groq)
  const socraticPrompt = `You are a Socratic interviewer. Ask thoughtful, probing questions to help the user explore their ideas deeply. Respond to: "${englishTranslation.translatedText}"`;
  const socraticResponse = await generateSocraticResponse(socraticPrompt);

  // 4. Translate response to Tamil
  const tamilResponse = await translate({
    text: socraticResponse,
    sourceLang: 'en' as SupportedLanguage,
    targetLang: 'ta' as SupportedLanguage,
  });

  // 5. TTS to Tamil
  const ttsResult = await synthesizeSpeech({
    text: tamilResponse.translatedText,
    language: 'ta',
  });

  return {
    text: tamilResponse.translatedText,
    audioBlob: ttsResult.audioBlob,
  };
}

/**
 * Generate Socratic response using Groq
 */
async function generateSocraticResponse(prompt: string): Promise<string> {
  const response = await fetch(`${API_CONFIG.groq.baseUrl}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_CONFIG.groq.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: API_CONFIG.groq.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── Status Constants ─────────────────────────────────────────────────────────

export const VOICE_INPUT_STATUS = {
  READY: 'Voice input ready',
  RECORDING: 'Recording...',
  TRANSCRIBING: 'Transcribing...',
  BROWSER_NOT_SUPPORTED: 'Voice input not supported in this browser. Use Chrome or Firefox on desktop.',
  PERMISSION_DENIED: 'Microphone access denied — please enable in browser settings.',
  API_NOT_CONFIGURED: 'No ASR API key configured. Set NEXT_PUBLIC_GROQ_API_KEY in .env',
  NETWORK_ERROR: 'Network error during transcription. Please check your connection.',
} as const;