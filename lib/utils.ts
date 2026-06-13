/**
 * Utility functions for VRIKSHA.ai
 */

import { waitForCapacity } from './redis-queue';

// ── Provider type ────────────────────────────────────────────────────────────

export type ApiProvider = 'groq' | 'bedrock' | 'qwen' | 'gemini';

// ── Dumb exponential backoff (internal legacy / kept for non-LLM calls) ──────

export async function withRetries<T>(
  apiCall: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s…
      console.warn(`API error, retrying in ${waitTime}ms (Attempt ${attempt + 1}/${maxRetries})...`, error);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error("API request failed after maximum retries.");
}

// ── Smart Redis-backed rate-limit queue ──────────────────────────────────────

/**
 * Wraps an API call with:
 *   1. Redis token-bucket gating (waitlist if RPM/TPM saturated)
 *   2. 3-attempt retry on transient errors / 429s
 *
 * @param provider        - Which AI provider ('groq' | 'bedrock' | 'qwen' | 'gemini')
 * @param estimatedTokens - Expected token usage for this call (used for TPM tracking)
 * @param apiCall         - The actual fetch/API call to make
 * @param onStatus        - Optional UI status callback; fires on waitlist and retries
 * @param maxRetries      - Number of attempts after the queue clears (default 3)
 */
export async function withSmartRetries<T>(
  provider: ApiProvider,
  estimatedTokens: number,
  apiCall: () => Promise<T>,
  onStatus?: (status: string) => void,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // ── 1. Gate on the Redis token bucket ─────────────────────────────────
      await waitForCapacity(provider, estimatedTokens, (position, waitTimeMs) => {
        const seconds = Math.ceil(waitTimeMs / 1000);
        onStatus?.(
          `🚦 High traffic. Waitlisted at position ${position}. Retrying in ${seconds}s…`
        );
      });

      // ── 2. Fire the API call ───────────────────────────────────────────────
      return await apiCall();

    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;

      // Surface 429s with a longer back-off; other errors use exponential
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit =
        msg.includes('429') ||
        (error as { status?: number })?.status === 429;

      let waitTime = isRateLimit ? 10_000 : Math.pow(2, attempt) * 1_000;
      
      // Parse precise wait time from Groq error message if present
      if (isRateLimit) {
        const match = msg.match(/try again in (\d+(?:\.\d+)?)s/);
        if (match && match[1]) {
          waitTime = (parseFloat(match[1]) * 1000) + 1500; // Add 1.5s buffer
        }
      }

      onStatus?.(
        `⚠️ Rate limit. Retrying in ${(waitTime / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})…`
      );
      console.warn(`[${provider}] attempt ${attempt} failed, waiting ${waitTime}ms…`, error);

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error(`API request to ${provider} failed after ${maxRetries} retries.`);
}