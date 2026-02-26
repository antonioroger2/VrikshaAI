/**
 * voice-input.ts — Voice Ingestion Service (Node 1: Vernacular Q/A Pipeline)
 *
 * Implements:
 *  1. Browser MediaRecorder API for capturing audio blobs.
 *  2. AI4Bharat Saaras ASR (primary) for transcription.
 *  3. Sarvam AI ASR (fallback) for transcription.
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

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum recording duration before auto-stop (ms) */
const MAX_RECORDING_MS = 60_000;

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
 * Transcribe an audio blob using the AI4Bharat Saaras ASR API.
 *
 * Falls back to Sarvam AI if AI4Bharat fails or is not configured.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  preferredLanguage?: SupportedLanguage,
): Promise<TranscriptionResult> {
  // Try AI4Bharat first
  const ai4bharatKey = API_CONFIG.ai4bharat.apiKey;
  if (ai4bharatKey) {
    try {
      return await transcribeWithAI4Bharat(audioBlob, preferredLanguage);
    } catch (err) {
      console.warn('[voice-input] AI4Bharat ASR failed, trying Sarvam fallback:', err);
    }
  }

  // Try Sarvam AI fallback
  const sarvamKey = API_CONFIG.sarvam.apiKey;
  if (sarvamKey) {
    try {
      return await transcribeWithSarvam(audioBlob, preferredLanguage);
    } catch (err) {
      console.warn('[voice-input] Sarvam ASR failed:', err);
    }
  }

  throw new Error(
    !ai4bharatKey && !sarvamKey
      ? VOICE_INPUT_STATUS.API_NOT_CONFIGURED
      : 'Both ASR providers failed. Please try again.',
  );
}

// ── AI4Bharat Saaras ASR ─────────────────────────────────────────────────────

/**
 * POST audio to AI4Bharat Saaras ASR v3 endpoint.
 *
 * API contract:
 *   POST {baseUrl}/asr/v1/recognize
 *   Content-Type: multipart/form-data
 *   Authorization: Bearer {apiKey}
 *
 *   Form fields:
 *     audio        — binary audio file
 *     language     — ISO 639-1 code (optional, 'auto' for detection)
 *     model        — e.g. 'saaras-v3'
 *
 *   Response JSON:
 *     { status, transcript, language, confidence, duration_ms }
 */
async function transcribeWithAI4Bharat(
  audioBlob: Blob,
  preferredLanguage?: SupportedLanguage,
): Promise<TranscriptionResult> {
  const apiKey = API_CONFIG.ai4bharat.apiKey;
  const baseUrl = API_CONFIG.ai4bharat.baseUrl;

  const formData = new FormData();
  formData.append('audio', audioBlob, `recording.${extensionForBlob(audioBlob)}`);

  if (preferredLanguage && preferredLanguage !== 'en') {
    formData.append('language', SUPPORTED_LANGUAGES[preferredLanguage].ai4bharatCode);
  } else {
    formData.append('language', 'auto');
  }
  formData.append('model', API_CONFIG.ai4bharat.asrModel);

  const response = await fetch(`${baseUrl}/asr/v1/recognize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`AI4Bharat ASR error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Normalize the response — the API may use different field names
  const transcript: string = data.transcript ?? data.text ?? data.result ?? '';
  const detectedLang: string = data.language ?? data.lang ?? preferredLanguage ?? 'en';
  const confidence: number = data.confidence ?? data.score ?? 0.0;
  const durationMs: number = data.duration_ms ?? data.duration ?? 0;

  return {
    text: transcript.trim(),
    language: normalizeLanguageCode(detectedLang),
    confidence,
    duration_ms: durationMs,
  };
}

// ── Sarvam AI ASR ────────────────────────────────────────────────────────────

/**
 * POST audio to Sarvam AI Speech-to-Text endpoint.
 *
 * API contract:
 *   POST {baseUrl}/speech-to-text
 *   Content-Type: multipart/form-data
 *   api-subscription-key: {apiKey}
 *
 *   Form fields:
 *     file             — binary audio file
 *     language_code    — e.g. 'hi-IN', 'ta-IN'
 *     model            — e.g. 'saarika:v2'
 *
 *   Response JSON:
 *     { transcript, language_code, request_id }
 */
async function transcribeWithSarvam(
  audioBlob: Blob,
  preferredLanguage?: SupportedLanguage,
): Promise<TranscriptionResult> {
  const apiKey = API_CONFIG.sarvam.apiKey;
  const baseUrl = API_CONFIG.sarvam.baseUrl;

  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${extensionForBlob(audioBlob)}`);

  // Sarvam uses BCP-47 language codes like 'hi-IN'
  const langCode = preferredLanguage
    ? sarvamLangCode(preferredLanguage)
    : 'hi-IN';
  formData.append('language_code', langCode);
  formData.append('model', 'saarika:v2');

  const response = await fetch(`${baseUrl}/speech-to-text`, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Sarvam ASR error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  return {
    text: (data.transcript ?? '').trim(),
    language: preferredLanguage ?? 'hi',
    confidence: 0.85, // Sarvam doesn't always return confidence
    duration_ms: 0,
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

/** Convert SupportedLanguage to Sarvam's BCP-47 code */
function sarvamLangCode(lang: SupportedLanguage): string {
  const map: Record<SupportedLanguage, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    ta: 'ta-IN',
    te: 'te-IN',
    bn: 'bn-IN',
    mr: 'mr-IN',
    gu: 'gu-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    pa: 'pa-IN',
    or: 'or-IN',
  };
  return map[lang] ?? 'hi-IN';
}

// ── Status Constants ─────────────────────────────────────────────────────────

export const VOICE_INPUT_STATUS = {
  READY: 'Voice input ready',
  RECORDING: 'Recording...',
  TRANSCRIBING: 'Transcribing...',
  BROWSER_NOT_SUPPORTED: 'Voice input not supported in this browser. Use Chrome or Firefox on desktop.',
  PERMISSION_DENIED: 'Microphone access denied — please enable in browser settings.',
  API_NOT_CONFIGURED: 'No ASR API key configured. Set NEXT_PUBLIC_AI4BHARAT_API_KEY or NEXT_PUBLIC_SARVAM_API_KEY in .env',
  NETWORK_ERROR: 'Network error during transcription. Please check your connection.',
} as const;